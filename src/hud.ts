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
  private hitT = 0;

  showHit() {
    this.hitT = 0.15;
  }

  update(dt: number, w: Weapon, spreadRad: number, fov: number, view: 'fp' | 'tp', sprinting: boolean) {
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
    this.hit.style.opacity = String(Math.max(0, this.hitT / 0.15));

    this.mag.textContent = String(w.ammo);
    this.res.textContent = `/ ${w.reserve}`;
    this.ammo.classList.toggle('low', w.ammo <= WEAPON.magSize * 0.25);
    const needReload = !w.reloading && w.ammo <= WEAPON.magSize * 0.25 && w.reserve > 0;
    this.hint.style.display = w.reloading || needReload ? 'block' : 'none';
    this.hint.textContent = w.reloading ? '재장전 중...' : 'R 재장전';
    this.label.textContent = view === 'fp' ? '1인칭 [V]' : '3인칭 [V]';
  }
}
