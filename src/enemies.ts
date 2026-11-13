import * as THREE from 'three';
import type { Assets } from './assets';
import { ENEMY, ENEMY2, ENEMY_STYLE_MIX, PERF } from './config';
import { AREA, GunnerEnemy, mulberry32, rollPersona, type Enemy, type EnemyHooks, type WorldRefs } from './enemy';
import { WalkerEnemy } from './enemy2';
import type { Player } from './player';
import { spreadSpots } from './spread';

const _t = new THREE.Vector3();
const _a = new THREE.Vector3();

/** 적 무리: 두 종류를 섞어 배치, 갱신, 피격 메시 목록 */
export class Enemies {
  list: Enemy[] = [];
  /** 플레이어 사격용 피격 박스(살아 있는 적만) */
  hitMeshes: THREE.Object3D[] = [];

  constructor(private assets: Assets, private scene: THREE.Scene, private flashTex: THREE.Texture) {}

  /**
   * 맵 바닥의 빈 칸에 골고루(서로 가장 먼 자리부터) 배치한다. 종류는 번갈아(총잡이, 레이저, 총잡이, ...) 각 종류 수만큼.
   * counts를 주면 [총잡이 수, 레이저 수]로 덮어쓴다. reachable이 false인 곳(건물 밖, 막힌 방)에는 놓지 않는다.
   */
  spawn(
    colliders: THREE.Box3[], playerPos: THREE.Vector3, area: THREE.Box3, seed = 7, counts: [number, number] = [ENEMY.count, ENEMY2.count],
    reachable: (x: number, z: number) => boolean = () => true,
  ) {
    for (const e of this.list) e.root.removeFromParent();
    this.list = [];
    AREA.copy(area);
    const rand = mulberry32(seed);
    // 종류 순서: 번갈아 섞는다
    const kinds: ('gunner' | 'walker')[] = [];
    let [g, w] = counts;
    while (g > 0 || w > 0) {
      if (g > 0) { kinds.push('gunner'); g--; }
      if (w > 0) { kinds.push('walker'); w--; }
    }
    // 골고루: 서로 가장 먼 자리부터(spread.ts). 플레이어 시작점 근처는 후보가 모자랄 때만.
    const spots = spreadSpots(kinds.length, {
      colliders, area, reachable, rand, height: Math.max(ENEMY.height, ENEMY2.height), from: playerPos, minFrom: ENEMY.spawnFromPlayer,
    });
    // 성향: 섞은 순서를 돌려 써서 한 맵에 여러 성향이 고루 나오게 한다
    const styles = ENEMY_STYLE_MIX.slice();
    for (let i = styles.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [styles[i], styles[j]] = [styles[j], styles[i]];
    }
    spots.forEach((p, n) => {
      const r = mulberry32(seed * 977 + n * 131);
      const e: Enemy = kinds[n] === 'gunner' ? new GunnerEnemy(this.assets, r, this.flashTex) : new WalkerEnemy(this.assets, r, this.flashTex);
      e.persona = rollPersona(r, styles[n % styles.length]);
      e.place(p.x, p.y, rand() * Math.PI * 2);
      this.scene.add(e.root);
      this.list.push(e);
    });
    this.refreshHitMeshes();
  }

  refreshHitMeshes() {
    this.hitMeshes = this.list.flatMap((e) => (e.alive ? e.hitBoxes : []));
  }

  /** 성능 옵션: 멀리 있고 전투 중이 아닌 적은 몇 프레임에 한 번, 모은 시간으로 갱신한다 */
  farSkip = false;
  private skipAcc = new Map<Enemy, { t: number; n: number }>();

  private frustum = new THREE.Frustum();
  private projView = new THREE.Matrix4();
  private sphere = new THREE.Sphere();
  private camPos = new THREE.Vector3();
  private camRight = new THREE.Vector3();
  private ray = new THREE.Ray();
  private hitP = new THREE.Vector3();
  private seg = new THREE.Vector3();
  /** 가려짐 확인용(맵 메시는 BVH라 첫 충돌만 찾으면 빠르다) */
  private meshRay = Object.assign(new THREE.Raycaster(), { firstHitOnly: true });

  /** 선분 a→b가 충돌 박스(벽, 상자)에 막히는가. a가 박스 안에 있으면 그 박스는 무시한다(카메라가 벽에 닿았을 때). */
  private segmentBlocked(a: THREE.Vector3, b: THREE.Vector3, colliders: THREE.Box3[]) {
    const len = this.seg.subVectors(b, a).length();
    if (len < 1e-4) return false;
    this.ray.set(a, this.seg.divideScalar(len));
    for (const c of colliders) {
      if (c.containsPoint(a)) continue;
      if (this.ray.intersectBox(c, this.hitP) && this.hitP.distanceTo(a) < len - 0.05) return true;
    }
    return false;
  }

