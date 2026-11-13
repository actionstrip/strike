import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { MapColliders } from './world';
import type { MapDef } from './config';

const robotUrl = import.meta.env.BASE_URL + 'models/robot.glb';
const gunUrl = import.meta.env.BASE_URL + 'models/g32.glb';
const enemyUrl = import.meta.env.BASE_URL + 'models/enemy_robot.glb';
const enemyGunUrl = import.meta.env.BASE_URL + 'models/enemy_gun.glb';
const enemy2Url = import.meta.env.BASE_URL + 'models/enemy2_robot.glb';
const nukeCrateUrl = import.meta.env.BASE_URL + 'models/nuclear_container.glb';
const nukeBombUrl = import.meta.env.BASE_URL + 'models/nuclear_bomb.glb';
const portalUrl = import.meta.env.BASE_URL + 'models/portal.glb';

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
  /** 돌 포털(시작 지점 뒤, 출구). animations[0]은 수정이 도는 클립 */
  portal: GLTF;
}

/** 클립에서 팔, 어깨, 목, 머리 트랙을 뺀다. 팔은 IK가, 상체 pitch는 코드가 맡는다. */
const KEEP_TRACK = /(Hips|UpLeg|Leg|Foot|ToeBase|Spine\d?|Hand(Index|Middle|Ring|Pinky)\d)$/;

/** 캐릭터와 적, 그리고 고른 맵만 받는다 */
export async function loadAssets(mapDef: MapDef): Promise<Assets> {
  const base = import.meta.env.BASE_URL;
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const [robot, gun, enemy, enemyGun, enemy2, map, mapColliders, nukeCrate, nukeBomb, portal] = await Promise.all([
    loader.loadAsync(robotUrl), loader.loadAsync(gunUrl), loader.loadAsync(enemyUrl), loader.loadAsync(enemyGunUrl), loader.loadAsync(enemy2Url),
    mapDef.glb ? loader.loadAsync(base + mapDef.glb) : Promise.resolve(null),
    mapDef.colliders ? fetch(base + mapDef.colliders).then((r) => r.json() as Promise<MapColliders>) : Promise.resolve(null),
    loader.loadAsync(nukeCrateUrl), loader.loadAsync(nukeBombUrl), loader.loadAsync(portalUrl),
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
  mergeSkinnedPieces(enemy2.scene);
  const enemy2Clips = { Walk: THREE.AnimationUtils.subclip(enemy2.animations[0], 'Walk', 116, 148, 24) };
  return { robot, gun, clips, enemy, enemyGun, enemyClips, enemy2, enemy2Clips, map, mapColliders, nukeCrate, nukeBomb, portal };
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

/**
 * 같은 뼈, 같은 재질을 쓰는 스킨 메시 조각들을 하나로 합친다(레이저 로봇은 12조각이라 그리기 12번, 뼈 계산 12번이었다).
 * 조각마다 바인드 공간이 고정 변환 하나만큼 다르므로, 정점을 첫 조각의 바인드 공간으로 옮긴 뒤 합친다.
 * 조건이 맞지 않으면(뼈나 재질이 다르면) 아무것도 바꾸지 않는다.
 */
function mergeSkinnedPieces(root: THREE.Object3D) {
  const parts: THREE.SkinnedMesh[] = [];
  root.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) parts.push(o as THREE.SkinnedMesh); });
  if (parts.length < 2) return;
  const s0 = parts[0];
  const bones0 = s0.skeleton.bones;
  const ok = parts.every((p) => p.parent === s0.parent && p.material === s0.material &&
    p.skeleton.bones.length === bones0.length && p.skeleton.bones.every((b, k) => b === bones0[k]));
  if (!ok) return;
  // 정점 변환: v' = B0^-1 * I0^-1 * Ii * Bi * v (뼈 0 기준, 다른 뼈도 같은 값임을 확인함)
  const b0Inv = s0.bindMatrix.clone().invert();
  const i0Inv = s0.skeleton.boneInverses[0].clone().invert();
  // 좌표가 압축(16비트 정수, -1~1)되어 있어 그대로 변환하면 범위를 넘는 값이 잘린다 → 실수로 풀어 놓고 변환한다
  const toFloat = (g: THREE.BufferGeometry) => {
    for (const name of ['position', 'normal', 'tangent']) {
      const a = g.getAttribute(name);
      if (!a) continue;
      const arr = new Float32Array(a.count * a.itemSize);
      for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) arr[i * a.itemSize + c] = a.getComponent(i, c);
      g.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize));
    }
    return g;
  };
  const geos = parts.map((p) => {
    const g = toFloat(p.geometry.clone());
    if (p !== s0) g.applyMatrix4(b0Inv.clone().multiply(i0Inv).multiply(p.skeleton.boneInverses[0]).multiply(p.bindMatrix));
    return g;
  });
  const merged = mergeGeometries(geos, false);
  if (!merged) return;
  s0.geometry = merged;
  // 경계 구는 적마다 fitCullSpheres(enemy.ts)가 다시 구한다
  for (const p of parts.slice(1)) p.removeFromParent();
}

