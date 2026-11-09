import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Assets } from './assets';
import { PORTAL } from './config';
import type { World } from './world';

const M = PORTAL.model;
const _ray = new THREE.Raycaster();
const _v = new THREE.Vector3();

/** 고리 안 소용돌이: 극좌표 각을 시간과 반지름에 따라 비틀어 가운데로 빨려 드는 나선, 가운데는 어두운 눈 */
const VORTEX_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const VORTEX_FRAG = /* glsl */ `
uniform float uTime;
uniform float uPower;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; }
  return s;
}
void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  float r = length(p);
  if (r > 1.0) discard;
  float a = atan(p.y, p.x);
  // 안쪽으로 갈수록 더 감기는 나선(시간에 따라 안으로 흘러 든다)
  float tw = a + 2.4 / (r + 0.18) - uTime * 2.2;
  // 각도를 cos/sin으로 넣어 이음새 없는 노이즈
  float n = fbm(vec2(cos(tw), sin(tw)) * 2.2 + vec2(r * 3.0 + uTime * 2.6, uTime * 0.4));
  float bands = 0.5 + 0.5 * sin(tw * 4.0 + n * 5.0);
  float edge = smoothstep(1.0, 0.86, r);
  float rim = smoothstep(0.68, 0.94, r) * edge;
  float eye = smoothstep(0.04, 0.42, r);
  float ring = exp(-pow((r - 0.3) * 6.5, 2.0));
  vec3 deep = vec3(0.05, 0.01, 0.16);
  vec3 elec = vec3(0.32, 0.74, 1.0);
  vec3 hot = vec3(0.92, 0.97, 1.0);
  vec3 pink = vec3(1.0, 0.25, 0.8);
  vec3 col = mix(deep, elec, n * bands * 1.2);
  col += pink * 0.3 * bands * (1.0 - r);
  col += hot * ring * 1.1;
  col += elec * rim * 1.5;
  // 가장자리 잔전기
  float crack = smoothstep(0.78, 1.0, noise(vec2(a * 7.0, uTime * 14.0))) * rim;
  col += hot * crack * 2.2;
  // 가운데는 어둡게(깊이감): 뒤 배경을 가려 구멍처럼 보이게 알파는 높게 둔다
  col *= eye * 0.9 + 0.1;
  float alpha = edge * uPower * mix(0.96, 0.82, eye);
  gl_FragColor = vec4(col, alpha);
}`;

interface Arc { line: THREE.Line; life: number; }
interface Spark { a: number; r: number; z: number; speed: number; }

/**
 * 돌 포털: 시작 지점 바로 뒤에 놓아 캐릭터가 그곳에서 나온 것처럼 보이게 한다.
 * 폭탄을 다 모으면 activate(): 소용돌이 원판, 번개 호, 빨려 드는 입자, 깜빡이는 빛.
 * 활성 상태에서 고리를 지나가면 update()가 true를 돌려준다(게임 클리어).
 */
export class Portal {
  root = new THREE.Group();
  /** 원본 대비 배율 */
  k = 1;
  active = false;
  /** 효과 세기 0..1 (활성 + 시작 섬광 중 큰 값) */
  power = 0;
  private activeT = -1;
  private flashT = -1;
  private time = 0;
  private mixer: THREE.AnimationMixer;
  private action: THREE.AnimationAction | null = null;
  private crystals: THREE.MeshStandardMaterial[] = [];
  private disc: THREE.Mesh;
  private discMat: THREE.ShaderMaterial;
  private arcs: Arc[] = [];
  private arcGroup = new THREE.Group();
  private sparks: Spark[] = [];
  private points: THREE.Points;
  private light: THREE.PointLight;
  private fx = new THREE.Group();

