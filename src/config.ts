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

/**
 * 1인칭 조준(ADS) 때 조준경 주변만 반투명하게 한다.
 * 조준점이 화면에 찍히는 자리를 중심으로, 반지름은 화면 높이 비율(inner 안은 alpha, outer 밖은 불투명).
 */
export const VIEWMODEL_ADS_SIGHT = { alpha: 0.2, inner: 0.07, outer: 0.13 };

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
  /** 덩치 배율(원래 키 1.9m). 모델, 총, 피격 박스, 보폭, 충돌 크기에 함께 적용된다. */
  size: 0.5,
  /** 맵(23×45m)에 나오는 수(두 번째 적 ENEMY2.count와 합쳐 5기) */
  count: 3,
  health: 5,
  /** 걷기 클립(제자리 걸음)이 한 주기 동안 앞으로 가는 거리(m)와 주기(초). tools/blender/enemy.blend와 맞춘다. */
  walkStride: 1.51,
  walkPeriod: 1.6,
  /** 작아진 다리에 맞춘 순찰 속도(원래 키에서는 1.2) */
  patrolSpeed: 0.8,
  /** 순찰 범위: 시작점에서 이 반경 안을 돌아다닌다 */
  patrolRadius: 10,
  /** 배치: 플레이어와의 최소 거리(적끼리는 enemies.ts에서 서로 가장 먼 자리부터 골라 퍼뜨린다) */
  spawnFromPlayer: 12,
  /** 서서 두리번거리는 시간 범위(초). 짧을수록 자주 걷는다. */
  lookTime: [1.5, 3.2] as [number, number],
  /** 걷다가 방향을 바꿀 때 몸 회전 속도 */
  turnSpeed: THREE.MathUtils.degToRad(90),
  /** 전투 중 몸 회전 속도(상체 비틀림 한계를 넘을 때) */
  combatTurnSpeed: THREE.MathUtils.degToRad(120),
  /** 사람처럼: 고개는 몸 정면 기준 좌우 최대 60°, 상체 비틀림은 최대 45° */
  headMax: THREE.MathUtils.degToRad(60),
  twistMax: THREE.MathUtils.degToRad(45),
  /** 전투 중 목표가 몸 정면에서 이 각보다 벗어나면 발을 떼서 몸을 다시 정렬한다(그 안은 상체와 팔만 따라감) */
  realignAngle: THREE.MathUtils.degToRad(25),
  /** 고개 돌리는 스프링 강성(클수록 빠름). 4.5면 60° 돌리는 데 약 1초, 최고 속도 약 100°/s */
  headSpring: 4.5,
  /** 한 방향을 보고 멈춰 있는 시간 범위(초) */
  glanceHold: [0.4, 0.9] as [number, number],
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
  /** 시야를 잃은 뒤(또는 소리를 들은 뒤) 그곳에 가서 둘러보는 시간 */
  searchTime: 4,
  /** 전투 중 자리 옮기기: 공격(점사/레이저) 몇 번 뒤 옆으로 몇 m, 걷는 속도 */
  volleysBeforeMove: [1, 2] as [number, number],
  moveDist: [1.5, 3.5] as [number, number],
  combatSpeed: 1.25,
  /** 맞으면 피하기: 속도, 다시 피할 수 있을 때까지, 엄폐(플레이어가 못 보는 자리)를 고를 확률, 엄폐 뒤 머무는 시간 */
  dodgeSpeed: 1.8,
  dodgeCooldown: 1.2,
  coverChance: 0.65,
  coverHold: [0.8, 1.8] as [number, number],
  /** 수색: 마지막으로 본 곳까지 걸어가는 속도 */
  searchSpeed: 1.0,
  /** 발견하거나 맞으면 이 반경 안의 동료에게 알린다 */
  alertRadius: 12,
  /** 플레이어 총소리를 듣는 거리 */
  hearRange: 16,
  /**
   * 인기척: 주인공이 이 거리(m) 안에 있으면 안 보여도(뒤쪽, 벽 너머) 알아채고 그쪽으로 몸을 돌린다.
   * 가만히 있어도 아주 가까우면(still), 걸으면 walk, 앉아 걸으면 crouch, 달리면 sprint.
   */
  sense: { still: 1.4, crouch: 2.2, walk: 4.5, sprint: 8 },
  senseInterval: 0.25,
  /** 시야를 잃을 때 주인공이 달아나던 방향으로 몇 초 앞을 짐작할지 */
  predictTime: 0.8,
  /** 이동하며 쏠 때 퍼짐 배율 */
  moveSpread: 1.7,
  radius: 0.4 * 0.5,
  height: 1.9 * 0.5,
  /** 사망 후 회색으로 바뀌는 시간 */
  greyTime: 1.0,
};

