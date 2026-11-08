import * as THREE from 'three';
import type { Assets } from './assets';
import { PICKUP } from './config';
import { spreadSpots } from './spread';

interface Item {
  root: THREE.Group;
  /** 회전, 위아래로 흔들리는 탄창 */
  spin: THREE.Object3D;
  glow: THREE.Mesh;
  phase: number;
  taken: boolean;
}

/**
 * 탄창 아이템: 바닥에서 떠서 돌며 위아래로 흔들린다. 플레이어가 닿으면 예비 탄약이 늘어난다.
 * 모양은 주인공 총(G32)의 탄창 메시를 복제해 쓴다.
 */
export class Pickups {
  items: Item[] = [];
  /** 탄창 + 위로 삐져나온 탄 하나(멀리서도 탄약으로 읽히게) */
  private mag: THREE.Group;
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
    this.glowTex = glowTexture();
  }

  /** 맵에 count개를 골고루 놓는다(플레이어 시작점에서도 떨어지게) */
  spawn(count: number, o: { colliders: THREE.Box3[]; area: THREE.Box3; reachable: (x: number, z: number) => boolean; rand: () => number; from: THREE.Vector3 }) {
    for (const it of this.items) it.root.removeFromParent();
    this.items = [];
    const spots = spreadSpots(count, {
      colliders: o.colliders, area: o.area, reachable: o.reachable, rand: o.rand, height: 1.0, margin: 0.5,
      avoid: [new THREE.Vector2(o.from.x, o.from.z)],
    });
    for (const p of spots) {
      const root = new THREE.Group();
      root.position.set(p.x, 0, p.y);
      const spin = new THREE.Group();
      const m = this.mag.clone();
      // 탄창을 약간 기울여 세운다(옆면과 윗면이 같이 보이게)
      m.rotation.set(0.35, 0, 0.25);
      spin.add(m);
      const glow = new THREE.Mesh(
        new THREE.PlaneGeometry(PICKUP.glowSize, PICKUP.glowSize),
        new THREE.MeshBasicMaterial({ map: this.glowTex, color: PICKUP.glowColor, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
      );
      glow.rotation.x = -Math.PI / 2;
      glow.position.y = 0.02;
      root.add(spin, glow);
      this.scene.add(root);
      this.items.push({ root, spin, glow, phase: o.rand() * Math.PI * 2, taken: false });
    }
  }

  /** 떠 있는 움직임과 줍기. 주운 개수를 돌려준다. */
  update(dt: number, playerPos: THREE.Vector3, onPick: (it: Item) => void) {
    this.time += dt;
    for (const it of this.items) {
      if (it.taken) continue;
      const t = this.time + it.phase;
      it.spin.position.y = PICKUP.height + Math.sin(t * PICKUP.bobSpeed) * PICKUP.bob;
      it.spin.rotation.y = t * PICKUP.spinSpeed;
      (it.glow.material as THREE.MeshBasicMaterial).opacity = 0.55 + 0.25 * Math.sin(t * PICKUP.bobSpeed);
      const p = it.root.position;
      if (Math.hypot(playerPos.x - p.x, playerPos.z - p.z) < PICKUP.radius && playerPos.y < p.y + 1.2 && playerPos.y > p.y - 0.5) {
        it.taken = true;
        it.root.visible = false;
        onPick(it);
      }
    }
  }

  get remaining() {
    return this.items.filter((it) => !it.taken).length;
  }
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
