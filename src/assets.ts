import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

const robotUrl = import.meta.env.BASE_URL + 'models/robot.glb';
const gunUrl = import.meta.env.BASE_URL + 'models/g32.glb';
const enemyUrl = import.meta.env.BASE_URL + 'models/enemy_robot.glb';
const enemyGunUrl = import.meta.env.BASE_URL + 'models/enemy_gun.glb';

export interface Assets {
  robot: GLTF;
  gun: GLTF;
  clips: Record<string, THREE.AnimationClip>;
  enemy: GLTF;
  enemyGun: GLTF;
  /** Walk, Idle, Death */
  enemyClips: Record<string, THREE.AnimationClip>;
}

/** 클립에서 팔, 어깨, 목, 머리 트랙을 뺀다. 팔은 IK가, 상체 pitch는 코드가 맡는다. */
const KEEP_TRACK = /(Hips|UpLeg|Leg|Foot|ToeBase|Spine\d?|Hand(Index|Middle|Ring|Pinky)\d)$/;

export async function loadAssets(): Promise<Assets> {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const [robot, gun, enemy, enemyGun] = await Promise.all([
    loader.loadAsync(robotUrl), loader.loadAsync(gunUrl), loader.loadAsync(enemyUrl), loader.loadAsync(enemyGunUrl),
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
  return { robot, gun, clips, enemy, enemyGun, enemyClips };
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
