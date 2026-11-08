import * as THREE from 'three';
import { FOV, WEAPON, WEAPON_POSE } from './config';
import type { Input } from './input';
import type { Player } from './player';

/**
 * 무기 상태 머신과 무기 자세 계산. 1인칭 뷰모델과 3인칭 전신이 같은 결과를 쓴다.
 * 자세는 "어깨 프레임"(양 어깨 중점, 시선 방향) 기준 GripR(총 원점)의 위치와 회전이다.
 */

export type WeaponMode = 'idle' | 'walk' | 'sprint' | 'ads' | 'fire' | 'reload' | 'air';

/** 키 배열 [t, value] 사이를 smoothstep으로 잇는다. */
function track(keys: [number, number][], t: number) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1] = keys[i];
    if (t <= t1) {
      const [t0, v0] = keys[i - 1];
      const u = (t - t0) / (t1 - t0 || 1);
      const s = u * u * (3 - 2 * u);
      return v0 + (v1 - v0) * s;
    }
  }
  return keys[keys.length - 1][1];
}

/** 재장전 타임라인(0..1). 탄창, 왼손, 장전손잡이, 총 기울기 커브. */
export const RELOAD = {
  /** 왼손이 탄창을 잡는 가중치 */
  handToMag: [[0.1, 0], [0.24, 1], [0.72, 1], [0.78, 0]] as [number, number][],
  /** 왼손이 장전손잡이를 잡는 가중치 */
  handToCharger: [[0.74, 0], [0.8, 1], [0.9, 1], [0.97, 0]] as [number, number][],
  /** 탄창 아래 이동(총 로컬 -Y, m) */
  magDown: [[0.26, 0], [0.4, 0.17], [0.5, 0.42], [0.56, 0.5], [0.6, 0.42], [0.68, 0.15], [0.72, 0], [0.735, 0.012], [0.75, 0]] as [number, number][],
  /** 탄창 뒤쪽 이동(몸 쪽, 총 로컬 +Z) */
  magBack: [[0.4, 0], [0.5, 0.12], [0.6, 0.12], [0.7, 0]] as [number, number][],
  /** 장전손잡이 당김(총 로컬 +Z, m) */
  charger: [[0.82, 0], [0.85, 0.07], [0.875, 0.07], [0.89, 0]] as [number, number][],
  /** 총 롤(라디안, +면 오른쪽으로 눕힘) */
  roll: [[0, 0], [0.16, -0.45], [0.7, -0.45], [0.78, 0.3], [0.9, 0.3], [1, 0]] as [number, number][],
  /** 총 피치(+면 총구가 위) */
  pitch: [[0, 0], [0.16, 0.18], [0.7, 0.2], [0.73, 0.12], [0.78, 0.05], [1, 0]] as [number, number][],
  /** 총 위치 오프셋 */
  liftY: [[0, 0], [0.16, 0.04], [0.7, 0.04], [0.72, 0.025], [0.8, 0.03], [1, 0]] as [number, number][],
  shiftX: [[0, 0], [0.16, -0.05], [0.7, -0.05], [0.8, -0.03], [1, 0]] as [number, number][],
  /** 장전손잡이를 당길 때 총이 살짝 앞으로 */
  pushZ: [[0.8, 0], [0.85, -0.02], [0.9, 0], [1, 0]] as [number, number][],
  magOutAt: 0.4,
  magInAt: 0.72,
  chargerAt: 0.85,
};

class Spring {
  x = new THREE.Vector3();
  v = new THREE.Vector3();
  constructor(public k = 220, public damp = 0.55) {}
  update(dt: number) {
    const c = 2 * Math.sqrt(this.k) * this.damp;
    // 반암시적 오일러를 여러 번 나눠서 안정적으로 적분
    const n = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      this.v.addScaledVector(this.x, -this.k * h).multiplyScalar(Math.max(0, 1 - c * h));
      this.x.addScaledVector(this.v, h);
    }
  }
}

export interface WeaponEvents {
  onFire?: () => void;
  onDryFire?: () => void;
  onReloadStage?: (stage: 'start' | 'magOut' | 'magIn' | 'charger' | 'done') => void;
}

const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();

export class Weapon {
  ammo = WEAPON.magSize;
  reserve = WEAPON.reserve;
  /** 0..1, 부드럽게 따라가는 값 */
  ads = 0;
  sprint = 0;
  air = 0;
  /** 재장전 진행도 0..1, 재장전 중이 아니면 -1 */
  reloadT = -1;
  /** 디버그: 재장전 진행도를 고정 */
  reloadHold: number | null = null;
  cooldown = 0;
  shotsFired = 0;
  /** 연사 중인 시간(반동 패턴용) */
  recoilPos = new Spring(260, 0.5);
  recoilRot = new Spring(200, 0.5);
  sway = new THREE.Vector2();
  swayVel = new THREE.Vector2();
  breath = 0;
  /** 이번 프레임 발사 여부(효과용) */
  firedThisFrame = false;
  /** 카메라 반동(보는 방향에 더해지는 순간 킥) */
  camKick = new THREE.Vector2();
  /** 디버그: 강제 상태 */
  forceAds: boolean | null = null;
  forceFire = false;
  private reloadStages = new Set<string>();

