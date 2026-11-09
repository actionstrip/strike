import * as THREE from 'three';

/**
 * 성능 옵션: 자동으로 바꾸지 않고, 패널의 토글과 단계 버튼으로 하나씩 켜고 끄며 시험한다.
 * 설정은 localStorage에 저장한다(안티앨리어싱은 렌더러를 만들 때만 정할 수 있어 새로고침 뒤 적용).
 */
export interface PerfState {
  /** 그림자 끄기 */
  noShadows: boolean;
  /** 점광원(총구, 레이저, 포털) 끄기 */
  noLights: boolean;
  /** 렌더 해상도 배율 */
  resScale: 1 | 0.75 | 0.5;
  /** MeshStandard → MeshLambert */
  simpleMat: boolean;
  /** 시야 거리 줄이기(카메라 far, 안개) */
  shortView: boolean;
  /** 먼 적은 몇 프레임에 한 번 갱신 */
  farSkip: boolean;
  /** 미니맵 초당 10번 */
  minimapLow: boolean;
  /** 30fps 제한 */
  cap30: boolean;
  /** 안티앨리어싱 끄기(새로고침 필요) */
  noAA: boolean;
}

export const PERF_DEFAULT: PerfState = {
  noShadows: false, noLights: false, resScale: 1, simpleMat: false, shortView: false,
  farSkip: false, minimapLow: false, cap30: false, noAA: false,
};

/** 단계 프리셋: 0은 원래대로, 단계가 오를수록 앞 단계에 더한다 */
export const PERF_PRESETS: Partial<PerfState>[] = [
  {},
  { noShadows: true, noLights: true },
  { noShadows: true, noLights: true, resScale: 0.75, farSkip: true },
  { noShadows: true, noLights: true, resScale: 0.75, farSkip: true, simpleMat: true, shortView: true, minimapLow: true },
  { noShadows: true, noLights: true, resScale: 0.5, farSkip: true, simpleMat: true, shortView: true, minimapLow: true, cap30: true },
];

const KEY = 'robotfps.perf';

export function loadPerf(): PerfState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...PERF_DEFAULT, ...JSON.parse(raw) };
  } catch { /* 저장소를 못 쓰면 기본값 */ }
  return { ...PERF_DEFAULT };
}

export function savePerf(s: PerfState) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* 저장 못 해도 동작은 한다 */ }
}

/** 단순 재질로 바꾼 쌍(원본 ↔ Lambert). 원본의 발광 세기, 투명도가 매 프레임 바뀌는 것(적 눈, 포털 수정)을 옮겨 준다. */
const pairs: { full: THREE.MeshStandardMaterial; lite: THREE.MeshLambertMaterial }[] = [];
const liteOf = new WeakMap<THREE.Material, THREE.MeshLambertMaterial>();

function toLambert(src: THREE.MeshStandardMaterial) {
  let lite = liteOf.get(src);
  if (lite) return lite;
  lite = new THREE.MeshLambertMaterial({
    name: src.name, color: src.color, map: src.map, emissive: src.emissive, emissiveMap: src.emissiveMap,
    emissiveIntensity: src.emissiveIntensity, normalMap: src.normalMap, aoMap: src.aoMap,
    transparent: src.transparent, opacity: src.opacity, alphaTest: src.alphaTest, alphaMap: src.alphaMap,
    side: src.side, depthWrite: src.depthWrite, depthTest: src.depthTest, vertexColors: src.vertexColors,
    fog: src.fog, toneMapped: src.toneMapped,
  });
  liteOf.set(src, lite);
  pairs.push({ full: src, lite });
  return lite;
}

/** root 아래 메시의 물리 기반 재질을 Lambert로(on) 또는 원래대로(off). 같은 원본은 같은 Lambert를 나눠 쓴다. */
export function simplifyMaterials(root: THREE.Object3D, on: boolean) {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.material) return;
    if (on) {
      if (m.userData.fullMat) return;
      const one = (x: THREE.Material) => ((x as THREE.MeshStandardMaterial).isMeshStandardMaterial ? toLambert(x as THREE.MeshStandardMaterial) : x);
      const next = Array.isArray(m.material) ? m.material.map(one) : one(m.material);
      if (next === m.material) return;
      m.userData.fullMat = m.material;
      m.material = next;
    } else if (m.userData.fullMat) {
      m.material = m.userData.fullMat;
      delete m.userData.fullMat;
    }
  });
}

/** 매 프레임: 원본에서 바뀌는 값을 Lambert에 옮긴다 */
export function syncSimpleMaterials() {
  for (const { full, lite } of pairs) {
    lite.emissiveIntensity = full.emissiveIntensity;
    lite.opacity = full.opacity;
    lite.visible = full.visible;
  }
}

