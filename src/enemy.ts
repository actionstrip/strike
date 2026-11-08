import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Assets } from './assets';
import { ENEMY } from './config';
import { MuzzleFlash } from './effects';
import type { Player } from './player';
import { rotateBoneWorld } from './rig';

/**
 * 적 로봇: 순찰(걷다 서서 두리번거림) -> 발견하면 팔을 들어 조준, 사격 -> 5발 맞으면 주저앉아 회색으로 꺼진다.
 * 모델(enemy_robot.glb)은 로컬 +X를 정면으로 본다. 그래서 model.rotation.y = PI/2로 -Z가 정면이 되게 놓는다.
 * 오른팔(ArmR~HandR)은 코드가 직접 조준하고, 나머지는 클립(Walk/Idle/Death)이 움직인다.
 */

export type EnemyState = 'walk' | 'look' | 'combat' | 'search' | 'dead';

export interface EnemyHooks {
  /** 적이 한 발 쐈다. from은 총구, dir은 퍼짐이 적용된 방향 */
  onFire(e: Enemy, from: THREE.Vector3, dir: THREE.Vector3): void;
  onDeath?(e: Enemy): void;
}

const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _ray = new THREE.Raycaster();

function bone(root: THREE.Object3D, name: string) {
  const b = root.getObjectByName(name);
  if (!b) throw new Error('enemy bone missing: ' + name);
  return b as THREE.Bone;
}

/** 각도 차이를 -PI..PI로 */
function angDiff(a: number, b: number) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function turnToward(cur: number, target: number, maxStep: number) {
  const d = angDiff(target, cur);
  return cur + THREE.MathUtils.clamp(d, -maxStep, maxStep);
}

/** 적이 다닐 수 있는 범위(맵 경계). Enemies.spawn이 맵에서 받아 설정한다. */
const AREA = new THREE.Box3(new THREE.Vector3(-43, 0, -43), new THREE.Vector3(43, 5, 43));
const inArea = (x: number, z: number, margin = 0) =>
  x > AREA.min.x + margin && x < AREA.max.x - margin && z > AREA.min.z + margin && z < AREA.max.z - margin;