  /**
   * 카메라에서 적이 보일 수 있는가(벽에 완전히 가려지지 않았는가). 머리와 가슴 두 점을 카메라 위치와 양옆 0.5m에서 본다.
   * 양옆에서도 보므로 모퉁이를 돌기 조금 전부터 보이는 것으로 판정한다(갑자기 튀어나오지 않게).
   * 충돌 상자는 실제 모양보다 크거나 속이 찬 경우가 있어서(창살, 틈, 열린 창고), 상자가 다 막을 때만
   * 실제 맵 메시로 한 번 더 확인한다(적 몸 양옆 0.3m까지). 메시 쪽이 한 줄이라도 뚫려 있으면 보이는 것으로 본다.
   */
  private visibleFromCamera(e: Enemy, world: WorldRefs) {
    const p = e.root.position;
    const h = e.cfg.height;
    const ox = [0, 0.5, -0.5];
    for (const y of [h * 0.9, h * 0.5]) {
      const t = _t.set(p.x, p.y + y, p.z);
      for (const o of ox) {
        const a = _a.copy(this.camPos).addScaledVector(this.camRight, o);
        if (!this.segmentBlocked(a, t, world.colliders)) return true;
      }
    }
    const rc = this.meshRay;
    for (const y of [h * 0.9, h * 0.5, 0.3]) {
      for (const side of [0, 0.3, -0.3]) {
        const t = _t.set(p.x, p.y + y, p.z).addScaledVector(this.camRight, side);
        const len = this.seg.subVectors(t, this.camPos).length();
        rc.set(this.camPos, this.seg.divideScalar(len));
        rc.far = len - 0.1;
        if (rc.intersectObjects(world.hitMeshes, false).length === 0) return true;
      }
    }
    return false;
  }

  update(dt: number, player: Player, playerHead: THREE.Vector3, world: WorldRefs, hooks: EnemyHooks, camera?: THREE.Camera) {
    // 화면 밖이거나 멀리 있는 적은 자세를 3프레임에 한 번만 갱신한다(애니메이션이 적 갱신 비용의 대부분)
    if (camera) {
      this.projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      this.frustum.setFromProjectionMatrix(this.projView);
      camera.getWorldPosition(this.camPos);
      const m = camera.matrixWorld.elements;
      this.camRight.set(m[0], 0, m[2]).normalize();
      for (const e of this.list) {
        const p = e.root.position;
        this.sphere.center.set(p.x, p.y + 0.6, p.z);
        this.sphere.radius = 1.3;
        const dist = p.distanceTo(player.pos);
        const far = dist > ENEMY.animFarDistance;
        const inView = this.frustum.intersectsSphere(this.sphere);
        // 화면 안이지만 벽에 가려진 적은 그리지 않는다(트인 맵에서는 정면 쪽 적 대부분이 이 경우였다).
        // 0.1초마다 검사하고, 두 번 연속 가려졌을 때만 숨긴다. 보이면 바로 다시 그린다.
        if (inView) {
          e.occT -= dt;
          if (e.occT <= 0) {
            e.occT = ENEMY.occlusionInterval;
            e.occHidden = this.visibleFromCamera(e, world) ? 0 : e.occHidden + 1;
          }
        } else {
          e.occHidden = 0;
        }
        const occluded = e.occHidden >= 2;
        // 화면 밖 적은 three.js가 알아서 거르므로 켜 둔다(가까우면 그림자가 화면에 보일 수 있다)
        e.root.visible = !occluded;
        e.setCastShadow(dist < ENEMY.shadowDistance);
        // 다 쓰러진 적은 자세가 더 이상 바뀌지 않는다
        if (!e.alive && e.deathT > 3) e.animEvery = 30;
        else e.animEvery = e.alive && (far || !inView || occluded) ? ENEMY.animSkip : 1;
      }
    }
    for (const e of this.list) {
      if (this.farSkip && e.alive && e.state !== 'combat' && e.root.position.distanceTo(player.pos) > PERF.farDistance) {
        let a = this.skipAcc.get(e);
        if (!a) this.skipAcc.set(e, (a = { t: 0, n: 0 }));
        a.t += dt;
        if (++a.n < PERF.farEvery) continue;
        const t = Math.min(a.t, 0.1);
        a.t = 0;
        a.n = 0;
        e.update(t, player, playerHead, world, hooks);
        continue;
      }
      e.update(dt, player, playerHead, world, hooks);
    }
    // 전투를 시작한 적은 근처 동료에게 알린다(동료는 그곳으로 수색하러 온다)
    for (const e of this.list) {
      if (!e.alertOthers) continue;
      e.alertOthers = false;
      for (const o of this.list) {
        // 동료는 무기를 들고 그쪽으로 다가온다(성향대로 곧장/돌아서/내다보며)
        if (o !== e && o.root.position.distanceTo(e.root.position) < o.cfg.alertRadius) o.hear(e.lastSeen, o.persona.pursuit * 0.6);
      }
    }
    this.senseTick(dt, player);
  }

  private senseT = 0;
  /** 인기척: 주인공이 가까이서 움직이면(달릴수록 멀리까지) 안 보여도 알아챈다 */
  private senseTick(dt: number, player: Player) {
    this.senseT -= dt;
    if (this.senseT > 0) return;
    this.senseT = ENEMY.senseInterval;
    const S = ENEMY.sense;
    const sp = player.horizSpeed;
    const r = sp < 0.3 ? S.still : player.sprinting ? S.sprint : player.crouched ? S.crouch : S.walk;
    for (const e of this.list) {
      if (!e.alive) continue;
      const d = Math.hypot(e.root.position.x - player.pos.x, e.root.position.z - player.pos.z);
      if (d < r) e.sense(player.pos);
    }
  }

  /** 소리(플레이어 총소리): 들리는 거리 안의 적은 그곳을 수색하러 간다 */
  noise(at: THREE.Vector3) {
    for (const e of this.list) {
      // 총소리 난 곳은 조심스럽게 다가가 본다(짧게 쫓기)
      if (e.root.position.distanceTo(at) < e.cfg.hearRange) e.hear(at, e.persona.pursuit * 0.3);
    }
  }

  get aliveCount() {
    return this.list.filter((e) => e.alive).length;
  }
}
