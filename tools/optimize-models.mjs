// Blender에서 내보낸 원본(scratch_build/*_raw.glb)을 게임용으로 최적화해서 public/models/로 출력한다.
// - 쓰지 않는 KHR_materials_specular 제거
// - 텍스처 WebP 변환(색 데이터가 거의 없는 작은 텍스처는 4x4로 축소)
// - meshopt 압축
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRMaterialsSpecular, KHRMaterialsIOR, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dedup, prune, meshopt, textureCompress, weld, flatten, join, metalRough } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';
import { statSync } from 'node:fs';

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

// 인자로 이름 일부를 주면 그 출력만 다시 만든다(예: node tools/optimize-models.mjs map_desert)
const only = process.argv[2];

async function run(src, dst, { maxTex = 1024, merge = false, specGloss = false, level = 'medium' } = {}) {
  if (only && !dst.includes(only)) return;
  const doc = await io.read(src);
  // 옛 spec-gloss 재질(three.js 미지원)을 metal-rough로 바꾼다
  // (변환이 넣는 ior=1000은 거울처럼 번쩍이게 만들어서 뺀다)
  if (specGloss) {
    await doc.transform(metalRough());
    doc.getRoot().listExtensionsUsed().filter((e) => e.extensionName === KHRMaterialsIOR.EXTENSION_NAME).forEach((e) => e.dispose());
  }
  doc.getRoot().listExtensionsUsed()
    .filter((e) => e.extensionName === KHRMaterialsSpecular.EXTENSION_NAME)
    .forEach((e) => e.dispose());
  // 1비트 흑백 PNG(유리 재질의 단색 맵)는 libvips WebP 변환이 실패한다. 4x4 검정 PNG로 바꾼다.
  for (const tex of doc.getRoot().listTextures()) {
    const img = tex.getImage();
    if (img && img.byteLength < 2048) {
      const small = await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 0, g: 0, b: 0 } } }).png().toBuffer();
      tex.setImage(new Uint8Array(small));
    }
  }
  // 맵: 같은 색 재질을 하나로 합치고(dedup), 노드를 펴서(flatten) 같은 재질끼리 한 메시로(join) draw call을 줄인다
  if (merge) await doc.transform(dedup(), flatten(), join({ keepNamed: false }));
  await doc.transform(
    dedup(),
    prune({ keepLeaves: true, keepAttributes: false }),
    weld(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [maxTex, maxTex], quality: 82 }),
    meshopt({ encoder: MeshoptEncoder, level }),
  );
  doc.createExtension(EXTMeshoptCompression).setRequired(true);
  await io.write(dst, doc);
  console.log(`${dst}: ${(statSync(dst).size / 1024).toFixed(0)} KB`);
}

await run('scratch_build/g32_raw.glb', 'public/models/g32.glb');
await run('scratch_build/robot_raw.glb', 'public/models/robot.glb');
await run('scratch_build/enemy_robot_raw.glb', 'public/models/enemy_robot.glb');
await run('scratch_build/enemy_gun_raw.glb', 'public/models/enemy_gun.glb', { maxTex: 512 });
await run('scratch_build/map_raw.glb', 'public/models/map.glb', { merge: true });
// 두 번째 적(레이저 보행 로봇): Sketchfab 원본을 그대로(애니메이션은 런타임에 걷기 한 주기만 잘라 쓴다)
// 백룸: 조명이 구워진 텍스처 맵(1024 WebP)
await run('scratch_build/map_backrooms_raw.glb', 'public/models/map_backrooms.glb', { merge: true });
// 사막 마을: tools/build-desert.mjs가 만든 박스 맵(같은 재질끼리 이미 한 메시)
await run('scratch_build/map_desert_raw.glb', 'public/models/map_desert.glb');
// 항구 창고: tools/build-port.mjs가 만든 박스 맵
await run('scratch_build/map_port_raw.glb', 'public/models/map_port.glb');
await run('3d/enermy2_robot.glb', 'public/models/enemy2_robot.glb', { specGloss: true });