/**
 * 두 번째 적: 카메라 몸통에 두 다리가 달린 보행 로봇(enemy2_robot.glb).
 * 순찰/경계/전투 AI는 ENEMY와 같고, 총 대신 가운데 렌즈에서 레이저를 쏜다(충전 -> 발사).
 */
export const ENEMY2 = {
  ...ENEMY,
  /** 맵에 함께 나오는 수(첫 번째 적과 합쳐서 배치) */
  count: 2,
  /** 덩치 배율(처음 크기 = 렌즈 높이 1.0m, 몸통 위 1.4m 기준). 0.7이면 렌즈 0.7m, 몸통 위 약 1.0m */
  size: 0.7,
  /** 모델 단위 -> m */
  unit: 0.085 * 0.7,
  /** 걷기 한 주기(32프레임) 동안 앞으로 가는 거리(m) = 모델 7.6단위 × unit */
  walkStride: 7.6 * 0.085 * 0.7,
  /** 작아진 다리에 맞춘 순찰 속도(처음 크기에서는 0.7) */
  patrolSpeed: 0.55,
  /** 다리가 짧아 전투 이동, 피하기, 수색 속도도 느리다. 레이저는 한 번 쏘고 옮긴다. */
  combatSpeed: 0.85,
  dodgeSpeed: 1.25,
  searchSpeed: 0.7,
  volleysBeforeMove: [1, 1] as [number, number],
  /** 몸통(카메라)이 다리 기준으로 좌우로 돌아가는 한계 */
  headMax: THREE.MathUtils.degToRad(70),
  twistMax: THREE.MathUtils.degToRad(50),
  realignAngle: THREE.MathUtils.degToRad(40),
  /** 렌즈 위아래 한계 */
  pitchMax: THREE.MathUtils.degToRad(35),
  /** 렌즈가 켜져 조준할 수 있게 되는 시간 */
  raiseTime: 0.3,
  fireAngle: THREE.MathUtils.degToRad(3),
  /** 레이저: 충전 시간, 발사 뒤 쉬는 시간, 퍼짐 */
  chargeTime: 0.55,
  laserPause: [1.3, 2.1] as [number, number],
  spread: THREE.MathUtils.degToRad(1.2),
  radius: 0.42 * 0.7,
  height: 1.5 * 0.7,
};
/** 두 적이 함께 쓰는 AI 설정 */
export type EnemyConfig = typeof ENEMY;

/**
 * 적 성향. 적마다 하나씩 받고(enemies.ts가 골고루 섞어 나눠 준다), 값은 적마다 ±12% 흔들어 같은 성향끼리도 조금씩 다르다.
 * - aggression: 0..1, 클수록 거리를 좁히러 다가온다
 * - reaction: 처음 보거나 맞은 뒤 첫 발까지(초)
 * - range: 좋아하는 교전 거리(m). 자리를 옮길 때 이 거리에 가까운 곳을 고른다
 * - dodge: 맞았을 때 피할 확률(나머지는 그 자리에서 돌아서서 맞서 쏜다)
 * - coverChance: 피할 때 엄폐(안 보이는 곳)를 고를 확률, coverMul: 엄폐 뒤 머무는 시간 배율
 * - moveFire: 이동하면서도 쏘는가
 * - pursuit: 놓친 뒤 쫓아오며 다시 찾는 시간(초)
 * - push / flank / peek: 쫓아올 때 고르는 방식의 비중(곧장 다가오기 / 옆으로 돌아 들어오기 / 엄폐물 가장자리에서 내다보기)
 * - recover: 쏜 뒤 다시 엄폐로 들어가는 비중(내다보고 쏘고 숨기)
 */
