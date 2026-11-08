import * as THREE from 'three';
import type { Assets } from './assets';
import { EYE_FROM_SHOULDER, FOV } from './config';
import type { Player } from './player';
import { attachHands, GunInstance, RobotRig } from './robot';
import { ledgeGrabWorld } from './character';
import type { Weapon } from './weapon';

/**
 * 1인칭 뷰모델: 로봇 팔(몸통 삼각형 제거)과 총을 별도 씬에 그린다.
 * 카메라는 원점에서 -Z를 보고, 리그는 "어깨 중점 + EYE_FROM_SHOULDER.fp = 카메라"가 되게 놓는다.
 */
export class Viewmodel {
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  rig: RobotRig;
  gun: GunInstance;
  private sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private shoulderOffset = new THREE.Vector3();
  private frameQ = new THREE.Quaternion();

  constructor(assets: Assets) {
    this.camera = new THREE.PerspectiveCamera(FOV.viewmodel, 1, 0.01, 10);
    // 손가락 쥔 자세만 쓴다
    const idle = assets.clips.Idle;
    const fingerClip = new THREE.AnimationClip('Grip', idle.duration, idle.tracks.filter((t) => /Hand(Index|Middle|Ring|Pinky)/.test(t.name)));
    this.rig = new RobotRig(assets.robot, { Grip: fingerClip }, { armsOnly: true });
    this.rig.actions.Grip.setEffectiveWeight(1);
    this.gun = new GunInstance(assets.gun, { shadows: false });
    this.scene.add(this.rig.root, this.gun.root);

    this.hemi = new THREE.HemisphereLight(0xdfeeff, 0x50463a, 1.3);
    this.sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
    this.scene.add(this.hemi, this.sun, this.sun.target);

    // 리그 배치: 어깨 중점이 카메라 기준 -EYE_FROM_SHOULDER.fp에 오도록
    this.rig.mixer.update(0);
    this.rig.root.updateMatrixWorld(true);
    const mid = this.rig.shoulderMid(new THREE.Vector3());
    this.shoulderOffset.copy(EYE_FROM_SHOULDER.fp).negate();
    this.rig.root.position.copy(this.shoulderOffset).sub(mid);
    this.rig.root.updateMatrixWorld(true);
  }

  update(player: Player, weapon: Weapon, worldCamera: THREE.Camera, sunDirWorld: THREE.Vector3, hemiColors: { sky: THREE.Color; ground: THREE.Color }) {
    this.camera.fov = weapon.viewmodelFov();
    this.camera.updateProjectionMatrix();

    // 월드 조명 방향을 카메라 공간으로
    const camQ = worldCamera.getWorldQuaternion(new THREE.Quaternion()).invert();
    this.sun.position.copy(sunDirWorld).applyQuaternion(camQ).multiplyScalar(10);
    this.hemi.color.copy(hemiColors.sky);
    this.hemi.groundColor.copy(hemiColors.ground);
    // 반구광의 "위"도 카메라 기준으로 돌린다
    this.hemi.position.set(0, 1, 0).applyQuaternion(camQ);

    // 리그 기본자세로 되돌리고 손가락 자세 적용
    this.rig.mixer.update(0);
    this.rig.root.updateMatrixWorld(true);
    const mid = this.rig.shoulderMid(new THREE.Vector3());
    const gp = new THREE.Vector3();
    const gq = new THREE.Quaternion();
    weapon.pose(player, 'fp', EYE_FROM_SHOULDER.fp, this.gun.aimPointLocal(new THREE.Vector3()), 1, gp, gq);
    this.frameQ.identity();
    this.gun.root.position.copy(gp).add(mid);
    this.gun.root.quaternion.copy(gq);
    this.gun.applyParts(weapon);
    // 모서리 짚기: 월드 목표를 카메라 공간(=뷰모델 씬 좌표)으로
    const lg = ledgeGrabWorld(player);
    if (lg) {
      worldCamera.updateMatrixWorld();
      const inv = worldCamera.getWorldQuaternion(new THREE.Quaternion()).invert();
      lg.pos.copy(worldCamera.worldToLocal(lg.pos));
      // 뷰모델 FOV가 월드보다 좁으므로, 화면상 같은 자리에 보이도록 x, y를 줄인다
      const wc = worldCamera as THREE.PerspectiveCamera;
      const k = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) / Math.tan(THREE.MathUtils.degToRad(wc.fov / 2));
      lg.pos.x *= k;
      lg.pos.y *= k;
      lg.fingers.applyQuaternion(inv);
      lg.palm.applyQuaternion(inv);
    }
    attachHands(this.rig, this.gun, weapon, this.frameQ, lg);
  }

  setAspect(a: number) {
    this.camera.aspect = a;
    this.camera.updateProjectionMatrix();
  }

  muzzleView(out: THREE.Vector3) {
    return this.gun.muzzle.getWorldPosition(out);
  }
}
