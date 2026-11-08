import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { loadAssets } from './assets';
import { Sfx } from './audio';
import { CameraRig, type View } from './camera';
import { BODY_LAYER, Character } from './character';
import { EYE_HEIGHT, EYE_HEIGHT_CROUCH, MOVE, PICKUP, WEAPON } from './config';
import { mulberry32, type Enemy, type EnemyHooks, type EnemyWeapon } from './enemy';
import { Enemies } from './enemies';
import { Effects, MuzzleFlash } from './effects';
import { Hud } from './hud';
import { Input } from './input';
import { Player } from './player';
import { Viewmodel } from './viewmodel';
import { Weapon } from './weapon';
import { World } from './world';
import { Pickups } from './pickups';
import { backToIntro, chooseMap } from './intro';

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
// 인트로에서 맵을 고른다(?map=이 있으면 바로)
const mapDef = await chooseMap();
const world = new World(mapDef);
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
startEl.classList.remove('hidden');
document.getElementById('map-name')!.textContent = mapDef.name;
document.getElementById('to-intro')!.addEventListener('click', (ev) => {
  ev.stopPropagation();
  backToIntro();
});

const assets = await loadAssets(mapDef);
if (assets.map && assets.mapColliders) world.buildArena(assets.map, assets.mapColliders);
player.pos.copy(world.spawn.pos);
player.yaw = world.spawn.yaw;
loadingEl.textContent = '';
const character = new Character(assets, world.scene);
const viewmodel = new Viewmodel(assets);
viewmodel.scene.environment = envTex;
viewmodel.scene.environmentIntensity = 0.5;
const fpFlash = new MuzzleFlash(viewmodel.gun.muzzle, effects.flashTex, 0.16);
const tpFlash = new MuzzleFlash(character.gun.muzzle, effects.flashTex, 0.3, BODY_LAYER);

// 적
const enemies = new Enemies(assets, world.scene, effects.flashTex);
enemies.spawn(world.colliders, player.pos, world.bounds, 7, mapDef.enemies, (x, z) => world.reachable(x, z));
// 탄창 아이템
const pickups = new Pickups(assets, world.scene);
const spawnPickups = (seed = 11) =>
  pickups.spawn(mapDef.pickups, { colliders: world.colliders, area: world.bounds, reachable: (x, z) => world.reachable(x, z), rand: mulberry32(seed), from: world.spawn.pos });
