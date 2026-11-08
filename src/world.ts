import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { MapDef } from './config';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';

// 맵 메시(수만 삼각형)에 대한 레이캐스트를 BVH로 가속한다: 사격, 카메라 충돌, 3인칭 조준점, 적 시야
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

/**
 * 맵(config.ts의 MAPS):
 * - glb가 있는 맵: 시각 메시 + 충돌 박스 json(tools/blender/map_build.py가 만든 것)
 * - test: 바닥, 엄폐 박스, 표적판이 있는 시험 맵(오르기, 앉기 통로 확인용)
 */

/** 조명이 구워진 텍스처를 그대로 보여 주는 재질(조명, 톤 매핑 없음). 텍스처 없는 발광 재질은 발광색으로. */
function bakedMaterial(src: THREE.MeshStandardMaterial) {
  const map = src.map ?? src.emissiveMap;
  const color = src.map ? src.color.clone() : src.emissiveMap || src.emissiveIntensity > 0 && src.emissive.getHex() ? src.emissive.clone() : src.color.clone();
  const m = new THREE.MeshBasicMaterial({
    map, color, transparent: src.transparent, opacity: src.opacity, alphaTest: src.alphaTest, side: src.side, depthWrite: src.depthWrite,
  });
  m.toneMapped = false;
  m.name = src.name;
  src.dispose();
  return m;
}

const REACH_CELL = 0.125;

export interface MapColliders {
  scale: number;
  bounds: number[];
  boxes: number[][];
}

export interface Target {
  pivot: THREE.Object3D;
  plate: THREE.Mesh;
  down: number; // 쓰러져 있는 남은 시간
  angle: number;
}

export class World {
  scene = new THREE.Scene();
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  colliders: THREE.Box3[] = [];
  /** 레이캐스트 대상(정적 메시와 표적판) */
  hitMeshes: THREE.Object3D[] = [];
  targets: Target[] = [];
  /** 이동 가능한 범위(적 배치, 순찰 제한) */
  bounds = new THREE.Box3(new THREE.Vector3(-43, 0, -43), new THREE.Vector3(43, 5, 43));
  /** 플레이어 시작 위치와 방향(yaw, 0 = -Z) */
  spawn = { pos: new THREE.Vector3(0, 0, 0), yaw: 0 };

  constructor(readonly def: MapDef) {
    const s = this.scene;
    s.background = new THREE.Color(0x9fb8cf);
    s.fog = new THREE.Fog(0x9fb8cf, 60, 160);

    this.hemi = new THREE.HemisphereLight(0xdfeeff, 0x50463a, 1.3);
    s.add(this.hemi);
    const sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
    sun.position.set(18, 30, 12);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -30; sc.right = 30; sc.top = 30; sc.bottom = -30; sc.near = 1; sc.far = 90;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    // 3인칭 전신(레이어 1)도 그림자를 드리운다. 1인칭에서는 메인 카메라가 레이어 1을 그리지 않는다.
    sc.layers.enable(1);
    s.add(sun, sun.target);
    this.sun = sun;
    if (!def.glb) this.buildTest();
  }

