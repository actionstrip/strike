// 사막 마을 맵: 배치를 박스로 정의해서 시각 메시(glb)와 이동 충돌 박스(json)를 함께 만든다.
// 텍스처는 "sandyards standoff 2"(frostychaos144, CC BY 4.0)의 아틀라스에서 잘라 쓴다. 배치(구조)는 이 파일에서 새로 짠 것.
//
//   node tools/build-desert.mjs --extract   # 3d/sandyards_standoff_2.glb 에서 텍스처를 잘라 tools/desert_tex/ 에 저장(원본 glb가 있을 때 한 번)
//   node tools/build-desert.mjs             # tools/desert_tex/ -> scratch_build/map_desert_raw.glb + public/models/map_desert_colliders.json
//   node tools/optimize-models.mjs          # -> public/models/map_desert.glb
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const TEX = 'tools/desert_tex';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

// ---------------------------------------------------------------- 텍스처 자르기
// 원본 텍스처 번호: 0 = 건물/창 아틀라스, 1 = 모래 회벽(반복), 2 = 소품 아틀라스(문, 창, 상자), 3 = 바닥/벽 2×2 아틀라스
const TILES = {
  plaster: { src: 1, rect: null, size: 1024 },
  paving: { src: 3, rect: [0, 0, 512, 512], size: 512 },
  concrete: { src: 3, rect: [0, 512, 512, 512], size: 512 },
  stone: { src: 3, rect: [512, 512, 512, 512], size: 512 },
  rust: { src: 2, rect: [4, 124, 100, 498], size: [128, 512] },
  planks: { src: 2, rect: [304, 74, 126, 172], size: 256 },
};
// 데칼 아틀라스: 4×4 칸(각 256²)에 늘려 넣는다. 실제 비율은 [w, h](m)로 붙일 때 맞춘다.
const DECALS = {
  crate: [112, 514, 102, 110],
  crateBand: [112, 210, 176, 106],
  doorBlue: [566, 414, 142, 196],
  doorGreen: [663, 618, 110, 238],
  doorWood: [327, 252, 106, 252],
  doorCarved: [781, 618, 154, 238],
  window: [860, 4, 160, 242],
  windowSmall: [598, 862, 90, 126],
  shutters: [424, 698, 70, 112],
  ac: [502, 634, 56, 36],
  doorPlank: [714, 344, 146, 262],
  grate: [912, 862, 74, 122],
};

async function extract() {
  const doc = await io.read('3d/sandyards_standoff_2.glb');
  const tex = doc.getRoot().listTextures().map((t) => Buffer.from(t.getImage()));
  mkdirSync(TEX, { recursive: true });
  for (const [name, t] of Object.entries(TILES)) {
    let img = sharp(tex[t.src]);
    if (t.rect) img = img.extract({ left: t.rect[0], top: t.rect[1], width: t.rect[2], height: t.rect[3] });
    const [w, h] = Array.isArray(t.size) ? t.size : [t.size, t.size];
    await img.resize(w, h, { fit: 'fill' }).webp({ quality: 92 }).toFile(`${TEX}/${name}.webp`);
  }
  const names = Object.keys(DECALS);
  const parts = [];
  for (let i = 0; i < names.length; i++) {
    const [l, tp, w, h] = DECALS[names[i]];
    const buf = await sharp(tex[2]).extract({ left: l, top: tp, width: w, height: h }).resize(256, 256, { fit: 'fill' }).png().toBuffer();
    parts.push({ input: buf, left: (i % 4) * 256, top: Math.floor(i / 4) * 256 });
  }
  await sharp({ create: { width: 1024, height: 1024, channels: 3, background: '#808080' } }).composite(parts).webp({ quality: 92 }).toFile(`${TEX}/decals.webp`);
  console.log('textures ->', TEX);
}

