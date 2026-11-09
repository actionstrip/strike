import * as THREE from 'three';
import { MINIMAP } from './config';
import type { Item } from './pickups';

/**
 * 원형 미니맵(화면 오른쪽 위). 플레이어가 가운데, 바라보는 방향이 항상 위다.
 * 벽(충돌 박스)은 처음에 한 장으로 그려 두고, 매 프레임 돌려서 붙인 뒤 탄창, 구급상자, 플레이어를 얹는다.
 * 범위 밖의 아이템은 테두리에 붙여 방향만 알려 준다.
 */
export class Minimap {
  private canvas = document.getElementById('minimap') as HTMLCanvasElement;
  private ctx = this.canvas.getContext('2d')!;
  private bg = document.createElement('canvas');
  /** 미리 그린 벽 그림의 월드 범위 */
  private bgArea = new THREE.Box2();
  private size = 0;
  private dpr = 1;

  /** 맵 충돌 박스로 벽 그림을 만든다(맵을 불러온 뒤 한 번) */
  build(colliders: THREE.Box3[], bounds: THREE.Box3) {
    // 몸 높이를 막는 박스만(world.computeReach와 같은 기준). 바닥과 머리 위 천장은 뺀다.
    const walls = colliders.filter((k) => k.min.y <= 1.7 && k.max.y >= 0.35);
    const area = this.bgArea.makeEmpty();
    for (const k of walls) {
      area.expandByPoint(new THREE.Vector2(k.min.x, k.min.z));
      area.expandByPoint(new THREE.Vector2(k.max.x, k.max.z));
    }
    // 맵 밖 멀리 있는 박스가 그림을 키우지 않게, 싸우는 범위 둘레 6m까지만
    area.intersect(new THREE.Box2(new THREE.Vector2(bounds.min.x - 6, bounds.min.z - 6), new THREE.Vector2(bounds.max.x + 6, bounds.max.z + 6)));
    if (area.isEmpty()) area.set(new THREE.Vector2(bounds.min.x, bounds.min.z), new THREE.Vector2(bounds.max.x, bounds.max.z));
    const ppm = MINIMAP.bakePxPerMeter;
    const w = Math.ceil((area.max.x - area.min.x) * ppm), h = Math.ceil((area.max.y - area.min.y) * ppm);
    this.bg.width = w;
    this.bg.height = h;
    const g = this.bg.getContext('2d')!;
    g.clearRect(0, 0, w, h);
    g.scale(ppm, ppm);
    g.translate(-area.min.x, -area.min.y);
    // 낮은 엄폐물(허리 높이)은 옅게, 벽은 진하게
    // 얇은 벽(백룸은 0.12m)은 미니맵에서 1픽셀도 안 되므로 최소 두께까지 가운데 기준으로 넓힌다
    const t = MINIMAP.minWall;
    for (const k of walls) {
      g.fillStyle = k.max.y < 1.3 ? MINIMAP.lowColor : MINIMAP.wallColor;
      const w = Math.max(k.max.x - k.min.x, t), d = Math.max(k.max.z - k.min.z, t);
      g.fillRect((k.min.x + k.max.x - w) / 2, (k.min.z + k.max.z - d) / 2, w, d);
    }
  }

  private resize() {
    const css = this.canvas.clientWidth;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    if (css === this.size && dpr === this.dpr) return;
    this.size = css;
    this.dpr = dpr;
    this.canvas.width = Math.round(css * dpr);
    this.canvas.height = Math.round(css * dpr);
  }

  private time = 0;
  /** 성능 옵션: 0이면 매 프레임, 아니면 이 간격(초)마다만 다시 그린다 */
  interval = 0;
  private lastDraw = 0;

