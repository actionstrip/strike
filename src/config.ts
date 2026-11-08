import * as THREE from 'three';

/** 튜닝 수치를 한 곳에 모아 둔다. 단위는 m, 초, 라디안. */

/** 로봇 원본 키 0.768 -> 1.8m */
export const ROBOT_SCALE = 1.8 / 0.768;

/** Blender에서 만든 이동 클립의 기준 속도(m/s)와 주기(초). tools/blender/gait.py와 맞춰야 한다. */
export const CLIP = {
  walkSpeed: 2.6,
  runSpeed: 5.6,
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
  /** 달리기를 끝낸 뒤 발사, 조준이 가능해지기까지의 지연 */
  sprintOutDelay: 0.18,
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
  offset: new THREE.Vector3(0.6, 0.18, 2.5),
  offsetAds: new THREE.Vector3(0.5, 0.12, 1.3),
  collisionPad: 0.2,
};

/** 1인칭 눈 위치 */
export const EYE_HEIGHT = 1.62;

/**
 * 무기 자세는 "어깨 프레임"(양 어깨 중점, 시선 방향) 기준의 GripR 위치와 회전이다.
 * 1인칭과 3인칭이 같은 값을 쓴다. 시점별로 다른 것은 ADS 눈 위치/거리와 viewOffset 높이 보정뿐이다.
 */
export const WEAPON_POSE = {
  hip: { pos: new THREE.Vector3(0.13, -0.06, -0.27), rot: new THREE.Euler(0.02, 0.05, 0.0) },
  sprint: { pos: new THREE.Vector3(0.06, -0.1, -0.22), rot: new THREE.Euler(-0.35, 0.85, 0.35) },
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
  spreadHip: 0.02,
  spreadAds: 0.002,
  spreadMove: 0.025,
  recoilKick: 0.035,
  recoilRise: 0.06,
  camKick: 0.009,
};

/** 손바닥 중심에서 손목까지 오프셋(손 프레임 기준: fingers, palm 방향 성분) */
export const HAND = {
  wristBack: 0.045,
  palmOut: 0.03,
};
