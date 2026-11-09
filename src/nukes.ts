import * as THREE from 'three';
import type { Assets } from './assets';
import { NUKE } from './config';
import type { Item, Pickups } from './pickups';
import { spreadSpots } from './spread';
import type { World } from './world';

export type CrateState = 'closed' | 'open' | 'empty';

export interface Crate {
  root: THREE.Group;
  /** 뚜껑 경첩(돌리면 뚜껑이 열린다) */
  lid: THREE.Object3D;
  /** 사격 판정용 보이지 않는 박스(world.hitMeshes에 들어 있다) */
  proxy: THREE.Mesh;
  state: CrateState;
  /** 뚜껑 여는 진행 시간(초), -1이면 움직이지 않음 */
  lidT: number;
  /** 열려서 나온 폭탄 아이템 */
  bomb: Item | null;
  /** 놓인 자리의 실내 점수, 지붕 여부, 막힌 방향 수(디버그) */
  shelter: number;
  roof: boolean;
  walls: number;
}

const _ray = new THREE.Raycaster();
const _o = new THREE.Vector3();
const _d = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const ROOF_PROBES = [[0, 0], [1.5, 0], [-1.5, 0], [0, 1.5], [0, -1.5]];

/**
 * 미션 오브젝트: 핵컨테이너 NUKE.count개를 건물이나 방 안쪽에 놓는다.
 * 총으로 쏘면 뚜껑이 열리고 핵원자로폭탄이 떠오른다. 폭탄을 주우면 collect()로 센다.
 * 다 모으면 onAllCollected를 부른다(게이트는 따로 만든다).
 */
export class NukeCrates {
  list: Crate[] = [];
  collected = 0;
  get total() { return this.list.length; }
  onAllCollected?: () => void;

  private template: THREE.Group;
  /** 몸통 윗면 높이(폭탄이 떠오르기 시작하는 곳, 바닥 빛 높이) */
  private baseTop = 0.5;

  constructor(assets: Assets, private world: World, private pickups: Pickups) {
    this.template = this.buildTemplate(assets.nukeCrate.scene);
  }