// ---------------------------------------------------------------- 지오메트리
/** 재질별 버퍼 */
const geo = {};
const boxes = [];
function buf(mat) {
  return (geo[mat] ??= { pos: [], nrm: [], uv: [], idx: [] });
}
/** 바깥에서 볼 때 왼아래, 오른아래, 오른위, 왼위 순서의 사각형 */
function quad(mat, p, n, uv) {
  const b = buf(mat);
  const base = b.pos.length / 3;
  for (let i = 0; i < 4; i++) {
    b.pos.push(...p[i]);
    b.nrm.push(...n);
    b.uv.push(...uv[i]);
  }
  b.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
}
const decalNames = Object.keys(DECALS);
function decalUV(name) {
  const i = decalNames.indexOf(name);
  const pad = 2 / 1024;
  const u0 = (i % 4) / 4 + pad, v0 = Math.floor(i / 4) / 4 + pad, u1 = u0 + 0.25 - 2 * pad, v1 = v0 + 0.25 - 2 * pad;
  // glTF uv: v=0이 이미지 위
  return [[u0, v1], [u1, v1], [u1, v0], [u0, v0]];
}
/**
 * 축 정렬 상자. side/top은 재질 이름, tile은 반복 크기(m). decal을 주면 모든 면에 그 칸을 한 번씩.
 * collide=false면 충돌 박스를 만들지 않는다.
 */
function box(x0, y0, z0, x1, y1, z1, { side, top = side, tile = 2, topTile = tile, decal = null, collide = true, bottom = false } = {}) {
  if (collide) boxes.push([x0, y0, z0, x1, y1, z1]);
  const wuv = (u0, u1, y0_, y1_, t) => [[u0 / t, -y0_ / t], [u1 / t, -y0_ / t], [u1 / t, -y1_ / t], [u0 / t, -y1_ / t]];
  const faces = [
    // +X: 바깥에서 보면 오른쪽이 -Z
    { n: [1, 0, 0], p: [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], u: [-z1, -z0] },
    { n: [-1, 0, 0], p: [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], u: [z0, z1] },
    { n: [0, 0, 1], p: [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], u: [x0, x1] },
    { n: [0, 0, -1], p: [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], u: [-x1, -x0] },
  ];
  for (const f of faces) quad(decal ? 'decals' : side, f.p, f.n, decal ? decalUV(decal) : wuv(f.u[0], f.u[1], y0, y1, tile));
  const tp = [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]];
  quad(decal ? 'decals' : top, tp, [0, 1, 0], decal ? decalUV(decal) : tp.map((q) => [q[0] / topTile, q[2] / topTile]));
  if (bottom) {
    const bp = [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]];
    quad(side, bp, [0, -1, 0], bp.map((q) => [q[0] / tile, q[2] / tile]));
  }
}
/** 바닥 사각형(충돌 없음) */
function floor(mat, x0, z0, x1, z1, y, tile) {
  const p = [[x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0]];
  quad(mat, p, [0, 1, 0], p.map((q) => [q[0] / tile, q[2] / tile]));
}
/** 벽면에 붙이는 데칼(문, 창). face: '+x' | '-x' | '+z' | '-z', at = 그 면의 좌표, c = 면을 따라 가운데 좌표, y0 = 아래 높이 */
function decal(name, face, at, c, y0, w, h) {
  const o = 0.07;
  const y1 = y0 + h, a = c - w / 2, b = c + w / 2;
  let p, n;
  if (face === '+x') { n = [1, 0, 0]; const x = at + o; p = [[x, y0, b], [x, y0, a], [x, y1, a], [x, y1, b]]; }
  else if (face === '-x') { n = [-1, 0, 0]; const x = at - o; p = [[x, y0, a], [x, y0, b], [x, y1, b], [x, y1, a]]; }
  else if (face === '+z') { n = [0, 0, 1]; const z = at + o; p = [[a, y0, z], [b, y0, z], [b, y1, z], [a, y1, z]]; }
  else { n = [0, 0, -1]; const z = at - o; p = [[b, y0, z], [a, y0, z], [a, y1, z], [b, y1, z]]; }
  quad('decals', p, n, decalUV(name));
}

