import * as THREE from 'three';
import { CLIP, LOOK, MOVE } from './config';
import type { Input } from './input';

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
  private wasGrounded = true;

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

  update(dt: number, input: Input, opts: { ads: boolean; wantsSprintBlocked: boolean }) {
    const axis = input.moveAxis();
    const moving = axis.x !== 0 || axis.z !== 0;
    const canSprint = input.sprintHeld() && axis.z > 0.5 && this.grounded && !opts.ads && !opts.wantsSprintBlocked;
    if (this.sprinting && !canSprint) this.sprintOut = MOVE.sprintOutDelay;
    this.sprinting = canSprint;
    if (this.sprintOut > 0) this.sprintOut -= dt;

    const speed = this.sprinting ? MOVE.sprint : opts.ads ? MOVE.adsWalk : MOVE.walk;
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    const wishX = (axis.x * c + axis.z * -s) * (moving ? speed : 0);
    const wishZ = (axis.x * -s + axis.z * -c) * (moving ? speed : 0);
    const acc = this.grounded ? MOVE.accel : MOVE.airAccel;
    const f = 1 - Math.exp(-acc * dt);
    this.vel.x += (wishX - this.vel.x) * f;
    this.vel.z += (wishZ - this.vel.z) * f;

    if (this.grounded && input.pressed.has('Space')) {
      this.vel.y = MOVE.jump;
      this.grounded = false;
    }
    this.vel.y -= MOVE.gravity * dt;

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
    if (this.grounded && !this.wasGrounded) this.landImpulse = 1;
    this.wasGrounded = this.grounded;
    this.landImpulse = Math.max(0, this.landImpulse - dt * 4);

    // 걸음 위상: 클립 한 주기 동안 이동하는 거리를 기준으로 진행한다(발 미끄러짐 방지)
    const hs = this.horizSpeed;
    if (this.grounded && hs > 0.05) {
      const run = this.runBlend();
      const strideWalk = CLIP.walkSpeed * 0.6; // 걷기 클립: 0.6초 주기
      const strideRun = CLIP.runSpeed * (16 / 30); // 달리기 클립: 16프레임 주기
      const stride = strideWalk + (strideRun - strideWalk) * run;
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
      new THREE.Vector3(this.pos.x + r, this.pos.y + MOVE.height, this.pos.z + r),
    );
    for (const c of this.colliders) {
      if (!box.intersectsBox(c)) continue;
      // 발 높이 기준으로 낮은 턱(0.45m 이하)은 올라선다
      if (axis !== 'y' && c.max.y - this.pos.y <= 0.45 && this.grounded !== false) {
        const up = c.max.y - this.pos.y;
        if (up > 0) { this.pos.y = c.max.y; box.min.y += up; box.max.y += up; continue; }
      }
      if (axis === 'y') {
        if (d < 0) { this.pos.y = c.max.y; this.vel.y = 0; this.grounded = true; }
        else { this.pos.y = c.min.y - MOVE.height; this.vel.y = 0; }
      } else if (d > 0) {
        this.pos[axis] = c.min[axis] - r - 1e-4;
      } else {
        this.pos[axis] = c.max[axis] + r + 1e-4;
      }
      box.setFromCenterAndSize(
        new THREE.Vector3(this.pos.x, this.pos.y + MOVE.height / 2, this.pos.z),
        new THREE.Vector3(r * 2, MOVE.height, r * 2),
      );
    }
  }
}
