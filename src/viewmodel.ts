import * as THREE from 'three';
import type { Assets } from './assets';
import { EYE_FROM_SHOULDER, FOV, VIEWMODEL_ADS_SIGHT } from './config';
import type { Player } from './player';
import { attachHands, GunInstance, RobotRig } from './robot';
import { ledgeGrabWorld } from './character';
import type { Weapon } from './weapon';

const _v = new THREE.Vector3();
const _size = new THREE.Vector2();

/**
 * 1인칭 뷰모델: 로봇 팔(몸통 삼각형 제거)과 총을 별도 씬에 그린다.
 * 카메라는 원점에서 -Z를 보고, 리그는 "어깨 중점 + EYE_FROM_SHOULDER.fp = 카메라"가 되게 놓는다.
 */
export class Viewmodel {
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  rig: RobotRig;
  gun: GunInstance;
  private sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private shoulderOffset = new THREE.Vector3();
  private frameQ = new THREE.Quaternion();
  /** 이 씬 전용으로 복제한 재질과 원래 값(3인칭 모델과 재질을 나눠 쓰지 않도록) */
  private fadeMats: { mat: THREE.Material; depthWrite: boolean }[] = [];
  private fadeSet = new Set<THREE.Material>();
  /** 조준경 주변 원 안만 반투명하게 하는 셰이더 값(모든 재질이 같은 객체를 나눠 쓴다) */
  private sightU = {
    uSightC: { value: new THREE.Vector2() },
    uSightR: { value: new THREE.Vector2(1, 2) },
    uSightA: { value: 1 },
  };
  private ads = 0;