export const ENEMY_STYLES = {
  rusher: { aggression: 0.9, reaction: 0.18, range: 5, dodge: 0.3, coverChance: 0.3, coverMul: 0.5, moveFire: true, pursuit: 14, speedMul: 1.15, push: 0.7, flank: 0.2, peek: 0.1, recover: 0.05 },
  rifleman: { aggression: 0.55, reaction: 0.24, range: 10, dodge: 0.55, coverChance: 0.55, coverMul: 1, moveFire: true, pursuit: 10, speedMul: 1, push: 0.45, flank: 0.25, peek: 0.3, recover: 0.2 },
  flanker: { aggression: 0.7, reaction: 0.22, range: 8, dodge: 0.5, coverChance: 0.45, coverMul: 0.8, moveFire: true, pursuit: 12, speedMul: 1.1, push: 0.2, flank: 0.7, peek: 0.1, recover: 0.1 },
  cautious: { aggression: 0.3, reaction: 0.3, range: 13, dodge: 0.85, coverChance: 0.85, coverMul: 1.5, moveFire: false, pursuit: 8, speedMul: 0.92, push: 0.2, flank: 0.15, peek: 0.65, recover: 0.5 },
};
export type EnemyStyle = keyof typeof ENEMY_STYLES;
/** 배치 순서(이 순서를 섞어서 돌려 쓴다): 소총수가 가장 많다 */
export const ENEMY_STYLE_MIX: EnemyStyle[] = ['rifleman', 'rusher', 'cautious', 'flanker', 'rifleman', 'rusher', 'cautious'];

/** 주인공 체력(에너지) */
export const PLAYER_HEALTH = {
  max: 100,
  /** 적 총알 한 발, 레이저 한 발에 깎이는 양 */
  bullet: 3,//7,
  laser: 5,//14,
  /** 쓰러진 뒤 시작점에서 다시 일어나기까지(초) */
  respawnDelay: 2.5,
  /** 처음 시작하거나 다시 태어난 뒤 무적 시간(초). 그동안 몸과 총이 반투명하다. */
  spawnProtect: 5,
  /** 무적 중 깜박임: 흐릴 때와 진할 때 투명도(0 투명 ~ 1 불투명), 초당 깜박임 수(끝나기 1.5초 전부터는 fastBlink) */
  ghostAlpha: 0.15,
  ghostAlphaHigh: 0.85,
  blinkRate: 5,
  fastBlink: 10,
};

/** 구급상자 아이템 */
export const MEDKIT = {
  /** 주우면 회복하는 체력(체력이 가득이면 줍지 않는다) */
  heal: 40,
  /** 상자의 가장 긴 변(m). 멀리서도 보이게 실제보다 크게 */
  size: 0.42,
  glowColor: 0xff5a5a,
};

/** 미션: 핵컨테이너를 쏴서 열고 핵원자로폭탄을 모은다 */
export const NUKE = {
  /** 맵마다 놓는 컨테이너 수(= 모아야 할 폭탄 수) */
  count: 3,
  /** 컨테이너의 가장 긴 변(m) */
  crateSize: 1.1,
  /** 폭탄 아이템 높이(m) */
  bombSize: 0.55,
  /** 뚜껑 경첩이 있는 쪽(컨테이너 로컬): 'back'(-Z) 또는 'front'(+Z) */
  hingeSide: 'back' as 'back' | 'front',
  /** 뚜껑이 열리는 각(도)과 시간(초) */
  lidOpenDeg: 105,
  lidOpenTime: 0.6,
  /** 폭탄이 컨테이너 안에서 떠오르는 시간(초)과 떠 있는 높이(발 기준, m) */
  riseTime: 0.8,
  bombHover: 1.05,
  /** 폭탄 줍는 거리(수평, m). 컨테이너가 막고 있어 아이템보다 넓다. */
  bombRadius: 1.4,
  /** 실내 점수 기준(지붕 +4, 6m 안 벽 방향 수, 1.5m 안 벽 +1). 후보가 모자라면 낮춘다. */
  shelterMinScore: 5,
  glowColor: 0x7dff6a,
};

/**
 * 돌 포털(시작 지점 뒤). 폭탄을 다 모으면 활성화되고, 들어가면 게임 클리어.
 * 모델 치수(원본 m): 폭 5.14, 높이 3.71, 받침 높이 0.65(z -1.92~1.86), 앞(+Z) 계단 z 1.86~2.56,
 * 고리 구멍은 받침 위 0.68~3.6m, 안쪽 반폭 약 1.32m. 아래 값은 모두 원본 치수 기준이고 배율 k를 곱해 쓴다.
 */
