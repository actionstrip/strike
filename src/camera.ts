import * as THREE from 'three';
import { EYE_HEIGHT, EYE_HEIGHT_CROUCH, TP_CAM } from './config';
import type { Player } from './player';
import type { Weapon } from './weapon';

export type View = 'fp' | 'tp';

/** 1인칭/3인칭 카메라 리그. 전환은 viewBlend(0=1인칭, 1=3인칭)로 보간한다. */
export class CameraRig {
  camera: THREE.PerspectiveCamera;
  view: View = 'fp';
  viewBlend = 0;
  /** 디버그 궤도 카메라: 캐릭터 정면 기준 각도(도). null이면 끔 */
  orbit: { angle: number; dist: number; height: number; pivot?: THREE.Vector3 } | null = null;
  private ray = new THREE.Raycaster();
  private shake = new THREE.Vector2();
  private shakeVel = new THREE.Vector2();
  private lastLand = 0;

  constructor() {
    this.camera = new THREE.PerspectiveCamera(75, 1, 0.03, 400);
    this.camera.layers.set(0);
  }

  kick(x: number, y: number) {
    this.shakeVel.x += x * 60;
    this.shakeVel.y += y * 60;
  }

  update(dt: number, player: Player, weapon: Weapon, hitMeshes: THREE.Object3D[]) {
    const target = this.view === 'tp' ? 1 : 0;
    this.viewBlend += (target - this.viewBlend) * (1 - Math.exp(-14 * dt));
    if (Math.abs(this.viewBlend - target) < 0.002) this.viewBlend = target;

    // 화면 흔들림 스프링
    this.shakeVel.addScaledVector(this.shake, -400 * dt).multiplyScalar(Math.max(0, 1 - 22 * dt));
    this.shake.addScaledVector(this.shakeVel, dt);

    // 착지하면 화면이 아래로 눌렸다가 돌아온다
    if (player.landImpulse > this.lastLand + 0.05) this.kick(-0.012 * player.landImpulse, 0);
    this.lastLand = player.landImpulse;

    // 매달려 오르기: 숙였다가 들어 올리며 살짝 기운다
    const mp = player.mantleProgress;
    let dip = 0, roll = 0;
    if (mp >= 0) {
      const k = Math.sin(Math.PI * mp);
      dip = -0.07 * Math.sin(Math.PI * Math.min(mp / 0.6, 1)) + 0.03 * Math.max(0, Math.sin(Math.PI * (mp - 0.6) / 0.4));
      roll = 0.05 * k;
    }

    const cam = this.camera;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(player.pitch + this.shake.x + dip, player.yaw + this.shake.y, roll, 'YXZ'));
    const fpPos = new THREE.Vector3(player.pos.x, player.pos.y + THREE.MathUtils.lerp(EYE_HEIGHT, EYE_HEIGHT_CROUCH, player.crouchBlend) - player.landImpulse * 0.06, player.pos.z);

    if (this.orbit) {
      const pivot = this.orbit.pivot?.clone() ?? new THREE.Vector3(player.pos.x, player.pos.y + this.orbit.height, player.pos.z);
      const a = player.yaw + THREE.MathUtils.degToRad(this.orbit.angle);
      // angle 0 = 캐릭터 정면에서 바라봄
      cam.position.set(pivot.x - Math.sin(a) * this.orbit.dist, pivot.y, pivot.z - Math.cos(a) * this.orbit.dist);
      cam.lookAt(pivot);
      cam.fov = 40;
      cam.updateProjectionMatrix();
      cam.layers.enable(1);
      return;
    }

    let pos = fpPos;
    if (this.viewBlend > 0) {
      const pivot = new THREE.Vector3(player.pos.x, player.pos.y + THREE.MathUtils.lerp(TP_CAM.pivotHeight, TP_CAM.pivotHeightCrouch, player.crouchBlend), player.pos.z);
      const off = TP_CAM.offset.clone().lerp(TP_CAM.offsetAds, weapon.ads).applyQuaternion(q);
      const want = pivot.clone().add(off);
      const dir = off.clone().normalize();
      this.ray.set(pivot, dir);
      this.ray.far = off.length() + TP_CAM.collisionPad;
      const hit = this.ray.intersectObjects(hitMeshes, false)[0];
      if (hit) want.copy(pivot).addScaledVector(dir, Math.max(0.3, hit.distance - TP_CAM.collisionPad));
      pos = fpPos.clone().lerp(want, this.viewBlend);
    }
    cam.position.copy(pos);
    cam.quaternion.copy(q);
    cam.fov = weapon.worldFov();
    cam.updateProjectionMatrix();
    // 전환 도중 절반을 넘으면 전신을 보인다
    if (this.viewBlend > 0.35) cam.layers.enable(1);
    else cam.layers.disable(1);
  }

  /** 1인칭 뷰모델을 그릴지 */
  get showViewmodel() {
    return !this.orbit && this.viewBlend <= 0.35;
  }

  /** 화면 중앙 광선이 맞는 월드 지점(3인칭 겨냥점). 너무 가까운 히트는 무시한다. */
  aimPoint(hitMeshes: THREE.Object3D[], out: THREE.Vector3, minDist = 0) {
    const cam = this.camera;
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    this.ray.set(cam.position, dir);
    this.ray.far = 200;
    this.ray.near = minDist;
    const hit = this.ray.intersectObjects(hitMeshes, false)[0];
    this.ray.near = 0;
    if (hit) return out.copy(hit.point);
    return out.copy(cam.position).addScaledVector(dir, 200);
  }
}
