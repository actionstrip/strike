import { TOUCH } from './config';
import type { Input } from './input';
import type { Player } from './player';
import type { Weapon } from './weapon';

type ButtonName = 'fire' | 'aim' | 'crouch' | 'jump' | 'reload' | 'view' | 'pause';

/**
 * 모바일 터치 조작. Input의 필드(이동 축, 마우스 이동량, 발사, 조준, 키 눌림)를 채우기만 해서
 * 플레이어와 무기 코드는 PC와 똑같이 돈다.
 * - 왼쪽 영역: 닿은 자리에 생기는 이동 스틱(끝까지 앞으로 밀면 달리기)
 * - 나머지 빈 곳: 끌어서 시선
 * - 발사: 누르는 동안 연사, 누른 채 끌면 시선도 돈다
 * - 조준, 앉기: 탭할 때마다 켜고 끈다
 * Pointer Events로 처리해서 ?mobile=1이면 PC 마우스로도 시험할 수 있다.
 */
export class TouchControls {
  root = document.getElementById('touch')!;
  onPause?: () => void;
  private stickZone: HTMLElement;
  private lookZone: HTMLElement;
  private base: HTMLElement;
  private knob: HTMLElement;
  private buttons = {} as Record<ButtonName, HTMLElement>;
  /** 손가락별 역할 */
  private stickId = -1;
  private lookId = -1;
  private fireId = -1;
  private stickOrigin = { x: 0, y: 0 };
  private last = new Map<number, { x: number; y: number }>();

  constructor(private input: Input) {
    this.root.innerHTML = '';
    this.stickZone = this.el('div', 'zone stick-zone');
    this.lookZone = this.el('div', 'zone look-zone');
    this.base = this.el('div', 'stick-base');
    this.knob = this.el('div', 'stick-knob');
    this.base.appendChild(this.knob);
    const labels: Record<ButtonName, string> = { fire: '발사', aim: '조준', crouch: '앉기', jump: '점프', reload: 'R', view: '1P', pause: 'Ⅱ' };
    for (const name of Object.keys(labels) as ButtonName[]) {
      const b = this.el('button', `tbtn tbtn-${name}`);
      b.textContent = labels[name];
      b.setAttribute('type', 'button');
      this.buttons[name] = b;
    }
    this.root.style.setProperty('--fire', `${TOUCH.fireSize}px`);
    this.root.style.setProperty('--btn', `${TOUCH.buttonSize}px`);
    this.root.style.setProperty('--stick', `${TOUCH.stickRadius * 2}px`);
    this.root.style.setProperty('--stick-area', `${TOUCH.stickArea * 100}%`);
    this.bind();
  }

  private el(tag: string, cls: string) {
    const e = document.createElement(tag);
    e.className = cls;
    this.root.appendChild(e);
    return e;
  }

  /** 시작 전, 쓰러짐/클리어/일시정지 때는 숨기고 입력을 모두 푼다 */
  show(on: boolean) {
    this.root.classList.toggle('on', on);
    if (!on) this.release();
  }

  private release() {
    const i = this.input;
    i.touchMove = null;
    i.touchSprint = false;
    i.fire = false;
    this.stickId = this.lookId = this.fireId = -1;
    this.last.clear();
    this.base.classList.remove('show', 'sprint');
    this.buttons.fire.classList.remove('down');
  }

