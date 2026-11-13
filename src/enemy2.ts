import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Assets } from './assets';
import { ENEMY2 } from './config';
import { bone, Enemy, fitCullSpheres, LifeBar, patchGrey, UP, type EnemyHooks } from './enemy';
import type { Player } from './player';
import { rotateBoneWorld } from './rig';

/**
 * 두 번째 적: 카메라 몸통에 두 다리가 달린 보행 로봇(enemy2_robot.glb, "Walking robot" by komov, CC BY 4.0).
 * AI(경계, 순찰, 전투)는 Enemy와 같고, 무기는 몸통 가운데 렌즈에서 쏘는 레이저다(충전 -> 발사).
 *
 * 모델 좌표(glTF 장면 단위): 발바닥 y=-7.93, 렌즈 중심 (0, 3.84, 5.3), 렌즈가 +Z를 본다.
 * 그래서 model.rotation.y = PI로 -Z가 정면이 되게 놓고, ENEMY2.unit배로 줄인다.
 * 원본 애니메이션(11초)은 걷기 사이사이 몸통을 돌리는 동작이 섞여 있어서, 몸통이 정면인 걷기 한 주기(116~148프레임)만 쓴다.
 * 서 있을 때는 걷기 클립을 두 발이 모두 땅에 닿은 위상(0 또는 0.5)에 멈춰 둔다.
 * 몸통(Osnova_Top_01)의 좌우 회전과 렌즈 위아래 조준은 코드가 한다.
 */

const FEET = 7.93;
/** 처음 크기(unit 0.085) 대비 배율: 미터로 정한 값(쓰러짐, 빛 크기 등)에 곱한다 */
const K = ENEMY2.size;
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();

export class WalkerEnemy extends Enemy {
  readonly kind = 'walker';
  model: THREE.Object3D;
  lifeBar: LifeBar;
  mixer: THREE.AnimationMixer;
  walk: THREE.AnimationAction;
  /** 렌즈 끝(레이저가 나가는 곳). 렌즈 본에 붙어 있다. */
  muzzle = new THREE.Object3D();

  /** 쓰러질 때 기울이는 받침점(발 옆 바닥) */
  private tilt = new THREE.Object3D();
  private top: THREE.Bone;
  private topRest = new THREE.Quaternion();
  /** 몸통 본 기준 렌즈 정면 방향 */
  private lensFwdLocal = new THREE.Vector3();
  /** 조금 늦게 따라가는 조준점(레이저가 실제로 노리는 곳) */
  private lagAim = new THREE.Vector3();
  private lagInit = false;
  private phase = 0;
  private pitch = 0;
  private recoil = 0;
  /** 레이저 충전 남은 시간(0 이하면 충전 중 아님) */
  private chargeT = 0;
  /** 발사 직후 렌즈 섬광 */
  private flashT = 0;
  private glow: THREE.Sprite;
  /** 쓰러지는 방향(루트 기준 수평 단위 벡터)과 최대 기울기. 죽는 순간 주변 벽을 보고 정한다. */
  private fallDir: THREE.Vector3 | null = null;
  private fallMax = Math.PI / 2;
  private fallSide = 1;
  private settled = false;
  private mats: THREE.MeshStandardMaterial[] = [];