export const PORTAL = {
  /** 기본 전체 높이(m). 공간이 좁으면 줄인다(최소 minHeight) */
  height: 3.2,
  minHeight: 2.3,
  /** 시작 지점과 계단 끝 사이 거리(m) */
  gap: 0.5,
  /** 원본 치수 */
  model: {
    height: 3.71, halfWidth: 2.57, back: 1.92, front: 2.56,
    platformY: 0.65, platformHalfX: 1.9, platformFront: 1.86,
    holeY0: 0.68, holeY1: 3.6, holeHalfW: 1.32,
    pillarInnerX: 1.32, pillarHalfZ: 0.45,
    stairs: [[1.86, 2.14, 0.49, 1.0], [2.14, 2.34, 0.32, 1.0], [2.34, 2.56, 0.15, 1.8]] as [number, number, number, number][],
  },
  /** 켜지는 시간(초), 시작할 때 한 번 번쩍이는 시간(초) */
  activateTime: 0.9,
  introFlash: 1.4,
  arcCount: 6,
  particleCount: 160,
  /** 들어간 것으로 보는 범위: 고리 평면 앞뒤(m, 원본), 안쪽 반폭 비율 */
  enterDepth: 0.4,
  enterWidthMul: 0.85,
};

/** 성능 옵션(패널 토글)에서 쓰는 값 */
export const PERF = {
  /** 먼 적 갱신 줄이기: 이 거리(m) 밖이고 전투 중이 아니면 farEvery 프레임에 한 번 */
  farDistance: 20,
  farEvery: 3,
  /** 시야 거리 줄이기: 카메라 far, 안개 시작과 끝(m) */
  viewFar: 45,
  fogNear: 15,
  fogFar: 40,
  /** 미니맵 갱신 줄이기: 초당 횟수 */
  minimapHz: 10,
};

/** 모바일 터치 조작 */
export const TOUCH = {
  /** 이동 스틱: 반지름(px), 데드존(0..1), 앞으로 이만큼 밀면 달리기 */
  stickRadius: 60,
  deadZone: 0.15,
  sprintAt: 0.9,
  /** 이동 스틱을 놓을 수 있는 왼쪽 영역(화면 폭 비율) */
  stickArea: 0.4,
  /** 시선: 끈 1px당 마우스 몇 px로 칠지 */
  lookSensitivity: 1.6,
  /** 버튼 지름(px) */
  fireSize: 84,
  buttonSize: 58,
  /** 탄창이 이만큼 이하면 재장전 버튼이 깜빡인다 */
  reloadBlinkAt: 6,
};

/** 아이템 줍는 동작(짧게 숙였다 일어나고, 아이템은 몸쪽으로 날아와 사라진다) */
export const PICKUP_ANIM = {
  /** 숙였다 일어나는 전체 시간(초) */
  duration: 0.5,
  /** 가장 깊이 숙이는 시점(전체 중 비율) */
  peak: 0.35,
  /** 1인칭: 눈이 내려가는 높이(m), 시선이 숙여지는 각(rad) */
  eyeDrop: 0.25,
  pitchDown: 0.12,
  /** 3인칭: 앉은 자세를 섞는 정도 */
  crouch: 0.6,
  /** 총을 내리는 정도(오르기 자세 쪽으로) */
  gunDip: 0.65,
  /** 아이템이 날아오는 시간(초)과 도착할 높이(발 기준, m) */
  flyTime: 0.28,
  flyHeight: 1.0,
  /** 날아올 곳: 몸 앞 거리(m). 1인칭 화면 아래쪽에 보이게 */
  flyAhead: 0.6,
};

/** 미니맵 */
export const MINIMAP = {
  /** 가운데에서 테두리까지 보이는 거리(m) */
  radius: 22,
  /** 벽 그림을 미리 그릴 때의 해상도(픽셀/m) */
  bakePxPerMeter: 8,
  /** 벽을 그릴 최소 두께(m). 얇은 벽도 보이게 */
  minWall: 0.45,
  floorColor: 'rgba(20,26,34,.72)',
  wallColor: 'rgba(170,186,204,.9)',
  lowColor: 'rgba(120,134,150,.75)',
};

/** 탄창 아이템 */
export const PICKUP = {
  /** 주우면 늘어나는 예비 탄약 */
  ammo: 30,
  /** 줍는 거리(수평, m) */
  radius: 0.8,
  /** 바닥에서 떠 있는 높이(탄창 중심), 위아래 흔들림 */
  height: 0.45,
  bob: 0.07,
  bobSpeed: 2.4,
  spinSpeed: 1.8,
  /** 탄창의 가장 긴 변(m). 실제 탄창(약 0.2m)보다 키워 멀리서도 보이게 */
  size: 0.42,
  emissive: 0x4a3510,
  glowSize: 0.9,
  glowColor: 0xffc34d,
};

