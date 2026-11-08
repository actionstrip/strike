import * as THREE from 'three';
import { WEAPON } from './config';
import type { Weapon } from './weapon';

export class Hud {
  private cross = document.getElementById('crosshair')!;
  private arms = Array.from(this.cross.querySelectorAll('i')) as HTMLElement[];
  private hit = document.getElementById('hitmarker')!;
  private ammo = document.getElementById('ammo')!;
  private mag = document.getElementById('ammo-mag')!;
  private res = document.getElementById('ammo-res')!;
  private hint = document.getElementById('reload-hint')!;
  private label = document.getElementById('view-label')!;
  stats = document.getElementById('stats')!;
  private dmg = document.getElementById('damage')!;
  private dmgDir = document.getElementById('dmg-dir')!;
  private hitT = 0;
  private killT = 0;
  private dmgT = 0;
  /** 마지막으로 맞은 방향(월드 yaw) */
  private dmgYaw = 0;

  showHit() {
    this.hitT = 0.15;
  }

  showKill() {
    this.killT = 0.35;
  }

  /** 적 총알에 맞음: 화면 가장자리를 붉게, 쏜 방향을 표시 */
  showDamage(from: THREE.Vector3, playerPos: THREE.Vector3, _yaw: number) {
    this.dmgT = 0.6;
    this.dmgYaw = Math.atan2(-(from.x - playerPos.x), -(from.z - playerPos.z));
  }

  update(dt: number, w: Weapon, spreadRad: number, fov: number, view: 'fp' | 'tp', sprinting: boolean, yaw = 0) {
    // 크로스헤어 벌어짐: 퍼짐 각을 화면 픽셀로
    const px = (Math.tan(spreadRad) / Math.tan((fov * Math.PI) / 360)) * (innerHeight / 2) + 4;
    const [t, b, l, r] = this.arms;
    t.style.top = `${-px - 9}px`;
    b.style.top = `${px}px`;
    l.style.left = `${-px - 9}px`;
    r.style.left = `${px}px`;
    const hide = w.ads > 0.6 && view === 'fp' ? 1 : 0;
    this.cross.style.opacity = String(sprinting ? 0 : 1 - hide);

    this.hitT -= dt;
    this.killT -= dt;
    this.hit.style.opacity = String(Math.max(0, this.hitT / 0.15, this.killT / 0.35));
    this.hit.classList.toggle('kill', this.killT > 0);
    this.dmgT -= dt;
    const d = Math.max(0, this.dmgT / 0.6);
    this.dmg.style.opacity = String(d * 0.85);
    this.dmgDir.style.opacity = String(d);
    // 쏜 방향: 화면 위가 정면, 시계 방향이 오른쪽
    const rel = yaw - this.dmgYaw;
    this.dmgDir.style.transform = `translate(-50%, -50%) rotate(${rel}rad)`;

    this.mag.textContent = String(w.ammo);
    this.res.textContent = `/ ${w.reserve}`;
    this.ammo.classList.toggle('low', w.ammo <= WEAPON.magSize * 0.25);
    const needReload = !w.reloading && w.ammo <= WEAPON.magSize * 0.25 && w.reserve > 0;
    this.hint.style.display = w.reloading || needReload ? 'block' : 'none';
    this.hint.textContent = w.reloading ? '재장전 중...' : 'R 재장전';
    this.label.textContent = view === 'fp' ? '1인칭 [V]' : '3인칭 [V]';
  }
}
