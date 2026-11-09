import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { loadAssets } from './assets';
import { Sfx } from './audio';
import { CameraRig, type View } from './camera';
import { BODY_LAYER, Character } from './character';
import { EYE_HEIGHT, EYE_HEIGHT_CROUCH, MEDKIT, MOVE, NUKE, PERF, PICKUP, PICKUP_ANIM, PLAYER_HEALTH, WEAPON } from './config';
import { mulberry32, type Enemy, type EnemyHooks, type EnemyWeapon } from './enemy';
import { Enemies } from './enemies';
import { Effects, MuzzleFlash } from './effects';
import { Hud } from './hud';
import { Input } from './input';
import { Player } from './player';
import { Viewmodel } from './viewmodel';
import { Minimap } from './minimap';
import { Weapon } from './weapon';
import { World } from './world';
import { Pickups } from './pickups';
import { NukeCrates } from './nukes';
import { Portal } from './portal';
import { TouchControls } from './touch';
import { loadPerf, PerfPanel, PERF_DEFAULT, setShadows, simplifyMaterials, syncSimpleMaterials, type PerfState } from './perf';
import { renderIcon } from './icon';
import { backToIntro, chooseMap } from './intro';

// 모바일: 손가락이 주 입력인 기기, 또는 ?mobile=1(PC에서 마우스로 시험). ?mobile=0이면 끈다.
const params = new URLSearchParams(location.search);
const isMobile = params.has('mobile') ? params.get('mobile') !== '0' : matchMedia('(pointer: coarse)').matches;
document.body.classList.toggle('mobile', isMobile);
World.lowPower = isMobile;

// 성능 옵션(패널에서 사용자가 켜고 끔). 안티앨리어싱은 렌더러를 만들 때만 정할 수 있어 저장값을 여기서 쓴다.
const perfAtStart = loadPerf();
const app = document.getElementById('app')!;
const renderer = new THREE.WebGLRenderer({ antialias: !perfAtStart.noAA, powerPreference: 'high-performance' });
// 모바일은 화면이 작고 GPU가 약해 픽셀 비율 상한을 낮춘다(해상도 옵션은 여기에 배율을 곱한다)
const basePixelRatio = Math.min(devicePixelRatio, isMobile ? 1.5 : 2);
renderer.setPixelRatio(basePixelRatio * perfAtStart.resScale);
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.autoClear = false;
// 통계는 프레임 전체(월드 + 1인칭 총)를 세도록 직접 비운다
renderer.info.autoReset = false;
app.appendChild(renderer.domElement);

const input = new Input(renderer.domElement);
const touch = isMobile ? new TouchControls(input) : null;
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

// 미니맵: 벽 그림은 맵을 불러온 지금 한 번 그린다(포털, 핵컨테이너가 벽으로 그려지지 않게 그보다 먼저)
const minimap = new Minimap();
minimap.build(world.colliders, world.bounds);
// 출구 포털: 시작 지점 바로 뒤(거기서 나온 것처럼). 뒤가 좁으면 시작 지점을 계단 앞으로 옮긴다.
const portal = new Portal(assets, world);
world.spawn.pos.copy(world.findFree(portal.place(world.spawn.pos, world.spawn.yaw), 0.4));
player.pos.copy(world.spawn.pos);
// 아이템(탄창, 구급상자, 컨테이너에서 나오는 폭탄)
const pickups = new Pickups(assets, world.scene);
// 미션: 핵컨테이너. 적과 아이템이 겹치지 않게 먼저 놓는다(충돌 박스가 world.colliders에 들어간다).
const nukes = new NukeCrates(assets, world, pickups);
nukes.place(mulberry32(23), world.spawn.pos);
nukes.onAllCollected = () => {
  // 다 모았다: 시작 지점의 포털이 열린다
  portal.activate();
  sfx.portalActivate();
  hud.showPickup('포털이 열렸다! 시작 지점의 포털로 돌아가라', 'nuke');
};
// 적
const enemies = new Enemies(assets, world.scene, effects.flashTex);
enemies.spawn(world.colliders, player.pos, world.bounds, 7, mapDef.enemies, (x, z) => world.reachable(x, z));
const spawnPickups = (seed = 11) =>
  pickups.spawn({ ammo: mapDef.pickups, medkit: mapDef.medkits }, {
    colliders: world.colliders, area: world.bounds, reachable: (x, z) => world.reachable(x, z), rand: mulberry32(seed), from: world.spawn.pos,
    avoid: nukes.markers().map((m) => new THREE.Vector2(m.x, m.z)),
  });
