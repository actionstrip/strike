import * as THREE from 'three';

/**
 * 로봇 Mixamo 뼈대를 다루는 공용 도구: 본 찾기, 월드 회전 적용, 2본 팔 IK, 손 방향 맞추기.
 * 1인칭 뷰모델과 3인칭 전신이 같은 코드를 쓴다.
 */

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _t = new THREE.Vector3();
const _u = new THREE.Vector3();
const _p = new THREE.Vector3();
const _e = new THREE.Vector3();
const _m = new THREE.Matrix4();

export type Side = 'Left' | 'Right';

export function findBone(root: THREE.Object3D, name: string): THREE.Bone {
  let found: THREE.Bone | null = null;
  root.traverse((o) => {
    if (!found && (o as THREE.Bone).isBone && o.name.replace(/[:]/g, '').endsWith('mixamorig' + name)) found = o as THREE.Bone;
  });
  if (!found) throw new Error('bone not found: ' + name);
  return found;
}

/** 본의 월드 회전을 q로 지정한다(부모 기준 로컬로 변환). */
export function setBoneWorldQuat(bone: THREE.Object3D, q: THREE.Quaternion) {
  bone.parent!.getWorldQuaternion(_q2);
  bone.quaternion.copy(_q2.invert().multiply(q));
  bone.updateMatrixWorld(true);
}

/** 본을 월드 축 기준으로 angle만큼 더 돌린다. */
export function rotateBoneWorld(bone: THREE.Object3D, axisWorld: THREE.Vector3, angle: number) {
  bone.getWorldQuaternion(_q);
  _q.premultiply(_q2.setFromAxisAngle(axisWorld, angle));
  setBoneWorldQuat(bone, _q);
}

/** fingers, palm 방향으로 만든 직교 기저의 회전 */
export function frameQuat(fingers: THREE.Vector3, palm: THREE.Vector3, out: THREE.Quaternion) {
  const f = _a.copy(fingers).normalize();
  const p = _b.copy(palm).addScaledVector(f, -palm.dot(f)).normalize();
  const s = _c.crossVectors(f, p);
  _m.makeBasis(f, p, s);
  return out.setFromRotationMatrix(_m);
}

export interface ArmChain {
  side: Side;
  upper: THREE.Bone;
  lower: THREE.Bone;
  hand: THREE.Bone;
  /** 손 월드 회전 = frameQuat(목표 fingers, palm) * handK */
  handK: THREE.Quaternion;
  /** 전완 로컬 공간의 손바닥 방향(비틀림 분산용) */
  forearmPalmLocal: THREE.Vector3;
}

/**
 * 뼈대가 T자 기본자세이고 모델 루트 회전이 없을 때 호출한다.
 * 로봇(+Z를 봄) 기본자세에서 왼손 손가락은 +X, 오른손은 -X, 손바닥은 -Y, 엄지는 +Z다.
 */
export function makeArmChain(root: THREE.Object3D, side: Side): ArmChain {
  root.updateMatrixWorld(true);
  const upper = findBone(root, side + 'Arm');
  const lower = findBone(root, side + 'ForeArm');
  const hand = findBone(root, side + 'Hand');
  const fingers = new THREE.Vector3(side === 'Left' ? 1 : -1, 0, 0);
  const palm = new THREE.Vector3(0, -1, 0);
  const restFrame = frameQuat(fingers, palm, new THREE.Quaternion());
  const handRest = hand.getWorldQuaternion(new THREE.Quaternion());
  const handK = restFrame.clone().invert().multiply(handRest);
  const foreRest = lower.getWorldQuaternion(new THREE.Quaternion());
  const forearmPalmLocal = palm.clone().applyQuaternion(foreRest.invert());
  return { side, upper, lower, hand, handK, forearmPalmLocal };
}

/**
 * 2본 해석적 IK. wrist는 손목(Hand 본 원점) 목표 위치, handQ는 손 월드 회전, pole은 팔꿈치가 향할 월드 점.
 * 팔 길이가 모자라면 최대한 뻗고 남는 거리를 반환한다(검증용).
 */
