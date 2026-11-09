import * as THREE from 'three';

/**
 * 3D 모델을 투명 배경 그림(dataURL)으로 한 번 그린다. 인벤토리 칸처럼 게임 모델과 똑같은 그림이 필요할 때.
 * 잠깐 쓰는 별도 렌더러를 만들고 바로 버린다.
 */
export function renderIcon(model: THREE.Object3D, env: THREE.Texture | null, size = 128) {
  const r = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  r.setPixelRatio(1);
  r.setSize(size, size, false);
  r.setClearColor(0x000000, 0);
  r.toneMapping = THREE.ACESFilmicToneMapping;
  // 작은 칸 안에서도 또렷하게: 게임 화면보다 밝게 비춘다
  r.toneMappingExposure = 1.5;

  const scene = new THREE.Scene();
  if (env) {
    scene.environment = env;
    scene.environmentIntensity = 1.2;
  }
  scene.add(new THREE.HemisphereLight(0xf2f7ff, 0x5a5040, 2.6));
  const sun = new THREE.DirectionalLight(0xffffff, 3.2);
  sun.position.set(2, 3, 4);
  const fill = new THREE.DirectionalLight(0xcfe4ff, 1.6);
  fill.position.set(-3, 1, 2);
  scene.add(sun, fill);

  // 살짝 돌려 옆면도 보이게 하고, 화면을 꽉 채우게 카메라 거리를 맞춘다
  const pivot = new THREE.Group();
  pivot.add(model);
  pivot.rotation.set(0.12, -0.55, 0);
  scene.add(pivot);
  pivot.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(pivot);
  const c = box.getCenter(new THREE.Vector3());
  const s = box.getSize(new THREE.Vector3());
  const cam = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
  const fit = Math.max(s.x, s.y) / 2 / Math.tan(THREE.MathUtils.degToRad(15)) * 1.08;
  cam.position.set(c.x, c.y, c.z + s.z / 2 + fit);
  cam.lookAt(c);

  r.render(scene, cam);
  const url = r.domElement.toDataURL('image/png');
  r.dispose();
  r.forceContextLoss();
  return url;
}