  constructor(public events: WeaponEvents = {}) {}

  get reloading() {
    return this.reloadT >= 0;
  }

  /** 현재 대표 상태(HUD와 디버그 표시용) */
  mode(player: Player): WeaponMode {
    if (this.reloading) return 'reload';
    if (!player.grounded) return 'air';
    if (this.cooldown > 0 && this.shotsFired > 0) return 'fire';
    if (this.ads > 0.5) return 'ads';
    if (player.sprinting) return 'sprint';
    return player.horizSpeed > 0.3 ? 'walk' : 'idle';
  }

  wantsAds(input: Input) {
    return this.forceAds ?? input.aim;
  }

  /** 달리기 중 발사나 조준 입력이 들어오면 달리기를 끊는다(플레이어 업데이트 전에 호출). */
  blocksSprint(input: Input) {
    return this.wantsAds(input) || input.fire || this.forceFire;
  }

  startReload() {
    if (this.reloading || this.ammo >= WEAPON.magSize || this.reserve <= 0) return;
    this.reloadT = 0;
    this.reloadStages.clear();
    this.events.onReloadStage?.('start');
  }

  update(dt: number, input: Input, player: Player) {
    this.firedThisFrame = false;
    const wantAds = this.wantsAds(input) && !player.sprinting && !this.reloading;
    this.ads = approach(this.ads, wantAds ? 1 : 0, dt / WEAPON.adsTime);
    this.sprint = damp(this.sprint, player.sprinting ? 1 : 0, 10, dt);
    this.air = damp(this.air, player.grounded ? 0 : 1, 8, dt);

    if (input.pressed.has('KeyR')) this.startReload();
    // 달리기를 시작하면 재장전 취소(CoD 방식). 탄창은 원래대로 돌아간다.
    if (player.sprinting && this.reloading && this.reloadHold === null && this.reloadT < RELOAD.magInAt) {
      this.reloadT = -1;
    }

    if (this.reloading) {
      if (this.reloadHold !== null) this.reloadT = this.reloadHold;
      else this.reloadT += dt / WEAPON.reloadTime;
      const st = (name: 'magOut' | 'magIn' | 'charger', at: number) => {
        if (this.reloadT >= at && !this.reloadStages.has(name)) {
          this.reloadStages.add(name);
          if (this.reloadHold === null) this.events.onReloadStage?.(name);
          if (name === 'magIn' && this.reloadHold === null) {
            const need = WEAPON.magSize - this.ammo;
            const take = Math.min(need, this.reserve);
            this.ammo += take;
            this.reserve -= take;
          }
        }
      };
      st('magOut', RELOAD.magOutAt);
      st('magIn', RELOAD.magInAt);
      st('charger', RELOAD.chargerAt);
      if (this.reloadT >= 1 && this.reloadHold === null) {
        this.reloadT = -1;
        this.events.onReloadStage?.('done');
      }
    }

    this.cooldown -= dt;
    const trigger = input.fire || this.forceFire;
    const canFire = !player.sprinting && player.sprintOut <= 0 && !this.reloading;
    if (trigger && canFire && this.cooldown <= 0) {
      if (this.ammo > 0) {
        this.ammo--;
        this.cooldown = 60 / WEAPON.rpm;
        this.shotsFired++;
        this.firedThisFrame = true;
        const adsK = 1 - this.ads * 0.55;
        this.recoilPos.v.z += WEAPON.recoilKick * 60 * adsK;
        this.recoilPos.v.y += 0.25 * adsK;
        this.recoilRot.v.x += WEAPON.recoilRise * 60 * adsK;
        this.recoilRot.v.y += (Math.random() - 0.5) * 1.2 * adsK;
        this.recoilRot.v.z += (Math.random() - 0.5) * 2.0 * adsK;
        this.camKick.set(WEAPON.camKick * (0.8 + Math.random() * 0.4), (Math.random() - 0.5) * WEAPON.camKick * 0.6);
        this.events.onFire?.();
        if (this.ammo === 0 && this.reserve > 0) setTimeout(() => this.startReload(), 250);
      } else if (input.pressed.has('Mouse0') || this.cooldown < -0.3) {
        this.cooldown = 0.25;
        this.events.onDryFire?.();
        this.startReload();
      }
    }
    if (!trigger) this.shotsFired = 0;

    this.recoilPos.update(dt);
    this.recoilRot.update(dt);

    // 마우스 sway: 반대 방향으로 늦게 따라온다
    const swayK = 1 - this.ads * 0.75;
    const tx = THREE.MathUtils.clamp(-input.mouseDX * 0.0009, -0.06, 0.06) * swayK;
    const ty = THREE.MathUtils.clamp(input.mouseDY * 0.0009, -0.06, 0.06) * swayK;
    this.swayVel.x += (tx - this.sway.x) * 90 * dt - this.swayVel.x * 12 * dt;
    this.swayVel.y += (ty - this.sway.y) * 90 * dt - this.swayVel.y * 12 * dt;
    this.sway.addScaledVector(this.swayVel, dt);
    this.breath += dt;
  }

