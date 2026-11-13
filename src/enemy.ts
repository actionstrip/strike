import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Assets } from './assets';
import { ENEMY, ENEMY_STYLES, type EnemyConfig, type EnemyStyle } from './config';
import { MuzzleFlash } from './effects';
import type { Player } from './player';
import { rotateBoneWorld } from './rig';

/**
 * 적 공통 AI(Enemy): 순찰(걷다 서서 두리번거림) -> 발견하면 조준, 공격 -> 체력이 다하면 쓰러져 회색으로 꺼진다.
 * 몸(모델, 애니메이션, 무기)은 종류별 하위 클래스가 맡는다.
 * - GunnerEnemy(이 파일): 사람형 로봇, 오른팔로 총을 겨눠 점사
 * - WalkerEnemy(enemy2.ts): 카메라 몸통 보행 로봇, 렌즈에서 레이저
 */

export type EnemyState = 'walk' | 'look' | 'combat' | 'search' | 'dead';

export type EnemyWeapon = 'bullet' | 'laser';

export interface EnemyHooks {
  /** 적이 한 발 쐈다. from은 총구(렌즈), dir은 퍼짐이 적용된 방향 */
  onFire(e: Enemy, from: THREE.Vector3, dir: THREE.Vector3, kind: EnemyWeapon): void;
  /** 레이저 충전 시작(소리용) */
  onCharge?(e: Enemy, from: THREE.Vector3): void;
  onDeath?(e: Enemy): void;
}

export const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _ray = new THREE.Raycaster();

export function bone(root: THREE.Object3D, name: string) {
  const b = root.getObjectByName(name);
  if (!b) throw new Error('enemy bone missing: ' + name);
  return b as THREE.Bone;
}

