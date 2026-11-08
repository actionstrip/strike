// Blender에서 내보낸 원본(scratch_build/*_raw.glb)을 게임용으로 최적화해서 public/models/로 출력한다.
// - 쓰지 않는 KHR_materials_specular 제거
// - 텍스처 WebP 변환(색 데이터가 거의 없는 작은 텍스처는 4x4로 축소)
// - meshopt 압축
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRMaterialsSpecular, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dedup, prune, meshopt, textureCompress, weld, flatten, join } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';
import { statSync } from 'node:fs';

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

async function run(src, dst, { maxTex = 1024, merge = false } = {}) {
  const doc = await io.read(src);
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
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
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
