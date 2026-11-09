import * as THREE from 'three';
import type { Assets } from './assets';
import { MEDKIT, NUKE, PICKUP, PICKUP_ANIM } from './config';
import { spreadSpots } from './spread';

export type PickupKind = 'ammo' | 'medkit' | 'bomb';

export interface Item {
  kind: PickupKind;
  root: THREE.Group;
  /** 회전, 위아래로 흔들리는 탄창 */
  spin: THREE.Object3D;
  glow: THREE.Mesh;
  phase: number;
  taken: boolean;
  /** 주운 뒤 플레이어 쪽으로 날아가는 진행 시간(초), -1이면 날아가지 않음 */
  flyT: number;
  /** 놓였던 자리(날아가는 동안 root를 옮기므로 끝나면 되돌린다) */
  home: THREE.Vector3;
  /** 떠 있는 높이(발 기준, 모델 중심), 줍는 거리(수평) */
  hover: number;
  radius: number;
  /** 등장 연출: rise 높이에서 hover까지 떠오르는 진행 시간(초), -1이면 끝남 */
  riseT: number;
  riseFrom: number;
}

export interface AddItemOptions {
  hover?: number;
  radius?: number;
  /** 이 높이에서 hover까지 NUKE.riseTime 동안 떠오르며 나타난다 */
  riseFrom?: number;
  /** 바닥 빛 높이(발 기준). 컨테이너 위처럼 바닥이 가려지는 곳에서 쓴다. */
  glowY?: number;
}

/**
 * 아이템: 바닥에서 떠서 돌며 위아래로 흔들린다. 플레이어가 닿으면 줍는다.
 * - 탄창: 예비 탄약이 늘어난다. 모양은 주인공 총(G32)의 탄창 메시를 복제해 쓴다.
 * - 구급상자: 체력을 회복한다. 흰 상자 양면에 빨간 십자.
 * - 핵원자로폭탄: 핵컨테이너를 쏘아 열면 나타난다(addItem). 미션 수집물.
 */
export class Pickups {
  items: Item[] = [];
  /** 탄창 + 위로 삐져나온 탄 하나(멀리서도 탄약으로 읽히게) */
  private mag: THREE.Group;
  private medkit: THREE.Group;
  private bomb: THREE.Group;
  private glowTex: THREE.Texture;
  private time = 0;