/** 각도 차이를 -PI..PI로 */
export function angDiff(a: number, b: number) {
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
export const AREA = new THREE.Box3(new THREE.Vector3(-43, 0, -43), new THREE.Vector3(43, 5, 43));
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
export function patchGrey(mat: THREE.MeshStandardMaterial, u: { uGrey: { value: number } }) {
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
export class LifeBar {
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

export type WorldRefs = { hitMeshes: THREE.Object3D[]; colliders: THREE.Box3[] };

type StyleValues = { -readonly [K in keyof (typeof ENEMY_STYLES)['rifleman']]: (typeof ENEMY_STYLES)['rifleman'][K] };
/** 적 하나의 성향(ENEMY_STYLES 값을 적마다 조금씩 흔든 것) */
export type Persona = StyleValues & { style: EnemyStyle };

export function rollPersona(rand: () => number, style?: EnemyStyle): Persona {
  const names = Object.keys(ENEMY_STYLES) as EnemyStyle[];
  const st = style ?? names[Math.floor(rand() * names.length)];
  const base = ENEMY_STYLES[st];
  const p: Persona = { ...base, style: st };
  const j = () => 0.88 + rand() * 0.24;
  p.aggression = Math.min(1, base.aggression * j());
  p.reaction = base.reaction * j();
  p.range = base.range * j();
  p.dodge = Math.min(0.95, base.dodge * j());
  p.coverChance = Math.min(0.95, base.coverChance * j());
  p.coverMul = base.coverMul * j();
  p.pursuit = base.pursuit * j();
  p.speedMul = base.speedMul * (0.95 + rand() * 0.1);
  return p;
}

/**
 * 전투 중 자리 옮기기 종류. ang은 목표(주인공) 쪽을 0, 반대쪽을 1(×PI)로 본 방향 범위, dist는 이동 거리(m, null이면 cfg.moveDist).
 * 점수 = 무작위 + 옆으로 움직인 정도 × lat + (그 자리에서 주인공 머리가 보이면 vis, 아니면 hide) - 좋아하는 거리와의 차이 × range
 */
export type MoveKind = 'strafe' | 'dodge' | 'cover' | 'push' | 'flank' | 'peek';
const MOVES: Record<MoveKind, { ang: [number, number]; dist: [number, number] | null; lat: number; vis: number; hide: number; range: number }> = {
  strafe: { ang: [0.25, 0.75], dist: null, lat: 0.6, vis: 0.8, hide: -0.3, range: 0.4 },
  dodge: { ang: [0.3, 0.8], dist: null, lat: 0.7, vis: 0.5, hide: 0, range: 0.2 },
  cover: { ang: [0.2, 1.0], dist: [1.2, 4.5], lat: 0.2, vis: 0, hide: 1.5, range: 0.1 },
  push: { ang: [0, 0.3], dist: [2, 5], lat: 0.15, vis: 0.5, hide: 0, range: 0.9 },
  flank: { ang: [0.3, 0.6], dist: [2.5, 5.5], lat: 0.8, vis: 0.3, hide: 0.2, range: 0.5 },
  peek: { ang: [0, 1], dist: [0.7, 2.4], lat: 0, vis: 2, hide: 0, range: 0.3 },
};

/** 적 공통: 상태, 순찰, 시야, 전투 판단. 몸을 움직이는 부분(animate)과 무기(attack)는 하위 클래스가 맡는다. */
export abstract class Enemy {
  abstract readonly kind: 'gunner' | 'walker';
  root = new THREE.Object3D();
  abstract model: THREE.Object3D;
  /** 피격 판정용 보이지 않는 박스 */
  hitBoxes: THREE.Mesh[] = [];
  abstract lifeBar: LifeBar;

  hp: number;
  state: EnemyState = 'look';
  yaw = 0;
  home = new THREE.Vector3();
  waypoint = new THREE.Vector3();
  /** 시야 안에 플레이어가 보이는지(마지막 검사 결과) */
  seesPlayer = false;
  lastSeen = new THREE.Vector3();
  /** 무기 들기(렌즈 켜기) 0..1 */
  raise = 0;
  aimError = Math.PI;
  speed = 0;
  deathT = -1;
  /** 디버그: 순찰/전투 갱신을 멈춘다(자세 시트 캡처용) */
  frozen = false;
  /** 무기가 겨누는 월드 지점 */
  aimPoint = new THREE.Vector3();

  protected stateT = 0;
  protected lookT = 0;
  /** 머리(몸통)가 몸 정면 기준으로 돌아간 각, 목표, 각속도 */
  protected headYaw = 0;
  protected headTarget = 0;
  protected headVel = 0;
  /** 상체 비틀림(골반 기준), 목표 */
  protected twist = 0;
  protected twistTarget = 0;
  /** 다음 시선 목표로 넘어가기까지 남은 시간 */
  protected glanceT = 0;
  protected glanceSide = 1;
  /** 이번 프레임 몸 회전 속도(rad/s): 제자리 돌 때 발을 떼게 한다 */
  protected turnRate = 0;
  /** 전투 중 몸을 다시 정렬하는 중인지 */
  protected realign = false;
  protected sightT: number;
  protected searchT = 0;
  protected fireT = 0;
  protected flinch = 0;
  protected hitFlash = 0;
  protected greyU = { uGrey: { value: 0 } };
  protected rand: () => number;
  /** 마지막 갱신 때 받은 이동 충돌 박스(쓰러질 방향 고르기 등) */
  protected colliders: THREE.Box3[] = [];
  /** 전투 중 행동: 서서 쏘기 / 자리 옮기기(피하기 포함) */
  tactic: 'hold' | 'move' = 'hold';
  protected moveTo = new THREE.Vector3();
  protected moveSpeed = 0;
  protected moveT = 0;
  /** 자리를 옮기기 전까지 남은 공격(점사/레이저) 수 */
  protected volleys = 1;
  protected dodgeCd = 0;
  protected dodgePending = false;
  /** 엄폐물 뒤에서 기다리는 남은 시간 */
  protected coverT = 0;
  /** 수색하러 걸어간 시간(너무 오래 걸리면 멈춘다) */
  protected searchMoveT = 0;
  /** 이번에 전투를 시작했다: Enemies가 근처 동료에게 알리고 지운다 */
  alertOthers = false;
  /** 성향(돌격형, 소총수, 우회형, 신중형) */
  persona: Persona;
  /** 지금 하는 자리 옮기기 종류 */
  moveKind: MoveKind = 'strafe';
  /** 맞았거나 인기척을 느꼈다: 이 시간 동안은 서서 그쪽으로 몸을 돌린다 */
  protected threatT = 0;
  /** 놓친 주인공을 쫓아가 다시 찾는 남은 시간 */
  protected pursuitT = 0;
  /** 쫓을 자리를 못 찾았을 때 다시 찾기까지 */
  protected approachCd = 0;
  /** 마지막으로 봤을 때 주인공 속도(놓친 뒤 어디로 갔을지 짐작) */
  protected lastVel = new THREE.Vector3();

  constructor(readonly cfg: EnemyConfig, rand: () => number) {
    this.rand = rand;
    this.hp = cfg.health;
    this.sightT = Math.random() * cfg.sightInterval;
    this.persona = rollPersona(rand);
  }

  /** 이동하며 쏘면 퍼짐이 커진다 */
  protected spreadMul() {
    return this.tactic === 'move' ? this.cfg.moveSpread : 1;
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
    this.tactic = 'hold';
    this.lookT = 0.5 + this.rand() * 2;
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
    // 맞으면 쏜 쪽을 안다: 곧바로 그쪽으로 돌아서고(시야 검사도 바로), 보이면 쏜다
    const P = this.persona;
    this.lastSeen.copy(fromPos);
    this.threatT = Math.max(this.threatT, 0.9);
    this.sightT = 0;
    this.pursuitT = Math.max(this.pursuitT, P.pursuit);
    if (this.state !== 'combat') this.engage(P.reaction * 1.4);
    this.searchT = this.cfg.searchTime;
    // 피하거나(성향, 체력이 낮으면 거의 항상) 그 자리에서 돌아서 맞서 쏜다. 연달아 맞으면 쿨다운이 지난 뒤 다시 고른다.
    if (this.dodgeCd <= 0 && !this.frozen) {
      if (this.rand() < (this.hp <= 2 ? 0.85 : P.dodge)) {
        this.dodgePending = true;
      } else {
        this.realign = true;
        this.fireT = Math.min(this.fireT, P.reaction);
        this.dodgeCd = this.cfg.dodgeCooldown * 0.5;
      }
    }
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
  update(dt: number, player: Player, playerHead: THREE.Vector3, world: WorldRefs, hooks: EnemyHooks) {
    this.colliders = world.colliders;
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    this.flinch = Math.max(0, this.flinch - dt * 5);
    this.weaponTick(dt, hooks);
    if (this.alive && !this.frozen) this.think(dt, player, playerHead, world, hooks);
    // 조준점: 전투 중이면 플레이어 가슴, 수색 중이면 마지막으로 본 곳, 평소에는 앞쪽 수평
    const aim = this.aimPoint;
    if (this.state === 'search') aim.set(this.lastSeen.x, this.lastSeen.y + 1.3, this.lastSeen.z);
    else if (this.state === 'combat') aim.set(player.pos.x, this.shotY > 0 ? player.pos.y + this.shotY : (player.pos.y + playerHead.y) * 0.5 + 0.2, player.pos.z);
    else this.forward(aim).multiplyScalar(5).add(this.root.position).setY(this.root.position.y + this.idleAimHeight());
    this.animate(dt, aim);
    // 라이프 바: 맞은 직후 흰색으로 반짝인다
    if (this.alive) this.lifeBar.draw(this.hp, this.cfg.health, this.hitFlash);
    this.lifeBar.sprite.visible = this.alive;
  }

  /** 눈(시야 원점) 월드 위치 */
  protected abstract eyePosition(out: THREE.Vector3): THREE.Vector3;
  /** 총구(렌즈) 월드 위치 */
  protected muzzlePosition(out: THREE.Vector3) {
    return this.eyePosition(out);
  }
  /** 총구에서 주인공 몸(가슴~머리)까지 막힘 없이 쏠 수 있는가 */
  protected shotClear(player: Player, playerHead: THREE.Vector3, hitMeshes: THREE.Object3D[]) {
    const from = this.muzzlePosition(new THREE.Vector3());
    for (const y of [(player.pos.y + playerHead.y) * 0.5 + 0.2, playerHead.y - 0.1]) {
      const to = _v2.set(player.pos.x, y, player.pos.z).sub(from);
      const d = to.length();
      _ray.set(from, to.normalize());
      _ray.far = d;
      const hit = _ray.intersectObjects(hitMeshes, false)[0];
      if (!hit || hit.distance > d - 0.3) {
        this.shotY = y - player.pos.y;
        return true;
      }
    }
    return false;
  }
  /** 노리는 높이(주인공 발 기준): 가슴이 엄폐물에 가리면 머리 */
  protected shotY = -1;
  /** 평소(경계) 조준 높이(발 기준 m) */
  protected abstract idleAimHeight(): number;
  /** 클립 + 절차적 자세 */
  protected abstract animate(dt: number, aim: THREE.Vector3): void;
  /** 조준이 맞았을 때 공격 한 번. 다음 공격까지의 시간을 돌려준다. */
  protected abstract attack(player: Player, playerHead: THREE.Vector3, hooks: EnemyHooks): number;
  /** 전투 시작(점사 수 초기화 등) */
  protected onEngage() {}
  /** 매 프레임 무기 상태(섬광, 반동, 충전) */
  protected weaponTick(_dt: number, _hooks: EnemyHooks) {}
  /** 방금 attack()으로 한 번의 공격(점사 끝, 레이저 한 발)이 끝났는가 */
  protected volleyDone() {
    return true;
  }
  /** 무기가 동작 중(점사 중, 충전 중)이라 지금 자리를 옮기면 안 되는가 */
  protected weaponBusy() {
    return false;
  }

  private think(dt: number, player: Player, playerHead: THREE.Vector3, world: WorldRefs, hooks: EnemyHooks) {
    const C = this.cfg;
    const P = this.persona;
    const pos = this.root.position;
    this.dodgeCd = Math.max(0, this.dodgeCd - dt);
    this.threatT = Math.max(0, this.threatT - dt);
    this.approachCd -= dt;
    // 시야 검사(주기적으로)
    this.sightT -= dt;
    if (this.sightT <= 0) {
      this.sightT = C.sightInterval;
      const was = this.seesPlayer;
      this.seesPlayer = this.canSee(playerHead, world.hitMeshes);
      if (this.seesPlayer) {
        this.lastSeen.copy(player.pos);
        this.lastVel.set(player.vel.x, 0, player.vel.z);
        // 수색 중에 다시 보이면 하던 행동(자리 옮기기)을 이어 간다(이동 중에도 쏜다). 처음 발견할 때만 새로 전투를 시작한다.
        if (this.state === 'search') this.state = 'combat';
        else if (this.state !== 'combat') this.engage(P.reaction);
        this.searchT = C.searchTime;
        this.pursuitT = P.pursuit;
        this.coverT = 0;
      } else if (was && this.state === 'combat') {
        // 방금 놓쳤다: 달아나던 쪽으로 조금 앞을 짐작한다(막힌 곳이면 본 곳 그대로)
        const g = _v.copy(this.lastSeen).addScaledVector(this.lastVel, C.predictTime);
        if (inArea(g.x, g.z, 0.5) && !this.blocked(g, this.colliders)) this.lastSeen.copy(g);
      }
    }
    // 맞은 직후: 옆으로(성향에 따라 엄폐물 뒤로) 피한다
    if (this.dodgePending) {
      this.dodgePending = false;
      const cover = this.hp <= 2 || this.rand() < P.coverChance;
      this.planMove(player, playerHead, world, cover ? 'cover' : 'dodge', true);
    }

    if (this.state === 'combat' || this.state === 'search') {
      this.raise = Math.min(1, this.raise + dt / C.raiseTime);
      this.fireT -= dt;
      this.coverT -= dt;
      this.pursuitT -= dt;
      if (!this.seesPlayer && this.state === 'combat') {
        this.state = 'search';
        this.searchMoveT = 0;
      } else if (this.seesPlayer && this.state === 'search') {
        this.state = 'combat';
      }
      // 보이는 동안은 지금 위치, 안 보이면 마지막으로 본(짐작한) 곳을 본다
      const tgt = this.seesPlayer ? player.pos : this.lastSeen;
      const faceTarget = Math.atan2(-(tgt.x - pos.x), -(tgt.z - pos.z));
      const rest = angDiff(faceTarget, this.yaw);

      if (this.tactic === 'move') {
        // 자리 옮기기/피하기/쫓기: 몸은 가는 방향, 상체와 고개는 목표 쪽(한계까지)
        this.moveT -= dt;
        const r = this.stepToward(this.moveTo, this.moveSpeed, C.combatTurnSpeed * 2, dt, world.colliders);
        this.twistTarget = THREE.MathUtils.clamp(rest, -C.twistMax, C.twistMax);
        this.headTarget = THREE.MathUtils.clamp(rest, -C.headMax, C.headMax);
        // 이동하면서도 쏜다(엄폐로 뛰어드는 중이 아니고, 상체를 틀어 겨눌 수 있는 쪽에 보일 때). 퍼짐은 커진다.
        if (this.seesPlayer && P.moveFire && this.moveKind !== 'cover' && this.raise >= 1 && this.fireT <= 0 &&
            Math.abs(rest) < C.twistMax + C.headMax * 0.9 && this.aimError < C.fireAngle * 1.5 &&
            (this.weaponBusy() || this.shotClear(player, playerHead, world.hitMeshes))) {
          this.fireT = this.attack(player, playerHead, hooks);
        }
        if (r || this.moveT <= 0) {
          this.tactic = 'hold';
          this.volleys = this.pickVolleys();
          this.fireT = Math.max(this.fireT, 0.1);
          this.realign = true;
          // 안 보이는 곳에 닿았으면: 엄폐였으면 잠깐 숨어 있고, 아니면 아주 잠깐 살핀 뒤 다음 행동
          if (!this.seesPlayer) {
            this.coverT = this.moveKind === 'cover'
              ? THREE.MathUtils.lerp(C.coverHold[0], C.coverHold[1], this.rand()) * P.coverMul
              : 0.15 + this.rand() * 0.45;
          }
        }
        return;
      }

      if (this.state === 'search') {
        // 맞았거나 인기척을 느꼈으면 우선 그쪽으로 돌아선다. 엄폐 중에도 그쪽을 보고 있는다(보이면 바로 전투).
        if (this.threatT > 0 || this.coverT > 0) {
          this.speed = Math.max(0, this.speed - dt * 5);
          this.turnBody(faceTarget, C.combatTurnSpeed * (this.threatT > 0 ? 1.6 : 0.5), dt);
          this.twistTarget = 0;
          this.headTarget = THREE.MathUtils.clamp(angDiff(faceTarget, this.yaw), -C.headMax, C.headMax);
          this.searchT = Math.max(this.searchT, 1.5);
          return;
        }
        // 놓친 지 얼마 안 됐으면 숨어만 있지 않고 다시 찾아 나선다(성향에 따라 곧장 / 돌아서 / 내다보기)
        if (this.pursuitT > 0 && this.approachCd <= 0) {
          if (this.planApproach(player, playerHead, world)) return;
          this.approachCd = 0.6;
        }
        if (this.pursuitT > 0) this.searchT = Math.max(this.searchT, 1.5);
        this.searchT -= dt;
        // 엄폐물 뒤에서 잠깐 기다렸다가, 마지막으로 본 곳으로 걸어가 확인한다
        const far = _v.subVectors(this.lastSeen, pos).setY(0).length() > 1.5;
        if (this.coverT <= 0 && far && this.searchMoveT < 8) {
          this.searchMoveT += dt;
          if (this.stepToward(this.lastSeen, C.searchSpeed, C.combatTurnSpeed, dt, world.colliders) === 'blocked') this.searchMoveT = 99;
          this.scan(dt, C.headMax * 0.7, 0.4);
          this.twistTarget = 0;
          // 걸어가는 동안은 수색 시간을 아낀다(도착해서 둘러볼 시간)
          this.searchT = Math.max(this.searchT, C.searchTime * 0.6);
        } else {
          // 도착했거나 갈 수 없으면 서서 넓게 둘러본다
          this.speed = Math.max(0, this.speed - dt * 4);
          this.turnRate = 0;
          this.twistTarget = 0;
          this.scan(dt, C.headMax, 0.25);
        }
        if (this.searchT <= 0) {
          // 수색 끝: 이 근처를 새 순찰 구역으로
          this.state = 'look';
          this.home.copy(pos);
          this.lookT = THREE.MathUtils.lerp(C.lookTime[0], C.lookTime[1], this.rand());
          this.stateT = 0;
          this.glanceT = 0.4;
        }
        return;
      }

      // 전투(보임): 서서 겨누고 쏜다. 작은 각은 상체와 무기로, 많이 벗어나면 발을 떼서 몸을 정렬한다.
      this.speed = Math.max(0, this.speed - dt * 5);
      const off = Math.abs(angDiff(faceTarget, this.yaw));
      if (off > C.realignAngle) this.realign = true;
      if (this.realign) {
        // 맞은 직후에는 더 빨리 돌아선다
        const rate = (off > C.twistMax * 0.8 ? C.combatTurnSpeed : C.combatTurnSpeed * 0.6) * (this.threatT > 0 ? 1.6 : 1);
        this.turnBody(faceTarget, rate, dt);
        if (Math.abs(angDiff(faceTarget, this.yaw)) < THREE.MathUtils.degToRad(3)) this.realign = false;
      } else {
        this.turnRate = 0;
      }
      const rest2 = angDiff(faceTarget, this.yaw);
      this.twistTarget = THREE.MathUtils.clamp(rest2, -C.twistMax, C.twistMax);
      this.headTarget = THREE.MathUtils.clamp(rest2, -C.headMax, C.headMax);
      if (this.raise >= 1 && this.aimError < C.fireAngle && this.fireT <= 0) {
        // 눈에는 보여도 총구 앞이 낮은 엄폐물에 막혔으면 쏘지 않고 옆으로 비켜서 쏠 자리를 찾는다
        if (!this.weaponBusy() && !this.shotClear(player, playerHead, world.hitMeshes)) {
          if (this.planMove(player, playerHead, world, 'peek')) return;
          this.fireT = 0.3;
        } else {
          this.fireT = this.attack(player, playerHead, hooks);
          if (this.volleyDone()) this.volleys--;
        }
      }
      // 정해진 만큼 쐈으면(점사/충전이 끝난 뒤) 성향과 거리에 맞게 자리를 옮긴다
      if (this.volleys <= 0 && !this.weaponBusy()) {
        const d = Math.hypot(player.pos.x - pos.x, player.pos.z - pos.z);
        if (!this.planMove(player, playerHead, world, this.combatMoveKind(d))) this.volleys = this.pickVolleys();
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
      this.scan(dt, C.headMax, 0.3);
      this.lookT -= dt;
      if (this.lookT <= 0) this.pickWaypoint(world.colliders);
    } else if (this.state === 'walk') {
      // 걸을 때도 자주 좌우를 본다
      this.scan(dt, THREE.MathUtils.degToRad(45), 0.45);
      this.twistTarget = 0;
      const r = this.stepToward(this.waypoint, C.patrolSpeed * this.persona.speedMul, C.turnSpeed, dt, world.colliders);
      if (r) {
        this.state = 'look';
        this.lookT = r === 'blocked' ? 0.8 + this.rand() : THREE.MathUtils.lerp(C.lookTime[0], C.lookTime[1], this.rand());
        this.stateT = 0;
        this.glanceT = 0.3;
      }
    }
  }

  /** 발견(또는 피격)해서 전투 시작. 동료에게 알릴 표시를 남긴다. */
  private engage(firstShotDelay: number) {
    this.state = 'combat';
    this.tactic = 'hold';
    this.onEngage();
    this.fireT = Math.max(this.fireT, firstShotDelay);
    this.volleys = this.pickVolleys();
    this.pursuitT = this.persona.pursuit;
    this.alertOthers = true;
  }

  /**
   * 소리(총소리, 동료의 경보)를 듣고 그쪽으로 돌아서 수색하러 간다(전투 중이면 무시).
   * pursue: 이 시간만큼은 걸어가 보는 게 아니라 무기를 들고 전투하듯 다가간다(동료 경보 등).
   * 이미 수색 중이면 하던 이동은 끊지 않고 목표만 바꾼다.
   */
  hear(at: THREE.Vector3, pursue = 0) {
    if (!this.alive || this.state === 'combat' || this.frozen) return;
    this.lastSeen.copy(at);
    this.threatT = Math.max(this.threatT, 0.5);
    if (pursue > 0) this.pursuitT = Math.max(this.pursuitT, pursue);
    if (this.state === 'search') {
      this.searchT = Math.max(this.searchT, this.cfg.searchTime);
      return;
    }
    this.state = 'search';
    this.tactic = 'hold';
    this.searchT = this.cfg.searchTime;
    this.searchMoveT = 0;
    this.coverT = 0;
    this.volleys = this.pickVolleys();
    this.fireT = Math.max(this.fireT, this.persona.reaction);
  }

  /**
   * 인기척(아주 가까이서 움직임): 안 보여도 그 자리를 알고 바로 돌아선다. 시야 검사도 곧바로 한다.
   * 이미 보고 있으면 무시.
   */
  sense(at: THREE.Vector3) {
    if (!this.alive || this.frozen || this.seesPlayer) return;
    this.sightT = Math.min(this.sightT, 0.05);
    if (this.state === 'combat' || this.state === 'search') {
      this.lastSeen.copy(at);
      // 이미 그쪽을 보고 있는데 안 보이면(벽 너머) 서서 돌아보지 않고 찾으러 간다
      const pos = this.root.position;
      const want = Math.atan2(-(at.x - pos.x), -(at.z - pos.z));
      if (Math.abs(angDiff(want, this.yaw + this.headYaw)) > this.cfg.fov * 0.35) this.threatT = Math.max(this.threatT, 0.8);
      else this.pursuitT = Math.max(this.pursuitT, 3);
      this.searchT = Math.max(this.searchT, this.cfg.searchTime * 0.6);
      return;
    }
    this.hear(at, this.persona.pursuit * 0.5);
    this.threatT = 1.0;
  }

  /** 쏜 뒤 어떻게 자리를 옮길지: 성향, 거리, 체력으로 고른다 */
  private combatMoveKind(dist: number): MoveKind {
    const P = this.persona;
    const r = this.rand();
    if (this.hp <= 2 && P.coverChance > 0.4 && r < 0.6) return 'cover';
    if (dist > P.range * 1.25 && r < 0.3 + 0.6 * P.aggression) return 'push';
    if (dist < P.range * 0.5) return 'strafe';
    const r2 = this.rand();
    if (r2 < P.flank * 0.6) return 'flank';
    if (r2 < P.flank * 0.6 + P.recover) return 'cover';
    return 'strafe';
  }

  /** 놓친 주인공을 찾아 나선다: 성향 비중대로 곧장/돌아서/내다보기 중 하나, 안 되면 곧장 */
  private planApproach(player: Player, playerHead: THREE.Vector3, world: WorldRefs) {
    const P = this.persona;
    const pos = this.root.position;
    if (Math.hypot(this.lastSeen.x - pos.x, this.lastSeen.z - pos.z) < 2.2) {
      // 거의 다 왔다: 이제부터는 서서 둘러보며 수색
      this.pursuitT = 0;
      return false;
    }
    const r = this.rand() * (P.push + P.flank + P.peek);
    const kind: MoveKind = r < P.push ? 'push' : r < P.push + P.flank ? 'flank' : 'peek';
    if (this.planMove(player, playerHead, world, kind)) return true;
    return kind !== 'push' && this.planMove(player, playerHead, world, 'push');
  }

  private pickVolleys() {
    const [a, b] = this.cfg.volleysBeforeMove;
    return a + Math.floor(this.rand() * (b - a + 1));
  }

  /**
   * 전투 중 옮길 자리를 고른다(MOVES의 종류별 방향, 거리, 점수). 목표는 보이면 주인공, 안 보이면 마지막으로 본(짐작한) 곳.
   * 좋아하는 교전 거리(persona.range)에 가까운 자리일수록 점수가 높다. 갈 곳이 없으면 false.
   */
  private planMove(player: Player, playerHead: THREE.Vector3, world: WorldRefs, kind: MoveKind, dodge = false) {
    const C = this.cfg;
    const P = this.persona;
    const M = MOVES[kind];
    const pos = this.root.position;
    const tgt = this.seesPlayer ? player.pos : this.lastSeen;
    const head = new THREE.Vector3(tgt.x, tgt.y + (playerHead.y - player.pos.y), tgt.z);
    const base = Math.atan2(tgt.x - pos.x, tgt.z - pos.z);
    const dist = Math.hypot(tgt.x - pos.x, tgt.z - pos.z);
    const [d0, d1] = M.dist ?? C.moveDist;
    let best: THREE.Vector3 | null = null;
    let bestScore = -Infinity;
    for (let i = 0; i < 14; i++) {
      const side = this.rand() < 0.5 ? -1 : 1;
      const ang = base + side * Math.PI * THREE.MathUtils.lerp(M.ang[0], M.ang[1], this.rand());
      let r = THREE.MathUtils.lerp(d0, d1, this.rand()) * (dodge ? 1.1 : 1);
      // 다가갈 때는 목표 바로 앞(1.5m)까지만
      if (kind === 'push') r = Math.min(r, dist - 1.5);
      if (r < 0.6) continue;
      const p = new THREE.Vector3(pos.x + Math.sin(ang) * r, 0, pos.z + Math.cos(ang) * r);
      if (!inArea(p.x, p.z, 0.8) || !this.pathClear(pos, p, world.colliders)) continue;
      // 그 자리에서 목표 머리가 보이는가
      const eye = _v3.set(p.x, C.height * 0.85, p.z);
      const to = _v2.subVectors(head, eye);
      const d = to.length();
      _ray.set(eye, to.normalize());
      _ray.far = d;
      const hit = _ray.intersectObjects(world.hitMeshes, false)[0];
      const visible = !hit || hit.distance > d - 0.3;
      // 내다보기는 보이는 자리여야 한다
      if (kind === 'peek' && !visible) continue;
      const lateral = Math.abs(Math.sin(ang - base));
      const nd = Math.hypot(tgt.x - p.x, tgt.z - p.z);
      const score = this.rand() * 0.3 + lateral * M.lat + (visible ? M.vis : M.hide) - Math.min(1.5, Math.abs(nd - P.range) / P.range) * M.range;
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
    if (!best) return false;
    this.moveTo.copy(best);
    this.tactic = 'move';
    this.moveKind = kind;
    const fast = kind === 'push' || kind === 'flank' ? 1 + 0.25 * P.aggression : kind === 'peek' ? 0.85 : 1;
    this.moveSpeed = (dodge ? C.dodgeSpeed : C.combatSpeed * fast) * P.speedMul;
    this.moveT = pos.distanceTo(best) / this.moveSpeed + 1.2;
    this.realign = false;
    this.coverT = 0;
    if (dodge) this.dodgeCd = C.dodgeCooldown;
    return true;
  }

  /**
   * 목표 지점으로 한 걸음: 몸을 그쪽으로 돌리고(정렬될수록 빨라짐) 막히면 멈춘다.
   * 도착하면 'arrived', 막히면 'blocked', 가는 중이면 null.
   */
  private stepToward(target: THREE.Vector3, speed: number, turnSpeed: number, dt: number, colliders: THREE.Box3[]): 'arrived' | 'blocked' | null {
    const pos = this.root.position;
    const to = _v2.subVectors(target, pos).setY(0);
    const dist = to.length();
    if (dist < 0.35) return 'arrived';
    const want = Math.atan2(-to.x, -to.z);
    this.turnBody(want, turnSpeed, dt);
    const align = Math.max(0, Math.cos(angDiff(want, this.yaw)));
    const goal = speed * THREE.MathUtils.smoothstep(align, 0.7, 1) * Math.min(1, dist / 0.6 + 0.3);
    this.speed += (goal - this.speed) * (1 - Math.exp(-8 * dt));
    const next = _v3.copy(pos).add(this.forward(_v).multiplyScalar(this.speed * dt));
    if (this.blocked(next, colliders)) {
      this.speed = 0;
      return 'blocked';
    }
    pos.copy(next);
    return null;
  }

  /** 몸(다리) 방향을 돌리고, 회전 속도를 기록한다(제자리 발걸음용) */
  protected turnBody(want: number, rate: number, dt: number) {
    const before = this.yaw;
    this.yaw = turnToward(this.yaw, want, rate * dt);
    this.turnRate = dt > 0 ? Math.abs(angDiff(this.yaw, before)) / dt : 0;
  }

  /** 고개(몸통) 스프링: 사람처럼 가속/감속(목표가 바뀌어도 순간이동하지 않는다) */
  protected springHead(dt: number) {
    const k = this.cfg.headSpring;
    this.headVel += (k * k * (this.headTarget - this.headYaw) - 2 * k * this.headVel) * dt;
    this.headYaw += this.headVel * dt;
    this.twist += (this.twistTarget - this.twist) * (1 - Math.exp(-8 * dt));
  }

  /**
   * 사람처럼 둘러보기: 한쪽을 보고 잠깐 멈췄다가 반대쪽, 가끔 정면.
   * max: 좌우 최대 각, centerChance: 다음 시선이 정면일 확률
   */
  private scan(dt: number, max: number, centerChance: number) {
    // 머리가 목표에 거의 닿은 뒤부터 멈춤 시간을 센다
    if (Math.abs(this.headTarget - this.headYaw) < 0.06) this.glanceT -= dt;
    if (this.glanceT > 0) return;
    this.glanceT = THREE.MathUtils.lerp(this.cfg.glanceHold[0], this.cfg.glanceHold[1], this.rand());
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
      const r = 2.5 + this.rand() * (this.cfg.patrolRadius - 2.5);
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
    const r = this.cfg.radius;
    if (!inArea(p.x, p.z, r)) return true;
    for (const c of colliders) {
      if (c.max.y < 0.05 || c.min.y > this.cfg.height) continue;
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

  /** 눈에서 플레이어 머리까지: 시야각, 거리, 가림 */
  canSee(playerHead: THREE.Vector3, hitMeshes: THREE.Object3D[]) {
    const head = this.eyePosition(_v);
    const to = _v2.subVectors(playerHead, head);
    const dist = to.length();
    if (dist > this.cfg.sightRange) return false;
    const lookYaw = this.yaw + this.headYaw;
    const fwd = _v3.set(-Math.sin(lookYaw), 0, -Math.cos(lookYaw));
    const flat = Math.hypot(to.x, to.z) || 1e-6;
    const cos = (to.x * fwd.x + to.z * fwd.z) / flat;
    if (cos < Math.cos(this.cfg.fov / 2)) return false;
    _ray.set(head, to.normalize());
    _ray.far = dist;
    const hit = _ray.intersectObjects(hitMeshes, false)[0];
    return !hit || hit.distance > dist - 0.3;
  }

  /** 목표 방향에 원뿔 퍼짐을 넣는다 */
  protected spreadDir(dir: THREE.Vector3, spread: number) {
    const r = Math.sqrt(this.rand()) * spread;
    const a = this.rand() * Math.PI * 2;
    const side = _v.crossVectors(dir, UP).normalize();
    const up = _v2.crossVectors(side, dir).normalize();
    return dir.addScaledVector(side, Math.cos(a) * Math.tan(r)).addScaledVector(up, Math.sin(a) * Math.tan(r)).normalize();
  }
}

/**
 * 첫 번째 적: 사람형 로봇. 오른팔로 총을 겨눠 점사한다.
 * 모델(enemy_robot.glb)은 로컬 +X를 정면으로 본다. 그래서 model.rotation.y = PI/2로 -Z가 정면이 되게 놓는다.
 * 오른팔(ArmR~HandR)은 코드가 직접 조준하고, 나머지는 클립(Walk/Idle/Death)이 움직인다.
 */
export class GunnerEnemy extends Enemy {
  readonly kind = 'gunner';
  model: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  actions: Record<string, THREE.AnimationAction> = {};
  gun: THREE.Object3D;
  muzzle: THREE.Object3D;
  flash: MuzzleFlash;
  lifeBar: LifeBar;

  private bones: Record<string, THREE.Bone> = {};
  private phase = 0;
  private idleT = Math.random() * 2;
  /** 걷기 클립 비중(부드럽게 오르내림) */
  private stepW = 0;
  /**
   * 절차적 회전(두리번, 조준)을 넣기 전의 클립 자세.
   * AnimationMixer는 트랙 값이 지난 프레임과 같으면 뼈에 다시 쓰지 않으므로(걷기 클립의 몸통처럼 고정된 트랙),
   * 매 프레임 이 자세로 되돌려 놓지 않으면 절차적 회전이 계속 쌓여 몸이 빙글빙글 돈다.
   */
  private restQ: [THREE.Bone, THREE.Quaternion][] = [];
  private burstLeft = 0;
  private recoil = 0;
  private eyeMats: THREE.MeshStandardMaterial[] = [];

  constructor(assets: Assets, rand: () => number, flashTex: THREE.Texture) {
    super(ENEMY, rand);
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

  protected eyePosition(out: THREE.Vector3) {
    return this.bones.Head.getWorldPosition(out);
  }

  protected muzzlePosition(out: THREE.Vector3) {
    return this.muzzle.getWorldPosition(out);
  }

  protected idleAimHeight() {
    return 1.2 * ENEMY.size;
  }

  protected onEngage() {
    this.burstLeft = 0;
  }

  protected volleyDone() {
    return this.burstLeft <= 0;
  }

  protected weaponBusy() {
    return this.burstLeft > 0;
  }

  protected weaponTick(dt: number) {
    this.flash.update(dt);
    this.recoil = Math.max(0, this.recoil - dt * 9);
  }

  protected attack(player: Player, playerHead: THREE.Vector3, hooks: EnemyHooks) {
    if (this.burstLeft <= 0) this.burstLeft = ENEMY.burst;
    this.shoot(playerHead, player, hooks);
    this.burstLeft--;
    return this.burstLeft > 0 ? ENEMY.burstInterval : THREE.MathUtils.lerp(ENEMY.burstPause[0], ENEMY.burstPause[1], this.rand());
  }

  private shoot(playerHead: THREE.Vector3, player: Player, hooks: EnemyHooks) {
    const from = this.muzzle.getWorldPosition(new THREE.Vector3());
    // 가슴과 머리 사이를 노린다
    const target = new THREE.Vector3(player.pos.x, this.shotY > 0 ? player.pos.y + this.shotY : (player.pos.y + playerHead.y) * 0.5 + 0.2, player.pos.z);
    const dir = this.spreadDir(target.sub(from).normalize(), ENEMY.spread * this.spreadMul());
    this.flash.fire();
    this.recoil = 1;
    hooks.onFire(this, from, dir, 'bullet');
  }

  /** 클립 블렌딩 + 머리/척추 두리번 + 오른팔 조준 */
  protected animate(dt: number, aimAt: THREE.Vector3) {
    this.root.rotation.y = this.yaw;
    const a = this.actions;
    const dead = this.deathT >= 0;
    if (dead) this.deathT += dt;
    const deathW = dead ? Math.min(1, this.deathT / 0.15) : 0;
    this.springHead(dt);
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
