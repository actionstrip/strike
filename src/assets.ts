import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { MapColliders } from './world';
import type { MapDef } from './config';

const robotUrl = import.meta.env.BASE_URL + 'models/robot.glb';
const gunUrl = import.meta.env.BASE_URL + 'models/g32.glb';
const enemyUrl = import.meta.env.BASE_URL + 'models/enemy_robot.glb';
const enemyGunUrl = import.meta.env.BASE_URL + 'models/enemy_gun.glb';
const enemy2Url = import.meta.env.BASE_URL + 'models/enemy2_robot.glb';
const nukeCrateUrl = import.meta.env.BASE_URL + 'models/nuclear_container.glb';
const nukeBombUrl = import.meta.env.BASE_URL + 'models/nuclear_bomb.glb';

export interface Assets {
  robot: GLTF;
  gun: GLTF;
  clips: Record<string, THREE.AnimationClip>;
  enemy: GLTF;
  enemyGun: GLTF;
  /** Walk, Idle, Death */
  enemyClips: Record<string, THREE.AnimationClip>;
  /** 두 번째 적(레이저 보행 로봇) */
  enemy2: GLTF;
  /** Walk(원본 11초 클립에서 몸통이 정면인 걷기 한 주기) */
  enemy2Clips: Record<string, THREE.AnimationClip>;
  /** 실제 맵(시험 맵이면 null) */
  map: GLTF | null;
  mapColliders: MapColliders | null;
  /** 미션: 핵컨테이너(몸통 + 뚜껑), 핵원자로폭탄 */
  nukeCrate: GLTF;
  nukeBomb: GLTF;
}

/** 클립에서 팔, 어깨, 목, 머리 트랙을 뺀다. 팔은 IK가, 상체 pitch는 코드가 맡는다. */
const KEEP_TRACK = /(Hips|UpLeg|Leg|Foot|ToeBase|Spine\d?|Hand(Index|Middle|Ring|Pinky)\d)$/;

/** 캐릭터와 적, 그리고 고른 맵만 받는다 */
export async function loadAssets(mapDef: MapDef): Promise<Assets> {
  const base = import.meta.env.BASE_URL;
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const [robot, gun, enemy, enemyGun, enemy2, map, mapColliders, nukeCrate, nukeBomb] = await Promise.all([
    loader.loadAsync(robotUrl), loader.loadAsync(gunUrl), loader.loadAsync(enemyUrl), loader.loadAsync(enemyGunUrl), loader.loadAsync(enemy2Url),
    mapDef.glb ? loader.loadAsync(base + mapDef.glb) : Promise.resolve(null),
    mapDef.colliders ? fetch(base + mapDef.colliders).then((r) => r.json() as Promise<MapColliders>) : Promise.resolve(null),
    loader.loadAsync(nukeCrateUrl), loader.loadAsync(nukeBombUrl),
  ]);
  const clips: Record<string, THREE.AnimationClip> = {};
  for (const clip of robot.animations) {
    clip.tracks = clip.tracks.filter((t) => {
      const node = t.name.slice(0, t.name.lastIndexOf('.'));
      return KEEP_TRACK.test(node) && !/Arm/.test(node);
    });
    clips[clip.name] = clip;
  }
  const enemyClips: Record<string, THREE.AnimationClip> = {};
  for (const clip of enemy.animations) enemyClips[clip.name] = clip;
  fixEnemyWalkHips(enemyClips);
  // 원본은 24fps 264프레임. 116~148프레임이 몸통이 정면인 걷기 한 주기(두 발이 같은 자리로 돌아온다)
  const enemy2Clips = { Walk: THREE.AnimationUtils.subclip(enemy2.animations[0], 'Walk', 116, 148, 24) };
  return { robot, gun, clips, enemy, enemyGun, enemyClips, enemy2, enemy2Clips, map, mapColliders, nukeCrate, nukeBomb };
}

/**
 * 원본 모델에서 가져온 Walk 클립은 엉덩이 관절(HipJL/R)이 Idle보다 세로축으로 90° 돌아가 있어
 * 다리가 몸통과 직각 방향으로 걷는다(게걸음). 엉덩이 관절을 Idle 값으로 맞춰 다리 방향을 몸통과 일치시킨다.
 */
function fixEnemyWalkHips(clips: Record<string, THREE.AnimationClip>) {
  const walk = clips.Walk;
  const idle = clips.Idle;
  if (!walk || !idle) return;
  for (const name of ['HipJL.quaternion', 'HipJR.quaternion']) {
    const w = walk.tracks.find((t) => t.name === name);
    const i = idle.tracks.find((t) => t.name === name);
    if (!w || !i) continue;
    const v = w.values;
    for (let k = 0; k < v.length; k += 4) for (let c = 0; c < 4; c++) v[k + c] = i.values[c];
  }
}