  constructor(assets: Assets, private world: World) {
    const model = SkeletonUtils.clone(assets.portal.scene);
    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      const mat = m.material as THREE.MeshStandardMaterial;
      if (/Crystal/i.test(mat.name)) {
        const c = mat.clone();
        c.emissiveIntensity = 0.5;
        m.material = c;
        this.crystals.push(c);
      }
    });
    this.root.add(model);
    this.mixer = new THREE.AnimationMixer(model);
    const clip = assets.portal.animations[0];
    if (clip) {
      this.action = this.mixer.clipAction(clip);
      this.action.play();
      this.action.timeScale = 0.35;
    }

    // 효과는 모델과 같은 원본 좌표에 둔다(root 배율을 같이 받는다)
    const cy = (M.holeY0 + M.holeY1) / 2;
    const hh = (M.holeY1 - M.holeY0) / 2;
    this.discMat = new THREE.ShaderMaterial({
      vertexShader: VORTEX_VERT, fragmentShader: VORTEX_FRAG,
      uniforms: { uTime: { value: 0 }, uPower: { value: 0 } },
      transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    });
    this.disc = new THREE.Mesh(new THREE.PlaneGeometry(M.holeHalfW * 2, hh * 2), this.discMat);
    this.disc.position.set(0, cy, 0);
    this.disc.renderOrder = 2;

    for (let i = 0; i < PORTAL.arcCount; i++) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(14 * 3), 3));
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
        color: 0xcff0ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
      }));
      line.frustumCulled = false;
      line.renderOrder = 3;
      this.arcGroup.add(line);
      this.arcs.push({ line, life: 0 });
    }

    const n = PORTAL.particleCount;
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    pg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    this.points = new THREE.Points(pg, new THREE.PointsMaterial({
      size: 0.09, map: glowTexture(), vertexColors: true, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: false,
    }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    for (let i = 0; i < n; i++) this.sparks.push(this.newSpark(true));

    this.light = new THREE.PointLight(0x9fd8ff, 0, 9, 2);
    this.light.position.set(0, cy, 0.8);

    this.fx.add(this.disc, this.arcGroup, this.points, this.light);
    this.fx.visible = false;
    this.root.add(this.fx);
  }

  /** 맵에서 방향 dir로 몸 높이 몇 곳을 쏴서 가장 가까운 막힘까지 거리 */
  private free(from: THREE.Vector3, dir: THREE.Vector3, heights = [0.4, 1.2, 2.0], far = 20) {
    let best = far;
    for (const h of heights) {
      _ray.set(_v.set(from.x, from.y + h, from.z), dir);
      _ray.far = far;
      const hit = _ray.intersectObjects(this.world.hitMeshes, false)[0];
      if (hit) best = Math.min(best, hit.distance);
    }
    return best;
  }

  /**
   * 시작 지점 바로 뒤에 놓는다. 포털 정면(계단)이 플레이어가 보는 쪽을 향한다.
   * 뒤 벽, 좌우 폭, 천장에 맞게 크기를 줄이고, 뒤가 좁으면 시작 지점을 앞으로 옮긴다. 옮긴 시작 지점을 돌려준다.
   */
  place(spawnPos: THREE.Vector3, spawnYaw: number) {
    // 정면(로컬 +Z)이 플레이어 정면(-sin yaw, -cos yaw)을 보게, 90° 단위로(충돌 박스가 딱 맞게)
    const psi = Math.round((spawnYaw + Math.PI) / (Math.PI / 2)) * (Math.PI / 2);
    const fwd = new THREE.Vector3(Math.sin(psi), 0, Math.cos(psi));
    const back = fwd.clone().negate();
    const right = new THREE.Vector3(fwd.z, 0, -fwd.x);
    const base = spawnPos.clone().setY(0);
    const D = this.free(base, back);
    // 포털이 설 근처(시작 지점 뒤 1.5m)에서 좌우 폭과 천장
    const probe = base.clone().addScaledVector(back, Math.min(1.5, D * 0.5));
    const W = this.free(probe, right, [1.2]) + this.free(probe, right.clone().negate(), [1.2]);
    _ray.set(_v.set(probe.x, 0.2, probe.z), new THREE.Vector3(0, 1, 0));
    _ray.far = 12;
    const ceil = _ray.intersectObjects(this.world.hitMeshes, false)[0];
    const H = ceil ? ceil.distance + 0.2 : Infinity;
    let k = Math.min(PORTAL.height / M.height, (W - 0.4) / (M.halfWidth * 2), (H - 0.15) / M.height);
    k = Math.max(k, 0.4);
    if (k < PORTAL.minHeight / M.height) console.warn(`[portal] 공간이 좁아 작게 놓음: 높이 ${(k * M.height).toFixed(2)}m`);
    this.k = k;

    const need = (M.front + M.back) * k + PORTAL.gap;
    const origin = new THREE.Vector3();
    const spawn = base.clone();
    if (D - 0.1 >= need) {
      origin.copy(base).addScaledVector(back, M.front * k + PORTAL.gap);
    } else {
      // 뒤가 좁다: 포털 뒤를 벽에 붙이고, 시작 지점을 계단 앞으로 옮긴다
      origin.copy(base).addScaledVector(back, D - 0.1 - M.back * k);
      spawn.copy(origin).addScaledVector(fwd, M.front * k + PORTAL.gap);
    }
    this.root.position.copy(origin);
    this.root.rotation.y = psi;
    this.root.scale.setScalar(k);
    this.world.scene.add(this.root);
    this.root.updateMatrixWorld(true);
    this.addColliders();
    return spawn;
  }

  /** 받침, 계단, 양쪽 기둥만 막는다(고리 가운데는 지나갈 수 있게). 같은 박스로 총알도 막는다. */
  private addColliders() {
    const boxes: THREE.Box3[] = [
      new THREE.Box3(new THREE.Vector3(-M.platformHalfX, 0, -M.back), new THREE.Vector3(M.platformHalfX, M.platformY, M.platformFront)),
      ...M.stairs.map(([z0, z1, h, w]) => new THREE.Box3(new THREE.Vector3(-w, 0, z0), new THREE.Vector3(w, h, z1))),
      new THREE.Box3(new THREE.Vector3(M.pillarInnerX, 0, -M.pillarHalfZ), new THREE.Vector3(M.halfWidth, M.height, M.pillarHalfZ)),
      new THREE.Box3(new THREE.Vector3(-M.halfWidth, 0, -M.pillarHalfZ), new THREE.Vector3(-M.pillarInnerX, M.height, M.pillarHalfZ)),
    ];
    const hidden = new THREE.MeshBasicMaterial({ visible: false });
    for (const b of boxes) {
      const wb = b.clone().applyMatrix4(this.root.matrixWorld);
      this.world.colliders.push(wb);
      const size = wb.getSize(new THREE.Vector3());
      const proxy = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), hidden);
      wb.getCenter(proxy.position);
      this.world.scene.add(proxy);
      proxy.updateMatrixWorld(true);
      this.world.hitMeshes.push(proxy);
    }
  }

  /** 게임을 시작할 때: 방금 이곳을 지나온 것처럼 잠깐 번쩍인다 */
  flash() {
    this.flashT = 0;
  }

  activate() {
    if (this.active) return;
    this.active = true;
    this.activeT = 0;
    if (this.action) this.action.timeScale = 1.2;
  }

  /** 소용돌이 바깥에서 생겨 안으로 빨려 드는 입자 */
  private newSpark(anyRadius = false): Spark {
    return {
      a: Math.random() * Math.PI * 2,
      r: anyRadius ? 0.1 + Math.random() * 1.5 : 1.15 + Math.random() * 0.5,
      z: (Math.random() - 0.5) * 1.2,
      speed: 0.5 + Math.random() * 0.6,
    };
  }

  /** 번개 호 하나를 새로 그린다: 가장자리 → 가장자리 또는 가장자리 → 안쪽, 지그재그 */
  private zap(arc: Arc) {
    const cy = (M.holeY0 + M.holeY1) / 2, hw = M.holeHalfW * 0.97, hh = (M.holeY1 - M.holeY0) / 2 * 0.97;
    const a0 = Math.random() * Math.PI * 2;
    const toCenter = Math.random() < 0.4;
    const a1 = toCenter ? a0 + (Math.random() - 0.5) : a0 + Math.PI * (0.4 + Math.random() * 0.8);
    const r1 = toCenter ? 0.15 + Math.random() * 0.2 : 1;
    const p0 = new THREE.Vector3(Math.cos(a0) * hw, cy + Math.sin(a0) * hh, 0);
    const p1 = new THREE.Vector3(Math.cos(a1) * hw * r1, cy + Math.sin(a1) * hh * r1, 0);
    const pos = arc.line.geometry.attributes.position as THREE.BufferAttribute;
    const n = pos.count;
    const dir = p1.clone().sub(p0);
    const perp = new THREE.Vector3(-dir.y, dir.x, 0).normalize();
    const amp = dir.length() * 0.12;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const env = Math.sin(Math.PI * t);
      const j = (Math.random() - 0.5) * 2 * amp * env;
      _v.copy(p0).lerp(p1, t).addScaledVector(perp, j);
      _v.z += (Math.random() - 0.5) * 0.12 * env;
      pos.setXYZ(i, _v.x, _v.y, _v.z);
    }
    pos.needsUpdate = true;
    arc.life = 0.05 + Math.random() * 0.1;
  }

  /** 매 프레임. 활성 상태에서 플레이어가 고리를 지나가면 true */
  update(dt: number, playerPos: THREE.Vector3) {
    this.time += dt;
    this.mixer.update(dt);

    // 세기: 활성(처음엔 몇 번 깜빡이며 켜진다) + 시작 섬광
    let act = 0;
    if (this.active) {
      this.activeT += dt;
      const k = Math.min(this.activeT / PORTAL.activateTime, 1);
      const flicker = k < 1 ? (Math.random() < 0.35 ? 0.3 : 1) : 1;
      act = k * flicker;
    }
    let fl = 0;
    if (this.flashT >= 0) {
      this.flashT += dt;
      const p = this.flashT / PORTAL.introFlash;
      fl = p < 0.15 ? p / 0.15 : Math.max(0, 1 - (p - 0.15) / 0.85);
      if (p >= 1) this.flashT = -1;
    }
    this.power = Math.max(act, fl);
    for (const c of this.crystals) c.emissiveIntensity = 0.5 + this.power * 3;
    this.fx.visible = this.power > 0.001;

    if (this.fx.visible) {
      this.discMat.uniforms.uTime.value = this.time;
      this.discMat.uniforms.uPower.value = this.power;
      this.light.intensity = this.power * (5 + Math.random() * 3) * this.k * this.k * 4;
      this.light.distance = 10 * this.k;
      // 번개: 수명이 다하면 새로 그린다
      for (const arc of this.arcs) {
        arc.life -= dt;
        if (arc.life <= 0) this.zap(arc);
        (arc.line.material as THREE.LineBasicMaterial).opacity = this.power * (0.5 + Math.random() * 0.5);
      }
      // 입자: 안으로 갈수록 빨리 돌며 빨려 든다
      const cy = (M.holeY0 + M.holeY1) / 2, hw = M.holeHalfW, hh = (M.holeY1 - M.holeY0) / 2;
      const pos = this.points.geometry.attributes.position as THREE.BufferAttribute;
      const col = this.points.geometry.attributes.color as THREE.BufferAttribute;
      this.sparks.forEach((s, i) => {
        s.r -= dt * s.speed * (0.4 + (1.7 - s.r) * 0.6);
        s.a += dt * (1.4 / (s.r + 0.25));
        if (s.r < 0.05) Object.assign(s, this.newSpark());
        const zr = Math.min(s.r, 1);
        pos.setXYZ(i, Math.cos(s.a) * s.r * hw, cy + Math.sin(s.a) * s.r * hh, s.z * zr * zr);
        // 바깥에서 나타나고 가운데에서 사라진다
        const b = this.power * Math.min(1, (1.65 - s.r) * 2) * Math.min(1, s.r * 4);
        col.setXYZ(i, 0.55 * b, 0.85 * b, 1.0 * b);
      });
      pos.needsUpdate = true;
      col.needsUpdate = true;
      (this.points.material as THREE.PointsMaterial).size = 0.09 * this.k;
    }

    // 진입: 활성으로 다 켜졌을 때, 몸 중심이 고리 평면 근처이고 구멍 안쪽이면
    if (!this.active || this.activeT < PORTAL.activateTime) return false;
    const local = this.root.worldToLocal(_v.set(playerPos.x, playerPos.y + 0.9, playerPos.z));
    return Math.abs(local.z) < PORTAL.enterDepth && Math.abs(local.x) < M.holeHalfW * PORTAL.enterWidthMul &&
      local.y > M.platformY && local.y < M.holeY1;
  }

  /** 미니맵 표시 */
  marker() {
    return { x: this.root.position.x, z: this.root.position.z, active: this.active };
  }
}

/** 가운데가 밝고 가장자리로 사라지는 점 */
function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.5)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
