import * as THREE from 'three';

/** 튜닝 수치를 한 곳에 모아 둔다. 단위는 m, 초, 라디안. */

/** 로봇 원본 키 0.768 -> 1.8m */
export const ROBOT_SCALE = 1.8 / 0.768;

/** Blender에서 만든 이동 클립의 기준 속도(m/s)와 주기(초). tools/blender/gait.py와 맞춰야 한다. */
export const CLIP = {
  walkSpeed: 2.6,
  runSpeed: 5.6,
  /** 앉아 걷기 클립: 1.9m/s, 21프레임(0.7초) 주기 */
  crouchSpeed: 1.9,
  crouchPeriod: 0.7,
};

export const MOVE = {
  walk: 3.4,
  adsWalk: 2.0,
  sprint: 6.2,
  accel: 14,
  airAccel: 4,
  jump: 6.2,
  gravity: 20,
  radius: 0.35,
  height: 1.8,
  /** 앉기: 이동 속도, 충돌 높이, 전환 속도(1/초) */
  crouch: 1.9,
  crouchHeight: 1.25,
  crouchRate: 11,
  /** 달리기를 끝낸 뒤 발사, 조준이 가능해지기까지의 지연 */
  sprintOutDelay: 0.18,
};

/** 매달려 오르기 */
export const MANTLE = {
  /** 발 기준 오를 수 있는 모서리 높이 범위 */
  minHeight: 0.45,
  maxHeight: 2.0,
  /** 땅에서 Space: 이 높이 이하는 그냥 점프로 넘는다 */
  jumpOverHeight: 0.85,
  /** 공중에서 잡을 수 있는 모서리 높이(현재 발 기준) */
  airMaxHeight: 1.6,
  /** 몸 반경 바깥으로 모서리를 찾는 거리 */
  reach: 0.45,
  baseTime: 0.4,
  timePerMeter: 0.22,
  /** 전체 시간 중 위로 올라가는 구간 비율 */
  risePart: 0.6,
};

export const LOOK = {
  sensitivity: 0.0022,
  adsSensitivityScale: 0.6,
  pitchLimit: THREE.MathUtils.degToRad(85),
};

export const FOV = {
  world: 75,
  worldAds: 55,
  viewmodel: 55,
  viewmodelAds: 42,
};

/** 3인칭 카메라: 어깨 뒤 오프셋(카메라 기준 x=오른쪽, y=위, z=뒤) */
export const TP_CAM = {
  pivotHeight: 1.5,
  pivotHeightCrouch: 1.05,
  offset: new THREE.Vector3(0.6, 0.18, 2.5),
  offsetAds: new THREE.Vector3(0.5, 0.12, 1.3),
  collisionPad: 0.2,
};

/** 1인칭 눈 위치 */
export const EYE_HEIGHT = 1.62;
export const EYE_HEIGHT_CROUCH = 1.08;

/**
 * 무기 자세는 "어깨 프레임"(양 어깨 중점, 시선 방향) 기준의 GripR 위치와 회전이다.
 * 1인칭과 3인칭이 같은 값을 쓴다. 시점별로 다른 것은 ADS 눈 위치/거리와 viewOffset 높이 보정뿐이다.
 */
export const WEAPON_POSE = {
  hip: { pos: new THREE.Vector3(0.13, -0.06, -0.27), rot: new THREE.Euler(0.02, 0.05, 0.0) },
  sprint: { pos: new THREE.Vector3(0.06, -0.1, -0.22), rot: new THREE.Euler(-0.35, 0.85, 0.35) },
  /** 오르는 동안: 총을 아래로 내리고 오른쪽으로 눕힌다 */
  mantle: { pos: new THREE.Vector3(0.17, -0.13, -0.3), rot: new THREE.Euler(0.25, 0.5, -0.9) },
  /** ADS에서 조준점(AimPoint)이 눈 앞 이 거리에 온다 */
  adsEyeDistance: { fp: 0.22, tp: 0.13 },
  /** 시점별 비조준 자세 보정(뷰모델은 총을 화면 안으로 올리고, 3인칭은 가슴 높이로 내린다) */
  viewOffset: { fp: new THREE.Vector3(0, 0.11, 0), tp: new THREE.Vector3(0, -0.07, 0) },
};

/** 어깨 프레임 기준 눈 위치. FP는 무기가 화면에 잘 보이도록 뒤쪽 아래로 둔다(뷰모델 관례). */
export const EYE_FROM_SHOULDER = {
  fp: new THREE.Vector3(0.0, 0.25, 0.25),
  tp: new THREE.Vector3(0.0, 0.2, -0.02),
};

export const WEAPON = {
  rpm: 750,
  magSize: 30,
  reserve: 90,
  reloadTime: 2.3,
  range: 200,
  adsTime: 0.2,
  /** 공중에서 ADS 전환이 느려지는 배율 */
  adsTimeAirMul: 1.6,
  /** 착지 직후 추가 퍼짐(라디안, landImpulse 1 기준) */
  spreadLand: 0.03,
  spreadHip: 0.02,
  spreadAds: 0.002,
  spreadMove: 0.025,
  /** 앉으면 퍼짐에 곱하는 값 */
  spreadCrouchMul: 0.75,
  /** 발사 1회 반동 임펄스: 뒤로(m/s), 총구 들림(rad/s) */
  recoilKick: 0.45,
  recoilRise: 0.55,
  camKick: 0.009,
};

/** 손바닥 중심에서 손목까지 오프셋(손 프레임 기준: fingers, palm 방향 성분) */
export const HAND = {
  wristBack: 0.045,
  palmOut: 0.03,
};

/** 적 로봇 */
export const ENEMY = {
  count: 6,
  health: 5,
  /** 걷기 클립(제자리 걸음)이 한 주기 동안 앞으로 가는 거리(m)와 주기(초). tools/blender/enemy.blend와 맞춘다. */
  walkStride: 1.51,
  walkPeriod: 1.6,
  patrolSpeed: 1.2,
  patrolRadius: 8,
  /** 서서 두리번거리는 시간 범위(초) */
  lookTime: [2, 4] as [number, number],
  turnSpeed: THREE.MathUtils.degToRad(120),
  combatTurnSpeed: THREE.MathUtils.degToRad(150),
  /** 시야: 전체 각도와 거리 */
  fov: THREE.MathUtils.degToRad(110),
  sightRange: 30,
  sightInterval: 0.2,
  /** 발견 후 팔을 다 드는 시간 */
  raiseTime: 0.35,
  /** 이 각도 안으로 조준되면 발사 */
  fireAngle: THREE.MathUtils.degToRad(4),
  burst: 3,
  burstInterval: 0.2,
  burstPause: [0.8, 1.3] as [number, number],
  spread: THREE.MathUtils.degToRad(2),
  /** 시야를 잃은 뒤 마지막 위치를 바라보는 시간 */
  searchTime: 3,
  radius: 0.4,
  height: 1.9,
  /** 사망 후 회색으로 바뀌는 시간 */
  greyTime: 1.0,
};