  constructor(assets: Assets) {
    this.camera = new THREE.PerspectiveCamera(FOV.viewmodel, 1, 0.01, 10);
    // 손가락 쥔 자세만 쓴다
    const idle = assets.clips.Idle;
    const fingerClip = new THREE.AnimationClip('Grip', idle.duration, idle.tracks.filter((t) => /Hand(Index|Middle|Ring|Pinky)/.test(t.name)));
    this.rig = new RobotRig(assets.robot, { Grip: fingerClip }, { armsOnly: true });
    this.rig.actions.Grip.setEffectiveWeight(1);
    this.gun = new GunInstance(assets.gun, { shadows: false });
    this.scene.add(this.rig.root, this.gun.root);
    for (const root of [this.rig.root, this.gun.root]) {
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const mat = (m.material as THREE.Material).clone();
        this.fadeMats.push({ mat, depthWrite: mat.depthWrite });
        this.fadeSet.add(mat);
        // 늘 transparent로 둔다(원 밖은 알파 1이라 불투명과 같다)
        mat.transparent = true;
        mat.onBeforeCompile = (shader) => {
          Object.assign(shader.uniforms, this.sightU);
          shader.fragmentShader = 'uniform vec2 uSightC;\nuniform vec2 uSightR;\nuniform float uSightA;\n' +
            shader.fragmentShader.replace('#include <dithering_fragment>', `#include <dithering_fragment>
  float sightK = 1.0 - smoothstep(uSightR.x, uSightR.y, distance(gl_FragCoord.xy, uSightC));
  gl_FragColor.a *= mix(1.0, uSightA, sightK);`);
        };
        m.material = mat;
      });
    }

    this.hemi = new THREE.HemisphereLight(0xdfeeff, 0x50463a, 1.3);
    this.sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
    this.scene.add(this.hemi, this.sun, this.sun.target);

    // 리그 배치: 어깨 중점이 카메라 기준 -EYE_FROM_SHOULDER.fp에 오도록
    this.rig.mixer.update(0);
    this.rig.root.updateMatrixWorld(true);
    const mid = this.rig.shoulderMid(new THREE.Vector3());
    this.shoulderOffset.copy(EYE_FROM_SHOULDER.fp).negate();
    this.rig.root.position.copy(this.shoulderOffset).sub(mid);
    this.rig.root.updateMatrixWorld(true);
  }

  update(player: Player, weapon: Weapon, worldCamera: THREE.Camera, sunDirWorld: THREE.Vector3, hemiColors: { sky: THREE.Color; ground: THREE.Color }) {
    this.ads = weapon.ads;
    this.camera.fov = weapon.viewmodelFov();
    this.camera.updateProjectionMatrix();

    // 월드 조명 방향을 카메라 공간으로
    const camQ = worldCamera.getWorldQuaternion(new THREE.Quaternion()).invert();
    this.sun.position.copy(sunDirWorld).applyQuaternion(camQ).multiplyScalar(10);
    this.hemi.color.copy(hemiColors.sky);
    this.hemi.groundColor.copy(hemiColors.ground);
    // 반구광의 "위"도 카메라 기준으로 돌린다
    this.hemi.position.set(0, 1, 0).applyQuaternion(camQ);

    // 리그 기본자세로 되돌리고 손가락 자세 적용
    this.rig.mixer.update(0);
    this.rig.root.updateMatrixWorld(true);
    const mid = this.rig.shoulderMid(new THREE.Vector3());
    const gp = new THREE.Vector3();
    const gq = new THREE.Quaternion();
    weapon.pose(player, 'fp', EYE_FROM_SHOULDER.fp, this.gun.aimPointLocal(new THREE.Vector3()), 1, gp, gq);
    this.frameQ.identity();
    this.gun.root.position.copy(gp).add(mid);
    this.gun.root.quaternion.copy(gq);
    this.gun.applyParts(weapon);
    // 모서리 짚기: 월드 목표를 카메라 공간(=뷰모델 씬 좌표)으로
    const lg = ledgeGrabWorld(player);
    if (lg) {
      worldCamera.updateMatrixWorld();
      const inv = worldCamera.getWorldQuaternion(new THREE.Quaternion()).invert();
      lg.pos.copy(worldCamera.worldToLocal(lg.pos));
      // 뷰모델 FOV가 월드보다 좁으므로, 화면상 같은 자리에 보이도록 x, y를 줄인다
      const wc = worldCamera as THREE.PerspectiveCamera;
      const k = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) / Math.tan(THREE.MathUtils.degToRad(wc.fov / 2));
      lg.pos.x *= k;
      lg.pos.y *= k;
      lg.fingers.applyQuaternion(inv);
      lg.palm.applyQuaternion(inv);
    }
    attachHands(this.rig, this.gun, weapon, this.frameQ, lg);
  }

  /**
   * 뷰모델을 그린다(월드 위에, 깊이는 미리 지운 상태로).
   * 반투명일 때는 깊이만 먼저 채운 뒤 색을 그려서 맨 앞 면만 한 번 섞이게 한다(팔과 총이 서로 비치지 않게).
   */
  render(renderer: THREE.WebGLRenderer) {
    // 원 중심은 조준점(AimPoint)이 화면에 찍히는 자리를 따라간다
    const size = renderer.getDrawingBufferSize(_size);
    this.gun.aimPoint.getWorldPosition(_v).project(this.camera);
    this.sightU.uSightC.value.set((_v.x * 0.5 + 0.5) * size.x, (_v.y * 0.5 + 0.5) * size.y);
    this.sightU.uSightR.value.set(VIEWMODEL_ADS_SIGHT.inner * size.y, VIEWMODEL_ADS_SIGHT.outer * size.y);
    this.sightU.uSightA.value = THREE.MathUtils.lerp(1, VIEWMODEL_ADS_SIGHT.alpha, this.ads);
    const fading = this.sightU.uSightA.value < 0.999;
    if (fading) {
      for (const f of this.fadeMats) { f.mat.colorWrite = false; f.mat.depthWrite = f.depthWrite; }
      // 총구 화염처럼 나중에 붙은 것은 깊이 패스에서 빼야 두 번 그려지지 않는다
      const hidden: THREE.Object3D[] = [];
      this.scene.traverseVisible((o) => {
        const mat = (o as THREE.Mesh).material as THREE.Material | undefined;
        if (mat && !this.fadeSet.has(mat)) hidden.push(o);
      });
      for (const o of hidden) o.visible = false;
      renderer.render(this.scene, this.camera);
      for (const o of hidden) o.visible = true;
    }
    for (const f of this.fadeMats) {
      f.mat.colorWrite = true;
      f.mat.depthWrite = f.depthWrite && !fading;
    }
    renderer.render(this.scene, this.camera);
  }

  setAspect(a: number) {
    this.camera.aspect = a;
    this.camera.updateProjectionMatrix();
  }

  muzzleView(out: THREE.Vector3) {
    return this.gun.muzzle.getWorldPosition(out);
  }
}
