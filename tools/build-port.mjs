// 항구 창고 맵: 가운데 큰 창고(안에 선반 통로), 서쪽 컨테이너 야적장, 동쪽 연료 탱크, 북쪽 부두, 남쪽 사무동.
// 배치는 이 파일에서 새로 짠 것. 텍스처는 tools/desert_tex/(frostychaos144, CC BY 4.0에서 잘라 둔 것)를 색만 바꿔 다시 쓰고,
// 창고 벽과 컨테이너의 골판 철판은 mapkit.mjs에서 절차적으로 만든다.
//
//   node tools/build-port.mjs              # -> scratch_build/map_port_raw.glb + public/models/map_port_colliders.json
//   node tools/optimize-models.mjs map_port # -> public/models/map_port.glb
import { corrugatedTexture, createKit } from './mapkit.mjs';

const { box, floor, blocker, decal, cylinder, container, crate, write } = createKit();

// 땅: x -26..26, z -26(부두 끝)..30. 바깥 벽 두께 1m. 북쪽은 바다.
const X = 26, ZN = -26, ZS = 30, WALL_H = 4;

// ---------------------------------------------------------------- 땅, 바다, 바깥 벽
floor('ground', -X - 1, ZN, X + 1, ZS + 1, 0, 4);
floor('ground', -X - 12, ZS + 1, X + 12, ZS + 12, 0, 4);
floor('water', -90, -90, 90, ZN - 0.4, -1.3, 8);
// 부두 벽(물 위로 드러난 옆면)과 가장자리 턱, 넘어가지 못하게 보이지 않는 벽
box(-X - 1, -1.6, ZN - 0.4, X + 1, 0, ZN, { side: 'stone', top: 'wallC', tile: 1.5, collide: false });
box(-X, 0, ZN - 0.4, X, 0.3, ZN + 0.2, { side: 'wallC', tile: 1.5 });
blocker(-X - 1, 0, ZN - 1, X + 1, 3, ZN + 0.2);
for (let x = -22; x <= 22; x += 6.3) cylinder(x, ZN + 0.9, 0.25, 0, 0.6, { side: 'metalDark', tile: 1, seg: 10 });
// 바깥 벽(서, 동, 남)
box(-X - 1, 0, ZN - 0.4, -X, WALL_H, ZS + 1, { side: 'wallC', top: 'wallC', tile: 2 });
box(X, 0, ZN - 0.4, X + 1, WALL_H, ZS + 1, { side: 'wallC', top: 'wallC', tile: 2 });
box(-X, 0, ZS, X, WALL_H, ZS + 1, { side: 'wallC', top: 'wallC', tile: 2 });

// ---------------------------------------------------------------- 가운데 창고
// x -11..11, z -9..9, 높이 7. 남/북 큰 문(6 × 4.5m), 서/동 작은 문(2 × 2.6m). 벽 두께 0.4.
const WX = 11, WZ = 9, WH = 7, T = 0.4;
const wallOpt = { side: 'metal', top: 'metalDark', tile: 2.6 };
// 남쪽 벽(z = 9): 큰 문 x -3..3
box(-WX, 0, WZ - T, -3, WH, WZ, wallOpt);
box(3, 0, WZ - T, WX, WH, WZ, wallOpt);
box(-3, 4.5, WZ - T, 3, WH, WZ, wallOpt);
// 북쪽 벽(z = -9)
box(-WX, 0, -WZ, -3, WH, -WZ + T, wallOpt);
box(3, 0, -WZ, WX, WH, -WZ + T, wallOpt);
box(-3, 4.5, -WZ, 3, WH, -WZ + T, wallOpt);
// 서쪽 벽(x = -11): 작은 문 z -1..1
box(-WX, 0, -WZ + T, -WX + T, WH, -1, wallOpt);
box(-WX, 0, 1, -WX + T, WH, WZ - T, wallOpt);
box(-WX, 2.6, -1, -WX + T, WH, 1, wallOpt);
// 동쪽 벽(x = 11): 작은 문 z 2..4
box(WX - T, 0, -WZ + T, WX, WH, 2, wallOpt);
box(WX - T, 0, 4, WX, WH, WZ - T, wallOpt);
box(WX - T, 2.6, 2, WX, WH, 4, wallOpt);
// 지붕(안에서도 보이게 아랫면 포함)과 문 위 노란 띠
box(-WX - 0.2, WH, -WZ - 0.2, WX + 0.2, WH + 0.3, WZ + 0.2, { side: 'metalDark', top: 'metalDark', tile: 3, bottom: true });
box(-3.2, 4.3, WZ, 3.2, 4.5, WZ + 0.08, { side: 'yellow', tile: 1, collide: false });
box(-3.2, 4.3, -WZ - 0.08, 3.2, 4.5, -WZ, { side: 'yellow', tile: 1, collide: false });
// 바닥과 문 표시
floor('floorIn', -WX + T, -WZ + T, WX - T, WZ - T, 0.01, 3);
decal('doorPlank', '-x', -WX, 0, 0, 2.0, 2.6, 0.02);
decal('grate', '+x', WX, -6, 2.4, 1.2, 1.6);
decal('grate', '-x', -WX, -6, 2.4, 1.2, 1.6);
decal('grate', '+x', WX, 6.5, 2.4, 1.2, 1.6);
decal('grate', '-x', -WX, 6.5, 2.4, 1.2, 1.6);

