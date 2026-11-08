import * as THREE from 'three';
import type { Assets } from './assets';
import { EYE_FROM_SHOULDER } from './config';
import type { Player } from './player';
import { rotateBoneWorld } from './rig';
import { attachHands, GunInstance, RobotRig } from './robot';
import type { Weapon } from './weapon';

/** 레이어 1: 3인칭 전신. 1인칭에서는 그림자만 드리운다. */
export const BODY_LAYER = 1;

const _v = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _right = new THREE.Vector3();
const _pos = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _lv = new THREE.Vector2();

/** 3인칭 전신 캐릭터: 하체 클립 블렌딩 + 상체 pitch + 양손 IK */
export class Character {
  rig: RobotRig;
  gun: GunInstance;
  frameQ = new THREE.Quaternion();
  private idleTime = 0;
  /** 디버그 표시용 현재 클립 가중치 */
  weights: Record<string, number> = {};

  constructor(assets: Assets, scene: THREE.Scene) {
    this.rig = new RobotRig(assets.robot, assets.clips, { armsOnly: false, layer: BODY_LAYER });
    this.gun = new GunInstance(assets.gun, { layer: BODY_LAYER, shadows: true });
    scene.add(this.rig.root, this.gun.root);
    this.headRest = this.rig.head.quaternion.clone();
  }
  private headRest: THREE.Quaternion;

  /** aimTarget: 총이 겨눌 월드 지점(3인칭 크로스헤어가 가리키는 곳). 1인칭에서는 시선 방향 먼 점. */
  update(dt: number, player: Player, weapon: Weapon, aimTarget: THREE.Vector3) {
    const rig = this.rig;
    rig.root.position.copy(player.pos);
    rig.root.rotation.set(0, player.yaw, 0);

    // 하체 블렌딩
    const hs = player.horizSpeed;
    const air = weapon.air;
    const moveW = THREE.MathUtils.smoothstep(hs, 0.15, 1.2) * (1 - air);
    const run = player.runBlend();
    player.localVel(_lv);
    let f = Math.max(_lv.y, 0), b = Math.max(-_lv.y, 0), r = Math.max(_lv.x, 0), l = Math.max(-_lv.x, 0);
    const sum = f + b + r + l || 1;
    f /= sum; b /= sum; r /= sum; l /= sum;
    const w: Record<string, number> = {
      Idle: (1 - moveW) * (1 - air),
      WalkF: moveW * (1 - run) * f,
      WalkB: moveW * (1 - run) * b,
      StrafeR: moveW * (1 - run) * r,
      StrafeL: moveW * (1 - run) * l,
      Run: moveW * run,
      Air: air,
    };
    this.idleTime += dt;
    for (const [name, a] of Object.entries(rig.actions)) {
      const wt = w[name] ?? 0;
      a.setEffectiveWeight(wt);
      const dur = a.getClip().duration;
      a.time = name === 'Idle' ? this.idleTime % dur : name === 'Air' ? 0 : player.gaitPhase * dur;
    }
    this.weights = w;
    rig.head.quaternion.copy(this.headRest); // 머리는 클립 트랙이 없으므로 매 프레임 초기화
    rig.mixer.update(0);
    rig.root.updateMatrixWorld(true);

    // 상체: 겨냥 방향으로 척추를 나눠서 숙이거나 젖힌다
    rig.shoulderMid(_mid);
    const eyeWorld = _pos.copy(EYE_FROM_SHOULDER.tp).applyAxisAngle(THREE.Object3D.DEFAULT_UP, player.yaw).add(_mid);
    _v.subVectors(aimTarget, eyeWorld).normalize();
    const pitch = Math.asin(THREE.MathUtils.clamp(_v.y, -1, 1));
    _right.set(Math.cos(player.yaw), 0, -Math.sin(player.yaw));
    for (const bone of rig.spine) rotateBoneWorld(bone, _right, pitch * 0.2);
    rotateBoneWorld(rig.head, _right, pitch * 0.25);

    // 어깨 프레임: 어깨 중점에서 겨냥점을 본다
    rig.shoulderMid(_mid);
    eyeWorld.copy(EYE_FROM_SHOULDER.tp);
    const yawA = Math.atan2(-(aimTarget.x - _mid.x), -(aimTarget.z - _mid.z));
    this.frameQ.setFromEuler(new THREE.Euler(0, yawA, 0, 'YXZ'));
    eyeWorld.applyQuaternion(this.frameQ).add(_mid);
    _v.subVectors(aimTarget, eyeWorld).normalize();
    const yawE = Math.atan2(-_v.x, -_v.z);
    const pitchE = Math.asin(THREE.MathUtils.clamp(_v.y, -1, 1));
    this.frameQ.setFromEuler(new THREE.Euler(pitchE, yawE, 0, 'YXZ'));

    // 총 자세
    const gp = new THREE.Vector3();
    const gq = new THREE.Quaternion();
    weapon.pose(player, 'tp', EYE_FROM_SHOULDER.tp, this.gun.aimPointLocal(new THREE.Vector3()), 0.35, gp, gq);
    this.gun.root.position.copy(gp).applyQuaternion(this.frameQ).add(_mid);
    this.gun.root.quaternion.copy(this.frameQ).multiply(gq);
    this.gun.applyParts(weapon);
    attachHands(rig, this.gun, weapon, this.frameQ);
  }

  muzzleWorld(out: THREE.Vector3) {
    return this.gun.muzzle.getWorldPosition(out);
  }

  setVisibleLayer(layer: number) {
    this.rig.model.traverse((o) => o.layers.set(layer));
    this.gun.root.traverse((o) => o.layers.set(layer));
  }

  get gunQuat() {
    return this.gun.root.getWorldQuaternion(_q);
  }
}