spawnPickups();
// 인벤토리 칸의 폭탄 그림(게임 모델을 한 번 그려 만든다)
hud.setupInventory(NUKE.count, renderIcon(pickups.model('bomb'), envTex));

// ───── 성능 옵션 ─────
const sunCasts = world.sun.castShadow;
const fogBase = world.scene.fog instanceof THREE.Fog ? { near: world.scene.fog.near, far: world.scene.fog.far } : null;
const camFarBase = camRig.camera.far;
/** 바뀐 항목만 적용한다(처음에는 기본값에서 저장값으로) */
function applyPerf(s: PerfState, prev: PerfState) {
  if (s.noShadows !== prev.noShadows) setShadows(renderer, world.scene, world.sun, sunCasts, !s.noShadows);
  if (s.noLights !== prev.noLights) {
    effects.light.visible = !s.noLights;
    effects.laserLight.visible = !s.noLights;
    portal.setLightEnabled(!s.noLights);
  }
  if (s.resScale !== prev.resScale) renderer.setPixelRatio(basePixelRatio * s.resScale);
  if (s.simpleMat !== prev.simpleMat) simplifyMaterials(world.scene, s.simpleMat);
  if (s.shortView !== prev.shortView) {
    camRig.camera.far = s.shortView ? PERF.viewFar : camFarBase;
    camRig.camera.updateProjectionMatrix();
    const fog = world.scene.fog;
    if (fog instanceof THREE.Fog && fogBase) {
      fog.near = s.shortView ? Math.min(fogBase.near, PERF.fogNear) : fogBase.near;
      fog.far = s.shortView ? Math.min(fogBase.far, PERF.fogFar) : fogBase.far;
    }
  }
  enemies.farSkip = s.farSkip;
  minimap.interval = s.minimapLow ? 1 / PERF.minimapHz : 0;
}
const perfPanel = new PerfPanel(perfAtStart, perfAtStart.noAA);
applyPerf(perfAtStart, PERF_DEFAULT);
perfPanel.onChange = (s, prev) => applyPerf(s, prev);
/** 성능 패널 열고 닫기(PC는 버튼을 누를 수 있게 마우스 잠금을 잠깐 푼다) */
function togglePerf(open = !perfPanel.open) {
  perfPanel.show(open);
  if (isMobile) return;
  if (open) document.exitPointerLock?.();
  else if (started && !cleared) input.requestLock();
}
perfPanel.onClose = () => togglePerf(false);
document.getElementById('open-perf')!.addEventListener('click', (ev) => { ev.stopPropagation(); togglePerf(true); });
/** 측정: 갱신(시뮬레이션)과 렌더(CPU 쪽 제출) 시간을 0.5초 평균으로 */
const perfMeasure = { sim: 0, render: 0, frame: 0, n: 0, acc: 0 };

const playerHead = new THREE.Vector3();
const _pbox = new THREE.Box3();
const _eray = new THREE.Raycaster();
const _phit = new THREE.Vector3();
let playerHits = 0;
/** 주인공 체력(에너지) */
let hp = PLAYER_HEALTH.max;
/** 쓰러진 뒤 다시 일어나기까지 남은 시간(0 이하면 살아 있음) */
let deadT = 0;
/** 디버그: 적 총알이 플레이어를 맞히지 않게 한다 */
let godMode = false;
/** 게임 클리어(포털에 들어감). 이후로는 움직이거나 맞지 않는다. */
let cleared = false;
/** 플레이 시간(시작 후, 클리어 전까지) */
let playTime = 0;
let humT = 0;

/** 포털에 들어갔다: 섬광 후 결과 화면 */
function gameClear() {
  cleared = true;
  weapon.forceAds = null;
  weapon.forceFire = false;
  sfx.gameClear();
  const kills = enemies.list.length - enemies.aliveCount;
  const m = Math.floor(playTime / 60), s = Math.floor(playTime % 60);
  hud.showClear([
    ['걸린 시간', `${m}분 ${String(s).padStart(2, '0')}초`],
    ['쓰러뜨린 적', `${kills} / ${enemies.list.length}`],
    ['맞은 횟수', String(playerHits)],
    ['남은 체력', String(hp)],
  ]);
  // 버튼을 누를 수 있게 마우스를 풀어 준다
  document.exitPointerLock?.();
}
document.getElementById('clear-retry')!.addEventListener('click', () => location.reload());
document.getElementById('clear-maps')!.addEventListener('click', () => backToIntro());