  /**
   * 원본(cm 단위, 몸통 + 뚜껑)을 가장 긴 변이 NUKE.crateSize가 되게 줄이고 바닥 중심을 원점에 둔다.
   * 뚜껑은 경첩 쪽 아래 모서리에 둔 pivot('lidPivot') 아래로 옮긴다.
   */
  private buildTemplate(src: THREE.Object3D) {
    const inner = src.clone(true);
    inner.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(inner);
    const size = bb.getSize(new THREE.Vector3());
    const k = NUKE.crateSize / Math.max(size.x, size.z);
    const scaled = new THREE.Group();
    scaled.scale.setScalar(k);
    inner.position.set(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
    scaled.add(inner);
    const root = new THREE.Group();
    root.add(scaled);
    root.updateMatrixWorld(true);

    // 뚜껑: GLTFLoader가 이름의 공백을 '_'로 바꾸므로 앞부분으로 찾는다(부모 노드가 먼저 나온다)
    let lid: THREE.Object3D | null = null;
    let base: THREE.Object3D | null = null;
    root.traverse((o) => {
      if (!lid && /^cajaTapa/.test(o.name)) lid = o;
      if (!base && /^cajaBase/.test(o.name)) base = o;
    });
    if (!lid) throw new Error('nuclear_container: 뚜껑(cajaTapa) 노드가 없다');
    const lidBox = new THREE.Box3().setFromObject(lid);
    if (base) this.baseTop = new THREE.Box3().setFromObject(base).max.y;
    const back = NUKE.hingeSide === 'back';
    const pivot = new THREE.Group();
    pivot.name = 'lidPivot';
    pivot.position.set((lidBox.min.x + lidBox.max.x) / 2, lidBox.min.y, back ? lidBox.min.z : lidBox.max.z);
    root.add(pivot);
    root.updateMatrixWorld(true);
    pivot.attach(lid);

    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; }
    });
    return root;
  }

  /**
   * 실내 점수: 높이 1m에서 위로 8m 안에 지붕이 있으면 +4, 수평 8방향 중 6m 안에 막힌 방향마다 +1,
   * 1.5m 안에 벽이 있으면 +1. 가장 가까운 벽 방향(등질 쪽)도 돌려준다.
   */
  shelterAt(x: number, z: number) {
    const meshes = this.world.hitMeshes;
    _o.set(x, 1.0, z);
    let score = 0;
    // 지붕: 가운데와 앞뒤좌우 1.5m, 다섯 곳 중 넷 이상이 2.6~11m 높이에서 막혀야 한다
    // (크레인 팔이나 보 하나는 지붕이 아니고, 낮은 선반 밑은 지붕이 아니라 막힌 곳이다)
    let covered = 0;
    let clearance = Infinity;
    _ray.far = 10;
    ROOF_PROBES.forEach(([ox, oz], k) => {
      _ray.set(_d.set(x + ox, 1.0, z + oz), UP);
      const h = _ray.intersectObjects(meshes, false)[0];
      if (k === 0) clearance = h ? h.distance : Infinity;
      if (h && h.distance >= 1.6) covered++;
    });
    const roof = covered >= 4;
    if (roof) score += 4;
    let walls = 0;
    let near = Infinity, wall = new THREE.Vector2(0, -1);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      _d.set(Math.sin(a), 0, Math.cos(a));
      _ray.set(_o, _d);
      _ray.far = 6;
      const hit = _ray.intersectObjects(meshes, false)[0];
      if (!hit) continue;
      score++;
      walls++;
      if (hit.distance < near) { near = hit.distance; wall = new THREE.Vector2(_d.x, _d.z); }
    }
    if (near < 1.5) score++;
    // 뚜껑이 열리고 폭탄이 떠오를 머리 위 공간(발 기준 2.6m)이 있는가
    const open = clearance >= 1.6;
    return { score, roof, walls, wall, open };
  }

  /** 컨테이너를 놓는다. 실내 점수 기준을 넘는 자리가 모자라면 기준을 낮춘다. */
  place(rand: () => number, from: THREE.Vector3) {
    for (const c of this.list) this.remove(c);
    this.list = [];
    this.collected = 0;
    const w = this.world;
    const n = NUKE.count;
    // 조건을 차례로 느슨하게: 지붕 아래 벽에 둘러싸인 곳(방, 건물 안) → 지붕 아래 →
    // 맵 가장자리가 아닌 골목(사막 마을처럼 들어갈 건물이 없는 맵) → 벽에 많이 둘러싸인 곳 → 아무 곳
    const b = w.bounds;
    const inner = (x: number, z: number) => x > b.min.x + 4 && x < b.max.x - 4 && z > b.min.z + 4 && z < b.max.z - 4;
    const tiers: ((s: ReturnType<NukeCrates['shelterAt']>, x: number, z: number) => boolean)[] = [
      (s) => s.roof && s.walls >= 4,
      (s) => s.roof,
      (s, x, z) => s.walls >= 6 && inner(x, z),
      (s) => s.walls >= 6,
      (s, x, z) => s.walls >= 5 && inner(x, z),
      (s) => s.walls >= 5,
      (s) => s.score >= NUKE.shelterMinScore - 2,
      () => true,
    ];
    let spots: THREE.Vector2[] = [];
    for (const ok of tiers) {
      spots = spreadSpots(n, {
        colliders: w.colliders, area: w.bounds, reachable: (x, z) => w.reachable(x, z), rand, height: 1.0, margin: 1.1, step: 1.0,
        avoid: [new THREE.Vector2(from.x, from.z)], from, minFrom: 12,
        accept: (x, z) => { const s = this.shelterAt(x, z); return s.open && ok(s, x, z); },
      });
      // 후보가 모자라면 같은 점이 반복되거나 서로 붙어 나온다
      const apart = spots.length === n && spots.every((p, i) => spots.every((q, j) => i === j || p.distanceTo(q) > 4));
      if (apart) break;
    }
    spots.forEach((p, i) => this.add(p.x, p.y, i));
  }

  private add(x: number, z: number, i: number) {
    const sh = this.shelterAt(x, z);
    const root = this.template.clone(true);
    root.position.set(x, 0, z);
    // 경첩 쪽(뒤)이 가장 가까운 벽을 보게, 90° 단위로(충돌 박스가 딱 맞게)
    const back = NUKE.hingeSide === 'back' ? 1 : -1;
    const yaw = Math.atan2(-sh.wall.x * back, -sh.wall.y * back);
    root.rotation.y = Math.round(yaw / (Math.PI / 2)) * (Math.PI / 2);
    this.world.scene.add(root);
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    this.world.colliders.push(box);
    const size = box.getSize(new THREE.Vector3());
    const proxy = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), new THREE.MeshBasicMaterial({ visible: false }));
    box.getCenter(proxy.position);
    proxy.userData.nukeCrate = i;
    this.world.scene.add(proxy);
    proxy.updateMatrixWorld(true);
    this.world.hitMeshes.push(proxy);
    const lid = root.getObjectByName('lidPivot')!;
    this.list.push({ root, lid, proxy, state: 'closed', lidT: -1, bomb: null, shelter: sh.score, roof: sh.roof, walls: sh.walls });
  }

  private remove(c: Crate) {
    c.root.removeFromParent();
    c.proxy.removeFromParent();
    const w = this.world;
    w.hitMeshes.splice(w.hitMeshes.indexOf(c.proxy), 1);
    const bi = w.colliders.findIndex((b) => b.containsPoint(c.root.position.clone().setY(0.1)));
    if (bi >= 0) w.colliders.splice(bi, 1);
  }

  /** 총에 맞음: 닫혀 있으면 열고 폭탄을 띄운다. 열렸으면 true. */
  open(i: number) {
    const c = this.list[i];
    if (!c || c.state !== 'closed') return false;
    c.state = 'open';
    c.lidT = 0;
    c.bomb = this.pickups.addItem('bomb', c.root.position.x, c.root.position.z, {
      hover: NUKE.bombHover, radius: NUKE.bombRadius, riseFrom: this.baseTop * 0.6, glowY: this.baseTop + 0.01,
    });
    return true;
  }

  /** 폭탄을 주웠을 때 main에서 부른다 */
  collect(item: Item) {
    const c = this.list.find((k) => k.bomb === item);
    if (c) c.state = 'empty';
    this.collected++;
    if (this.collected >= this.total) this.onAllCollected?.();
  }

  update(dt: number) {
    const s = NUKE.hingeSide === 'back' ? -1 : 1;
    for (const c of this.list) {
      if (c.lidT < 0) continue;
      c.lidT += dt;
      const k = Math.min(c.lidT / NUKE.lidOpenTime, 1);
      // 처음에 툭 튀고 끝에서 살짝 되돌아오는 열림
      const e = 1 - (1 - k) ** 3;
      const over = Math.sin(Math.PI * k) * 0.08;
      c.lid.rotation.x = s * THREE.MathUtils.degToRad(NUKE.lidOpenDeg) * (e + over);
      if (k >= 1) c.lidT = -1;
    }
  }

  /** 미니맵 표시용 */
  markers() {
    return this.list.map((c) => ({ x: c.root.position.x, z: c.root.position.z, state: c.state }));
  }
}
