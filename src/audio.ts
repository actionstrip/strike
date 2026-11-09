/** 외부 파일 없이 WebAudio로 만든 임시 효과음. 나중에 실제 사운드로 교체한다. */
export class Sfx {
  private ctx: AudioContext | null = null;
  private noise: AudioBuffer | null = null;
  private master: GainNode | null = null;

  /** 사용자 입력 뒤에 호출해야 한다 */
  unlock() {
    if (this.ctx) { void this.ctx.resume(); return; }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(ctx.destination);
    const len = ctx.sampleRate * 0.5;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  private burst(opts: { gain: number; decay: number; freq: number; q?: number; type?: BiquadFilterType; delay?: number }) {
    const ctx = this.ctx;
    if (!ctx || !this.noise || !this.master) return;
    const t = ctx.currentTime + (opts.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = opts.type ?? 'lowpass';
    f.frequency.value = opts.freq;
    f.Q.value = opts.q ?? 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(opts.gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + opts.decay);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.2);
    src.stop(t + opts.decay + 0.02);
  }

  private thump(freq: number, gain: number, decay: number) {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * 0.4, t + decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + decay);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + decay + 0.02);
  }

  shot() {
    this.burst({ gain: 0.9, decay: 0.14, freq: 3200 });
    this.burst({ gain: 0.4, decay: 0.35, freq: 700 });
    this.thump(140, 0.7, 0.12);
  }
  /** 적 총소리: 거리에 따라 작고 둔해진다 */
  enemyShot(dist: number) {
    const k = Math.max(0.08, 1 / (1 + dist * 0.12));
    this.burst({ gain: 0.7 * k, decay: 0.12, freq: 2600 * (0.4 + 0.6 * k) });
    this.thump(170, 0.45 * k, 0.1);
  }
  /** 레이저 충전: 낮은 음에서 높은 음으로 올라가는 윙 소리 */
  laserCharge(dist: number) {
    const k = Math.max(0.08, 1 / (1 + dist * 0.12));
    this.sweep({ from: 300, to: 1400, dur: 0.55, gain: 0.12 * k, type: 'triangle' });
  }
  /** 레이저 발사: 높은 음이 빠르게 떨어지는 '퓨웅' */
  laser(dist: number) {
    const k = Math.max(0.08, 1 / (1 + dist * 0.12));
    this.sweep({ from: 2200, to: 180, dur: 0.22, gain: 0.35 * k, type: 'sawtooth' });
    this.burst({ gain: 0.25 * k, decay: 0.12, freq: 3500, type: 'bandpass', q: 2 });
  }
  private sweep(o: { from: number; to: number; dur: number; gain: number; type: OscillatorType; delay?: number }) {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime + (o.delay ?? 0);
    const osc = ctx.createOscillator();
    osc.type = o.type;
    osc.frequency.setValueAtTime(o.from, t);
    osc.frequency.exponentialRampToValueAtTime(o.to, t + o.dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.gain, t + Math.min(0.03, o.dur * 0.3));
    g.gain.exponentialRampToValueAtTime(0.001, t + o.dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + o.dur + 0.02);
  }
  /** 내가 맞았을 때 */
  hurt() {
    this.thump(90, 0.6, 0.15);
    this.burst({ gain: 0.25, decay: 0.08, freq: 900 });
  }
  /** 탄창 아이템을 주웠을 때: 철컥 + 짧은 높은 음 */
  pickup() {
    this.click(1.2);
    this.thump(260, 0.3, 0.06);
    this.sweep({ from: 900, to: 1500, dur: 0.12, gain: 0.12, type: 'triangle' });
  }
  /** 구급상자를 주웠을 때: 부드럽게 올라가는 두 음 */
  heal() {
    this.sweep({ from: 520, to: 780, dur: 0.14, gain: 0.14, type: 'sine' });
    this.sweep({ from: 780, to: 1170, dur: 0.18, gain: 0.12, type: 'sine', delay: 0.11 });
  }
  /** 적이 쓰러질 때 */
  enemyDown() {
    this.thump(60, 0.7, 0.4);
    this.burst({ gain: 0.3, decay: 0.3, freq: 600, delay: 0.25 });
  }
  dry() { this.burst({ gain: 0.3, decay: 0.03, freq: 4000, type: 'bandpass', q: 3 }); }
  click(pitch = 1) { this.burst({ gain: 0.45, decay: 0.05, freq: 2500 * pitch, type: 'bandpass', q: 4 }); }
  magOut() { this.click(0.8); this.burst({ gain: 0.2, decay: 0.1, freq: 1200, type: 'bandpass', q: 2, delay: 0.04 }); }
  magIn() { this.click(1.0); this.thump(220, 0.3, 0.06); }
  charger() { this.click(1.3); this.burst({ gain: 0.35, decay: 0.05, freq: 3000, type: 'bandpass', q: 4, delay: 0.09 }); }
  step(run: boolean) { this.burst({ gain: run ? 0.16 : 0.09, decay: 0.07, freq: 500 }); this.thump(90, run ? 0.14 : 0.07, 0.06); }
  hit() { this.burst({ gain: 0.25, decay: 0.05, freq: 5000, type: 'highpass' }); }
}