  constructor(assets: Assets, rand: () => number, flashTex: THREE.Texture) {
    super(ENEMY2, rand);
    this.fallSide = Math.random() < 0.5 ? -1 : 1;
    const u = ENEMY2.unit;
    this.model = SkeletonUtils.clone(assets.enemy2.scene);
    this.model.rotation.y = Math.PI;
    this.model.scale.setScalar(u);
    this.model.position.y = FEET * u;
    this.root.add(this.tilt);
    this.tilt.add(this.model);
    this.model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.receiveShadow = true;
      const c = (m.material as THREE.MeshStandardMaterial).clone();
      patchGrey(c, this.greyU);
      this.mats.push(c);
      m.material = c;
    });
    this.top = bone(this.model, 'Osnova_Top_01');

    this.mixer = new THREE.AnimationMixer(this.model);
    this.walk = this.mixer.clipAction(assets.enemy2Clips.Walk);
    this.walk.play();
    this.mixer.update(0);
    fitCullSpheres(this.model);
    this.topRest.copy(this.top.quaternion);
    this.root.updateMatrixWorld(true);

    // 렌즈 끝: 렌즈 본(Pipka_05) 위치에 붙인다
    const lens = bone(this.model, 'Pipka_05');
    lens.getWorldPosition(_v);
    this.muzzle.position.copy(_v);
    this.root.add(this.muzzle);
    this.root.updateMatrixWorld(true);
    lens.attach(this.muzzle);
    // 몸통 본 기준 렌즈 정면(지금 몸통은 -Z를 본다)
    this.top.getWorldQuaternion(_q);
    this.lensFwdLocal.set(0, 0, -1).applyQuaternion(_q.invert());

    // 피격 박스(모델 단위로 만들어 몸통은 몸통 본에, 다리는 모델에 붙인다)
    const boxMat = new THREE.MeshBasicMaterial({ visible: false });
    const body = new THREE.Mesh(new THREE.BoxGeometry(5.2, 8.9, 9.4), boxMat);
    body.position.set(0, 4.15, 0.7);
    const legs = new THREE.Mesh(new THREE.BoxGeometry(10.4, 7.6, 8), boxMat);
    legs.position.set(0, -4.1, -0.2);
    this.model.add(body, legs);
    this.root.updateMatrixWorld(true);
    this.top.attach(body);
    for (const b of [body, legs]) {
      b.userData.enemy = this;
      this.hitBoxes.push(b);
    }

    this.lifeBar = new LifeBar(this.root, 1.85 * K + 0.1);
    this.lifeBar.draw(this.hp, ENEMY2.health, 0);

    // 충전/발사 때 렌즈 앞 붉은 빛
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: flashTex, color: 0xff3a24, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.glow.visible = false;
    this.glow.renderOrder = 11;
    this.root.add(this.glow);
  }

  /**
   * 쓰러질 방향 고르기: 옆(좌우 중 하나 먼저), 반대 옆, 뒤, 앞 순으로 보고 몸 길이(처음 크기 약 1.6m × size)만큼 비어 있는 첫 방향.
   * 다 막혀 있으면 가장 많이 빈 쪽으로, 벽에 닿는 각도까지만 기울인다(벽에 기댄다).
   */
  private chooseFall() {
    const L = 1.6 * K;
    const cands = [new THREE.Vector3(this.fallSide, 0, 0), new THREE.Vector3(-this.fallSide, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1)];
    let best = cands[0], bestFree = -1;
    for (const c of cands) {
      const w = c.clone().applyQuaternion(this.root.quaternion);
      const free = this.freeLength(w, L);
      if (free >= L) { best = c; bestFree = L; break; }
      if (free > bestFree) { best = c; bestFree = free; }
    }
    this.fallDir = best;
    // 몸통 꼭대기(처음 크기 약 1.5m × size)가 벽 앞에서 멈추는 각도
    this.fallMax = bestFree >= L ? Math.PI / 2 : Math.asin(THREE.MathUtils.clamp((bestFree - 0.15 * K) / (1.5 * K), 0.15, 1));
  }

  /** 발밑에서 수평 방향 dir(월드)로 얼마나 비어 있는지(m, 최대 max). 높이 0.1m~(1.4m × size)의 충돌 박스만 본다. */
  private freeLength(dir: THREE.Vector3, max: number) {
    const p = this.root.position;
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    for (let d = 0.3 * K; d <= max + 1e-6; d += 0.1) {
      for (const s of [-0.3 * K, 0, 0.3 * K]) {
        const x = p.x + dir.x * d + side.x * s;
        const z = p.z + dir.z * d + side.z * s;
        for (const c of this.colliders) {
          if (c.max.y < 0.1 || c.min.y > 1.4 * K) continue;
          if (x > c.min.x && x < c.max.x && z > c.min.z && z < c.max.z) return d - 0.1;
        }
      }
    }
    return max;
  }

  /** 모델의 가장 낮은 점(월드 y, 정점 일부만 표본) */
  private lowestY() {
    let min = Infinity;
    this.model.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isSkinnedMesh) return;
      const p = m.geometry.getAttribute('position');
      for (let i = 0; i < p.count; i += 5) {
        _v.fromBufferAttribute(p, i);
        m.applyBoneTransform(i, _v);
        _v.applyMatrix4(m.matrixWorld);
        if (_v.y < min) min = _v.y;
      }
    });
    return min;
  }

  /** 렌즈 정면 방향(월드) */
  lensForward(out: THREE.Vector3) {
    return out.copy(this.lensFwdLocal).applyQuaternion(this.top.getWorldQuaternion(_q));
  }

  /** 레이저 충전 중인지(0..1, 충전 아니면 0) */
  get charge() {
    return this.chargeT > 0 ? 1 - this.chargeT / ENEMY2.chargeTime : 0;
  }

  protected eyePosition(out: THREE.Vector3) {
    return this.muzzle.getWorldPosition(out);
  }

  protected idleAimHeight() {
    return 1.0 * K;
  }

  protected onEngage() {
    this.chargeT = 0;
  }

  protected weaponBusy() {
    return this.chargeT > 0;
  }

  /** 조준이 맞으면 충전을 시작한다. 발사는 충전이 끝날 때 weaponTick에서. */
  protected attack(_player: Player, _playerHead: THREE.Vector3, hooks: EnemyHooks) {
    this.chargeT = ENEMY2.chargeTime;
    hooks.onCharge?.(this, this.muzzle.getWorldPosition(new THREE.Vector3()));
    return ENEMY2.chargeTime + THREE.MathUtils.lerp(ENEMY2.laserPause[0], ENEMY2.laserPause[1], this.rand());
  }

  protected weaponTick(dt: number, hooks: EnemyHooks) {
    this.recoil = Math.max(0, this.recoil - dt * 6);
    this.flashT = Math.max(0, this.flashT - dt);
    if (this.chargeT > 0) {
      this.chargeT -= dt;
      if (!this.alive || this.frozen) {
        this.chargeT = 0;
      } else if (this.chargeT <= 0) {
        // 렌즈가 보는 방향으로 쏜다(충전 중 플레이어가 피하면 빗나간다)
        const from = this.muzzle.getWorldPosition(new THREE.Vector3());
        // 렌즈 방향에서 trackAssist 안이면 늦게 따라간 조준점 쪽으로 꺾어 쏜다
        const lens = this.lensForward(new THREE.Vector3());
        const want = _v2.subVectors(this.lagAim, from).normalize();
        const ang = lens.angleTo(want);
        if (ang > 1e-4) {
          const k = Math.min(1, ENEMY2.trackAssist / ang);
          lens.applyQuaternion(_q.identity().slerp(_q2.setFromUnitVectors(lens, want), k));
        }
        const dir = this.spreadDir(lens, ENEMY2.spread * this.spreadMul());
        this.recoil = 1;
        this.flashT = 0.12;
        hooks.onFire(this, from, dir, 'laser');
      }
    }
  }

  protected animate(dt: number, aim: THREE.Vector3) {
    const C = ENEMY2;
    this.root.rotation.y = this.yaw;
    const dead = this.deathT >= 0;
    if (dead) this.deathT += dt;
    this.springHead(dt);
    this.top.quaternion.copy(this.topRest);

    // 걸음: 이동 거리(제자리 회전 포함)만큼 클립을 진행. 멈추면 두 발이 땅에 닿은 위상으로 마저 걷고 선다.
    const stepSpeed = dead ? 0 : Math.max(this.speed, this.turnRate * 0.35);
    if (stepSpeed > 0.03) {
      this.phase += (stepSpeed * dt) / C.walkStride;
    } else {
      const d = Math.round(this.phase * 2) / 2 - this.phase;
      this.phase += THREE.MathUtils.clamp(d, -0.9 * dt, 0.9 * dt);
    }
    this.phase = ((this.phase % 1) + 1) % 1;
    this.walk.time = this.phase * this.walk.getClip().duration;
    this.mixer.update(0);
    this.topRest.copy(this.top.quaternion);

    if (dead) {
      // 비어 있는 쪽으로 쓰러진다(중력처럼 빨라지다 바닥에서 살짝 튄다), 회색으로, 렌즈 불빛을 끈다
      if (!this.fallDir) this.chooseFall();
      const fd = this.fallDir!;
      const t = this.deathT;
      const max = this.fallMax;
      const tf = Math.sqrt((2 * max) / 6);
      const ang = t < tf ? 0.5 * 6 * t * t : max - Math.min(0.12, max * 0.1) * Math.abs(Math.sin((t - tf) * 9)) * Math.exp(-(t - tf) * 5);
      // 받침점: 넘어지는 쪽 발 가장자리. 축 = 위 × 방향(양의 각이면 위쪽이 그 방향으로 기운다)
      this.tilt.position.set(fd.x * 0.4 * K, this.tilt.position.y, fd.z * 0.4 * K);
      this.model.position.set(-fd.x * 0.4 * K, FEET * C.unit, -fd.z * 0.4 * K);
      this.tilt.quaternion.setFromAxisAngle(_v2.crossVectors(UP, fd).normalize(), ang);
      // 다 쓰러지면 한 번 재서 가장 낮은 점이 바닥에 닿게 내린다(옆으로 누우면 다리가 받쳐 몸이 뜨지 않도록)
      if (t >= tf && !this.settled) {
        this.settled = true;
        this.root.updateMatrixWorld(true);
        this.tilt.position.y -= this.lowestY() - this.root.position.y;
      }
      const g = Math.min(1, t / C.greyTime);
      this.greyU.uGrey.value = g;
      for (const m of this.mats) m.emissiveIntensity = 1 - g;
      this.glow.visible = false;
      this.root.updateMatrixWorld(true);
      return;
    }

    this.root.updateMatrixWorld(true);
    // 몸통 좌우: 다리 기준 최대 headMax
    const yawOff = THREE.MathUtils.clamp(this.headYaw, -C.headMax, C.headMax);
    rotateBoneWorld(this.top, UP, yawOff);
    // 렌즈 위아래: 전투/수색이면 목표 높이로, 평소에는 살짝 아래
    const lensPos = this.muzzle.getWorldPosition(_v);
    let want = -0.06;
    if (this.state === 'combat' || this.state === 'search') {
      const flat = Math.hypot(aim.x - lensPos.x, aim.z - lensPos.z);
      want = THREE.MathUtils.clamp(Math.atan2(aim.y - lensPos.y, flat), -C.pitchMax, C.pitchMax) * THREE.MathUtils.smoothstep(this.raise, 0, 1);
    }
    this.pitch += (want - this.pitch) * (1 - Math.exp(-7 * dt));
    const yw = this.yaw + yawOff;
    const right = _v2.set(Math.cos(yw), 0, -Math.sin(yw));
    // 맞으면 몸통이 뒤로 젖혀지고, 쏘면 렌즈가 위로 튄다
    rotateBoneWorld(this.top, right, this.pitch + 0.3 * this.flinch + 0.08 * this.recoil);

    // 조준 오차(발사 판정): 레이저가 노리는 늦은 조준점 기준, 발사 때 꺾어 줄 수 있는 각도는 빼고 본다
    this.muzzle.getWorldPosition(lensPos);
    const fwd = this.lensForward(new THREE.Vector3());
    if (!this.lagInit || this.state !== 'combat') this.lagAim.copy(aim);
    else this.lagAim.lerp(aim, 1 - Math.exp(-dt / C.aimLag));
    this.lagInit = true;
    this.aimError = Math.max(0, fwd.angleTo(_v2.subVectors(this.lagAim, lensPos).normalize()) - C.trackAssist);

    // 충전: 렌즈 앞 붉은 빛이 커지며 깜박인다. 발사 직후 크게 번쩍.
    const ch = this.charge;
    const show = ch > 0 || this.flashT > 0;
    this.glow.visible = show;
    if (show) {
      const s = K * (this.flashT > 0 ? 0.55 * (this.flashT / 0.12) + 0.1 : 0.06 + 0.26 * ch * ch * (0.85 + 0.15 * Math.sin(this.deathT + performance.now() * 0.05)));
      this.glow.scale.setScalar(s);
      this.glow.position.copy(this.root.worldToLocal(lensPos.addScaledVector(fwd, 0.03)));
      (this.glow.material as THREE.SpriteMaterial).opacity = this.flashT > 0 ? 1 : 0.35 + 0.65 * ch;
    }
  }
}