  constructor(assets: Assets, private scene: THREE.Scene) {
    const src = assets.gun.scene.getObjectByName('Mag') as THREE.Mesh;
    // 총 안의 위치/회전을 빼고 중심을 원점으로, 가장 긴 변이 PICKUP.size가 되게
    const geo = src.geometry.clone();
    geo.computeBoundingBox();
    const bb = geo.boundingBox!;
    const c = bb.getCenter(new THREE.Vector3());
    const size = bb.getSize(new THREE.Vector3());
    geo.translate(-c.x, -c.y, -c.z);
    const mat = (src.material as THREE.MeshStandardMaterial).clone();
    // 바닥에서 눈에 띄게 살짝 금빛으로 빛나게
    mat.emissive = new THREE.Color(PICKUP.emissive);
    mat.emissiveIntensity = 1;
    const k = PICKUP.size / Math.max(size.x, size.y, size.z);
    const body = new THREE.Mesh(geo, mat);
    body.scale.setScalar(k);
    body.castShadow = true;
    // 탄: 탄창 윗면(+Y, 급탄구)에 앞뒤로 눕혀 얹는다. 탄피(황동) + 탄두(구리)
    const sx = size.x * k, sy = size.y * k, sz = size.z * k;
    const r = Math.min(sx, sz) * 0.3;
    const len = Math.max(sx, sz) * 0.85;
    const brass = new THREE.MeshStandardMaterial({ color: 0xd9a441, metalness: 0.85, roughness: 0.3, emissive: 0x3a2a08 });
    const copper = new THREE.MeshStandardMaterial({ color: 0xc8703a, metalness: 0.85, roughness: 0.3, emissive: 0x2a1206 });
    const round = new THREE.Group();
    const caseM = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len * 0.68, 12), brass);
    caseM.position.y = -len * 0.16;
    const tip = new THREE.Mesh(new THREE.ConeGeometry(r * 0.92, len * 0.32, 12), copper);
    tip.position.y = len * 0.34;
    round.add(caseM, tip);
    // 원기둥 축(Y)을 탄창의 긴 수평축으로 눕힌다
    if (sz >= sx) round.rotation.x = Math.PI / 2;
    else round.rotation.z = -Math.PI / 2;
    round.position.y = sy / 2 + r * 0.7;
    this.mag = new THREE.Group();
    this.mag.add(body, round);
    this.medkit = medkitModel();
    this.bomb = normalizedModel(assets.nukeBomb.scene, NUKE.bombSize);
    this.glowTex = glowTexture();
  }

  /** 아이템 모델 복제본(인벤토리 그림처럼 밖에서도 쓴다) */
  model(kind: PickupKind) {
    const m = (kind === 'medkit' ? this.medkit : kind === 'bomb' ? this.bomb : this.mag).clone();
    // 약간 기울여 세운다(옆면과 윗면이 같이 보이게). 폭탄은 똑바로 세운다.
    if (kind === 'medkit') m.rotation.set(0.2, 0, 0.12);
    else if (kind === 'ammo') m.rotation.set(0.35, 0, 0.25);
    return m;
  }

  /** 한 개를 (x, z)에 놓는다 */
  addItem(kind: PickupKind, x: number, z: number, o: AddItemOptions = {}, phase = Math.random() * Math.PI * 2) {
    const root = new THREE.Group();
    root.position.set(x, 0, z);
    const spin = new THREE.Group();
    spin.add(this.model(kind));
    const color = kind === 'medkit' ? MEDKIT.glowColor : kind === 'bomb' ? NUKE.glowColor : PICKUP.glowColor;
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(PICKUP.glowSize, PICKUP.glowSize),
      new THREE.MeshBasicMaterial({ map: this.glowTex, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = o.glowY ?? 0.02;
    root.add(spin, glow);
    this.scene.add(root);
    const hover = o.hover ?? PICKUP.height;
    const it: Item = {
      kind, root, spin, glow, phase, taken: false, flyT: -1, home: root.position.clone(),
      hover, radius: o.radius ?? PICKUP.radius, riseT: o.riseFrom !== undefined ? 0 : -1, riseFrom: o.riseFrom ?? hover,
    };
    if (it.riseT >= 0) spin.position.y = it.riseFrom;
    this.items.push(it);
    return it;
  }

  /** 맵에 탄창과 구급상자를 골고루 섞어 놓는다(플레이어 시작점에서도 떨어지게) */
  spawn(counts: { ammo: number; medkit: number }, o: { colliders: THREE.Box3[]; area: THREE.Box3; reachable: (x: number, z: number) => boolean; rand: () => number; from: THREE.Vector3; avoid?: THREE.Vector2[] }) {
    // 탄창과 구급상자만 다시 뿌린다(컨테이너에서 나온 폭탄은 그대로)
    for (const it of this.items) if (it.kind !== 'bomb') it.root.removeFromParent();
    this.items = this.items.filter((it) => it.kind === 'bomb');
    const spots = spreadSpots(counts.ammo + counts.medkit, {
      colliders: o.colliders, area: o.area, reachable: o.reachable, rand: o.rand, height: 1.0, margin: 0.5,
      avoid: [new THREE.Vector2(o.from.x, o.from.z), ...(o.avoid ?? [])],
    });
    // 자리는 서로 먼 순서로 나오므로, 종류를 섞어서 한쪽에 몰리지 않게 한다
    const kinds: PickupKind[] = [...Array(counts.ammo).fill('ammo'), ...Array(counts.medkit).fill('medkit')];
    for (let i = kinds.length - 1; i > 0; i--) {
      const j = Math.floor(o.rand() * (i + 1));
      [kinds[i], kinds[j]] = [kinds[j], kinds[i]];
    }
    spots.forEach((p, i) => this.addItem(kinds[i], p.x, p.y, {}, o.rand() * Math.PI * 2));
  }

  /** 떠 있는 움직임과 줍기. onPick이 false를 돌려주면(예: 체력이 가득) 줍지 않고 그대로 둔다. */
  update(dt: number, playerPos: THREE.Vector3, onPick: (it: Item) => boolean, flyTarget: THREE.Vector3 = playerPos) {
    this.time += dt;
    for (const it of this.items) {
      if (it.flyT >= 0) {
        this.fly(it, dt, flyTarget);
        continue;
      }
      if (it.taken) continue;
      const t = this.time + it.phase;
      const bobY = it.hover + Math.sin(t * PICKUP.bobSpeed) * PICKUP.bob;
      it.spin.rotation.y = t * PICKUP.spinSpeed;
      (it.glow.material as THREE.MeshBasicMaterial).opacity = 0.55 + 0.25 * Math.sin(t * PICKUP.bobSpeed);
      if (it.riseT >= 0) {
        // 등장: 아래에서 천천히 떠올라 흔들림에 합류한다(그동안은 줍지 않는다)
        it.riseT += dt;
        const k = Math.min(it.riseT / NUKE.riseTime, 1);
        const e = 1 - (1 - k) ** 3;
        it.spin.position.y = THREE.MathUtils.lerp(it.riseFrom, bobY, e);
        (it.glow.material as THREE.MeshBasicMaterial).opacity *= e;
        if (k >= 1) it.riseT = -1;
        continue;
      }
      it.spin.position.y = bobY;
      const p = it.root.position;
      if (Math.hypot(playerPos.x - p.x, playerPos.z - p.z) < it.radius && playerPos.y < p.y + 1.2 && playerPos.y > p.y - 0.5 && onPick(it)) {
        it.taken = true;
        it.flyT = 0;
        it.glow.visible = false;
      }
    }
  }

  /** 주운 아이템: 플레이어 몸 앞(target, 발 높이 기준)으로 날아오며 작아지고 빨리 돈 뒤 사라진다 */
  private fly(it: Item, dt: number, playerPos: THREE.Vector3) {
    it.flyT += dt;
    const p = Math.min(it.flyT / PICKUP_ANIM.flyTime, 1);
    const e = p * p * (3 - 2 * p);
    // 수평은 집 자리에서 플레이어 쪽으로, 높이는 떠 있던 높이에서 허리 높이로
    it.root.position.set(
      THREE.MathUtils.lerp(it.home.x, playerPos.x, e),
      THREE.MathUtils.lerp(it.home.y, playerPos.y, e),
      THREE.MathUtils.lerp(it.home.z, playerPos.z, e),
    );
    it.spin.position.y = THREE.MathUtils.lerp(it.hover, PICKUP_ANIM.flyHeight, e) + Math.sin(Math.PI * p) * 0.15;
    it.spin.rotation.y += dt * 14;
    it.spin.scale.setScalar(1 - 0.8 * e);
    if (p >= 1) {
      it.flyT = -1;
      it.root.visible = false;
      it.root.position.copy(it.home);
      it.spin.scale.setScalar(1);
      it.glow.visible = true;
    }
  }

  get remaining() {
    return this.items.filter((it) => !it.taken).length;
  }
}

/**
 * glTF 장면을 아이템용으로: 원래 변환을 유지한 채 감싸서, 높이가 height가 되고 중심이 원점에 오게 한다.
 * 그림자를 드리우게 한다.
 */
export function normalizedModel(src: THREE.Object3D, height: number) {
  const inner = src.clone(true);
  inner.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(inner);
  const size = bb.getSize(new THREE.Vector3());
  const c = bb.getCenter(new THREE.Vector3());
  const k = height / size.y;
  const g = new THREE.Group();
  inner.position.sub(c);
  const wrap = new THREE.Group();
  wrap.scale.setScalar(k);
  wrap.add(inner);
  g.add(wrap);
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
  return g;
}

/** 구급상자: 흰 상자, 앞뒤 면에 빨간 십자, 위에 손잡이. 가장 긴 변이 MEDKIT.size. */
function medkitModel() {
  const s = MEDKIT.size;
  const w = s, h = s * 0.7, d = s * 0.32;
  const white = new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.45, emissive: 0x2a2a2a });
  const red = new THREE.MeshStandardMaterial({ color: 0xe0282a, roughness: 0.4, emissive: 0x5a0808 });
  const grey = new THREE.MeshStandardMaterial({ color: 0x55595f, roughness: 0.6 });
  const g = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), white);
  box.castShadow = true;
  g.add(box);
  // 뚜껑 이음새: 상자 둘레의 얇은 회색 띠
  const seam = new THREE.Mesh(new THREE.BoxGeometry(w * 1.01, h * 0.06, d * 1.01), grey);
  seam.position.y = h * 0.22;
  g.add(seam);
  // 십자: 가로 막대 + 세로 막대를 앞뒤 면에 살짝 띄워 붙인다
  const arm = s * 0.36, thick = s * 0.11, t = 0.006;
  for (const side of [1, -1]) {
    const hBar = new THREE.Mesh(new THREE.BoxGeometry(arm, thick, t), red);
    const vBar = new THREE.Mesh(new THREE.BoxGeometry(thick, arm, t), red);
    hBar.position.set(0, -h * 0.06, side * (d / 2 + t / 2));
    vBar.position.copy(hBar.position);
    g.add(hBar, vBar);
  }
  // 손잡이: 위쪽 가운데 기둥 둘 + 손잡이 막대
  const hw = w * 0.36, hh = h * 0.16, ht = s * 0.04;
  for (const x of [-hw / 2, hw / 2]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(ht, hh, ht), grey);
    post.position.set(x, h / 2 + hh / 2, 0);
    g.add(post);
  }
  const bar = new THREE.Mesh(new THREE.BoxGeometry(hw + ht, ht, ht), grey);
  bar.position.y = h / 2 + hh;
  g.add(bar);
  return g;
}

/** 가운데가 밝고 가장자리로 사라지는 원형 빛 */
function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