  /** 눈 FOV(ADS 줌 반영) */
  worldFov() {
    return THREE.MathUtils.lerp(FOV.world, FOV.worldAds, this.ads);
  }
  viewmodelFov() {
    return THREE.MathUtils.lerp(FOV.viewmodel, FOV.viewmodelAds, this.ads);
  }

  /**
   * 어깨 프레임 기준 총(GripR) 자세를 계산한다.
   * eye: 어깨 프레임 기준 눈 위치, aimPoint: 총 로컬 AimPoint 위치.
   * bob: 걸음 흔들림을 더할지(3인칭은 몸이 이미 흔들리므로 작게).
   */
  pose(player: Player, view: 'fp' | 'tp', eye: THREE.Vector3, aimPoint: THREE.Vector3, bobScale: number, outPos: THREE.Vector3, outQuat: THREE.Quaternion) {
    const P = WEAPON_POSE;
    const ads = easeInOut(this.ads);
    // ADS 자세: AimPoint가 눈 앞 adsEyeDistance에 오도록
    const adsPos = new THREE.Vector3(eye.x, eye.y, eye.z - P.adsEyeDistance[view]).sub(aimPoint);
    outPos.copy(P.hip.pos).lerp(adsPos, ads);
    outQuat.setFromEuler(P.hip.rot).slerp(_q.identity(), ads);
    const spr = this.sprint * (1 - ads);
    outPos.lerp(P.sprint.pos, spr);
    outQuat.slerp(_q2.setFromEuler(P.sprint.rot), spr);
    outPos.addScaledVector(P.viewOffset[view], 1 - ads);

    // 걸음 bob(8자)
    const speed = player.grounded ? Math.min(player.horizSpeed / 6.2, 1) : 0;
    const ph = player.gaitPhase * Math.PI * 2;
    const bobAmp = (0.012 + 0.02 * this.sprint) * speed * (1 - ads * 0.85) * bobScale;
    const bx = Math.sin(ph) * bobAmp;
    const by = Math.cos(ph * 2) * bobAmp * 0.6;
    // 숨쉬기
    const br = (1 - ads * 0.8) * 0.003;
    const bry = Math.sin(this.breath * 1.6) * br;

    // 재장전
    const t = this.reloadT;
    let rRoll = 0, rPitch = 0, rY = 0, rX = 0, rZ = 0;
    if (t >= 0) {
      rRoll = track(RELOAD.roll, t);
      rPitch = track(RELOAD.pitch, t);
      rY = track(RELOAD.liftY, t);
      rX = track(RELOAD.shiftX, t);
      rZ = track(RELOAD.pushZ, t);
    }
    // 점프/착지
    const airY = this.air * 0.02 - player.landImpulse * 0.03;

    outPos.x += bx + this.sway.x * 0.4 + rX;
    outPos.y += by + bry + this.sway.y * 0.4 + rY + airY + this.recoilPos.x.y * 0.01;
    outPos.z += this.recoilPos.x.z * 0.01 + rZ;

    _e.set(
      rPitch + this.recoilRot.x.x * 0.01 + this.sway.y * 1.2 + by * 2,
      this.sway.x * 1.5 + this.recoilRot.x.y * 0.01,
      rRoll + Math.sin(ph) * bobAmp * 2 + this.sway.x * 2 + this.recoilRot.x.z * 0.01,
      'XYZ',
    );
    outQuat.multiply(_q.setFromEuler(_e));
  }

  /** 총 로컬 탄창 오프셋 */
  magOffset(out: THREE.Vector3) {
    const t = this.reloadT;
    if (t < 0) return out.set(0, 0, 0);
    return out.set(0, -track(RELOAD.magDown, t), track(RELOAD.magBack, t));
  }

  /** 탄창이 손에 들려 몸 쪽으로 빠져 있는 동안은 숨겨서 "새 탄창"처럼 보이게 한다 */
  magHidden() {
    const t = this.reloadT;
    return t >= 0.52 && t <= 0.58;
  }

  chargerOffset() {
    return this.reloadT < 0 ? 0 : track(RELOAD.charger, this.reloadT);
  }

  /** 왼손 목표 가중치 */
  leftHandWeights() {
    const t = this.reloadT;
    if (t < 0) return { mag: 0, charger: 0 };
    return { mag: track(RELOAD.handToMag, t), charger: track(RELOAD.handToCharger, t) };
  }

  /** 탄 퍼짐(라디안) */
  spread(player: Player) {
    const move = Math.min(player.horizSpeed / 6, 1);
    const base = THREE.MathUtils.lerp(WEAPON.spreadHip, WEAPON.spreadAds, this.ads);
    return base + move * WEAPON.spreadMove * (1 - this.ads * 0.8) + (player.grounded ? 0 : 0.04);
  }
}

function approach(v: number, target: number, step: number) {
  return v < target ? Math.min(target, v + step) : Math.max(target, v - step);
}
function damp(v: number, target: number, k: number, dt: number) {
  return v + (target - v) * (1 - Math.exp(-k * dt));
}
function easeInOut(t: number) {
  return t * t * (3 - 2 * t);
}