  update(playerPos: THREE.Vector3, yaw: number, items: Item[], crates: { x: number; z: number; state: 'closed' | 'open' | 'empty' }[] = [], portal?: { x: number; z: number; active: boolean }) {
    const now = performance.now() / 1000;
    if (this.interval > 0 && now - this.lastDraw < this.interval) return;
    this.time += this.interval > 0 ? now - this.lastDraw : 1 / 60;
    this.lastDraw = now;
    this.resize();
    const S = this.size;
    if (!S) return;
    const g = this.ctx;
    const r = S / 2;
    /** 화면 픽셀 / 월드 m */
    const k = r / MINIMAP.radius;
    const cos = Math.cos(yaw), sin = Math.sin(yaw);
    // 월드 (x, z) → 미니맵 픽셀(가운데 기준). 바라보는 방향(-sin, -cos)이 위로 온다.
    const toMap = (x: number, z: number, out: { x: number; y: number }) => {
      const dx = (x - playerPos.x) * k, dz = (z - playerPos.z) * k;
      out.x = cos * dx - sin * dz;
      out.y = sin * dx + cos * dz;
      return out;
    };

    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, S, S);
    g.save();
    g.beginPath();
    g.arc(r, r, r, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = MINIMAP.floorColor;
    g.fillRect(0, 0, S, S);

    // 벽: 플레이어 기준으로 돌린 뒤 미리 그린 그림을 월드 좌표에 맞춰 붙인다
    g.save();
    g.translate(r, r);
    g.rotate(yaw);
    g.scale(k, k);
    g.translate(-playerPos.x, -playerPos.z);
    const a = this.bgArea;
    g.drawImage(this.bg, a.min.x, a.min.y, a.max.x - a.min.x, a.max.y - a.min.y);
    g.restore();

    // 거리 눈금(반경의 절반)
    g.strokeStyle = 'rgba(255,255,255,.12)';
    g.lineWidth = 1;
    g.beginPath();
    g.arc(r, r, r / 2, 0, Math.PI * 2);
    g.stroke();

    // 아이템과 핵컨테이너: 범위 밖이면 테두리에 붙이고 작고 흐리게
    const p = { x: 0, y: 0 };
    const edge = r - 7;
    /** (x, z)를 미니맵에 놓는다. 범위 밖이면 테두리로. 돌려주는 값: 크기 배율 */
    const place = (x: number, z: number, faded = 0.6) => {
      toMap(x, z, p);
      const d = Math.hypot(p.x, p.y);
      const out = d > edge;
      if (out) { p.x *= edge / d; p.y *= edge / d; }
      g.globalAlpha = out ? faded : 1;
      return out ? 0.75 : 1;
    };
    for (const it of items) {
      if (it.taken || it.kind === 'bomb') continue;
      const s = place(it.root.position.x, it.root.position.z);
      if (it.kind === 'medkit') drawMedkit(g, r + p.x, r + p.y, s);
      else drawAmmo(g, r + p.x, r + p.y, s);
    }
    // 미션 표시는 아이템 위에, 범위 밖이어도 또렷하게
    for (const c of crates) {
      const s = place(c.x, c.z, 0.85);
      if (c.state === 'closed') drawCrate(g, r + p.x, r + p.y, s);
      else if (c.state === 'empty') drawEmptyCrate(g, r + p.x, r + p.y, s);
    }
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 6);
    if (portal) {
      const s = place(portal.x, portal.z, portal.active ? 0.95 : 0.6);
      drawPortal(g, r + p.x, r + p.y, s, portal.active, pulse);
    }
    for (const it of items) {
      if (it.taken || it.kind !== 'bomb') continue;
      const s = place(it.root.position.x, it.root.position.z, 0.85);
      drawBomb(g, r + p.x, r + p.y, s, pulse);
    }
    g.globalAlpha = 1;

    // 북쪽(-Z) 표시
    toMap(playerPos.x, playerPos.z - 1, p);
    const nd = Math.hypot(p.x, p.y) || 1;
    const nx = r + (p.x / nd) * (r - 9), ny = r + (p.y / nd) * (r - 9);
    g.font = 'bold 10px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = 'rgba(0,0,0,.6)';
    g.beginPath();
    g.arc(nx, ny, 7, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#ffd36b';
    g.fillText('N', nx, ny + 0.5);

    // 플레이어: 가운데에서 위를 가리키는 화살표
    g.translate(r, r);
    g.fillStyle = '#fff';
    g.strokeStyle = 'rgba(0,0,0,.8)';
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(0, -8);
    g.lineTo(6, 6);
    g.lineTo(0, 3);
    g.lineTo(-6, 6);
    g.closePath();
    g.stroke();
    g.fill();
    g.restore();

    // 테두리
    g.strokeStyle = 'rgba(255,255,255,.35)';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(r, r, r - 1, 0, Math.PI * 2);
    g.stroke();
  }
}