// ---------------------------------------------------------------- 배치
// 크기 48 × 56m(바깥 벽 포함). 플레이어는 남쪽(+Z)에서 북쪽(-Z)을 보고 시작.
// 세 갈래 길: 서쪽 골목(x -23..-15), 가운데 큰길과 광장(x -7..7), 동쪽 골목(x 15..23). 건물 블록 사이 샛길로 이어진다.
const W = 24, D = 28, WALL_H = 4.5;

// 땅(벽 바깥까지 조금)
floor('sand', -W - 8, -D - 8, W + 8, D + 8, 0, 4);
// 바깥 벽
box(-W, 0, -D, W, WALL_H, -D + 1, { side: 'stone', top: 'concrete' });
box(-W, 0, D - 1, W, WALL_H, D, { side: 'stone', top: 'concrete' });
box(-W, 0, -D + 1, -W + 1, WALL_H, D - 1, { side: 'stone', top: 'concrete' });
box(W - 1, 0, -D + 1, W, WALL_H, D - 1, { side: 'stone', top: 'concrete' });

/**
 * 건물: 회벽 몸통 + 돌 받침(0.9m) + 지붕 난간. 면마다 문 하나, 높으면 창 줄.
 * doors: 면별 문 종류(없으면 생략)
 */
const DOOR_W = { doorBlue: 1.5, doorGreen: 1.1, doorWood: 1.0, doorCarved: 1.6, doorPlank: 1.3 };
function building(x0, z0, x1, z1, h, doors = {}) {
  box(x0, 0, z0, x1, h, z1, { side: 'plaster', top: 'concrete', tile: 3 });
  // 받침은 0.05m 튀어나온다(충돌은 몸통 박스로 충분)
  box(x0 - 0.05, 0, z0 - 0.05, x1 + 0.05, 0.9, z1 + 0.05, { side: 'stone', top: 'stone', tile: 1.5, collide: false });
  // 지붕 난간
  const t = 0.25, ph = 0.6;
  box(x0, h, z0, x1, h + ph, z0 + t, { side: 'plaster', top: 'concrete', tile: 3, collide: false });
  box(x0, h, z1 - t, x1, h + ph, z1, { side: 'plaster', top: 'concrete', tile: 3, collide: false });
  box(x0, h, z0 + t, x0 + t, h + ph, z1 - t, { side: 'plaster', top: 'concrete', tile: 3, collide: false });
  box(x1 - t, h, z0 + t, x1, h + ph, z1 - t, { side: 'plaster', top: 'concrete', tile: 3, collide: false });
  const faces = [
    ['+x', x1, z0, z1], ['-x', x0, z0, z1], ['+z', z1, x0, x1], ['-z', z0, x0, x1],
  ];
  for (const [face, at, a, b] of faces) {
    const len = b - a, mid = (a + b) / 2;
    const door = doors[face];
    if (door) {
      const w = DOOR_W[door];
      decal(door, face, at, mid, 0, w, door === 'doorCarved' || door === 'doorBlue' ? 2.3 : 2.2);
    }
    // 1층 창(문 양옆), 2층 창 줄
    const n = Math.max(1, Math.floor(len / 3.4));
    for (let i = 0; i < n; i++) {
      const c = a + (len * (i + 0.5)) / n;
      if (door && Math.abs(c - mid) < 1.6) continue;
      if (h >= 4.5) decal(i % 3 === 1 ? 'windowSmall' : 'window', face, at, c, 2.9, 1.0, 1.5);
      if (i % 2 === 0 && Math.abs(c - mid) > 2) decal('shutters', face, at, c, 1.1, 0.7, 1.1);
    }
    // 에어컨: 창 줄 사이(마지막 칸 경계)에, 문 위는 피한다
    const acAt = a + (len * (n - 1)) / n;
    if (n >= 2 && Math.abs(acAt - mid) > 1.3) decal('ac', face, at, acAt, 2.3, 0.9, 0.58);
  }
}

