import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { loadAssets } from './assets';
import { Sfx } from './audio';
import { CameraRig, type View } from './camera';
import { BODY_LAYER, Character } from './character';
import { MOVE, WEAPON } from './config';
import { Effects, MuzzleFlash } from './effects';
import { Hud } from './hud';
import { Input } from './input';
import { Player } from './player';
import { Viewmodel } from './viewmodel';
import { Weapon } from './weapon';
import { World } from './world';

const app = document.getElementById('app')!;
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.autoClear = false;
app.appendChild(renderer.domElement);

const input = new Input(renderer.domElement);
const sfx = new Sfx();
const hud = new Hud();
const world = new World();
const effects = new Effects(world.scene);
const camRig = new CameraRig();
const player = new Player(world.colliders);
player.pos.set(0, 0, 0);

const pmrem = new THREE.PMREMGenerator(renderer);
const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
world.scene.environment = envTex;
world.scene.environmentIntensity = 0.5;

const weapon = new Weapon({
  onFire: () => sfx.shot(),
  onDryFire: () => sfx.dry(),
  onReloadStage: (s) => {
    if (s === 'magOut') sfx.magOut();
    else if (s === 'magIn') sfx.magIn();
    else if (s === 'charger') sfx.charger();
  },
});

const startEl = document.getElementById('start')!;
const loadingEl = document.getElementById('loading')!;

const assets = await loadAssets();
loadingEl.textContent = '';
const character = new Character(assets, world.scene);
const viewmodel = new Viewmodel(assets);
viewmodel.scene.environment = envTex;
viewmodel.scene.environmentIntensity = 0.5;
const fpFlash = new MuzzleFlash(viewmodel.gun.muzzle, effects.flashTex, 0.16);
const tpFlash = new MuzzleFlash(character.gun.muzzle, effects.flashTex, 0.3, BODY_LAYER);

let started = false;
startEl.addEventListener('click', () => {
  sfx.unlock();
  input.requestLock();
});
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === renderer.domElement;
  started = locked || started;
  startEl.classList.toggle('hidden', locked);
});

function setView(v: View) {
  camRig.view = v;
}

function resize() {
  renderer.setSize(innerWidth, innerHeight);
  camRig.camera.aspect = innerWidth / innerHeight;
  camRig.camera.updateProjectionMatrix();
  viewmodel.setAspect(innerWidth / innerHeight);
}
addEventListener('resize', resize);
resize();

const clock = new THREE.Clock();
const aimTarget = new THREE.Vector3();
const tmp = new THREE.Vector3();
const ray = new THREE.Raycaster();
let timeScale = 1;
let lastPhase = 0;
let fpsAcc = 0, fpsFrames = 0, fpsShown = 0;

function shoot() {
  const cam = camRig.camera;
  const spread = weapon.spread(player);
  const dir = new THREE.Vector3(0, 0, -1);
  const r = Math.sqrt(Math.random()) * spread;
  const a = Math.random() * Math.PI * 2;
  dir.x += Math.cos(a) * Math.tan(r);
  dir.y += Math.sin(a) * Math.tan(r);
  dir.normalize().applyQuaternion(cam.quaternion);
  const tpMode = camRig.viewBlend > 0.35;
  const minDist = tpMode ? cam.position.distanceTo(tmp.set(player.pos.x, player.pos.y + 1.5, player.pos.z)) : 0;
  ray.set(cam.position, dir);
  ray.near = minDist;
  ray.far = WEAPON.range;
  const hit = ray.intersectObjects(world.hitMeshes, false)[0];
  const end = hit ? hit.point.clone() : cam.position.clone().addScaledVector(dir, WEAPON.range);

  // 총구 월드 위치
  const muzzle = new THREE.Vector3();
  if (tpMode) character.muzzleWorld(muzzle);
  else cam.localToWorld(viewmodel.muzzleView(muzzle));
  if (tpMode) tpFlash.fire(); else fpFlash.fire();
  effects.muzzleLight(muzzle);
  if (tpMode || Math.random() < 0.35) effects.tracer(muzzle, end);

  if (hit) {
    const n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : dir.clone().negate();
    const isTarget = !!hit.object.userData.target;
    effects.impact(hit.point, n, isTarget ? hit.object : undefined);
    if (isTarget) {
      world.hitTarget(hit.object);
      hud.showHit();
      sfx.hit();
    }
  }
}

function frame() {
  requestAnimationFrame(frame);
  const rawDt = Math.min(clock.getDelta(), 0.05);
  step(rawDt * timeScale, rawDt);
}