export function solveArm(chain: ArmChain, wrist: THREE.Vector3, handQ: THREE.Quaternion, pole: THREE.Vector3): number {
  const { upper, lower, hand } = chain;
  upper.getWorldPosition(_a);
  lower.getWorldPosition(_b);
  hand.getWorldPosition(_c);
  const l1 = _b.distanceTo(_a);
  const l2 = _c.distanceTo(_b);
  _t.subVectors(wrist, _a);
  const dist = _t.length();
  const d = THREE.MathUtils.clamp(dist, 1e-4, (l1 + l2) * 0.9995);
  _u.copy(_t).divideScalar(dist || 1);
  const cosA = THREE.MathUtils.clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  _p.subVectors(pole, _a);
  _p.addScaledVector(_u, -_p.dot(_u));
  if (_p.lengthSq() < 1e-8) _p.set(0, -1, 0);
  _p.normalize();
  _e.copy(_a).addScaledVector(_u, l1 * cosA).addScaledVector(_p, l1 * sinA);

  // 상완: 현재 (b-a) -> (e-a)
  _v.subVectors(_b, _a).normalize();
  _t.subVectors(_e, _a).normalize();
  _q.setFromUnitVectors(_v, _t);
  upper.getWorldQuaternion(_q2);
  setBoneWorldQuat(upper, _q.multiply(_q2));

  // 전완: 현재 (c-b) -> (target-b)
  lower.getWorldPosition(_b);
  hand.getWorldPosition(_c);
  const target = _t.copy(_a).addScaledVector(_u, d);
  _v.subVectors(_c, _b).normalize();
  target.sub(_b).normalize();
  const q3 = new THREE.Quaternion().setFromUnitVectors(_v, target);
  lower.getWorldQuaternion(_q2);
  setBoneWorldQuat(lower, q3.multiply(_q2));

  // 전완 비틀림: 손 회전과의 차이의 절반을 전완이 나눠 가진다
  const axis = target; // 전완 방향(정규화됨)
  const handPalm = frameAxis(handQ, chain.handK, _p);
  lower.getWorldQuaternion(_q2);
  const forePalm = _e.copy(chain.forearmPalmLocal).applyQuaternion(_q2);
  handPalm.addScaledVector(axis, -handPalm.dot(axis)).normalize();
  forePalm.addScaledVector(axis, -forePalm.dot(axis)).normalize();
  let ang = Math.acos(THREE.MathUtils.clamp(forePalm.dot(handPalm), -1, 1));
  if (_v.crossVectors(forePalm, handPalm).dot(axis) < 0) ang = -ang;
  rotateBoneWorld(lower, axis, ang * 0.5);

  setBoneWorldQuat(hand, handQ);
  return Math.max(0, dist - (l1 + l2));
}

/** 손 월드 회전에서 손바닥 방향(프레임의 두 번째 축)을 꺼낸다. */
function frameAxis(handQ: THREE.Quaternion, handK: THREE.Quaternion, out: THREE.Vector3) {
  _q.copy(handK).invert().premultiply(handQ);
  return out.set(0, 1, 0).applyQuaternion(_q);
}

/** 목표 소켓(손바닥 중심) -> 손목 위치 */
export function wristFromSocket(socketPos: THREE.Vector3, fingers: THREE.Vector3, palm: THREE.Vector3, back: number, out: number, res: THREE.Vector3) {
  return res.copy(socketPos).addScaledVector(palm, -out).addScaledVector(fingers, -back);
}

/**
 * 스킨 메시에서 지정한 본들에 주로 붙은 삼각형만 남긴 인덱스를 만든다(1인칭 팔만 보이기).
 */
export function filterTrianglesByBones(mesh: THREE.SkinnedMesh, keep: (boneName: string) => boolean) {
  const geo = mesh.geometry;
  const skinIndex = geo.getAttribute('skinIndex');
  const skinWeight = geo.getAttribute('skinWeight');
  const bones = mesh.skeleton.bones;
  const vertKeep = new Uint8Array(skinIndex.count);
  for (let i = 0; i < skinIndex.count; i++) {
    let best = 0, bw = -1;
    for (let k = 0; k < 4; k++) {
      const w = skinWeight.getComponent(i, k);
      if (w > bw) { bw = w; best = skinIndex.getComponent(i, k); }
    }
    vertKeep[i] = keep(bones[best].name) ? 1 : 0;
  }
  const src = geo.index!;
  const out: number[] = [];
  for (let i = 0; i < src.count; i += 3) {
    const a = src.getX(i), b = src.getX(i + 1), c = src.getX(i + 2);
    if (vertKeep[a] && vertKeep[b] && vertKeep[c]) out.push(a, b, c);
  }
  const g2 = geo.clone();
  g2.setIndex(out);
  mesh.geometry = g2;
}
