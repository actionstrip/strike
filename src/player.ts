import * as THREE from 'three';
import { CLIP, LOOK, MANTLE, MOVE } from './config';
import type { Input } from './input';

export interface Ledge {
  /** 모서리 지점(벽면과 윗면이 만나는 곳, 월드) */
  edge: THREE.Vector3;
  /** 발 기준 높이 */
  height: number;
  /** 오른 뒤 설 위치 */
  to: THREE.Vector3;
}

interface MantleState extends Ledge {
  t: number;
  dur: number;
  from: THREE.Vector3;
  /** 벽 바로 앞(상승이 끝나는 수평 위치) */
  wall: THREE.Vector3;
  fwd: THREE.Vector3;
}

const _ray = new THREE.Ray();
const _hit = new THREE.Vector3();
const _box = new THREE.Box3();

/** 1인칭/3인칭 공용 플레이어 이동. 위치는 발바닥 기준. */
export class Player {
  pos = new THREE.Vector3(0, 0, 0);
  vel = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  grounded = true;
  sprinting = false;
  /** 달리기 해제 후 남은 지연(이 동안 발사, 조준 불가) */
  sprintOut = 0;
  /** 걸음 주기 위상 0..1 (하체 클립과 무기 bob이 같이 쓴다) */
  gaitPhase = 0;
  /** 이동 속도를 클립 기준 속도로 나눈 값 */
  landImpulse = 0;
  /** 디버그: 위치를 고정한 채 이동 애니메이션만 재생 */
  treadmill = false;
  /** 디버그: 걸음 위상 고정 */
  phaseHold: number | null = null;
  /** 매달려 오르기 진행 상태 */
  mantle: MantleState | null = null;
  /** 디버그: 오르기 진행도 고정 */
  mantleHold: number | null = null;
  private mantleCooldown = 0;
  /** 마지막으로 땅을 밟았던 높이(공중 오르기 한계 기준) */
  private groundY = 0;
  private wasGrounded = true;
  /** C 토글로 정한 앉기 상태 */
  crouchToggle = false;
  /** 실제로 앉아 있는지(원하지 않아도 머리 위가 막히면 앉은 채로 있다) */
  crouched = false;
  /** 0=서기, 1=앉기 (자세, 눈높이, 충돌 높이가 같이 쓴다) */
  crouchBlend = 0;

  constructor(private colliders: THREE.Box3[]) {}

  get horizSpeed() {
    return Math.hypot(this.vel.x, this.vel.z);
  }

  /** 시선 기준 로컬 속도(x=오른쪽, z=앞) */
  localVel(out = new THREE.Vector2()) {
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    // forward = (-s, 0, -c), right = (c, 0, -s)
    out.set(this.vel.x * c - this.vel.z * s, -this.vel.x * s - this.vel.z * c);
    return out;
  }

  look(input: Input, adsAmount: number) {
    const k = LOOK.sensitivity * (1 - adsAmount * (1 - LOOK.adsSensitivityScale));
    this.yaw -= input.mouseDX * k;
    this.pitch -= input.mouseDY * k;
    this.pitch = THREE.MathUtils.clamp(this.pitch, -LOOK.pitchLimit, LOOK.pitchLimit);
  }

  /** 현재 충돌 높이 */
  get height() {
    return THREE.MathUtils.lerp(MOVE.height, MOVE.crouchHeight, this.crouchBlend);
  }

  /** 지금 자리에서 일어설 공간이 있는지 */
  canStand() {
    const r = MOVE.radius;
    _box.min.set(this.pos.x - r, this.pos.y + 0.05, this.pos.z - r);
    _box.max.set(this.pos.x + r, this.pos.y + MOVE.height, this.pos.z + r);
    return !this.colliders.some((o) => o.intersectsBox(_box) && o.min.y > this.pos.y + 0.05);
  }