/** 선반: 기둥 4개 + 판 3단, 판 위에 상자. 충돌은 통째로(사이로 지나가지 못하게, 총알은 틈으로 지나간다). */
function rack(x0, z0, x1, z1, seed) {
  const h = 2.6, p = 0.1;
  blocker(x0, 0, z0, x1, h, z1);
  for (const [px, pz] of [[x0, z0], [x1 - p, z0], [x0, z1 - p], [x1 - p, z1 - p]]) {
    box(px, 0, pz, px + p, h, pz + p, { side: 'yellow', tile: 1, collide: false });
  }
  const levels = [0.15, 1.3, 2.45];
  levels.forEach((y, li) => {
    box(x0, y, z0, x1, y + 0.06, z1, { side: 'planks', tile: 1.5, collide: false, bottom: true });
    // 상자: 위치를 조금씩 다르게
    let x = x0 + 0.15;
    let k = seed + li * 7;
    while (x < x1 - 0.8) {
      const s = 0.55 + ((k * 37) % 5) * 0.08;
      if ((k * 13) % 4 !== 0 && li < 2) crate(x + s / 2, (z0 + z1) / 2, s, y + 0.06, k % 2 ? 'crate' : 'crateBand');
      x += s + 0.25;
      k++;
    }
  });
  // 맨 위 칸 위에는 상자를 안 올린다(지붕 쪽 빈 공간)
}
rack(-8.5, -5.2, -2.5, -4.2, 1);
rack(2.5, -5.2, 8.5, -4.2, 3);
rack(-8.5, 4.2, -2.5, 5.2, 5);
rack(2.5, 4.2, 8.5, 5.2, 2);
// 창고 안 가운데: 컨테이너 하나와 상자 더미(엄폐)
container(0, -1.5, 'x', 'rustYellow');
crate(-6, 1.2, 1.2);
crate(-6, 1.2, 0.9, 1.2, 'crateBand');
crate(6.5, -1.2, 1.1);
crate(7.6, -0.6, 0.9, 0, 'crateBand');
crate(-9.4, -7.5, 1.0);
crate(9.4, 7.4, 1.0);

// ---------------------------------------------------------------- 서쪽 컨테이너 야적장
// 2단 더미(못 올라감)와 1단(계단으로 올라가 내려다보는 자리)
container(-21.5, -17, 'z', 'rust');
container(-21.5, -17, 'z', 'rustBlue', 2.6);
container(-21.5, -3.5, 'z', 'rustGreen');
container(-21.5, -3.5, 'z', 'rust', 2.6);
container(-15.5, -13.5, 'x', 'rustBlue');
container(-17.5, 6.5, 'z', 'rust');
container(-21.5, 14, 'z', 'rustBlue');
container(-21.5, 14, 'z', 'rustYellow', 2.6);
// 1단 컨테이너(x -17.5, z 3.47..9.53) 남쪽 끝에 오르는 계단 9칸(0.29m씩)
for (let i = 0; i < 9; i++) {
  const z1 = 9.53 + (9 - i) * 0.42;
  box(-18.6, 0, z1 - 0.42, -16.4, 0.289 * (i + 1), z1, { side: 'metalDark', top: 'metalDark', tile: 1 });
}
crate(-15, 0, 1.1);
crate(-14.2, 0.9, 0.9, 0, 'crateBand');
crate(-24.2, 7.5, 1.2);
crate(-15.5, -21.5, 1.1);
crate(-15.5, -21.5, 0.9, 1.1, 'crateBand');

// ---------------------------------------------------------------- 동쪽 연료 탱크
for (const [cx, cz] of [[19.5, -17.5], [19.5, -8]]) {
  cylinder(cx, cz, 3.0, 0, 6.5, { side: 'tank', top: 'metalDark', tile: 3, seg: 24 });
  // 탱크 띠
  cylinder(cx, cz, 3.04, 4.6, 4.9, { side: 'red', tile: 3, seg: 24, collide: false });
}
// 탱크 둘레 낮은 방호벽(0.9m, 서쪽에 틈)
box(15, 0, -22, 25, 0.9, -21.6, { side: 'wallC', tile: 1.5 });
box(15, 0, -3.6, 25, 0.9, -3.2, { side: 'wallC', tile: 1.5 });
box(15, 0, -21.6, 15.4, 0.9, -15, { side: 'wallC', tile: 1.5 });
box(15, 0, -10.5, 15.4, 0.9, -3.6, { side: 'wallC', tile: 1.5 });
// 배관(탱크에서 창고 쪽으로, 머리 위 높이: 걸어서 밑으로 지나간다)
box(11, 3.2, -13.2, 16.5, 3.5, -12.9, { side: 'metalDark', tile: 1, collide: false, bottom: true });
cylinder(13.5, -13.05, 0.15, 0, 3.2, { side: 'metalDark', tile: 1, seg: 8 });
// 동쪽 남부: 컨테이너, 상자
container(20, 6, 'x', 'rustGreen');
container(22.5, 15, 'z', 'rust');
crate(15.5, 9.8, 1.1);
crate(16.6, 10.2, 0.9, 0, 'crateBand');
crate(14.5, 20, 1.2);