function die() {
  deadT = PLAYER_HEALTH.respawnDelay;
  weapon.forceAds = null;
  hud.setDead(true);
}

/** 시작 지점에서 체력과 탄약을 채우고 다시 일어난다 */
function respawn() {
  deadT = 0;
  hp = PLAYER_HEALTH.max;
  player.mantle = null;
  player.mantleHold = null;
  player.pickupT = -1;
  player.pos.copy(world.spawn.pos);
  player.vel.set(0, 0, 0);
  player.yaw = world.spawn.yaw;
  player.pitch = 0;
  weapon.ammo = WEAPON.magSize;
  weapon.reserve = Math.max(weapon.reserve, WEAPON.reserve);
  weapon.reloadT = -1;
  hud.setDead(false);
}
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
    if (pDist < wallDist && !godMode && deadT <= 0 && !cleared) {
      playerHits++;
      hud.showDamage(from, player.pos, player.yaw);
      sfx.hurt();
      camRig.kick(-0.004, (Math.random() - 0.5) * 0.004);
      hp = Math.max(0, hp - (kind === 'laser' ? PLAYER_HEALTH.laser : PLAYER_HEALTH.bullet));
      if (hp <= 0) die();
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
/** 모바일 일시정지(시작 화면을 다시 띄운 동안, 또는 세로로 든 동안) */
let paused = false;
const portraitMq = matchMedia('(orientation: portrait)');

/** 게임 시작/재개(PC는 Pointer Lock이 잡힐 때, 모바일은 시작 화면을 탭할 때) */
function startGame() {
  // 처음 시작할 때: 포털에서 방금 나온 것처럼 번쩍인다
  if (!started) { portal.flash(); sfx.portalWhoosh(); }
  started = true;
  paused = false;
  startEl.classList.add('hidden');
  touch?.show(!cleared);
}

/** 시작 화면을 다시 띄운다(PC: 마우스 잠금이 풀림, 모바일: 일시정지 버튼) */
function showStartPanel() {
  // 클리어 뒤에는 시작 화면 대신 결과 화면을 둔다. 성능 패널을 열려고 잠금을 푼 것이면 그대로 둔다.
  if (cleared || perfPanel.open) return;
  startEl.classList.remove('hidden');
  if (isMobile) { paused = true; touch?.show(false); }
}

startEl.addEventListener('click', () => {
  sfx.unlock();
  if (!isMobile) { input.requestLock(); return; }
  // 모바일: 전체 화면과 가로 고정을 시도한다(지원하는 브라우저에서만, 실패해도 그대로 진행)
  document.documentElement.requestFullscreen?.().then(() => {
    (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape').catch(() => {});
  }).catch(() => {});
  startGame();
});
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === renderer.domElement;
  if (locked) startGame();
  else showStartPanel();
});
if (touch) {
  touch.onPause = showStartPanel;
  touch.onPerf = () => togglePerf();
}

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
/** 주운 아이템이 날아올 곳(몸 바로 앞, 1인칭 화면 아래쪽에 보이게) */
const flyTarget = new THREE.Vector3();
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
    // 핵컨테이너: 맞으면 뚜껑이 열리고 폭탄이 떠오른다
    const crate = hit.object.userData.nukeCrate as number | undefined;
    if (crate !== undefined && nukes.open(crate)) {
      // 새로 생긴 폭탄도 단순 재질로
      if (perfPanel.state.simpleMat) simplifyMaterials(world.scene, true);
      sfx.crateOpen();
      hud.showHit();
    }
  }
}

let lastStepAt = 0;
function frame(now = performance.now()) {
  requestAnimationFrame(frame);
  // 성능 옵션: 30fps 제한(그 사이 프레임은 건너뛰고, 시간은 clock에 그대로 모인다)
  if (perfPanel.state.cap30 && now - lastStepAt < 1000 / 30 - 2) return;
  lastStepAt = now;
  const rawDt = Math.min(clock.getDelta(), 0.05);
  // 모바일 일시정지 중, 또는 세로로 든 동안(회전 안내가 화면을 덮는다)에는 시뮬레이션을 멈춘다
  if (paused || (isMobile && portraitMq.matches)) { input.endFrame(); return; }
  step(rawDt * timeScale, rawDt);
}