/** 탄창: 금색 세로 막대에 탄 끝 */
function drawAmmo(g: CanvasRenderingContext2D, x: number, y: number, s: number) {
  g.save();
  g.translate(x, y);
  g.scale(s, s);
  g.fillStyle = 'rgba(0,0,0,.7)';
  g.fillRect(-5, -7, 10, 14);
  g.fillStyle = '#ffc34d';
  g.fillRect(-3.5, -3, 7, 8.5);
  g.fillStyle = '#e08a45';
  g.fillRect(-1.5, -6, 3, 3);
  g.restore();
}

/** 닫힌 핵컨테이너: 노란 원에 방사능 표시(가운데 점 + 날개 셋) */
function drawCrate(g: CanvasRenderingContext2D, x: number, y: number, s: number) {
  g.save();
  g.translate(x, y);
  g.scale(s, s);
  g.fillStyle = 'rgba(0,0,0,.75)';
  g.beginPath();
  g.arc(0, 0, 9, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#ffd400';
  g.beginPath();
  g.arc(0, 0, 7.5, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#1a1a1a';
  for (let k = 0; k < 3; k++) {
    const a = -Math.PI / 2 + (k * Math.PI * 2) / 3;
    g.beginPath();
    g.moveTo(0, 0);
    g.arc(0, 0, 6.5, a - 0.5, a + 0.5);
    g.closePath();
    g.fill();
  }
  g.fillStyle = '#ffd400';
  g.beginPath();
  g.arc(0, 0, 2, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#1a1a1a';
  g.beginPath();
  g.arc(0, 0, 1.3, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

/** 포털: 꺼져 있으면 회색 고리, 열리면 청백색 고리가 맥박친다 */
function drawPortal(g: CanvasRenderingContext2D, x: number, y: number, s: number, active: boolean, pulse: number) {
  g.save();
  g.translate(x, y);
  g.scale(s, s);
  if (active) {
    g.fillStyle = `rgba(120,210,255,${0.2 + 0.35 * pulse})`;
    g.beginPath();
    g.arc(0, 0, 11 + 3 * pulse, 0, Math.PI * 2);
    g.fill();
  }
  g.lineWidth = 4;
  g.strokeStyle = 'rgba(0,0,0,.7)';
  g.beginPath();
  g.ellipse(0, 0, 5, 7, 0, 0, Math.PI * 2);
  g.stroke();
  g.lineWidth = 2.2;
  g.strokeStyle = active ? '#bfeaff' : 'rgba(160,170,180,.9)';
  g.stroke();
  if (active) {
    g.fillStyle = 'rgba(60,140,255,.85)';
    g.beginPath();
    g.ellipse(0, 0, 3.6, 5.6, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}

/** 비운 핵컨테이너: 회색 작은 사각형 */
function drawEmptyCrate(g: CanvasRenderingContext2D, x: number, y: number, s: number) {
  g.save();
  g.translate(x, y);
  g.scale(s, s);
  g.fillStyle = 'rgba(0,0,0,.6)';
  g.fillRect(-5, -5, 10, 10);
  g.fillStyle = 'rgba(150,158,168,.85)';
  g.fillRect(-3.5, -3.5, 7, 7);
  g.restore();
}

/** 떠 있는 폭탄: 초록 빛이 깜빡이는 캡슐 */
function drawBomb(g: CanvasRenderingContext2D, x: number, y: number, s: number, pulse: number) {
  g.save();
  g.translate(x, y);
  g.scale(s, s);
  g.fillStyle = `rgba(125,255,106,${0.25 + 0.35 * pulse})`;
  g.beginPath();
  g.arc(0, 0, 10 + 2 * pulse, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = 'rgba(0,0,0,.8)';
  g.fillRect(-5, -8, 10, 16);
  g.fillStyle = '#c8d0d6';
  g.fillRect(-3.5, -6.5, 7, 13);
  g.fillStyle = '#7dff6a';
  g.fillRect(-2, -4, 4, 8);
  g.restore();
}

/** 구급상자: 흰 사각형에 빨간 십자 */
function drawMedkit(g: CanvasRenderingContext2D, x: number, y: number, s: number) {
  g.save();
  g.translate(x, y);
  g.scale(s, s);
  g.fillStyle = 'rgba(0,0,0,.7)';
  g.fillRect(-7, -7, 14, 14);
  g.fillStyle = '#f4f4f0';
  g.fillRect(-5.5, -5.5, 11, 11);
  g.fillStyle = '#e0282a';
  g.fillRect(-1.5, -4, 3, 8);
  g.fillRect(-4, -1.5, 8, 3);
  g.restore();
}
