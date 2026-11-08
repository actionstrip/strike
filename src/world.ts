import * as THREE from 'three';

/** 심플 테스트 맵: 바닥, 엄폐용 박스, 표적판. 나중에 실제 맵으로 교체한다. */

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

  constructor() {
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
