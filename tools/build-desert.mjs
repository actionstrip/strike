// 사막 마을 맵: 배치를 박스로 정의해서 시각 메시(glb)와 이동 충돌 박스(json)를 함께 만든다.
// 텍스처는 "sandyards standoff 2"(frostychaos144, CC BY 4.0)의 아틀라스에서 잘라 쓴다. 배치(구조)는 이 파일에서 새로 짠 것.
//
//   node tools/build-desert.mjs --extract   # 3d/sandyards_standoff_2.glb 에서 텍스처를 잘라 tools/desert_tex/ 에 저장(원본 glb가 있을 때 한 번)
//   node tools/build-desert.mjs             # tools/desert_tex/ -> scratch_build/map_desert_raw.glb + public/models/map_desert_colliders.json
//   node tools/optimize-models.mjs          # -> public/models/map_desert.glb
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { DECALS, TEX, createKit, io } from './mapkit.mjs';

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
// 데칼 아틀라스 칸 목록(DECALS)은 mapkit.mjs에 있다(4×4 칸, 각 256²에 늘려 넣는다).

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

const { box, floor, decal, container, crate, write } = createKit();

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
  await write({
    name: 'desert', mats: MATS, bounds: [-W, -D, W, D],
    note: 'Layout: original. Textures cropped from "sandyards standoff 2" by frostychaos144 (CC BY 4.0).',
  });
}

if (process.argv.includes('--extract')) await extract();
else await build();
