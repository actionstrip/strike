// 박스로 짜는 맵의 공용 도구: 축 정렬 상자/바닥/데칼/원기둥을 재질별 메시로 모으고, 같은 정의에서 이동 충돌 박스를 만든다.
// 텍스처는 tools/desert_tex/(build-desert.mjs --extract가 만든 WebP)를 쓴다. 사용: build-desert.mjs, build-port.mjs
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

export const TEX = 'tools/desert_tex';
export const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

/** 데칼 아틀라스(decals.webp)의 칸 순서: 4×4 칸에 이 순서로 들어 있다. [left, top, w, h]는 원본 소품 아틀라스에서 자른 영역. */
export const DECALS = {
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
const decalNames = Object.keys(DECALS);

export function decalUV(name) {
  const i = decalNames.indexOf(name);
  if (i < 0) throw new Error(`unknown decal ${name}`);
  const pad = 2 / 1024;
  const u0 = (i % 4) / 4 + pad, v0 = Math.floor(i / 4) / 4 + pad, u1 = u0 + 0.25 - 2 * pad, v1 = v0 + 0.25 - 2 * pad;
  // glTF uv: v=0이 이미지 위
  return [[u0, v1], [u1, v1], [u1, v0], [u0, v0]];
}

export function createKit() {
  /** 재질별 버퍼 */
  const geo = {};
  /** 이동 충돌 박스 [x0, y0, z0, x1, y1, z1] */
  const boxes = [];
  const buf = (mat) => (geo[mat] ??= { pos: [], nrm: [], uv: [], idx: [] });

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

  /**
   * 축 정렬 상자. side/top은 재질 이름, tile은 반복 크기(m). decal을 주면 모든 면에 그 칸을 한 번씩.
   * collide=false면 충돌 박스를 만들지 않는다. bottom=true면 아랫면도(공중에 뜬 상자).
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

  /** 보이지 않는 충돌 벽(물가 등) */
  function blocker(x0, y0, z0, x1, y1, z1) {
    boxes.push([x0, y0, z0, x1, y1, z1]);
  }

  /** 벽면에 붙이는 데칼(문, 창). face: '+x' | '-x' | '+z' | '-z', at = 그 면의 좌표, c = 면을 따라 가운데 좌표, y0 = 아래 높이 */
  function decal(name, face, at, c, y0, w, h, o = 0.07) {
    const y1 = y0 + h, a = c - w / 2, b = c + w / 2;
    let p, n;
    if (face === '+x') { n = [1, 0, 0]; const x = at + o; p = [[x, y0, b], [x, y0, a], [x, y1, a], [x, y1, b]]; }
    else if (face === '-x') { n = [-1, 0, 0]; const x = at - o; p = [[x, y0, a], [x, y0, b], [x, y1, b], [x, y1, a]]; }
    else if (face === '+z') { n = [0, 0, 1]; const z = at + o; p = [[a, y0, z], [b, y0, z], [b, y1, z], [a, y1, z]]; }
    else { n = [0, 0, -1]; const z = at - o; p = [[b, y0, z], [a, y0, z], [a, y1, z], [b, y1, z]]; }
    quad('decals', p, n, decalUV(name));
  }

  /** 세운 원기둥(탱크, 기둥). 옆면은 둘레 방향으로 반복, 충돌은 외접 상자. */
  function cylinder(cx, cz, r, y0, y1, { side, top = side, tile = 2, seg = 20, collide = true } = {}) {
    if (collide) boxes.push([cx - r, y0, cz - r, cx + r, y1, cz + r]);
    const circ = 2 * Math.PI * r;
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const p0 = [cx + Math.sin(a0) * r, cz + Math.cos(a0) * r], p1 = [cx + Math.sin(a1) * r, cz + Math.cos(a1) * r];
      const am = (a0 + a1) / 2;
      const u0 = (circ * i) / seg / tile, u1 = (circ * (i + 1)) / seg / tile;
      quad(side, [[p0[0], y0, p0[1]], [p1[0], y0, p1[1]], [p1[0], y1, p1[1]], [p0[0], y1, p0[1]]], [Math.sin(am), 0, Math.cos(am)],
        [[u0, -y0 / tile], [u1, -y0 / tile], [u1, -y1 / tile], [u0, -y1 / tile]]);
      // 윗면: 가운데 점을 두 번 쓴 사각형(삼각형 하나)
      const c = [cx, y1, cz];
      quad(top, [c, [p0[0], y1, p0[1]], [p1[0], y1, p1[1]], c], [0, 1, 0],
        [[cx / tile, cz / tile], [p0[0] / tile, p0[1] / tile], [p1[0] / tile, p1[1] / tile], [cx / tile, cz / tile]]);
    }
  }

  /** 화물 컨테이너(2.44 × 2.6 × 6.06). along: 'x' | 'z' */
  function container(cx, cz, along, mat = 'rust', y = 0) {
    const hw = 1.22, hl = 3.03, h = 2.6;
    const [ax, az] = along === 'x' ? [hl, hw] : [hw, hl];
    box(cx - ax, y, cz - az, cx + ax, y + h, cz + az, { side: mat, top: mat, tile: 2.6, topTile: 2.6, bottom: y > 0 });
  }

  /** 나무 상자(s = 한 변) */
  function crate(cx, cz, s = 1.1, y = 0, kind = 'crate') {
    box(cx - s / 2, y, cz - s / 2, cx + s / 2, y + s, cz + s / 2, { decal: kind });
  }

  /**
   * 재질별 메시로 glb를 쓰고 충돌 json을 쓴다.
   * mats: { 이름: { tex: 'plaster' | null, image?: PNG 버퍼(tex 이름으로 desert_tex 대신 이걸 쓴다), color: [r,g,b], clamp?, rough?, metal? } }
   */
  async function write({ name, mats, bounds, note }) {
    const doc = new Document();
    const buffer = doc.createBuffer();
    const scene = doc.createScene(name);
    // 보관은 WebP, glb에는 PNG로 넣는다(optimize-models.mjs가 다시 WebP로 압축)
    const png = {};
    for (const mat of Object.keys(geo)) {
      const { tex: t, image } = mats[mat];
      if (t && !png[t]) png[t] = image ?? (await sharp(readFileSync(`${TEX}/${t}.webp`)).png().toBuffer());
    }
    const textures = {};
    const texture = (t) => (textures[t] ??= doc.createTexture(t).setImage(new Uint8Array(png[t])).setMimeType('image/png'));
    let tris = 0;
    for (const [mat, g] of Object.entries(geo)) {
      const def = mats[mat];
      if (!def) throw new Error(`material ${mat} not defined`);
      const m = doc.createMaterial(mat).setBaseColorFactor([...def.color, 1]).setRoughnessFactor(def.rough ?? 0.92).setMetallicFactor(def.metal ?? 0);
      if (def.tex) m.setBaseColorTexture(texture(def.tex));
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
    doc.getRoot().getAsset().extras = { note };
    mkdirSync('scratch_build', { recursive: true });
    await io.write(`scratch_build/map_${name}_raw.glb`, doc);
    const r = (v) => Math.round(v * 1000) / 1000;
    const maxY = Math.max(...boxes.map((b) => b[4]));
    const [x0, z0, x1, z1] = bounds;
    const col = { source: `tools/build-${name}.mjs`, scale: 1, cell: 0, bounds: [x0, 0, z0, x1, r(maxY), z1], boxes: boxes.map((b) => b.map(r)) };
    writeFileSync(`public/models/map_${name}_colliders.json`, JSON.stringify(col));
    console.log(`map_${name}_raw.glb: ${Object.keys(geo).length} materials, ${tris} triangles; colliders: ${boxes.length} boxes`);
  }

  return { quad, box, floor, blocker, decal, cylinder, container, crate, write };
}

/** 결정적인 값 노이즈(0..1). 격자 크기 cell 픽셀, 가로로 반복되게 period 픽셀마다 같은 값. */
function valueNoise(x, y, cell, seed, period) {
  const h = (i, j) => {
    i = ((i % (period / cell)) + period / cell) % (period / cell);
    j = ((j % (period / cell)) + period / cell) % (period / cell);
    let n = (i * 374761393 + j * 668265263 + seed * 2147483647) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  };
  const fx = x / cell, fy = y / cell, i = Math.floor(fx), j = Math.floor(fy);
  const u = fx - i, v = fy - j, su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
  const a = h(i, j), b = h(i + 1, j), c = h(i, j + 1), d = h(i + 1, j + 1);
  return a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv;
}

/**
 * 골판 철판 텍스처(회색조, 재질 색으로 물들인다): 세로 골 ribs개, 얼룩과 아래쪽 때.
 * 사방으로 반복된다. size 픽셀 정사각.
 */
export async function corrugatedTexture({ size = 256, ribs = 8, seed = 1 } = {}) {
  const px = Buffer.alloc(size * size * 3);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const rib = Math.sin((x / size) * ribs * Math.PI * 2);
      // 골: 밝은 등과 어두운 골짜기(빛이 위에서 비스듬히 온다고 보고 한쪽을 더 밝게)
      let v = 0.72 + 0.16 * rib + 0.06 * Math.cos((x / size) * ribs * Math.PI * 2);
      const stain = valueNoise(x, y, 32, seed, size) * 0.6 + valueNoise(x, y, 8, seed + 7, size) * 0.4;
      v *= 0.82 + 0.22 * stain;
      // 세로로 흘러내린 자국
      v *= 0.93 + 0.07 * valueNoise(x, y * 0.08, 4, seed + 3, size);
      const g = Math.max(0, Math.min(255, Math.round(v * 255)));
      const o = (y * size + x) * 3;
      px[o] = g; px[o + 1] = g; px[o + 2] = g;
    }
  }
  return sharp(px, { raw: { width: size, height: size, channels: 3 } }).png().toBuffer();
}