  private bind() {
    const i = this.input;
    const capture = (e: PointerEvent) => {
      e.preventDefault();
      // 손가락이 영역 밖으로 나가도 계속 받는다(이미 떨어진 포인터 등에서는 실패할 수 있다)
      try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* 무시 */ }
      this.last.set(e.pointerId, { x: e.clientX, y: e.clientY });
    };
    // 이동 스틱: 닿은 자리가 중심
    this.stickZone.addEventListener('pointerdown', (e) => {
      if (this.stickId >= 0) return;
      capture(e);
      this.stickId = e.pointerId;
      this.stickOrigin = { x: e.clientX, y: e.clientY };
      this.base.style.left = `${e.clientX}px`;
      this.base.style.top = `${e.clientY}px`;
      this.base.classList.add('show');
      this.moveStick(e.clientX, e.clientY);
    });
    // 시선
    this.lookZone.addEventListener('pointerdown', (e) => {
      if (this.lookId >= 0) return;
      capture(e);
      this.lookId = e.pointerId;
    });
    // 발사: 누르는 동안 연사, 끌면 시선
    const fire = this.buttons.fire;
    fire.addEventListener('pointerdown', (e) => {
      capture(e);
      this.fireId = e.pointerId;
      i.fire = true;
      i.pressed.add('Mouse0');
      fire.classList.add('down');
    });
    // 탭 버튼
    const tap = (name: ButtonName, fn: () => void) => {
      this.buttons[name].addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        fn();
        const b = this.buttons[name];
        b.classList.add('down');
        setTimeout(() => b.classList.remove('down'), 120);
      });
    };
    tap('aim', () => { i.aim = !i.aim; });
    tap('crouch', () => { i.touchCrouch = !i.touchCrouch; });
    tap('jump', () => i.pressed.add('Space'));
    tap('reload', () => i.pressed.add('KeyR'));
    tap('view', () => i.pressed.add('KeyV'));
    tap('pause', () => this.onPause?.());

    // 움직임과 떼기는 손가락 역할에 따라
    const move = (e: PointerEvent) => {
      const prev = this.last.get(e.pointerId);
      if (!prev) return;
      if (e.pointerId === this.stickId) this.moveStick(e.clientX, e.clientY);
      else if (e.pointerId === this.lookId || e.pointerId === this.fireId) {
        i.mouseDX += (e.clientX - prev.x) * TOUCH.lookSensitivity;
        i.mouseDY += (e.clientY - prev.y) * TOUCH.lookSensitivity;
      }
      this.last.set(e.pointerId, { x: e.clientX, y: e.clientY });
    };
    const up = (e: PointerEvent) => {
      this.last.delete(e.pointerId);
      if (e.pointerId === this.stickId) {
        this.stickId = -1;
        i.touchMove = null;
        i.touchSprint = false;
        this.base.classList.remove('show', 'sprint');
      }
      if (e.pointerId === this.lookId) this.lookId = -1;
      if (e.pointerId === this.fireId) {
        this.fireId = -1;
        i.fire = false;
        fire.classList.remove('down');
      }
    };
    for (const el of [this.stickZone, this.lookZone, fire]) {
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('lostpointercapture', up);
    }
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private moveStick(x: number, y: number) {
    const R = TOUCH.stickRadius;
    let dx = x - this.stickOrigin.x, dy = y - this.stickOrigin.y;
    const len = Math.hypot(dx, dy);
    if (len > R) { dx *= R / len; dy *= R / len; }
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    const mx = dx / R, mz = -dy / R;
    const m = Math.hypot(mx, mz);
    if (m < TOUCH.deadZone) {
      this.input.touchMove = { x: 0, z: 0 };
      this.input.touchSprint = false;
    } else {
      // 데드존 밖을 0..1로 다시 펴서, 살짝 밀면 천천히 걷는다
      const k = (m - TOUCH.deadZone) / (1 - TOUCH.deadZone) / m;
      this.input.touchMove = { x: mx * k, z: mz * k };
      this.input.touchSprint = mz >= TOUCH.sprintAt;
    }
    // 달리기는 앉기 토글을 끈다(PC에서 Shift로 일어서는 것과 같게)
    if (this.input.touchSprint) this.input.touchCrouch = false;
    this.base.classList.toggle('sprint', this.input.touchSprint);
  }

  /** 매 프레임: 버튼 상태 표시, 조준 자동 해제, 재장전 깜빡임 */
  update(weapon: Weapon, player: Player, view: 'fp' | 'tp') {
    const i = this.input;
    // 재장전, 달리기 중에는 조준을 끈다(토글이라 계속 켜져 있지 않게)
    if (i.aim && (weapon.reloading || player.sprinting)) i.aim = false;
    this.buttons.aim.classList.toggle('active', i.aim);
    this.buttons.crouch.classList.toggle('active', player.crouched);
    const low = weapon.ammo <= TOUCH.reloadBlinkAt && !weapon.reloading && weapon.reserve > 0;
    this.buttons.reload.classList.toggle('blink', low);
    this.buttons.reload.classList.toggle('busy', weapon.reloading);
    this.buttons.view.textContent = view === 'fp' ? '1P' : '3P';
  }
}