function step(dt: number, rawDt: number) {

  if (input.pressed.has('KeyV')) setView(camRig.view === 'fp' ? 'tp' : 'fp');

  player.look(input, weapon.ads);
  player.update(dt, input, { ads: weapon.wantsAds(input) && !weapon.reloading, wantsSprintBlocked: weapon.blocksSprint(input) });
  weapon.update(dt, input, player);
  if (weapon.firedThisFrame) {
    player.pitch = Math.min(player.pitch + weapon.camKick.x, Math.PI / 2 - 0.05);
    player.yaw += weapon.camKick.y;
    camRig.kick(weapon.camKick.x * 0.5, weapon.camKick.y * 0.5);
  }

  camRig.update(dt, player, weapon, world.hitMeshes);
  const cam = camRig.camera;
  cam.updateMatrixWorld();
  if (camRig.viewBlend > 0.35 || camRig.orbit) {
    const minDist = camRig.orbit ? 0 : cam.position.distanceTo(tmp.set(player.pos.x, player.pos.y + 1.5, player.pos.z));
    if (camRig.orbit) {
      // 궤도 카메라에서는 시선 방향 먼 점을 겨냥
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(player.pitch, player.yaw, 0, 'YXZ'));
      aimTarget.set(0, 0, -50).applyQuaternion(q).add(tmp.set(player.pos.x, player.pos.y + 1.5, player.pos.z));
    } else {
      camRig.aimPoint(world.hitMeshes, aimTarget, minDist);
    }
  } else {
    aimTarget.set(0, 0, -50).applyQuaternion(cam.quaternion).add(cam.position);
  }
  character.update(dt, player, weapon, aimTarget);
  viewmodel.update(player, weapon, cam, world.sun.position.clone().sub(world.sun.target.position).normalize(), {
    sky: world.hemi.color, ground: world.hemi.groundColor,
  });

  if (weapon.firedThisFrame) shoot();

  // 발소리: 걸음 위상이 0, 0.5를 지날 때
  if (player.grounded && player.horizSpeed > 0.5) {
    const p = player.gaitPhase;
    if ((lastPhase < 0.5 && p >= 0.5) || p < lastPhase) sfx.step(player.sprinting);
  }
  lastPhase = player.gaitPhase;

  world.update(dt);
  effects.update(dt);
  fpFlash.update(dt);
  tpFlash.update(dt);

  renderer.clear();
  renderer.render(world.scene, cam);
  if (camRig.showViewmodel) {
    renderer.clearDepth();
    renderer.render(viewmodel.scene, viewmodel.camera);
  }

  hud.update(dt, weapon, weapon.spread(player), cam.fov, camRig.view, player.sprinting);
  fpsAcc += rawDt; fpsFrames++;
  if (fpsAcc > 0.5) { fpsShown = fpsFrames / fpsAcc; fpsAcc = 0; fpsFrames = 0; }
  hud.stats.textContent =
    `${fpsShown.toFixed(0)} fps  draw ${renderer.info.render.calls}\n` +
    `상태 ${weapon.mode(player)}  속도 ${player.horizSpeed.toFixed(1)}m/s`;
  input.endFrame();
}
requestAnimationFrame(frame);

/** 검증용 디버그 훅 */
const debug = {
  start() { started = true; startEl.classList.add('hidden'); sfx.unlock(); },
  setView(v: View) { setView(v); camRig.viewBlend = v === 'tp' ? 1 : 0; },
  /** x=오른쪽, z=앞 (-1..1). treadmill이면 제자리에서 애니메이션만 */
  setMove(x: number, z: number, sprint = false, treadmill = true) {
    input.virtualMove = x === 0 && z === 0 && !sprint ? null : { x, z, sprint };
    player.treadmill = treadmill && input.virtualMove !== null;
  },
  stop() { input.virtualMove = null; player.treadmill = false; },
  ads(on: boolean | null) { weapon.forceAds = on; },
  fire(on: boolean) { weapon.forceFire = on; },
  reload() { weapon.ammo = Math.min(weapon.ammo, 10); weapon.reserve = Math.max(weapon.reserve, 30); weapon.startReload(); },
  /** 재장전 진행도 고정(0..1), null이면 해제 */
  holdReload(t: number | null) {
    if (t === null) { weapon.reloadHold = null; weapon.reloadT = -1; return; }
    if (!weapon.reloading) weapon.reloadT = t;
    weapon.reloadHold = t;
  },
  look(yawDeg: number, pitchDeg: number) { player.yaw = THREE.MathUtils.degToRad(yawDeg); player.pitch = THREE.MathUtils.degToRad(pitchDeg); },
  orbit(angle: number | null, dist = 3.2, height = 1.1) { camRig.orbit = angle === null ? null : { angle, dist, height }; },
  timeScale(s: number) { timeScale = s; },
  teleport(x: number, z: number) { player.pos.set(x, 0, z); player.vel.set(0, 0, 0); },
  jump() { input.pressed.add('Space'); },
  /** 걸음 위상 고정(null 해제) */
  phase(p: number | null) { player.phaseHold = p; },
  /** 지금 상태로 한 프레임 동기 렌더 후 캔버스 dataURL을 돌려준다(스크린샷 시트용) */
  snap(x0 = 0, y0 = 0, w = 1, h = 1) {
    step(1 / 60, 1 / 60);
    const c = renderer.domElement;
    const out = document.createElement('canvas');
    out.width = Math.round(c.width * w); out.height = Math.round(c.height * h);
    out.getContext('2d')!.drawImage(c, c.width * x0, c.height * y0, out.width, out.height, 0, 0, out.width, out.height);
    return out;
  },
  info() {
    return {
      mode: weapon.mode(player), ads: weapon.ads, sprint: weapon.sprint, reloadT: weapon.reloadT,
      ammo: weapon.ammo, reserve: weapon.reserve, speed: player.horizSpeed, grounded: player.grounded,
      gaitPhase: player.gaitPhase, weights: character.weights,
      reachTP: { ...character.rig.reachError }, reachFP: { ...viewmodel.rig.reachError },
      view: camRig.view, viewBlend: camRig.viewBlend, pos: player.pos.toArray(), MOVE,
    };
  },
};
(window as unknown as { __debug: typeof debug }).__debug = debug;
