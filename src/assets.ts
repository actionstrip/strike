import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

const robotUrl = import.meta.env.BASE_URL + 'models/robot.glb';
const gunUrl = import.meta.env.BASE_URL + 'models/g32.glb';

export interface Assets {
  robot: GLTF;
  gun: GLTF;
  clips: Record<string, THREE.AnimationClip>;
}

/** 클립에서 팔, 어깨, 목, 머리 트랙을 뺀다. 팔은 IK가, 상체 pitch는 코드가 맡는다. */
const KEEP_TRACK = /(Hips|UpLeg|Leg|Foot|ToeBase|Spine\d?|Hand(Index|Middle|Ring|Pinky)\d)$/;

export async function loadAssets(): Promise<Assets> {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const [robot, gun] = await Promise.all([loader.loadAsync(robotUrl), loader.loadAsync(gunUrl)]);
  const clips: Record<string, THREE.AnimationClip> = {};
  for (const clip of robot.animations) {
    clip.tracks = clip.tracks.filter((t) => {
      const node = t.name.slice(0, t.name.lastIndexOf('.'));
      return KEEP_TRACK.test(node) && !/Arm/.test(node);
    });
    clips[clip.name] = clip;
  }
  return { robot, gun, clips };
}
