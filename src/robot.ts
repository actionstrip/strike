import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { HAND, ROBOT_SCALE } from './config';
import { filterTrianglesByBones, findBone, frameQuat, makeArmChain, solveArm, wristFromSocket, type ArmChain } from './rig';
import type { Weapon } from './weapon';

/** 로봇 인스턴스(1인칭 팔 또는 3인칭 전신) */
export class RobotRig {
  root: THREE.Object3D;
  model: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  actions: Record<string, THREE.AnimationAction> = {};
  left: ArmChain;
  right: ArmChain;
  spine: THREE.Bone[];
  head: THREE.Bone;
  leftArm: THREE.Bone;
  rightArm: THREE.Bone;
  /** 마지막 IK에서 손이 닿지 못한 거리(검증용) */
  reachError = { left: 0, right: 0 };

  constructor(gltf: GLTF, clips: Record<string, THREE.AnimationClip>, opts: { armsOnly: boolean; layer?: number }) {
    this.model = SkeletonUtils.clone(gltf.scene);
    this.model.scale.setScalar(ROBOT_SCALE);
    this.root = new THREE.Object3D();
    this.root.add(this.model);
    this.root.updateMatrixWorld(true);
    // 기본자세에서 팔 체인을 만든다(루트 회전이 없을 때)
    this.left = makeArmChain(this.model, 'Left');
    this.right = makeArmChain(this.model, 'Right');
    this.spine = ['Spine', 'Spine1', 'Spine2'].map((n) => findBone(this.model, n));
    this.head = findBone(this.model, 'Head');
    this.leftArm = this.left.upper;
    this.rightArm = this.right.upper;
    // 모델은 +Z를 본다. 루트 -Z가 정면이 되도록 180도 돌린다.
    this.model.rotation.y = Math.PI;

    this.model.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isMesh) return;
      m.castShadow = !opts.armsOnly;
      m.receiveShadow = !opts.armsOnly;
      m.frustumCulled = false;
      if (opts.armsOnly && m.isSkinnedMesh) {
        filterTrianglesByBones(m, (name) => /(Arm|Hand)/.test(name) && !/Shoulder/.test(name));
      }
      const mat = m.material as THREE.MeshStandardMaterial;
      if (mat && mat.isMeshStandardMaterial) mat.envMapIntensity = 0.6;
    });
    if (opts.layer !== undefined) this.model.traverse((o) => o.layers.set(opts.layer!));

    this.mixer = new THREE.AnimationMixer(this.model);
    for (const [name, clip] of Object.entries(clips)) {
      const a = this.mixer.clipAction(clip);
      a.play();
      a.setEffectiveWeight(0);
      this.actions[name] = a;
    }
  }

  /** 양 어깨(상완 시작점) 중점 */
  shoulderMid(out: THREE.Vector3) {
    const a = this.leftArm.getWorldPosition(new THREE.Vector3());
    const b = this.rightArm.getWorldPosition(new THREE.Vector3());
    return out.addVectors(a, b).multiplyScalar(0.5);
  }
}

/** 총 인스턴스. 원점은 GripR(오른손 그립). 로컬 -Z가 총구 방향. */
export class GunInstance {
  root: THREE.Object3D;
  mag: THREE.Object3D;
  magBase: THREE.Vector3;
  charger: THREE.Object3D;
  chargerBase: THREE.Vector3;
  trigger: THREE.Object3D;
  gripL: THREE.Object3D;
  aimPoint: THREE.Object3D;
  magGrab: THREE.Object3D;
  muzzle: THREE.Object3D;

  constructor(gltf: GLTF, opts: { layer?: number; shadows: boolean }) {
    this.root = gltf.scene.clone(true);
    const get = (n: string) => {
      const o = this.root.getObjectByName(n);
      if (!o) throw new Error('gun node missing: ' + n);
      return o;
    };
    this.mag = get('Mag');
    this.charger = get('Charger');
    this.trigger = get('Trigger');
    this.gripL = get('GripL');
    this.aimPoint = get('AimPoint');
    this.magGrab = get('MagGrab');
    this.muzzle = get('Muzzle');
    this.magBase = this.mag.position.clone();
    this.chargerBase = this.charger.position.clone();
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = opts.shadows;
        m.receiveShadow = opts.shadows;
        const mat = m.material as THREE.MeshStandardMaterial;
        if (mat.name === 'Glass') { mat.transparent = true; mat.opacity = 0.35; mat.depthWrite = false; }
      }
      if (opts.layer !== undefined) o.layers.set(opts.layer);
    });
  }

  /** 무기 상태에 따라 탄창, 장전손잡이, 방아쇠를 움직인다 */
  applyParts(w: Weapon) {
    const off = w.magOffset(new THREE.Vector3());
    this.mag.position.copy(this.magBase).add(off);
    this.mag.visible = !w.magHidden();
    this.charger.position.copy(this.chargerBase);
    this.charger.position.z += w.chargerOffset();
    this.trigger.rotation.x = w.cooldown > 0.03 ? -0.35 : 0;
  }

  aimPointLocal(out: THREE.Vector3) {
    return out.copy(this.aimPoint.position);
  }
}