function step(dt: number, rawDt: number) {
  const tStart = performance.now();
  if (input.pressed.has('KeyV')) setView(camRig.view === 'fp' ? 'tp' : 'fp');
  if (input.pressed.has('KeyP')) togglePerf();
  if (perfPanel.state.simpleMat) syncSimpleMaterials();

  if (started && !cleared) playTime += dt;
  if (cleared) {
    // 클리어 뒤에는 멈춰 있는다(포털 효과와 화면만 움직인다)
    weapon.firedThisFrame = false;
  } else if (deadT > 0) {
    // 쓰러진 동안은 움직이거나 쏘지 못한다
    deadT -= dt;
    weapon.firedThisFrame = false;
    if (deadT <= 0) respawn();
  } else {
    player.look(input, weapon.ads);
    player.update(dt, input, { ads: weapon.wantsAds(input) && !weapon.reloading, wantsSprintBlocked: weapon.blocksSprint(input) });
    weapon.update(dt, input, player);
  }
  if (weapon.firedThisFrame) {
    enemies.noise(player.pos);
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
  // 날아가던 아이템은 쓰러진 동안에도 마저 움직이게, 줍기만 막는다
  pickups.update(dt, player.pos, (it) => {
    if (deadT > 0) return false;
    if (it.kind === 'medkit') {
      // 체력이 가득이면 그대로 두어 나중에 쓸 수 있게 한다
      if (hp >= PLAYER_HEALTH.max) return false;
      const gain = Math.min(MEDKIT.heal, PLAYER_HEALTH.max - hp);
      hp += gain;
      sfx.heal();
      hud.showPickup(`+${gain} 체력`, 'heal');
    } else if (it.kind === 'bomb') {
      nukes.collect(it);
      hud.addBomb(nukes.collected);
      sfx.bombPickup();
      if (nukes.collected < nukes.total) hud.showPickup(`핵원자로폭탄 획득 ${nukes.collected}/${nukes.total}`, 'nuke');
    } else {
      weapon.reserve += PICKUP.ammo;
      sfx.pickup();
      hud.showPickup(`+${PICKUP.ammo} 탄약`);
    }
    // 짧게 숙여 줍는 동작
    player.startPickup();
    return true;
  }, flyTarget.set(player.pos.x - Math.sin(player.yaw) * PICKUP_ANIM.flyAhead, player.pos.y, player.pos.z - Math.cos(player.yaw) * PICKUP_ANIM.flyAhead));
  hud.setHealth(hp, PLAYER_HEALTH.max);
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
  nukes.update(dt);
  // 포털: 활성 상태에서 들어가면 게임 클리어. 켜져 있는 동안 가까울수록 크게 웅웅거린다.
  if (portal.update(dt, player.pos) && !cleared && deadT <= 0) gameClear();
  if (portal.active && !cleared) {
    humT -= dt;
    if (humT <= 0) { humT = 1.1; sfx.portalHum(player.pos.distanceTo(portal.root.position)); }
  }
  effects.update(dt);
  fpFlash.update(dt);
  tpFlash.update(dt);

  const tRender = performance.now();
  renderer.info.reset();
  renderer.clear();
  renderer.render(world.scene, cam);
  if (camRig.showViewmodel) {
    renderer.clearDepth();
    viewmodel.render(renderer);
  }
  const tRenderEnd = performance.now();

  hud.update(dt, weapon, weapon.spread(player), cam.fov, camRig.view, player.sprinting, player.yaw);
  if (touch) {
    // 쓰러졌거나 클리어했으면 터치 버튼을 숨긴다
    const showTouch = started && !paused && !cleared && deadT <= 0;
    if (showTouch !== touch.root.classList.contains('on')) touch.show(showTouch);
    touch.update(weapon, player, camRig.view);
  }
  minimap.update(player.pos, player.yaw, pickups.items, nukes.markers(), portal.marker());
  fpsAcc += rawDt; fpsFrames++;
  // 측정(0.5초 평균): 갱신 = 시뮬레이션, 렌더 = 그리기 명령 제출(CPU). 프레임이 둘의 합보다 훨씬 길면 GPU가 병목이다.
  const pm = perfMeasure;
  pm.sim += tRender - tStart; pm.render += tRenderEnd - tRender; pm.frame += rawDt * 1000; pm.n++;
  if (fpsAcc > 0.5) {
    fpsShown = fpsFrames / fpsAcc; fpsAcc = 0; fpsFrames = 0;
    if (perfPanel.open) {
      const sim = pm.sim / pm.n, ren = pm.render / pm.n, fr = pm.frame / pm.n;
      const size = renderer.getDrawingBufferSize(new THREE.Vector2());
      perfPanel.setMetrics(
        `${fpsShown.toFixed(0)} fps   프레임 ${fr.toFixed(1)}ms\n` +
        `갱신 ${sim.toFixed(1)}ms  렌더 ${ren.toFixed(1)}ms  GPU 대기 약 ${Math.max(0, fr - sim - ren).toFixed(1)}ms\n` +
        `그리기 ${renderer.info.render.calls}회  삼각형 ${(renderer.info.render.triangles / 1000).toFixed(0)}k\n` +
        `해상도 ${size.x}×${size.y}`);
    }
    pm.sim = pm.render = pm.frame = pm.n = 0;
  }
  hud.stats.textContent =
    `${fpsShown.toFixed(0)} fps  draw ${renderer.info.render.calls}  적 ${enemies.aliveCount}/${enemies.list.length}  피격 ${playerHits}  체력 ${hp}\n` +
    `상태 ${weapon.mode(player)}${player.crouched && weapon.mode(player) !== 'crouch' ? '(앉기)' : ''}  속도 ${player.horizSpeed.toFixed(1)}m/s`;
  input.endFrame();
}
requestAnimationFrame(frame);

/** 검증용 디버그 훅 */
const debug = {
  player, world, weapon,
  start() { startGame(); sfx.unlock(); },
  /** 모바일 일시정지 상태 */
  paused() { return paused || (isMobile && portraitMq.matches); },
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
  pickups() { return pickups.items.map((it) => ({ kind: it.kind, pos: it.root.position.toArray().map((v) => +v.toFixed(2)), taken: it.taken })); },
  /** 주인공 체력: 인자가 있으면 그 값으로 바꾼다(0이면 쓰러진다) */
  hp(v?: number) {
    if (v !== undefined) { hp = Math.max(0, Math.min(PLAYER_HEALTH.max, v)); if (hp <= 0 && deadT <= 0) die(); }
    return { hp, dead: deadT > 0 };
  },
  respawnPickups(seed = 11) { spawnPickups(seed); },
  /** 핵컨테이너: 위치, 상태, 실내 점수 */
  nukes() { return nukes.list.map((c, i) => ({ i, pos: c.root.position.toArray().map((v) => +v.toFixed(2)), yawDeg: Math.round(THREE.MathUtils.radToDeg(c.root.rotation.y)), state: c.state, shelter: c.shelter, roof: c.roof, walls: c.walls })); },
  openCrate(i: number) { const ok = nukes.open(i); if (ok) { sfx.crateOpen(); if (perfPanel.state.simpleMat) simplifyMaterials(world.scene, true); } return ok; },
  /** 성능 옵션: 상태 읽기, 바꾸기(일부만), 패널 열기 */
  perf(next?: Partial<PerfState>) { if (next) perfPanel.set({ ...perfPanel.state, ...next }); return { ...perfPanel.state }; },
  perfPanel(open: boolean) { perfPanel.show(open); },
  bombs() { return nukes.collected; },
  /** 포털: 위치, 방향, 배율, 활성 여부, 효과 세기 */
  portal() { return { pos: portal.root.position.toArray().map((v) => +v.toFixed(2)), yawDeg: Math.round(THREE.MathUtils.radToDeg(portal.root.rotation.y)), k: +portal.k.toFixed(3), height: +(portal.k * 3.71).toFixed(2), active: portal.active, power: +portal.power.toFixed(2), spawn: world.spawn.pos.toArray().map((v) => +v.toFixed(2)) }; },
  activatePortal() { portal.activate(); sfx.portalActivate(); },
  cleared() { return cleared; },
  portalObj: portal,
  nukeObj: nukes,
  killEnemy(i: number) { const e = enemies.list[i]; if (e?.alive) e.die(enemyHooks); },
  /** i번 적에게 플레이어가 맞힌 것처럼 피해를 준다 */
  hitEnemy(i: number) { return enemies.list[i]?.damage(player.pos, enemyHooks); },
  god(on: boolean) { godMode = on; },
  /** i번 적을 (x, z)로 옮기고 방향(도) 지정 */
  placeEnemy(i: number, x: number, z: number, yawDeg: number) { enemies.list[i]?.place(x, z, THREE.MathUtils.degToRad(yawDeg)); },
  enemyInfo() {
    return enemies.list.map((e, i) => ({ i, kind: e.kind, state: e.state, tactic: e.tactic, hp: e.hp, sees: e.seesPlayer, raise: +e.raise.toFixed(2), aimErrDeg: +THREE.MathUtils.radToDeg(e.aimError).toFixed(1), pos: e.root.position.toArray().map((v) => +v.toFixed(2)), yawDeg: +THREE.MathUtils.radToDeg(e.yaw).toFixed(0), speed: +e.speed.toFixed(2) }));
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