spawnPickups();
const playerHead = new THREE.Vector3();
const _pbox = new THREE.Box3();
const _eray = new THREE.Raycaster();
const _phit = new THREE.Vector3();
let playerHits = 0;
/** 디버그: 적 총알이 플레이어를 맞히지 않게 한다 */
let godMode = false;
const enemyHooks: EnemyHooks = {
  onFire(_e: Enemy, from: THREE.Vector3, dir: THREE.Vector3, kind: EnemyWeapon) {
    _eray.set(from, dir);
    _eray.far = 120;
    const hit = _eray.intersectObjects(world.hitMeshes, false)[0];
    const wallDist = hit ? hit.distance : 120;
    // 플레이어 몸(충돌 박스)에 맞았는지
    const r = MOVE.radius;
    _pbox.min.set(player.pos.x - r, player.pos.y, player.pos.z - r);
    _pbox.max.set(player.pos.x + r, player.pos.y + player.height, player.pos.z + r);
    const pHit = _eray.ray.intersectBox(_pbox, _phit);
    const pDist = pHit ? from.distanceTo(pHit) : Infinity;
    const end = from.clone().addScaledVector(dir, Math.min(wallDist, pDist, 120));
    if (kind === 'laser') {
      effects.laser(from, end);
      sfx.laser(from.distanceTo(player.pos));
    } else {
      effects.tracer(from, end);
      sfx.enemyShot(from.distanceTo(player.pos));
    }
    if (pDist < wallDist && !godMode) {
      playerHits++;
      hud.showDamage(from, player.pos, player.yaw);
      sfx.hurt();
      camRig.kick(-0.004, (Math.random() - 0.5) * 0.004);
    } else if (hit) {
      const n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : dir.clone().negate();
      effects.impact(hit.point, n, hit.object.userData.target ? hit.object : undefined);
    }
  },
  onCharge(_e: Enemy, from: THREE.Vector3) {
    sfx.laserCharge(from.distanceTo(player.pos));
  },
  onDeath() {
    sfx.enemyDown();
    enemies.refreshHitMeshes();
    hud.showKill();
  },
};

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
  const hit = ray.intersectObjects(world.hitMeshes.concat(enemies.hitMeshes), false)[0];
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
    const enemy = hit.object.userData.enemy as Enemy | undefined;
    effects.impact(hit.point, n, isTarget ? hit.object : undefined, !enemy);
    if (enemy) {
      enemy.damage(player.pos, enemyHooks);
      hud.showHit();
      sfx.hit();
    }
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
      camRig.aimPoint(world.hitMeshes.concat(enemies.hitMeshes), aimTarget, minDist);
    }
  } else {
    aimTarget.set(0, 0, -50).applyQuaternion(cam.quaternion).add(cam.position);
  }
  character.update(dt, player, weapon, aimTarget);
  playerHead.set(player.pos.x, player.pos.y + THREE.MathUtils.lerp(EYE_HEIGHT, EYE_HEIGHT_CROUCH, player.crouchBlend) + 0.08, player.pos.z);
  enemies.update(dt, player, playerHead, world, enemyHooks);
  pickups.update(dt, player.pos, () => {
    weapon.reserve += PICKUP.ammo;
    sfx.pickup();
    hud.showPickup(`+${PICKUP.ammo} 탄약`);
  });
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

  hud.update(dt, weapon, weapon.spread(player), cam.fov, camRig.view, player.sprinting, player.yaw);
  fpsAcc += rawDt; fpsFrames++;
  if (fpsAcc > 0.5) { fpsShown = fpsFrames / fpsAcc; fpsAcc = 0; fpsFrames = 0; }
  hud.stats.textContent =
    `${fpsShown.toFixed(0)} fps  draw ${renderer.info.render.calls}  적 ${enemies.aliveCount}/${enemies.list.length}  피격 ${playerHits}\n` +
    `상태 ${weapon.mode(player)}${player.crouched && weapon.mode(player) !== 'crouch' ? '(앉기)' : ''}  속도 ${player.horizSpeed.toFixed(1)}m/s`;
  input.endFrame();
}
requestAnimationFrame(frame);