  /** 실제 맵: 시각 메시는 그대로 그리고 레이캐스트 대상으로 쓰며, 이동 충돌은 미리 만든 박스를 쓴다 */
  buildArena(gltf: GLTF, col: MapColliders) {
    const s = this.scene;
    const indoor = this.def.indoor;
    const sky = indoor ? indoor.color : 0xa9c3dc;
    s.background = new THREE.Color(sky);
    s.fog = new THREE.Fog(sky, this.def.fog[0], this.def.fog[1]);
    if (indoor) {
      // 천장이 해를 가린다: 그림자 없이 약한 해 + 따뜻한 반구광으로 캐릭터를 비춘다
      this.sun.castShadow = false;
      this.sun.intensity = 0.6;
      this.hemi.color.set(indoor.hemiSky);
      this.hemi.groundColor.set(indoor.hemiGround);
      this.hemi.intensity = indoor.hemi;
    }
    const map = gltf.scene;
    map.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      if (indoor) m.material = bakedMaterial(m.material as THREE.MeshStandardMaterial);
      m.castShadow = !indoor;
      m.receiveShadow = !indoor;
      m.geometry.computeBoundsTree();
      this.hitMeshes.push(m);
    });
    s.add(map);
    map.updateMatrixWorld(true);
    for (const b of col.boxes) this.colliders.push(new THREE.Box3(new THREE.Vector3(b[0], b[1], b[2]), new THREE.Vector3(b[3], b[4], b[5])));
    const [x0, , z0, x1, y1, z1] = col.bounds;
    // 바깥 벽 두께만큼 안쪽
    this.bounds.set(new THREE.Vector3(x0 + 0.5, 0, z0 + 0.5), new THREE.Vector3(x1 - 0.5, y1, z1 - 0.5));
    const a = this.def.area;
    if (a) this.bounds.set(new THREE.Vector3(a[0], 0, a[1]), new THREE.Vector3(a[2], y1, a[3]));
    // 그림자: 맵 전체를 덮는 만큼만(해상도를 높인다)
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const half = Math.max(x1 - x0, z1 - z0) / 2 + 2;
    // 해를 맵 중심에서 같은 방향으로 맵 크기만큼 떨어뜨려, 넓은 맵도 깊이 범위 안에 들게 한다
    const reach = half + 30;
    this.sun.position.set(14, 30, 9).normalize().multiplyScalar(reach).add(new THREE.Vector3(cx, 0, cz));
    this.sun.target.position.set(cx, 0, cz);
    const sc = this.sun.shadow.camera;
    sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half; sc.far = reach * 2;
    sc.updateProjectionMatrix();
    // 넓은 맵은 그림자 해상도를 올린다(텍셀 약 3.5cm 이하 유지)
    if (half > 40) {
      this.sun.shadow.mapSize.set(4096, 4096);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    // 플레이어: 맵에 정한 자리, 없으면 +Z 끝에서 -Z를 본다
    const sp = this.def.spawn ?? { x: cx, z: z1 - 6, yaw: 0 };
    this.spawn.pos.copy(this.findFree(new THREE.Vector3(sp.x, 0, sp.z)));
    this.spawn.yaw = sp.yaw;
    this.computeReach(this.spawn.pos);
  }

  /** 플레이어 시작점에서 걸어서 갈 수 있는 칸(REACH_CELL 격자). 적 배치가 건물 밖이나 막힌 방에 놓이지 않게 한다. */
  private reach: { grid: Uint8Array; w: number; h: number } | null = null;

  private computeReach(from: THREE.Vector3, r = 0.3) {
    const b = this.bounds, c = REACH_CELL;
    const w = Math.ceil((b.max.x - b.min.x) / c), h = Math.ceil((b.max.z - b.min.z) / c);
    const blocked = new Uint8Array(w * h);
    for (const k of this.colliders) {
      // 몸통 높이(무릎~머리)를 막는 박스만. 낮은 턱은 오르고, 머리 위는 지나간다.
      if (k.min.y > 1.7 || k.max.y < 0.35) continue;
      const i0 = Math.max(0, Math.floor((k.min.x - r - b.min.x) / c)), i1 = Math.min(w - 1, Math.floor((k.max.x + r - b.min.x) / c));
      const j0 = Math.max(0, Math.floor((k.min.z - r - b.min.z) / c)), j1 = Math.min(h - 1, Math.floor((k.max.z + r - b.min.z) / c));
      for (let j = j0; j <= j1; j++) blocked.fill(1, j * w + i0, j * w + i1 + 1);
    }
    const grid = new Uint8Array(w * h);
    const si = Math.floor((from.x - b.min.x) / c), sj = Math.floor((from.z - b.min.z) / c);
    if (si < 0 || sj < 0 || si >= w || sj >= h) return;
    const stack = [sj * w + si];
    grid[stack[0]] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      const i = p % w, j = (p - i) / w;
      if (i > 0 && !grid[p - 1] && !blocked[p - 1]) { grid[p - 1] = 1; stack.push(p - 1); }
      if (i < w - 1 && !grid[p + 1] && !blocked[p + 1]) { grid[p + 1] = 1; stack.push(p + 1); }
      if (j > 0 && !grid[p - w] && !blocked[p - w]) { grid[p - w] = 1; stack.push(p - w); }
      if (j < h - 1 && !grid[p + w] && !blocked[p + w]) { grid[p + w] = 1; stack.push(p + w); }
    }
    this.reach = { grid, w, h };
  }

  /** (x, z)에 플레이어 시작점에서 걸어서 갈 수 있는가(시험 맵처럼 계산하지 않았으면 항상 true) */
  reachable(x: number, z: number) {
    if (!this.reach) return true;
    const i = Math.floor((x - this.bounds.min.x) / REACH_CELL), j = Math.floor((z - this.bounds.min.z) / REACH_CELL);
    if (i < 0 || j < 0 || i >= this.reach.w || j >= this.reach.h) return false;
    return this.reach.grid[j * this.reach.w + i] === 1;
  }

  /** 바닥 높이에서 반경 r 원기둥(키 2m)이 들어갈 빈 자리를 near 가까이에서 찾는다 */
  findFree(near: THREE.Vector3, r = 0.6) {
    const box = new THREE.Box3();
    for (let ring = 0; ring < 40; ring++) {
      const steps = Math.max(1, ring * 6);
      for (let k = 0; k < steps; k++) {
        const a = (k / steps) * Math.PI * 2;
        const x = near.x + Math.cos(a) * ring * 0.5;
        const z = near.z + Math.sin(a) * ring * 0.5;
        if (!this.bounds.containsPoint(new THREE.Vector3(x, 0.1, z))) continue;
        box.min.set(x - r, 0.05, z - r);
        box.max.set(x + r, 2, z + r);
        if (!this.colliders.some((c) => c.intersectsBox(box))) return new THREE.Vector3(x, 0, z);
      }
    }
    return near.clone();
  }

  private buildTest() {
    const s = this.scene;
    // 바닥
    const groundMat = new THREE.MeshStandardMaterial({ map: gridTexture('#5d6670', '#4f5760', '#7d8792'), roughness: 0.95 });
    groundMat.map!.repeat.set(40, 40);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    s.add(ground);
    this.hitMeshes.push(ground);

    // 엄폐물과 벽
    const boxMat = new THREE.MeshStandardMaterial({ map: gridTexture('#b9a588', '#a8937a', '#cbb89a', 4), roughness: 0.85 });
    const wallMat = new THREE.MeshStandardMaterial({ map: gridTexture('#7a8590', '#6c7782', '#8c97a2', 4), roughness: 0.9 });
    const box = (x: number, z: number, w: number, h: number, d: number, mat = boxMat, ry = 0, y = 0) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y + h / 2, z);
      m.rotation.y = ry;
      m.castShadow = true; m.receiveShadow = true;
      s.add(m);
      this.hitMeshes.push(m);
      m.updateMatrixWorld();
      this.colliders.push(new THREE.Box3().setFromObject(m));
      return m;
    };
    // 바깥 벽
    box(0, -45, 90, 5, 1, wallMat);
    box(0, 45, 90, 5, 1, wallMat);
    box(-45, 0, 1, 5, 90, wallMat);
    box(45, 0, 1, 5, 90, wallMat);
    // 엄폐 박스
    box(-4, -8, 2, 1.1, 1, boxMat);
    box(3.5, -9, 1.2, 1.2, 1.2, boxMat);
    box(6, -14, 3, 2.4, 0.6, wallMat);
    box(-7, -15, 0.6, 2.4, 4, wallMat);
    box(0, -18, 1.4, 0.9, 1.4, boxMat);
    box(-12, -4, 1.5, 1.5, 1.5, boxMat);
    box(-12, -2.5, 1.5, 3, 1.5, boxMat);
    box(11, -3, 2, 1, 4, boxMat);
    box(10, 6, 6, 3, 0.6, wallMat);
    box(-9, 8, 4, 1.2, 1.2, boxMat);
    box(0, 12, 2.5, 2.5, 2.5, boxMat);
    // 계단처럼 오를 수 있는 단
    box(16, -10, 3, 0.4, 3, boxMat);
    box(16, -13, 3, 0.8, 3, boxMat);
    box(16, -16, 3, 1.2, 3, boxMat);
    // 앉아서만 지나갈 수 있는 낮은 통로(기둥 2개 + 1.35~1.6m 높이 가로대)
    box(-20, -9, 0.4, 1.6, 1.4, wallMat);
    box(-17.6, -9, 0.4, 1.6, 1.4, wallMat);
    box(-18.8, -9, 2.0, 0.25, 1.4, wallMat, 0, 1.35);

    // 표적판
    const targetPos: [number, number][] = [[-3, -24], [2, -26], [7, -30], [-8, -32], [0, -40], [12, -22], [-14, -20]];
    for (const [x, z] of targetPos) this.addTarget(x, z);
  }

  private addTarget(x: number, z: number) {
    const pivot = new THREE.Object3D();
    pivot.position.set(x, 0, z);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.6, 0.08), new THREE.MeshStandardMaterial({ color: 0x333333 }));
    post.position.y = 0.3;
    post.castShadow = true;
    const hinge = new THREE.Object3D();
    hinge.position.y = 0.6;
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.1, 0.05), new THREE.MeshStandardMaterial({ map: targetTexture(), roughness: 0.7 }));
    plate.position.y = 0.55;
    plate.castShadow = true;
    plate.userData.target = true;
    hinge.add(plate);
    pivot.add(post, hinge);
    this.scene.add(pivot);
    this.hitMeshes.push(plate);
    this.targets.push({ pivot: hinge, plate, down: 0, angle: 0 });
  }

  hitTarget(plate: THREE.Object3D) {
    const t = this.targets.find((t) => t.plate === plate);
    if (t && t.down <= 0) t.down = 2.5;
  }

  update(dt: number) {
    for (const t of this.targets) {
      if (t.down > 0) t.down -= dt;
      const goal = t.down > 0 ? -Math.PI / 2 : 0;
      t.angle += (goal - t.angle) * (1 - Math.exp(-(t.down > 0 ? 18 : 6) * dt));
      t.pivot.rotation.x = t.angle;
    }
  }
}

function gridTexture(base: string, alt: string, line: string, cells = 2) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const n = cells, sz = 256 / n;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    g.fillStyle = (i + j) % 2 ? base : alt;
    g.fillRect(i * sz, j * sz, sz, sz);
  }
  g.strokeStyle = line;
  g.lineWidth = 3;
  for (let i = 0; i <= n; i++) {
    g.beginPath(); g.moveTo(i * sz, 0); g.lineTo(i * sz, 256); g.stroke();
    g.beginPath(); g.moveTo(0, i * sz); g.lineTo(256, i * sz); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function targetTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#e9e2cf'; g.fillRect(0, 0, 128, 256);
  g.fillStyle = '#c33c2c';
  g.beginPath(); g.arc(64, 60, 34, 0, Math.PI * 2); g.fill();
  g.fillRect(24, 110, 80, 130);
  g.fillStyle = '#e9e2cf';
  g.beginPath(); g.arc(64, 60, 18, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#c33c2c';
  g.beginPath(); g.arc(64, 60, 7, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