/**
 * 맵 목록(인트로에서 고른다). glb와 충돌 json은 tools/blender/map_build.py → tools/optimize-models.mjs로 만든다.
 * - enemies: [총잡이, 레이저 로봇]
 * - fog: [시작, 끝] m
 * - spawn: 플레이어 시작점 근처(빈 자리를 찾는다)와 바라볼 방향(yaw, 0 = -Z) 단위는 도(180 = +Z). 없으면 +Z 끝에서 -Z를 본다.
 */
export interface MapDef {
  id: string;
  name: string;
  desc: string;
  size: string;
  thumb: string;
  glb: string | null;
  colliders: string | null;
  enemies: [number, number];
  /** 탄창 아이템 수 */
  pickups: number;
  /** 구급상자 수 */
  medkits: number;
  fog: [number, number];
  spawn?: { x: number; z: number; yaw: number };
  /** 싸우는 범위 [x0, z0, x1, z1](외곽 벽 안쪽). 없으면 충돌 박스 전체 범위. 적 배치와 순찰에 쓴다. */
  area?: [number, number, number, number];
  /**
   * 실내 맵: 맵 텍스처에 조명이 구워져 있다. 맵은 조명 없이(unlit) 그대로 그리고,
   * 천장이 해를 가리므로 그림자를 끄고 반구광으로 캐릭터를 밝힌다. 값은 안개/배경 색.
   */
  indoor?: { color: number; hemiSky: number; hemiGround: number; hemi: number };
}
export const MAPS: MapDef[] = [
  {
    id: 'arena', name: '컨테이너 기지', desc: '좁은 통로와 2층 발판이 얽힌 근접전 맵', size: '23 × 45m',
    thumb: 'images/map_arena.webp', glb: 'models/map.glb', colliders: 'models/map_colliders.json',
    enemies: [6, 4], pickups: 5, medkits: 3, fog: [45, 110],
  },
  {
    id: 'backrooms', name: '백룸', desc: '끝없이 이어지는 노란 사무실 방과 아치 통로', size: '75 × 20m',
    thumb: 'images/map_backrooms.webp', glb: 'models/map_backrooms.glb', colliders: 'models/map_backrooms_colliders.json',
    enemies: [12, 8], pickups: 10, medkits: 6, fog: [10, 42],
    // 복도 옆 작은 방(의자, 책장)에서 문(+Z, 복도) 쪽을 보고 시작: 복도에 바로 서면 시작하자마자 적 눈에 띈다
    spawn: { x: 0, z: 0.6, yaw: 180 },
    indoor: { color: 0x8c8250, hemiSky: 0xfff0b8, hemiGround: 0x8a7440, hemi: 2.2 },
  },
  {
    id: 'desert', name: '사막 마을', desc: '사암 건물 사이 세 갈래 골목과 가운데 광장', size: '46 × 54m',
    thumb: 'images/map_desert.webp', glb: 'models/map_desert.glb', colliders: 'models/map_desert_colliders.json',
    enemies: [8, 6], pickups: 7, medkits: 4, fog: [55, 130],
    // 남쪽 끝 낮은 담 뒤에서 북쪽(-Z)을 보고 시작
    spawn: { x: 0, z: 22, yaw: 0 },
    area: [-22.6, -26.6, 22.6, 26.6],
  },
  {
    id: 'port', name: '항구 창고', desc: '선반 통로가 있는 큰 창고와 컨테이너 야적장, 연료 탱크', size: '52 × 56m',
    thumb: 'images/map_port.webp', glb: 'models/map_port.glb', colliders: 'models/map_port_colliders.json',
    enemies: [9, 7], pickups: 8, medkits: 5, fog: [50, 125],
    // 남쪽 정문 안쪽 방호벽 뒤에서 북쪽(창고)을 보고 시작
    spawn: { x: 0, z: 26, yaw: 0 },
    area: [-25.6, -25.4, 25.6, 29.6],
  },
  {
    id: 'test', name: '시험장', desc: '엄폐 상자와 표적판이 있는 연습 맵', size: '86 × 86m',
    thumb: '', glb: null, colliders: null,
    enemies: [ENEMY.count, ENEMY2.count], pickups: 4, medkits: 3, fog: [60, 160],
  },
];
export const mapById = (id: string | null) => MAPS.find((m) => m.id === id);