/** 검증용 디버그 훅 */
const debug = {
  player, world, weapon,
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
  /** fixed면 지금 위치를 궤도 중심으로 고정(오르기처럼 몸이 움직이는 동작 확인용) */
  orbit(angle: number | null, dist = 3.2, height = 1.1, fixed = false) {
    camRig.orbit = angle === null ? null : { angle, dist, height, pivot: fixed ? new THREE.Vector3(player.pos.x, player.pos.y + height, player.pos.z) : undefined };
  },
  timeScale(s: number) { timeScale = s; },
  teleport(x: number, z: number, y = 0) { player.mantle = null; player.mantleHold = null; player.pos.set(x, y, z); player.vel.set(0, 0, 0); },
  jump() { input.pressed.add('Space'); },
  /** 앉기 강제(true/false), null이면 키 입력으로 돌아간다 */
  crouch(on: boolean | null) { input.virtualCrouch = on; },
  /** 키 누름 흉내(다음 step에서 처리). 예: 'KeyC' */
  press(code: string) { input.pressed.add(code); },
  hold(code: string, on: boolean) { if (on) input.keys.add(code); else input.keys.delete(code); },
  /** 오르기 진행도 고정(0..1, null 해제). 오르는 중이 아니면 정면 모서리로 오르기를 시작한다 */
  holdMantle(t: number | null) {
    if (t === null) { player.mantleHold = null; return; }
    if (!player.mantle) {
      const l = player.findLedge();
      if (!l) return false;
      player.startMantle(l);
    }
    player.mantleHold = t;
    return true;
  },
  enemies,
  /** 적 다시 배치(시드, [총잡이 수, 레이저 로봇 수]) */
  spawnEnemies(seed = 7, counts: [number, number] = mapDef.enemies) { enemies.spawn(world.colliders, player.pos, world.bounds, seed, counts, (x, z) => world.reachable(x, z)); },
  /** 맵 정보: 경계, 스폰, 충돌 박스 수 */
  map() { return { mode: world.def.id, bounds: [world.bounds.min.toArray(), world.bounds.max.toArray()], spawn: world.spawn.pos.toArray(), colliders: world.colliders.length, hitMeshes: world.hitMeshes.length }; },
  /** 스폰 지점으로 */
  teleportSpawn() { player.pos.copy(world.spawn.pos); player.vel.set(0, 0, 0); player.yaw = world.spawn.yaw; },
  /** 탄창 아이템: 위치와 주웠는지, 다시 뿌리기 */
  pickups() { return pickups.items.map((it) => ({ pos: it.root.position.toArray().map((v) => +v.toFixed(2)), taken: it.taken })); },
  respawnPickups(seed = 11) { spawnPickups(seed); },
  killEnemy(i: number) { const e = enemies.list[i]; if (e?.alive) e.die(enemyHooks); },
  /** i번 적에게 플레이어가 맞힌 것처럼 피해를 준다 */
  hitEnemy(i: number) { return enemies.list[i]?.damage(player.pos, enemyHooks); },
  god(on: boolean) { godMode = on; },
  /** i번 적을 (x, z)로 옮기고 방향(도) 지정 */
  placeEnemy(i: number, x: number, z: number, yawDeg: number) { enemies.list[i]?.place(x, z, THREE.MathUtils.degToRad(yawDeg)); },
  enemyInfo() {
    return enemies.list.map((e, i) => ({ i, kind: e.kind, state: e.state, hp: e.hp, sees: e.seesPlayer, raise: +e.raise.toFixed(2), aimErrDeg: +THREE.MathUtils.radToDeg(e.aimError).toFixed(1), pos: e.root.position.toArray().map((v) => +v.toFixed(2)), yawDeg: +THREE.MathUtils.radToDeg(e.yaw).toFixed(0), speed: +e.speed.toFixed(2) }));
  },
  playerHits() { return playerHits; },
  /** 월드 지점(x, y, z)을 중심으로 도는 궤도 카메라. angle은 월드 기준(0 = +Z 쪽에서 -Z를 봄) */
  orbitPoint(x: number, y: number, z: number, angleDeg: number, dist = 3.5) {
    camRig.orbit = { angle: angleDeg - THREE.MathUtils.radToDeg(player.yaw) + 180, dist, height: y, pivot: new THREE.Vector3(x, y, z) };
  },
  /** i번 적의 갱신(순찰/전투)을 멈추거나 푼다 */
  freezeEnemy(i: number, on: boolean) { const e = enemies.list[i]; if (e) e.frozen = on; },
  /** 시뮬레이션을 1/60초씩 n번 진행(실시간과 무관한 결정적 테스트용) */
  tick(n = 1) { for (let i = 0; i < n; i++) step(1 / 60, 1 / 60); },
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
      mantle: player.mantleProgress, canMantle: player.findLedge()?.height ?? null,
      ledgeTarget: character.rig.lastLeftTarget.toArray(), landImpulse: player.landImpulse, spread: weapon.spread(player),
      crouched: player.crouched, crouchBlend: player.crouchBlend, height: player.height, canStand: player.canStand(),
      eyeY: camRig.camera.position.y,
      view: camRig.view, viewBlend: camRig.viewBlend, pos: player.pos.toArray(), MOVE,
    };
  },
};
(window as unknown as { __debug: typeof debug }).__debug = debug;