// 건물 블록(사이 샛길 5m)
building(-15, -20, -7, -6, 6, { '+x': 'doorCarved', '-x': 'doorWood' });
building(-15, -1, -7, 12, 5, { '+x': 'doorBlue', '-z': 'doorPlank' });
building(7, -22, 15, -10, 7, { '-x': 'doorGreen', '+z': 'doorWood' });
building(7, -5, 15, 8, 5.5, { '-x': 'doorCarved', '+x': 'doorPlank' });
// 북쪽 끝 작은 건물(적 쪽)
building(-4, -27, 4, -22, 4, { '+z': 'doorBlue' });
// 남쪽 시작 지점 양옆 작은 창고
building(-15, 18, -9, 27, 3.6, { '+x': 'doorPlank' });
building(9, 20, 15, 27, 3.6, { '-x': 'doorGreen' });

// 가운데 광장(타일 바닥)과 우물
floor('paving', -7, -5, 7, 5, 0.01, 3);
box(-1.3, 0, -1.3, 1.3, 0.9, 1.3, { side: 'stone', top: 'concrete', tile: 1.5 });

/** 화물 컨테이너(2.44 × 2.6 × 6.06). along: 'x' | 'z' */
function container(cx, cz, along, mat = 'rust', y = 0) {
  const hw = 1.22, hl = 3.03, h = 2.6;
  const [ax, az] = along === 'x' ? [hl, hw] : [hw, hl];
  box(cx - ax, y, cz - az, cx + ax, y + h, cz + az, { side: mat, top: mat, tile: 2.6, topTile: 2.6 });
}
/** 나무 상자(s = 한 변) */
function crate(cx, cz, s = 1.1, y = 0, kind = 'crate') {
  box(cx - s / 2, y, cz - s / 2, cx + s / 2, y + s, cz + s / 2, { decal: kind });
}

// 가운데 큰길: 북쪽 컨테이너, 상자 엄폐
container(0, -13, 'x', 'rustBlue');
crate(-4.6, -8);
crate(-4.6, -8, 0.9, 1.1, 'crateBand');
crate(-3.4, -8.2, 0.9);
crate(4.2, 7.2, 1.2);
crate(5.4, 8.1, 0.9, 0, 'crateBand');
crate(-3.2, 13.5);
crate(-2, 13.8, 0.9, 0, 'crateBand');
crate(3, 17.2, 1.0);
// 시작 지점 낮은 담(쪼그려 숨는 높이)
box(-5.5, 0, 18.4, -2.2, 1.1, 19, { side: 'stone', top: 'concrete', tile: 1.5 });
box(2.2, 0, 18.4, 5.5, 1.1, 19, { side: 'stone', top: 'concrete', tile: 1.5 });
// 북쪽 끝
crate(-8, -24.5, 1.2);
crate(8.5, -25, 1.1, 0, 'crateBand');
crate(9.6, -24.6, 0.9);

// 서쪽 골목
container(-21.2, -15, 'z', 'rust');
container(-17.3, 7, 'z', 'rustBlue');
crate(-19, -3.2, 1.2);
crate(-19, -3.2, 0.9, 1.2, 'crateBand');
crate(-21.6, 15.5);
crate(-20.5, 15.9, 0.9, 0, 'crateBand');
crate(-17.6, -24.5, 1.1);