  private updateCrouch(dt: number, input: Input) {
    if (input.crouchToggled()) this.crouchToggle = !this.crouchToggle;
    const want = input.virtualCrouch ?? (this.crouchToggle || input.crouchHeld());
    this.crouched = want || (this.crouched && !this.canStand());
    const k = 1 - Math.exp(-MOVE.crouchRate * dt);
    this.crouchBlend += ((this.crouched ? 1 : 0) - this.crouchBlend) * k;
    if (Math.abs(this.crouchBlend - (this.crouched ? 1 : 0)) < 0.002) this.crouchBlend = this.crouched ? 1 : 0;
  }

  /** 앉기를 푼다(달리기, 점프, 오르기 시작). 머리 위가 막혀 있으면 풀지 못한다. */
  private standUp(input: Input) {
    if (!this.canStand()) return false;
    this.crouchToggle = false;
    if (input.virtualCrouch) input.virtualCrouch = false;
    this.crouched = input.crouchHeld() && input.virtualCrouch === null;
    return !this.crouched;
  }

  /** 오르기 진행도 0..1, 오르는 중이 아니면 -1 */
  get mantleProgress() {
    return this.mantle ? Math.min(this.mantle.t / this.mantle.dur, 1) : -1;
  }

  forward(out = new THREE.Vector3()) {
    return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  /** 정면에 오를 수 있는 모서리를 찾는다(가장 가까운 것). */
  findLedge(): Ledge | null {
    const fwd = this.forward();
    const r = MOVE.radius;
    let best: Ledge | null = null;
    let bestDist = Infinity;
    for (const c of this.colliders) {
      const h = c.max.y - this.pos.y;
      if (h < MANTLE.minHeight || h > MANTLE.maxHeight) continue;
      _ray.set(new THREE.Vector3(this.pos.x, c.max.y - 0.05, this.pos.z), fwd);
      if (!_ray.intersectBox(c, _hit)) continue;
      const dist = Math.hypot(_hit.x - this.pos.x, _hit.z - this.pos.z);
      if (dist < r * 0.5 || dist > r + MANTLE.reach || dist >= bestDist) continue;
      const edge = new THREE.Vector3(_hit.x, c.max.y, _hit.z);
      const to = edge.clone().addScaledVector(fwd, r + 0.3);
      to.y = c.max.y;
      // 오른 자리에 설 공간이 있어야 한다
      _box.min.set(to.x - r, to.y + 0.02, to.z - r);
      _box.max.set(to.x + r, to.y + MOVE.height, to.z + r);
      if (this.colliders.some((o) => o.intersectsBox(_box))) continue;
      // 오르는 동안 머리 위가 막혀 있으면 안 된다
      _box.min.set(this.pos.x - r * 0.8, this.pos.y + this.height, this.pos.z - r * 0.8);
      _box.max.set(this.pos.x + r * 0.8, c.max.y + MOVE.height, this.pos.z + r * 0.8);
      if (this.colliders.some((o) => o !== c && o.intersectsBox(_box))) continue;
      bestDist = dist;
      best = { edge, height: h, to };
    }
    return best;
  }

  startMantle(l: Ledge) {
    const fwd = this.forward();
    // 오르면 일어선다
    this.crouchToggle = false;
    this.crouched = false;
    const wall = l.edge.clone().addScaledVector(fwd, -(MOVE.radius + 0.02));
    this.mantle = {
      ...l, t: 0, dur: MANTLE.baseTime + MANTLE.timePerMeter * l.height,
      from: this.pos.clone(), wall, fwd,
    };
    this.vel.set(0, 0, 0);
    this.sprinting = false;
    this.grounded = false;
  }

  private updateMantle(dt: number) {
    const m = this.mantle!;
    m.t = this.mantleHold !== null ? this.mantleHold * m.dur : m.t + dt;
    const p = Math.min(m.t / m.dur, 1);
    const top = m.to.y + 0.03;
    if (p < MANTLE.risePart) {
      const u = p / MANTLE.risePart;
      const e = u * u * (3 - 2 * u); // 손을 짚고 천천히 시작해서 밀어 올린다
      this.pos.set(
        THREE.MathUtils.lerp(m.from.x, m.wall.x, Math.min(u * 1.5, 1)),
        THREE.MathUtils.lerp(m.from.y, top, e),
        THREE.MathUtils.lerp(m.from.z, m.wall.z, Math.min(u * 1.5, 1)),
      );
    } else {
      const u = (p - MANTLE.risePart) / (1 - MANTLE.risePart);
      const e = u * u * (3 - 2 * u);
      this.pos.set(THREE.MathUtils.lerp(m.wall.x, m.to.x, e), THREE.MathUtils.lerp(top, m.to.y, e), THREE.MathUtils.lerp(m.wall.z, m.to.z, e));
    }
    if (p >= 1 && this.mantleHold === null) {
      this.pos.copy(m.to);
      this.vel.copy(m.fwd).multiplyScalar(1.2);
      this.mantle = null;
      this.mantleCooldown = 0.25;
      this.grounded = true;
      this.wasGrounded = true;
      this.groundY = this.pos.y;
    }
  }

  update(dt: number, input: Input, opts: { ads: boolean; wantsSprintBlocked: boolean }) {
    if (this.mantleCooldown > 0) this.mantleCooldown -= dt;
    if (this.mantle) {
      this.updateMantle(dt);
      this.crouchBlend = Math.max(0, this.crouchBlend - dt * MOVE.crouchRate * 0.5);
      this.landImpulse = Math.max(0, this.landImpulse - dt * 4);
      return;
    }
    this.updateCrouch(dt, input);
    const axis = input.moveAxis();
    const moving = axis.x !== 0 || axis.z !== 0;
    let canSprint = input.sprintHeld() && axis.z > 0.5 && this.grounded && !opts.ads && !opts.wantsSprintBlocked;
    // 달리기를 시작하면 일어선다(머리 위가 막혀 있으면 달리지 못한다)
    if (canSprint && this.crouched) canSprint = this.standUp(input);
    if (this.sprinting && !canSprint) this.sprintOut = MOVE.sprintOutDelay;
    this.sprinting = canSprint;
    if (this.sprintOut > 0) this.sprintOut -= dt;

    const walk = opts.ads ? MOVE.adsWalk : MOVE.walk;
    const speed = this.sprinting ? MOVE.sprint : THREE.MathUtils.lerp(walk, Math.min(walk, MOVE.crouch), this.crouchBlend);
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    const wishX = (axis.x * c + axis.z * -s) * (moving ? speed : 0);
    const wishZ = (axis.x * -s + axis.z * -c) * (moving ? speed : 0);
    const acc = this.grounded ? MOVE.accel : MOVE.airAccel;
    const f = 1 - Math.exp(-acc * dt);
    this.vel.x += (wishX - this.vel.x) * f;
    this.vel.z += (wishZ - this.vel.z) * f;

    const crouchLedge = this.grounded && this.crouched && input.pressed.has('Space') && this.mantleCooldown <= 0 && axis.z >= 0 ? this.findLedge() : null;
    if (crouchLedge && crouchLedge.height > MANTLE.jumpOverHeight * 0.6) {
      // 앉은 채 앞에 오를 턱이 있으면 바로 오른다(일어서며 오르기)
      this.startMantle(crouchLedge);
      return;
    } else if (this.grounded && input.pressed.has('Space') && this.crouched) {
      // 앉은 상태에서 Space는 점프하지 않고 일어서기만 한다
      this.standUp(input);
    } else if (this.grounded && input.pressed.has('Space')) {
      // 정면에 오를 모서리가 있으면 점프 대신 매달려 오른다
      const ledge = this.mantleCooldown <= 0 && axis.z >= 0 ? this.findLedge() : null;
      if (ledge && ledge.height > MANTLE.jumpOverHeight) {
        this.startMantle(ledge);
        return;
      }
      this.vel.y = MOVE.jump;
      this.grounded = false;
    } else if (!this.grounded && axis.z > 0.3 && this.mantleCooldown <= 0) {
      // 공중에서 앞으로 밀면 닿는 모서리를 잡는다
      const ledge = this.findLedge();
      if (ledge && ledge.height <= MANTLE.airMaxHeight && ledge.edge.y - this.groundY <= MANTLE.maxHeight) {
        this.startMantle(ledge);
        return;
      }
    }
    this.vel.y -= MOVE.gravity * dt;
    const fallSpeed = -this.vel.y;

    if (!this.treadmill) {
      this.moveAxis('x', this.vel.x * dt);
      this.moveAxis('z', this.vel.z * dt);
    }
    this.grounded = false;
    this.moveAxis('y', this.vel.y * dt);
    if (this.pos.y <= 0) {
      this.pos.y = 0;
      if (this.vel.y < 0) this.vel.y = 0;
      this.grounded = true;
    }
    // 착지 충격은 낙하 속도에 비례(점프 착지 약 0.8, 높은 곳에서 떨어지면 최대 1.5)
    if (this.grounded && !this.wasGrounded) this.landImpulse = THREE.MathUtils.clamp(fallSpeed / 7.5, 0.25, 1.5);
    this.wasGrounded = this.grounded;
    if (this.grounded) this.groundY = this.pos.y;
    this.landImpulse = Math.max(0, this.landImpulse - dt * 4);

    // 걸음 위상: 클립 한 주기 동안 이동하는 거리를 기준으로 진행한다(발 미끄러짐 방지)
    const hs = this.horizSpeed;
    if (this.grounded && hs > 0.05) {
      const run = this.runBlend();
      const strideWalk = CLIP.walkSpeed * 0.6; // 걷기 클립: 0.6초 주기
      const strideRun = CLIP.runSpeed * (16 / 30); // 달리기 클립: 16프레임 주기
      const strideCrouch = CLIP.crouchSpeed * CLIP.crouchPeriod;
      const stride = THREE.MathUtils.lerp(strideWalk + (strideRun - strideWalk) * run, strideCrouch, this.crouchBlend);
      this.gaitPhase = (this.gaitPhase + (hs * dt) / stride) % 1;
    }
    if (this.phaseHold !== null) this.gaitPhase = this.phaseHold;
  }

  /** 0=걷기, 1=달리기 */
  runBlend() {
    return THREE.MathUtils.clamp((this.horizSpeed - MOVE.walk) / (MOVE.sprint - MOVE.walk), 0, 1);
  }

  private moveAxis(axis: 'x' | 'y' | 'z', d: number) {
    if (d === 0) return;
    this.pos[axis] += d;
    const r = MOVE.radius;
    const box = new THREE.Box3(
      new THREE.Vector3(this.pos.x - r, this.pos.y, this.pos.z - r),
      new THREE.Vector3(this.pos.x + r, this.pos.y + this.height, this.pos.z + r),
    );
    for (const c of this.colliders) {
      if (!box.intersectsBox(c)) continue;
      // 윗면에 서 있는 박스(발이 윗면과 같은 높이)는 옆으로 밀어내지 않는다
      if (axis !== 'y' && this.pos.y >= c.max.y - 1e-3) continue;
      // 발 높이 기준으로 낮은 턱(0.45m 이하)은 올라선다
      if (axis !== 'y' && c.max.y - this.pos.y <= 0.45 && this.grounded !== false) {
        const up = c.max.y - this.pos.y;
        if (up > 0) { this.pos.y = c.max.y; box.min.y += up; box.max.y += up; continue; }
      }
      if (axis === 'y') {
        if (d < 0) { this.pos.y = c.max.y; this.vel.y = 0; this.grounded = true; }
        else { this.pos.y = c.min.y - this.height; this.vel.y = 0; }
      } else if (d > 0) {
        this.pos[axis] = c.min[axis] - r - 1e-4;
      } else {
        this.pos[axis] = c.max[axis] + r + 1e-4;
      }
      box.setFromCenterAndSize(
        new THREE.Vector3(this.pos.x, this.pos.y + this.height / 2, this.pos.z),
        new THREE.Vector3(r * 2, this.height, r * 2),
      );
    }
  }
}