/** 그림자 켜고 끄기: 렌더러, 해, 모든 재질 셰이더 다시 컴파일 */
export function setShadows(renderer: THREE.WebGLRenderer, scene: THREE.Scene, sun: THREE.DirectionalLight, sunCasts: boolean, on: boolean) {
  renderer.shadowMap.enabled = on;
  sun.castShadow = on && sunCasts;
  scene.traverse((o) => {
    const m = (o as THREE.Mesh).material;
    if (!m) return;
    for (const x of Array.isArray(m) ? m : [m]) x.needsUpdate = true;
  });
}

type ToggleKey = Exclude<keyof PerfState, 'resScale'>;
const TOGGLES: { key: ToggleKey; label: string; note: string }[] = [
  { key: 'noShadows', label: '그림자 끄기', note: '그림자 패스와 픽셀마다 그림자 계산을 없앤다' },
  { key: 'noLights', label: '동적 조명 끄기', note: '총구, 레이저, 포털 점광원 3개(밝기 0이어도 늘 계산됨)' },
  { key: 'simpleMat', label: '단순 재질', note: '물리 기반 재질을 Lambert로' },
  { key: 'shortView', label: '시야 거리 줄이기', note: '45m 밖은 안개로 가리고 그리지 않음' },
  { key: 'farSkip', label: '먼 적 갱신 줄이기', note: '20m 밖 적은 3프레임에 한 번(CPU)' },
  { key: 'minimapLow', label: '미니맵 갱신 줄이기', note: '초당 10번만 다시 그림' },
  { key: 'cap30', label: '30fps 제한', note: '고르게, 덜 뜨겁게' },
  { key: 'noAA', label: '안티앨리어싱 끄기', note: '바꾸면 새로고침' },
];

/** 성능 패널: 측정값, 단계 버튼, 토글. 게임은 멈추지 않는다. */
export class PerfPanel {
  el = document.getElementById('perf')!;
  private metrics: HTMLElement;
  private rows = new Map<ToggleKey | 'resScale', HTMLButtonElement>();
  onChange?: (s: PerfState, prev: PerfState) => void;
  onClose?: () => void;

  constructor(public state: PerfState, private aaAtStart: boolean) {
    this.el.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'perf-head';
    head.innerHTML = '<b>성능 옵션</b>';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'perf-close';
    close.textContent = '✕';
    close.addEventListener('click', () => this.onClose?.());
    head.appendChild(close);
    this.metrics = document.createElement('pre');
    this.metrics.className = 'perf-metrics';
    const presets = document.createElement('div');
    presets.className = 'perf-presets';
    presets.innerHTML = '<span>단계</span>';
    PERF_PRESETS.forEach((p, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = i === 0 ? '원래' : String(i);
      b.title = i === 0 ? '모두 끄기' : `${i}단계`;
      b.addEventListener('click', () => this.set({ ...PERF_DEFAULT, ...p, noAA: this.state.noAA }));
      presets.appendChild(b);
    });
    const list = document.createElement('div');
    list.className = 'perf-list';
    const res = this.row('resScale', '해상도', '렌더 픽셀 수(GPU)');
    res.addEventListener('click', () => {
      const next = this.state.resScale === 1 ? 0.75 : this.state.resScale === 0.75 ? 0.5 : 1;
      this.set({ ...this.state, resScale: next });
    });
    list.appendChild(res);
    for (const t of TOGGLES) {
      const b = this.row(t.key, t.label, t.note);
      b.addEventListener('click', () => this.set({ ...this.state, [t.key]: !this.state[t.key] }));
      list.appendChild(b);
    }
    this.el.append(head, this.metrics, presets, list);
    this.refresh();
  }

  private row(key: ToggleKey | 'resScale', label: string, note: string) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'perf-row';
    b.innerHTML = `<span class="l">${label}<small>${note}</small></span><span class="v"></span>`;
    this.rows.set(key, b);
    return b;
  }

  set(next: PerfState) {
    const prev = this.state;
    this.state = next;
    savePerf(next);
    this.refresh();
    this.onChange?.(next, prev);
  }

  private refresh() {
    for (const [key, b] of this.rows) {
      const v = b.querySelector('.v')!;
      if (key === 'resScale') {
        v.textContent = `${Math.round(this.state.resScale * 100)}%`;
        b.classList.toggle('on', this.state.resScale < 1);
      } else {
        const on = this.state[key];
        v.textContent = on ? '켜짐' : '꺼짐';
        b.classList.toggle('on', on);
        if (key === 'noAA' && on !== this.aaAtStart) v.textContent += ' (새로고침)';
      }
    }
  }

  setMetrics(text: string) {
    this.metrics.textContent = text;
  }

  get open() {
    return this.el.classList.contains('show');
  }

  show(on: boolean) {
    this.el.classList.toggle('show', on);
  }
}