/** 소켓별 손 방향(총 로컬). fingers: 손목->손가락, palm: 손바닥이 향하는 쪽(잡는 물체 방향) */
const HOLD = {
  gripR: { fingers: new THREE.Vector3(0, -0.35, -1), palm: new THREE.Vector3(-1, 0, 0) },
  gripL: { fingers: new THREE.Vector3(0.2, -0.15, -1), palm: new THREE.Vector3(1, 0, 0.1) },
  mag: { fingers: new THREE.Vector3(0.4, 0, -1), palm: new THREE.Vector3(0, 1, 0) },
  charger: { fingers: new THREE.Vector3(0, -0.2, -1), palm: new THREE.Vector3(-0.6, -0.8, 0) },
};

const _gq = new THREE.Quaternion();
const _f = new THREE.Vector3();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _w = new THREE.Vector3();
const _hq = new THREE.Quaternion();
const _pole = new THREE.Vector3();

interface HandTarget { pos: THREE.Vector3; fingers: THREE.Vector3; palm: THREE.Vector3 }

function socketTarget(gun: GunInstance, localPos: THREE.Vector3, hold: { fingers: THREE.Vector3; palm: THREE.Vector3 }): HandTarget {
  gun.root.getWorldQuaternion(_gq);
  return {
    pos: gun.root.localToWorld(localPos.clone()),
    fingers: hold.fingers.clone().normalize().applyQuaternion(_gq),
    palm: hold.palm.clone().normalize().applyQuaternion(_gq),
  };
}

function blendTarget(a: HandTarget, b: HandTarget, t: number): HandTarget {
  if (t <= 0) return a;
  if (t >= 1) return b;
  return {
    pos: a.pos.clone().lerp(b.pos, t),
    fingers: a.fingers.clone().lerp(b.fingers, t).normalize(),
    palm: a.palm.clone().lerp(b.palm, t).normalize(),
  };
}

function applyHand(chain: ArmChain, t: HandTarget, frameQ: THREE.Quaternion, poleLocal: THREE.Vector3) {
  frameQuat(t.fingers, t.palm, _hq).multiply(chain.handK);
  wristFromSocket(t.pos, _f.copy(t.fingers), _p.copy(t.palm), HAND.wristBack, HAND.palmOut, _w);
  chain.upper.getWorldPosition(_s);
  _pole.copy(poleLocal).applyQuaternion(frameQ).add(_s);
  return solveArm(chain, _w, _hq, _pole);
}

/** 총 소켓에 양손을 붙인다. frameQ는 어깨 프레임 회전(팔꿈치 방향 기준). */
export function attachHands(rig: RobotRig, gun: GunInstance, w: Weapon, frameQ: THREE.Quaternion) {
  gun.root.updateMatrixWorld(true);
  const right = socketTarget(gun, new THREE.Vector3(0, 0, 0), HOLD.gripR);
  const gripL = socketTarget(gun, gun.gripL.position, HOLD.gripL);
  const lw = w.leftHandWeights();
  let left = gripL;
  if (lw.mag > 0) {
    const magPos = gun.magGrab.position.clone().add(w.magOffset(new THREE.Vector3()));
    left = blendTarget(left, socketTarget(gun, magPos, HOLD.mag), lw.mag);
  }
  if (lw.charger > 0) {
    const cp = gun.charger.position.clone().add(new THREE.Vector3(0.025, 0.01, 0));
    left = blendTarget(left, socketTarget(gun, cp, HOLD.charger), lw.charger);
  }
  rig.reachError.right = applyHand(rig.right, right, frameQ, new THREE.Vector3(0.6, -1, 0.35));
  rig.reachError.left = applyHand(rig.left, left, frameQ, new THREE.Vector3(-0.6, -1, 0.35));
}