/** 시드 고정 난수 */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 사망 시 회색 처리용: 모든 표준 재질에 채도 제거와 밝기 배율 uniform을 넣는다 */
function patchGrey(mat: THREE.MeshStandardMaterial, u: { uGrey: { value: number } }) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uGrey = u.uGrey;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uGrey;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(lum) * 0.4, uGrey);`,
      );
  };
  mat.customProgramCacheKey = () => 'enemyGrey';
}

/** 머리 위 라이프 바(5칸) */
class LifeBar {
  sprite: THREE.Sprite;
  private canvas = document.createElement('canvas');
  private tex: THREE.CanvasTexture;
  constructor(parent: THREE.Object3D, y: number) {
    this.canvas.width = 128;
    this.canvas.height = 20;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: this.tex, depthTest: true, depthWrite: false, transparent: true });
    this.sprite = new THREE.Sprite(mat);
    this.sprite.scale.set(0.75, 0.12, 1);
    this.sprite.position.y = y;
    this.sprite.renderOrder = 10;
    parent.add(this.sprite);
  }
  draw(hp: number, max: number, hitFlash: number) {
    const g = this.canvas.getContext('2d')!;
    const w = this.canvas.width, h = this.canvas.height;
    g.clearRect(0, 0, w, h);
    g.fillStyle = 'rgba(0,0,0,0.55)';
    g.fillRect(0, 0, w, h);
    const pad = 3, gap = 3;
    const cw = (w - pad * 2 - gap * (max - 1)) / max;
    const col = hp >= 4 ? '#5be36b' : hp >= 2 ? '#ffc23d' : '#ff4b3a';
    for (let i = 0; i < max; i++) {
      g.fillStyle = i < hp ? (hitFlash > 0 ? '#ffffff' : col) : 'rgba(255,255,255,0.12)';
      g.fillRect(pad + i * (cw + gap), pad, cw, h - pad * 2);
    }
    this.tex.needsUpdate = true;
  }
}

export class Enemy {
  root = new THREE.Object3D();
  model: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  actions: Record<string, THREE.AnimationAction> = {};
  gun: THREE.Object3D;
  muzzle: THREE.Object3D;
  flash: MuzzleFlash;
  /** 피격 판정용 보이지 않는 박스(몸통, 머리) */
  hitBoxes: THREE.Mesh[] = [];
  lifeBar: LifeBar;

  hp = ENEMY.health;
  state: EnemyState = 'look';
  yaw = 0;
  home = new THREE.Vector3();
  waypoint = new THREE.Vector3();
  /** 시야 안에 플레이어가 보이는지(마지막 검사 결과) */
  seesPlayer = false;
  lastSeen = new THREE.Vector3();
  /** 팔 들기 0..1 */
  raise = 0;
  aimError = Math.PI;
  speed = 0;
  deathT = -1;
  /** 디버그: 순찰/전투 갱신을 멈춘다(자세 시트 캡처용) */
  frozen = false;
  /** 오른팔이 겨누는 월드 지점 */
  aimPoint = new THREE.Vector3();

  private bones: Record<string, THREE.Bone> = {};
  private phase = 0;
  private idleT = Math.random() * 2;
  private stateT = 0;
  private lookT = 0;
  /** 머리가 몸 정면 기준으로 돌아간 각(목+머리), 목표, 각속도 */
  private headYaw = 0;
  private headTarget = 0;
  private headVel = 0;
  /** 상체 비틀림(골반 기준), 목표 */
  private twist = 0;
  private twistTarget = 0;
  /** 다음 시선 목표로 넘어가기까지 남은 시간 */
  private glanceT = 0;
  private glanceSide = 1;
  /** 이번 프레임 몸 회전 속도(rad/s): 제자리 돌 때 발을 떼게 한다 */
  private turnRate = 0;
  /** 걷기 클립 비중(부드럽게 오르내림) */
  private stepW = 0;
  /** 전투 중 몸을 다시 정렬하는 중인지 */
  private realign = false;
  /**
   * 절차적 회전(두리번, 조준)을 넣기 전의 클립 자세.
   * AnimationMixer는 트랙 값이 지난 프레임과 같으면 뼈에 다시 쓰지 않으므로(걷기 클립의 몸통처럼 고정된 트랙),
   * 매 프레임 이 자세로 되돌려 놓지 않으면 절차적 회전이 계속 쌓여 몸이 빙글빙글 돈다.
   */
  private restQ: [THREE.Bone, THREE.Quaternion][] = [];
  private sightT = Math.random() * ENEMY.sightInterval;
  private searchT = 0;
  private burstLeft = 0;
  private fireT = 0;
  private recoil = 0;
  private flinch = 0;
  private hitFlash = 0;
  private greyU = { uGrey: { value: 0 } };
  private eyeMats: THREE.MeshStandardMaterial[] = [];
  private rand: () => number;

  constructor(assets: Assets, rand: () => number, flashTex: THREE.Texture) {
    this.rand = rand;
    this.model = SkeletonUtils.clone(assets.enemy.scene);
    this.model.rotation.y = Math.PI / 2;
    this.root.add(this.model);
    // 재질은 적마다 따로(회색 처리를 개별로)
    this.model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      const mats = (Array.isArray(m.material) ? m.material : [m.material]).map((src) => {
        const c = (src as THREE.MeshStandardMaterial).clone();
        patchGrey(c, this.greyU);
        if (/Yeux/i.test(c.name)) this.eyeMats.push(c);
        return c;
      });
      m.material = Array.isArray(m.material) ? mats : mats[0];
    });
    for (const n of ['Root', 'Spine', 'Neck', 'Head', 'ArmR', 'ForeArmR', 'WristR', 'HandR']) this.bones[n] = bone(this.model, n);
    for (const n of ['Spine', 'Neck', 'Head', 'ArmR', 'ForeArmR', 'WristR', 'HandR']) this.restQ.push([this.bones[n], this.bones[n].quaternion.clone()]);

    this.mixer = new THREE.AnimationMixer(this.model);
    for (const [name, clip] of Object.entries(assets.enemyClips)) {
      const a = this.mixer.clipAction(clip);
      a.play();
      a.setEffectiveWeight(0);
      this.actions[name] = a;
    }

    // 총: 손 본에 붙인다. 총 -Z(총구)가 손 +Y(손가락 방향), 총 +Y(위)가 손 +Z. 비틀림은 매 프레임 조준에서 바로잡는다.
    this.gun = assets.enemyGun.scene.clone(true);
    this.gun.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      const c = (m.material as THREE.MeshStandardMaterial).clone();
      patchGrey(c, this.greyU);
      m.material = c;
    });
    const hand = this.bones.HandR;
    const basis = new THREE.Matrix4().makeBasis(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, -1, 0));
    this.gun.quaternion.setFromRotationMatrix(basis);
    // 손 본의 월드 스케일을 상쇄해서 총이 실제 크기(m)로 보이게 한다
    this.model.updateMatrixWorld(true);
    const hs = hand.getWorldScale(new THREE.Vector3()).x;
    this.gun.scale.setScalar(1 / hs);
    this.gun.position.set(0, 0.04 / hs, -0.02 / hs);
    hand.add(this.gun);
    this.muzzle = this.gun.getObjectByName('Muzzle')!;

    // 피격 박스
    const boxMat = new THREE.MeshBasicMaterial({ visible: false });
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.95, 0.6), boxMat);
    torso.position.y = 0.95;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.5, 0.8), boxMat);
    head.position.y = 1.62;
    for (const b of [torso, head]) {
      b.userData.enemy = this;
      this.root.add(b);
      this.hitBoxes.push(b);
    }
    this.lifeBar = new LifeBar(this.root, 2.15);
    // 덩치 배율: 루트 아래 전부(모델, 총, 섬광, 피격 박스)가 함께 줄어든다. 라이프바는 읽기 좋게 크기를 덜 줄인다.
    this.root.scale.setScalar(ENEMY.size);
    this.lifeBar.sprite.scale.multiplyScalar(0.8 / ENEMY.size);
    this.lifeBar.draw(this.hp, ENEMY.health, 0);
    this.flash = new MuzzleFlash(this.muzzle, flashTex, 0.35);
  }

  get alive() {
    return this.state !== 'dead';
  }

  forward(out = new THREE.Vector3()) {
    return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  place(x: number, z: number, yaw: number) {
    this.root.position.set(x, 0, z);
    this.home.set(x, 0, z);
    this.yaw = yaw;
    this.state = 'look';
    this.lookT = 1 + this.rand() * 2;
  }

  damage(fromPos: THREE.Vector3, hooks: EnemyHooks) {
    if (!this.alive) return false;
    this.hp--;
    this.hitFlash = 0.12;
    this.flinch = 1;
    if (this.hp <= 0) {
      this.die(hooks);
      return true;
    }
    // 맞으면 쏜 쪽을 안다
    if (this.state !== 'combat') {
      this.state = 'combat';
      this.lastSeen.copy(fromPos);
      this.burstLeft = 0;
      this.fireT = 0.4;
    }
    this.searchT = ENEMY.searchTime;
    return false;
  }

  die(hooks?: EnemyHooks) {
    this.state = 'dead';
    this.hp = 0;
    this.deathT = 0;
    this.speed = 0;
    for (const b of this.hitBoxes) b.removeFromParent();
    hooks?.onDeath?.(this);
  }

  /** world: 레이캐스트 대상(정적), colliders: 이동 충돌 */
  update(dt: number, player: Player, playerHead: THREE.Vector3, world: { hitMeshes: THREE.Object3D[]; colliders: THREE.Box3[] }, hooks: EnemyHooks) {
    this.flash.update(dt);
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    this.flinch = Math.max(0, this.flinch - dt * 5);
    this.recoil = Math.max(0, this.recoil - dt * 9);
    if (this.alive && !this.frozen) this.think(dt, player, playerHead, world, hooks);
    // 조준점: 전투 중이면 플레이어 가슴, 수색 중이면 마지막으로 본 곳
    const aim = this.aimPoint;
    if (this.state === 'search') aim.set(this.lastSeen.x, this.lastSeen.y + 1.3, this.lastSeen.z);
    else if (this.state === 'combat') aim.set(player.pos.x, (player.pos.y + playerHead.y) * 0.5 + 0.2, player.pos.z);
    else this.forward(aim).multiplyScalar(5).add(this.root.position).setY(this.root.position.y + 1.2 * ENEMY.size);
    this.animate(dt, aim);
    // 라이프 바: 맞은 직후 흰색으로 반짝인다
    if (this.alive) this.lifeBar.draw(this.hp, ENEMY.health, this.hitFlash);
    this.lifeBar.sprite.visible = this.alive;
  }

  private think(dt: number, player: Player, playerHead: THREE.Vector3, world: { hitMeshes: THREE.Object3D[]; colliders: THREE.Box3[] }, hooks: EnemyHooks) {
    const pos = this.root.position;
    // 시야 검사(주기적으로)
    this.sightT -= dt;
    if (this.sightT <= 0) {
      this.sightT = ENEMY.sightInterval;
      this.seesPlayer = this.canSee(playerHead, world.hitMeshes);
      if (this.seesPlayer) {
        this.lastSeen.copy(player.pos);
        if (this.state !== 'combat') {
          this.state = 'combat';
          this.burstLeft = 0;
          this.fireT = 0.25;
        }
        this.searchT = ENEMY.searchTime;
      }
    }

    if (this.state === 'combat' || this.state === 'search') {
      this.speed = 0;
      // 보이는 동안은 지금 위치, 안 보이면 마지막으로 본 곳
      const tgt = this.seesPlayer ? player.pos : this.lastSeen;
      const want = Math.atan2(-(tgt.x - pos.x), -(tgt.z - pos.z));
      // 작은 움직임은 상체와 팔로만 따라가고, 많이 벗어나면 발을 떼서 몸을 정렬한다(정렬이 끝날 때까지)
      const off = Math.abs(angDiff(want, this.yaw));
      if (off > ENEMY.realignAngle) this.realign = true;
      if (this.realign) {
        const rate = off > ENEMY.twistMax * 0.8 ? ENEMY.combatTurnSpeed : ENEMY.combatTurnSpeed * 0.6;
        this.turnBody(want, rate, dt);
        if (Math.abs(angDiff(want, this.yaw)) < THREE.MathUtils.degToRad(3)) this.realign = false;
      } else {
        this.turnRate = 0;
      }
      const rest = angDiff(want, this.yaw);
      this.twistTarget = THREE.MathUtils.clamp(rest, -ENEMY.twistMax, ENEMY.twistMax);
      this.headTarget = THREE.MathUtils.clamp(rest, -ENEMY.headMax, ENEMY.headMax);
      if (!this.seesPlayer) {
        this.searchT -= dt;
        this.state = 'search';
        if (this.searchT <= 0) {
          this.state = 'look';
          this.lookT = THREE.MathUtils.lerp(ENEMY.lookTime[0], ENEMY.lookTime[1], this.rand());
          this.stateT = 0;
          this.glanceT = 0.6;
        }
      } else {
        this.state = 'combat';
      }
      // 팔은 전투/수색 중 들고 있고, 사격은 보이고 조준됐을 때만
      this.raise = Math.min(1, this.raise + dt / ENEMY.raiseTime);
      this.fireT -= dt;
      if (this.state === 'combat' && this.raise >= 1 && this.aimError < ENEMY.fireAngle && this.fireT <= 0) {
        if (this.burstLeft <= 0) this.burstLeft = ENEMY.burst;
        this.shoot(playerHead, player, hooks);
        this.burstLeft--;
        this.fireT = this.burstLeft > 0 ? ENEMY.burstInterval : THREE.MathUtils.lerp(ENEMY.burstPause[0], ENEMY.burstPause[1], this.rand());
      }
      return;
    }

    this.raise = Math.max(0, this.raise - dt / 0.6);
    this.stateT += dt;
    if (this.state === 'look') {
      // 서서 좌우로 두리번거린다
      this.speed = Math.max(0, this.speed - dt * 3);
      this.turnRate = 0;
      this.twistTarget = 0;
      this.scan(dt, ENEMY.headMax, 0.3);
      this.lookT -= dt;
      if (this.lookT <= 0) this.pickWaypoint(world.colliders);
    } else if (this.state === 'walk') {
      const to = _v.subVectors(this.waypoint, pos).setY(0);
      const dist = to.length();
      const want = Math.atan2(-to.x, -to.z);
      this.turnBody(want, ENEMY.turnSpeed, dt);
      this.twistTarget = 0;
      const align = Math.max(0, Math.cos(angDiff(want, this.yaw)));
      const target = ENEMY.patrolSpeed * THREE.MathUtils.smoothstep(align, 0.7, 1) * Math.min(1, dist / 0.6 + 0.3);
      this.speed += (target - this.speed) * (1 - Math.exp(-6 * dt));
      // 걸을 때는 가끔 옆을 힐끗 본다
      this.scan(dt, THREE.MathUtils.degToRad(30), 0.55);
      const step = this.forward(_v2).multiplyScalar(this.speed * dt);
      const next = _v3.copy(pos).add(step);
      if (this.blocked(next, world.colliders)) {
        this.state = 'look';
        this.lookT = 1.5 + this.rand() * 2;
        this.stateT = 0;
        this.glanceT = 0.5;
      } else {
        pos.copy(next);
      }
      if (dist < 0.35) {
        this.state = 'look';
        this.lookT = THREE.MathUtils.lerp(ENEMY.lookTime[0], ENEMY.lookTime[1], this.rand());
        this.stateT = 0;
        this.glanceT = 0.5;
      }
    }
  }

  /** 몸(다리) 방향을 돌리고, 회전 속도를 기록한다(제자리 발걸음용) */
  private turnBody(want: number, rate: number, dt: number) {
    const before = this.yaw;
    this.yaw = turnToward(this.yaw, want, rate * dt);
    this.turnRate = dt > 0 ? Math.abs(angDiff(this.yaw, before)) / dt : 0;
  }

  /**
   * 사람처럼 둘러보기: 한쪽을 보고 잠깐 멈췄다가 반대쪽, 가끔 정면.
   * max: 좌우 최대 각, centerChance: 다음 시선이 정면일 확률
   */
  private scan(dt: number, max: number, centerChance: number) {
    // 머리가 목표에 거의 닿은 뒤부터 멈춤 시간을 센다
    if (Math.abs(this.headTarget - this.headYaw) < 0.06) this.glanceT -= dt;
    if (this.glanceT > 0) return;
    this.glanceT = THREE.MathUtils.lerp(ENEMY.glanceHold[0], ENEMY.glanceHold[1], this.rand());
    if (this.headTarget !== 0 && this.rand() < centerChance) {
      this.headTarget = 0;
    } else {
      this.glanceSide = -this.glanceSide;
      this.headTarget = this.glanceSide * max * THREE.MathUtils.lerp(0.6, 1, this.rand());
    }
  }

  private pickWaypoint(colliders: THREE.Box3[]) {
    for (let i = 0; i < 12; i++) {
      const a = this.rand() * Math.PI * 2;
      const r = 2.5 + this.rand() * (ENEMY.patrolRadius - 2.5);
      const wp = _v.set(this.home.x + Math.cos(a) * r, 0, this.home.z + Math.sin(a) * r);
      if (!inArea(wp.x, wp.z, 0.8)) continue;
      if (!this.pathClear(this.root.position, wp, colliders)) continue;
      this.waypoint.copy(wp);
      this.state = 'walk';
      this.stateT = 0;
      return;
    }
    this.lookT = 1;
  }

  private blocked(p: THREE.Vector3, colliders: THREE.Box3[]) {
    const r = ENEMY.radius;
    if (!inArea(p.x, p.z, ENEMY.radius)) return true;
    for (const c of colliders) {
      if (c.max.y < 0.05 || c.min.y > ENEMY.height) continue;
      if (p.x > c.min.x - r && p.x < c.max.x + r && p.z > c.min.z - r && p.z < c.max.z + r) return true;
    }
    return false;
  }

  private pathClear(a: THREE.Vector3, b: THREE.Vector3, colliders: THREE.Box3[]) {
    const n = Math.ceil(a.distanceTo(b) / 0.4);
    for (let i = 1; i <= n; i++) {
      if (this.blocked(_v2.lerpVectors(a, b, i / n), colliders)) return false;
    }
    return true;
  }

  /** 머리에서 플레이어 머리까지: 시야각, 거리, 가림 */
  canSee(playerHead: THREE.Vector3, hitMeshes: THREE.Object3D[]) {
    const head = this.bones.Head.getWorldPosition(_v);
    const to = _v2.subVectors(playerHead, head);
    const dist = to.length();
    if (dist > ENEMY.sightRange) return false;
    const lookYaw = this.yaw + this.headYaw;
    const fwd = _v3.set(-Math.sin(lookYaw), 0, -Math.cos(lookYaw));
    const flat = Math.hypot(to.x, to.z) || 1e-6;
    const cos = (to.x * fwd.x + to.z * fwd.z) / flat;
    if (cos < Math.cos(ENEMY.fov / 2)) return false;
    _ray.set(head, to.normalize());
    _ray.far = dist;
    const hit = _ray.intersectObjects(hitMeshes, false)[0];
    return !hit || hit.distance > dist - 0.3;
  }

  private shoot(playerHead: THREE.Vector3, player: Player, hooks: EnemyHooks) {
    const from = this.muzzle.getWorldPosition(new THREE.Vector3());
    // 가슴과 머리 사이를 노린다
    const target = new THREE.Vector3(player.pos.x, (player.pos.y + playerHead.y) * 0.5 + 0.2, player.pos.z);
    const dir = target.sub(from).normalize();
    const r = Math.sqrt(this.rand()) * ENEMY.spread;
    const a = this.rand() * Math.PI * 2;
    const side = _v.crossVectors(dir, UP).normalize();
    const up = _v2.crossVectors(side, dir).normalize();
    dir.addScaledVector(side, Math.cos(a) * Math.tan(r)).addScaledVector(up, Math.sin(a) * Math.tan(r)).normalize();
    this.flash.fire();
    this.recoil = 1;
    hooks.onFire(this, from, dir);
  }

  /** 클립 블렌딩 + 머리/척추 두리번 + 오른팔 조준 */
  private animate(dt: number, aimAt: THREE.Vector3) {
    this.root.rotation.y = this.yaw;
    const a = this.actions;
    const dead = this.deathT >= 0;
    if (dead) this.deathT += dt;
    const deathW = dead ? Math.min(1, this.deathT / 0.15) : 0;
    // 고개와 상체: 스프링으로 사람처럼 가속/감속(목표가 바뀌어도 순간이동하지 않는다)
    const k = ENEMY.headSpring;
    this.headVel += (k * k * (this.headTarget - this.headYaw) - 2 * k * this.headVel) * dt;
    this.headYaw += this.headVel * dt;
    this.twist += (this.twistTarget - this.twist) * (1 - Math.exp(-8 * dt));
    for (const [b, q] of this.restQ) b.quaternion.copy(q);
    // 제자리에서 돌 때도 발을 뗀다(1rad 도는 동안 약 0.5m 걷는 만큼)
    const stepSpeed = Math.max(this.speed, this.turnRate * 0.5);
    // 걷기 비중은 순간적으로 바뀌지 않게(발과 손이 튀지 않도록) 약 0.15초에 걸쳐 따라간다
    this.stepW += (THREE.MathUtils.smoothstep(stepSpeed, 0.05, 0.6) - this.stepW) * (1 - Math.exp(-dt / 0.15));
    const walkW = this.stepW * (1 - deathW);
    this.phase = (this.phase + (stepSpeed * dt) / (ENEMY.walkStride * ENEMY.size)) % 1;
    this.idleT += dt;
    a.Walk.setEffectiveWeight(walkW);
    a.Walk.time = this.phase * a.Walk.getClip().duration;
    a.Idle.setEffectiveWeight((1 - walkW) * (1 - deathW));
    a.Idle.time = this.idleT % a.Idle.getClip().duration;
    a.Death.setEffectiveWeight(deathW);
    a.Death.time = dead ? Math.min(this.deathT, a.Death.getClip().duration - 1e-3) : 0;
    this.mixer.update(0);
    for (const [b, q] of this.restQ) q.copy(b.quaternion);
    this.root.updateMatrixWorld(true);

    // 사망: 회색으로, 눈 불빛을 끈다
    if (dead) {
      const g = Math.min(1, this.deathT / ENEMY.greyTime);
      this.greyU.uGrey.value = g;
      for (const m of this.eyeMats) m.emissiveIntensity = 1 - g;
    }

    const armW = dead ? 1 - deathW : 1;
    if (armW <= 0) return;

    // 상체 비틀림(최대 45°)과 고개(몸 정면 기준 최대 60°, 상체가 돈 만큼은 빼고 목이 나머지를 돈다)
    const twist = THREE.MathUtils.clamp(this.twist + this.headYaw * 0.15, -ENEMY.twistMax, ENEMY.twistMax) * armW;
    const neck = THREE.MathUtils.clamp(this.headYaw * armW - twist, -ENEMY.headMax, ENEMY.headMax);
    rotateBoneWorld(this.bones.Spine, UP, twist);
    rotateBoneWorld(this.bones.Head, UP, neck);
    // 맞으면 상체가 뒤로 움찔
    if (this.flinch > 0) {
      const right = _v.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      rotateBoneWorld(this.bones.Spine, right, 0.25 * this.flinch * armW);
    }

    this.aimArm(aimAt, armW);
  }

  /** 오른팔을 곧게 펴고 총구가 목표를 향하도록 어깨를 돌린다. raise=0이면 아래로 내린 경계 자세. */
  private aimArm(target: THREE.Vector3, w: number) {
    const B = this.bones;
    const chain = [B.ArmR, B.ForeArmR, B.WristR, B.HandR];
    const clipQ = chain.map((b) => b.quaternion.clone());
    for (const b of chain.slice(1)) b.quaternion.identity();
    B.ArmR.updateMatrixWorld(true);

    const fwd = this.forward(new THREE.Vector3());
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const low = new THREE.Vector3().addScaledVector(fwd, 0.5).addScaledVector(right, 0.12).addScaledVector(UP, -0.86).normalize();
    const raise = THREE.MathUtils.smoothstep(this.raise, 0, 1);
    const gq = new THREE.Quaternion();
    const gunFwd = new THREE.Vector3();
    const muzzle = new THREE.Vector3();
    const want = new THREE.Vector3();
    const shoulder = B.ArmR.getWorldPosition(new THREE.Vector3());

    const align = () => {
      this.gun.getWorldQuaternion(gq);
      gunFwd.set(0, 0, -1).applyQuaternion(gq);
      this.muzzle.getWorldPosition(muzzle);
      want.subVectors(target, muzzle).normalize();
      if (raise < 1) want.lerp(low, 1 - raise).normalize();
      _q.setFromUnitVectors(gunFwd, want);
      const ax = _v.set(_q.x, _q.y, _q.z);
      const s = ax.length();
      if (s < 1e-6) return;
      rotateBoneWorld(B.ArmR, ax.divideScalar(s), 2 * Math.atan2(s, _q.w));
    };
    align();
    align();
    // 총이 눕지 않도록 총구 축을 중심으로 비틀어 위(+Y)를 맞춘다
    this.gun.getWorldQuaternion(gq);
    gunFwd.set(0, 0, -1).applyQuaternion(gq);
    const gunUp = new THREE.Vector3(0, 1, 0).applyQuaternion(gq);
    const wantUp = UP.clone().addScaledVector(gunFwd, -UP.dot(gunFwd)).normalize();
    const twist = Math.atan2(_v.crossVectors(gunUp, wantUp).dot(gunFwd), gunUp.dot(wantUp));
    rotateBoneWorld(B.ArmR, gunFwd, twist);
    align();
    // 반동: 총구가 위로 튄다
    if (this.recoil > 0) {
      const side = _v2.crossVectors(gunFwd, UP).normalize();
      rotateBoneWorld(B.ArmR, side, 0.12 * this.recoil);
    }

    // 조준 오차(발사 판정)
    this.gun.getWorldQuaternion(gq);
    gunFwd.set(0, 0, -1).applyQuaternion(gq);
    this.muzzle.getWorldPosition(muzzle);
    this.aimError = gunFwd.angleTo(want.subVectors(target, muzzle).normalize());
    void shoulder;

    // 사망 중에는 클립 팔 자세로 섞는다
    if (w < 1) {
      chain.forEach((b, i) => b.quaternion.slerpQuaternions(clipQ[i], b.quaternion.clone(), w));
      B.ArmR.updateMatrixWorld(true);
    }
  }
}

/** 적 무리: 배치, 갱신, 피격 메시 목록 */
export class Enemies {
  list: Enemy[] = [];
  /** 플레이어 사격용 피격 박스(살아 있는 적만) */
  hitMeshes: THREE.Object3D[] = [];

  constructor(private assets: Assets, private scene: THREE.Scene, private flashTex: THREE.Texture) {}

  spawn(colliders: THREE.Box3[], playerPos: THREE.Vector3, area: THREE.Box3, seed = 7, count = ENEMY.count) {
    for (const e of this.list) e.root.removeFromParent();
    this.list = [];
    AREA.copy(area);
    const rand = mulberry32(seed);
    // 바닥 높이의 빈 칸만(경사로, 2층 제외). 머리 위가 막힌 곳(지붕 밑)도 1.9m 키가 들어가면 된다.
    const blocked = (x: number, z: number) =>
      colliders.some((c) => c.max.y > 0.05 && c.min.y < ENEMY.height + 0.1 && x > c.min.x - 0.9 && x < c.max.x + 0.9 && z > c.min.z - 0.9 && z < c.max.z + 0.9);
    const w = area.max.x - area.min.x, d = area.max.z - area.min.z;
    let tries = 0;
    while (this.list.length < count && tries++ < 4000) {
      const x = area.min.x + 1 + rand() * (w - 2);
      const z = area.min.z + 1 + rand() * (d - 2);
      if (blocked(x, z)) continue;
      if (Math.hypot(x - playerPos.x, z - playerPos.z) < ENEMY.spawnFromPlayer) continue;
      if (this.list.some((e) => Math.hypot(e.root.position.x - x, e.root.position.z - z) < ENEMY.spawnApart)) continue;
      const e = new Enemy(this.assets, mulberry32(seed * 977 + this.list.length * 131), this.flashTex);
      e.place(x, z, rand() * Math.PI * 2);
      this.scene.add(e.root);
      this.list.push(e);
    }
    this.refreshHitMeshes();
  }

  refreshHitMeshes() {
    this.hitMeshes = this.list.flatMap((e) => (e.alive ? e.hitBoxes : []));
  }

  update(dt: number, player: Player, playerHead: THREE.Vector3, world: { hitMeshes: THREE.Object3D[]; colliders: THREE.Box3[] }, hooks: EnemyHooks) {
    for (const e of this.list) e.update(dt, player, playerHead, world, hooks);
  }

  get aliveCount() {
    return this.list.filter((e) => e.alive).length;
  }
}