// ---------------------------------------------------------------- 북쪽 부두
container(-5.5, -19.5, 'x', 'rustBlue');
container(7.5, -18, 'z', 'rust');
crate(-0.5, -22.5, 1.1);
crate(0.6, -22.2, 0.9, 0, 'crateBand');
crate(-12, -23, 1.2);
crate(13, -23.4, 1.0);
// 가로등(가는 기둥)
for (const [lx, lz] of [[-13, -10.5], [13, 12], [-13, 12], [0, -15.5]]) cylinder(lx, lz, 0.12, 0, 6, { side: 'metalDark', tile: 1, seg: 8 });

// ---------------------------------------------------------------- 남쪽: 사무동, 경비 초소, 방호벽
function office(x0, z0, x1, z1, h, door, doorFace) {
  box(x0, 0, z0, x1, h, z1, { side: 'plaster', top: 'wallC', tile: 3 });
  box(x0 - 0.05, 0, z0 - 0.05, x1 + 0.05, 0.6, z1 + 0.05, { side: 'wallC', top: 'wallC', tile: 1.5, collide: false });
  box(x0 - 0.15, h, z0 - 0.15, x1 + 0.15, h + 0.25, z1 + 0.15, { side: 'metalDark', top: 'metalDark', tile: 2, collide: false });
  const [face, at, a, b] = doorFace;
  decal(door, face, at, (a + b) / 2, 0, 1.2, 2.2);
  for (let c = a + 1.6; c < b - 1; c += 2.6) if (Math.abs(c - (a + b) / 2) > 1.4) decal('windowSmall', face, at, c, 1.1, 0.9, 1.25);
  decal('ac', face, at, b - 0.9, 2.3, 0.9, 0.58);
}
office(-24.5, 21, -14, 29, 3.8, 'doorGreen', ['+x', -14, 21, 29]);
office(14, 22, 24.5, 29, 3.8, 'doorBlue', ['-x', 14, 22, 29]);
// 경비 초소
box(-6.8, 0, 20, -4.6, 2.6, 22.2, { side: 'plaster', top: 'metalDark', tile: 2 });
decal('windowSmall', '+z', 22.2, -5.7, 1.0, 1.0, 1.2);
// 시작 지점 앞 방호벽(1.0m, 앉으면 숨는다)
for (const [x0, x1] of [[-3.6, -0.8], [0.8, 3.6]]) box(x0, 0, 19.2, x1, 1.0, 19.7, { side: 'wallC', top: 'wallC', tile: 1.5 });
// 가운데 마당 방호벽(창고와 사무동 사이)
box(-9, 0, 13.2, -6.2, 1.0, 13.7, { side: 'wallC', tile: 1.5 });
box(6.2, 0, 12.5, 9, 1.0, 13, { side: 'wallC', tile: 1.5 });
box(-1.4, 0, -14, 1.4, 1.0, -13.5, { side: 'wallC', tile: 1.5 });

// ---------------------------------------------------------------- 출력
const CORR = await corrugatedTexture({ size: 256, ribs: 8, seed: 5 });
await write({
  name: 'port',
  bounds: [-X - 1, ZN - 1, X + 1, ZS + 1],
  note: 'Layout: original. Textures from tools/desert_tex (cropped from "sandyards standoff 2" by frostychaos144, CC BY 4.0), recolored.',
  mats: {
    // 골판: 창고 벽(골 8개/2.6m), 컨테이너(골이 더 촘촘)
    ...Object.fromEntries(Object.entries({
      metal: [0.62, 0.68, 0.74], metalDark: [0.36, 0.38, 0.4],
      rust: [0.72, 0.32, 0.2], rustBlue: [0.22, 0.38, 0.58], rustGreen: [0.26, 0.46, 0.3], rustYellow: [0.85, 0.62, 0.15],
    }).map(([k, c]) => [k, { tex: 'corrugated', image: CORR, color: c, rough: 0.7, metal: 0.25 }])),
    ground: { tex: 'concrete', color: [0.4, 0.4, 0.39] },
    floorIn: { tex: 'concrete', color: [0.36, 0.36, 0.35] },
    wallC: { tex: 'concrete', color: [0.7, 0.7, 0.68] },
    stone: { tex: 'stone', color: [0.7, 0.68, 0.64] },
    tank: { tex: 'concrete', color: [0.86, 0.87, 0.86], rough: 0.6 },
    yellow: { tex: null, color: [0.9, 0.7, 0.12] },
    red: { tex: null, color: [0.7, 0.16, 0.12] },
    planks: { tex: 'planks', color: [1, 1, 1] },
    plaster: { tex: 'concrete', color: [0.78, 0.81, 0.86] },
    water: { tex: null, color: [0.1, 0.24, 0.3], rough: 0.25 },
    decals: { tex: 'decals', color: [1, 1, 1], clamp: true },
  },
});
