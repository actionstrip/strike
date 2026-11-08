import * as THREE from 'three';

/** 총구 화염, 탄흔, 탄착 불꽃, 예광선 */

function flashTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  // translate 뒤에 칠하므로 그라데이션도 원점 기준
  const grd = g.createRadialGradient(0, 0, 0, 0, 0, 64);
  grd.addColorStop(0, 'rgba(255,255,230,1)');
  grd.addColorStop(0.25, 'rgba(255,210,120,0.95)');
  grd.addColorStop(0.6, 'rgba(255,140,40,0.35)');
  grd.addColorStop(1, 'rgba(255,100,20,0)');
  g.fillStyle = grd;
  g.translate(64, 64);
  for (let i = 0; i < 6; i++) {
    g.rotate(Math.PI / 3);
    g.beginPath();
    g.moveTo(-9, 0); g.lineTo(0, -62); g.lineTo(9, 0);
    g.fill();
  }
  g.beginPath(); g.arc(0, 0, 34, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function decalTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(10,10,10,1)');
  grd.addColorStop(0.35, 'rgba(25,22,20,0.9)');
  grd.addColorStop(0.7, 'rgba(40,35,30,0.35)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class MuzzleFlash {
  sprite: THREE.Sprite;
  side: THREE.Sprite;
  t = 0;
  constructor(parent: THREE.Object3D, tex: THREE.Texture, scale: number, layer?: number) {
    const mat = new THREE.SpriteMaterial({ map: tex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    this.sprite = new THREE.Sprite(mat);
    this.sprite.scale.setScalar(scale);
    this.side = new THREE.Sprite(mat);
    this.side.scale.set(scale * 1.6, scale * 0.6, 1);
    this.side.position.z = -scale * 0.35;
    parent.add(this.sprite, this.side);
    this.sprite.visible = this.side.visible = false;
    if (layer !== undefined) { this.sprite.layers.set(layer); this.side.layers.set(layer); }
  }
  fire() {
    this.t = 0.05;
    this.sprite.material.rotation = Math.random() * Math.PI;
  }
  update(dt: number) {
    this.t -= dt;
    const on = this.t > 0;
    this.sprite.visible = this.side.visible = on;
    if (on) {
      const s = 0.8 + Math.random() * 0.5;
      this.sprite.material.opacity = s;
    }
  }
}

interface Tracer { line: THREE.Line; t: number }
interface Spark { pts: THREE.Points; vel: Float32Array; t: number }
interface Beam { group: THREE.Group; core: THREE.Mesh; outer: THREE.Mesh; dot: THREE.Sprite; t: number }

const BEAM_TIME = 0.2;
const _y = new THREE.Vector3(0, 1, 0);

export class Effects {
  flashTex = flashTexture();
  private decalMat: THREE.MeshBasicMaterial;
  private decals: THREE.Mesh[] = [];
  private decalIdx = 0;
  private tracers: Tracer[] = [];
  private sparks: Spark[] = [];
  private beams: Beam[] = [];
  private beamGeo = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);
  /** 레이저가 닿은 곳의 붉은 빛 */
  laserLight: THREE.PointLight;
  light: THREE.PointLight;
  private lightT = 0;

  constructor(private scene: THREE.Scene) {
    this.decalMat = new THREE.MeshBasicMaterial({
      map: decalTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4,
    });
    const geo = new THREE.PlaneGeometry(0.09, 0.09);
    for (let i = 0; i < 80; i++) {
      const m = new THREE.Mesh(geo, this.decalMat);
      m.visible = false;
      scene.add(m);
      this.decals.push(m);
    }
    this.light = new THREE.PointLight(0xffb060, 0, 6, 2);
    scene.add(this.light);
    this.laserLight = new THREE.PointLight(0xff3020, 0, 5, 2);
    scene.add(this.laserLight);
  }

  muzzleLight(pos: THREE.Vector3) {
    this.light.position.copy(pos);
    this.lightT = 0.05;
  }

  impact(point: THREE.Vector3, normal: THREE.Vector3, parent?: THREE.Object3D, decal = true) {
    const p = point.clone().addScaledVector(normal, 0.003);
    if (decal) this.placeDecal(p, normal, parent);
    this.sparkBurst(p, normal);
  }

  private placeDecal(p: THREE.Vector3, normal: THREE.Vector3, parent?: THREE.Object3D) {
    const d = this.decals[this.decalIdx++ % this.decals.length];
    d.visible = true;
    d.removeFromParent();
    if (parent) {
      parent.add(d);
      d.position.copy(parent.worldToLocal(p.clone()));
      const pq = parent.getWorldQuaternion(new THREE.Quaternion()).invert();
      d.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal).premultiply(pq);
    } else {
      this.scene.add(d);
      d.position.copy(p);
      d.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    }
    d.rotateZ(Math.random() * Math.PI);
    d.scale.setScalar(0.7 + Math.random() * 0.6);
  }

  private sparkBurst(p: THREE.Vector3, normal: THREE.Vector3) {
    // 불꽃 파편
    const n = 8;
    const pos = new Float32Array(n * 3);
    const vel = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos.set([p.x, p.y, p.z], i * 3);
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(2.4).addScaledVector(normal, 2.2);
      vel.set([v.x, v.y, v.z], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffd28a, size: 0.035, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.scene.add(pts);
    this.sparks.push({ pts, vel, t: 0.25 });
  }

  tracer(from: THREE.Vector3, to: THREE.Vector3) {
    // 총구에서 조금 앞에서 시작해 탄착점 직전까지
    const dir = to.clone().sub(from);
    const len = dir.length();
    const a = from.clone().addScaledVector(dir, Math.min(0.6, len * 0.1) / len);
    const g = new THREE.BufferGeometry().setFromPoints([a, to]);
    const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xffe2a0, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.scene.add(line);
    this.tracers.push({ line, t: 0.05 });
  }

  /** 레이저 빔: 하얀 심과 붉은 겉빛, 끝점의 붉은 점. 짧게 남았다가 가늘어지며 사라진다. */
  laser(from: THREE.Vector3, to: THREE.Vector3) {
    const dir = to.clone().sub(from);
    const len = dir.length();
    if (len < 1e-3) return;
    const group = new THREE.Group();
    group.position.copy(from).addScaledVector(dir, 0.5);
    group.quaternion.setFromUnitVectors(_y, dir.divideScalar(len));
    const mk = (color: number, opacity: number) =>
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const core = new THREE.Mesh(this.beamGeo, mk(0xffe6e0, 1));
    core.scale.set(0.012, len, 0.012);
    const outer = new THREE.Mesh(this.beamGeo, mk(0xff2a14, 0.55));
    outer.scale.set(0.045, len, 0.045);
    group.add(core, outer);
    const dot = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.flashTex, color: 0xff4a2a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    dot.position.set(0, len / 2, 0);
    dot.scale.setScalar(0.35);
    group.add(dot);
    this.scene.add(group);
    this.beams.push({ group, core, outer, dot, t: BEAM_TIME });
    this.laserLight.position.copy(to);
  }

  update(dt: number) {
    this.lightT -= dt;
    this.light.intensity = this.lightT > 0 ? 18 : 0;
    let laserGlow = 0;
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i];
      b.t -= dt;
      const k = Math.max(0, b.t / BEAM_TIME);
      laserGlow = Math.max(laserGlow, k);
      const w = 0.4 + 0.6 * k;
      b.core.scale.x = b.core.scale.z = 0.012 * w;
      b.outer.scale.x = b.outer.scale.z = 0.045 * w;
      (b.core.material as THREE.MeshBasicMaterial).opacity = k;
      (b.outer.material as THREE.MeshBasicMaterial).opacity = 0.55 * k;
      (b.dot.material as THREE.SpriteMaterial).opacity = k;
      if (b.t <= 0) {
        b.group.removeFromParent();
        for (const m of [b.core, b.outer]) (m.material as THREE.Material).dispose();
        (b.dot.material as THREE.Material).dispose();
        this.beams.splice(i, 1);
      }
    }
    this.laserLight.intensity = 14 * laserGlow;
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tr = this.tracers[i];
      tr.t -= dt;
      (tr.line.material as THREE.LineBasicMaterial).opacity = Math.max(0, tr.t / 0.05) * 0.85;
      if (tr.t <= 0) {
        tr.line.removeFromParent();
        tr.line.geometry.dispose();
        (tr.line.material as THREE.Material).dispose();
        this.tracers.splice(i, 1);
      }
    }
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.t -= dt;
      const pos = s.pts.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let k = 0; k < pos.count; k++) {
        s.vel[k * 3 + 1] -= 9 * dt;
        pos.setXYZ(k, pos.getX(k) + s.vel[k * 3] * dt, pos.getY(k) + s.vel[k * 3 + 1] * dt, pos.getZ(k) + s.vel[k * 3 + 2] * dt);
      }
      pos.needsUpdate = true;
      (s.pts.material as THREE.PointsMaterial).opacity = Math.max(0, s.t / 0.25);
      if (s.t <= 0) {
        s.pts.removeFromParent();
        s.pts.geometry.dispose();
        (s.pts.material as THREE.Material).dispose();
        this.sparks.splice(i, 1);
      }
    }
  }
}
