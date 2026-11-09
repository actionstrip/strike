/** 키보드, 마우스, Pointer Lock 입력. 디버그 훅이 가상 입력을 덮어쓸 수 있다. */
export class Input {
  keys = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  fire = false;
  aim = false;
  locked = false;
  /** 한 번 눌림 이벤트(프레임마다 비운다) */
  pressed = new Set<string>();
  /** 디버그용 가상 입력. null이 아니면 키보드 이동 대신 쓴다. */
  virtualMove: { x: number; z: number; sprint: boolean } | null = null;
  /** 디버그용 가상 앉기. null이 아니면 키 대신 쓴다. */
  virtualCrouch: boolean | null = null;
  /** 모바일 터치 조작(src/touch.ts)이 채운다: 이동 스틱(아날로그), 달리기, 앉기 토글 */
  touchMove: { x: number; z: number } | null = null;
  touchSprint = false;
  touchCrouch = false;

  constructor(private el: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.fire = false; this.aim = false; });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    el.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) this.fire = true;
      if (e.button === 2) this.aim = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.fire = false;
      if (e.button === 2) this.aim = false;
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.el;
      if (!this.locked) { this.fire = false; this.aim = false; }
    });
  }

  requestLock() {
    this.el.requestPointerLock?.();
  }

  /** 로컬 이동 입력(x=오른쪽, z=앞) */
  moveAxis() {
    if (this.virtualMove) return { x: this.virtualMove.x, z: this.virtualMove.z };
    if (this.touchMove) return { x: this.touchMove.x, z: this.touchMove.z };
    let x = 0, z = 0;
    if (this.keys.has('KeyW')) z += 1;
    if (this.keys.has('KeyS')) z -= 1;
    if (this.keys.has('KeyD')) x += 1;
    if (this.keys.has('KeyA')) x -= 1;
    const len = Math.hypot(x, z);
    return len > 0 ? { x: x / len, z: z / len } : { x: 0, z: 0 };
  }

  sprintHeld() {
    if (this.virtualMove) return this.virtualMove.sprint;
    return this.touchSprint || this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
  }

  /** C를 누르고 있는 동안(모바일은 앉기 버튼이 켜져 있는 동안) 앉는다 */
  crouchHeld() {
    return this.keys.has('KeyC') || this.touchCrouch;
  }

  endFrame() {
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.pressed.clear();
  }
}