// 동쪽 골목
container(19.9, -17, 'z', 'rust');
container(18.1, -1.8, 'x', 'rustBlue');
crate(17, -8, 1.1);
crate(21.3, 5.5, 1.2, 0, 'crateBand');
crate(16.8, 23.5, 1.0);
// 하역장(올라설 수 있는 높이 1.2m, 북쪽 계단 0.3m씩)
box(15.5, 0, 12, 23, 1.2, 18.5, { side: 'stone', top: 'planks', tile: 1.5, topTile: 1.5 });
for (let i = 0; i < 4; i++) {
  const zz = 12 - (4 - i) * 0.45;
  box(16, 0, zz, 19, 0.3 * (i + 1), zz + 0.45, { side: 'concrete', top: 'concrete', tile: 1.5 });
}
crate(21.6, 16.8, 1.0, 1.2);

// ---------------------------------------------------------------- 출력
const MATS = {
  sand: { tex: 'plaster', color: [0.95, 0.86, 0.72] },
  plaster: { tex: 'plaster', color: [1.0, 0.95, 0.86] },
  paving: { tex: 'paving', color: [1, 1, 1] },
  concrete: { tex: 'concrete', color: [0.92, 0.9, 0.86] },
  stone: { tex: 'stone', color: [1, 1, 1] },
  rust: { tex: 'rust', color: [1, 0.82, 0.74] },
  rustBlue: { tex: 'rust', color: [0.62, 0.78, 0.9] },
  planks: { tex: 'planks', color: [1, 1, 1] },
  decals: { tex: 'decals', color: [1, 1, 1], clamp: true },
};

async function build() {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene('desert');
  // 보관은 WebP, glb에는 PNG로 넣는다(optimize-models.mjs가 다시 WebP로 압축)
  const png = {};
  for (const name of new Set(Object.values(MATS).map((d) => d.tex))) png[name] = await sharp(readFileSync(`${TEX}/${name}.webp`)).png().toBuffer();
  const textures = {};
  const texture = (name) => (textures[name] ??= doc.createTexture(name).setImage(new Uint8Array(png[name])).setMimeType('image/png'));
  let tris = 0;
  for (const [mat, g] of Object.entries(geo)) {
    const def = MATS[mat];
    const m = doc.createMaterial(mat).setBaseColorFactor([...def.color, 1]).setRoughnessFactor(0.92).setMetallicFactor(0)
      .setBaseColorTexture(texture(def.tex));
    if (def.clamp) m.getBaseColorTextureInfo().setWrapS(33071).setWrapT(33071);
    const acc = (type, arr, Ctor) => doc.createAccessor().setType(type).setArray(new Ctor(arr)).setBuffer(buffer);
    const prim = doc.createPrimitive()
      .setAttribute('POSITION', acc('VEC3', g.pos, Float32Array))
      .setAttribute('NORMAL', acc('VEC3', g.nrm, Float32Array))
      .setAttribute('TEXCOORD_0', acc('VEC2', g.uv, Float32Array))
      .setIndices(acc('SCALAR', g.idx, Uint32Array))
      .setMaterial(m);
    scene.addChild(doc.createNode(mat).setMesh(doc.createMesh(mat).addPrimitive(prim)));
    tris += g.idx.length / 3;
  }
  doc.getRoot().getAsset().extras = { note: 'Layout: original. Textures cropped from "sandyards standoff 2" by frostychaos144 (CC BY 4.0).' };
  mkdirSync('scratch_build', { recursive: true });
  await io.write('scratch_build/map_desert_raw.glb', doc);
  const r = (v) => Math.round(v * 1000) / 1000;
  const maxY = Math.max(...boxes.map((b) => b[4]));
  const col = { source: 'tools/build-desert.mjs', scale: 1, cell: 0, bounds: [-W, 0, -D, W, r(maxY), D], boxes: boxes.map((b) => b.map(r)) };
  writeFileSync('public/models/map_desert_colliders.json', JSON.stringify(col));
  console.log(`map_desert_raw.glb: ${Object.keys(geo).length} materials, ${tris} triangles; colliders: ${boxes.length} boxes`);
}

if (process.argv.includes('--extract')) await extract();
else await build();
