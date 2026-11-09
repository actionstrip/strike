import * as THREE from 'three';
import type { Assets } from './assets';
import { ENEMY, ENEMY2, PERF } from './config';
import { AREA, GunnerEnemy, mulberry32, type Enemy, type EnemyHooks, type WorldRefs } from './enemy';
import { WalkerEnemy } from './enemy2';
import type { Player } from './player';
import { spreadSpots } from './spread';

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
    spots.forEach((p, n) => {
      const r = mulberry32(seed * 977 + n * 131);
      const e: Enemy = kinds[n] === 'gunner' ? new GunnerEnemy(this.assets, r, this.flashTex) : new WalkerEnemy(this.assets, r, this.flashTex);
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

  update(dt: number, player: Player, playerHead: THREE.Vector3, world: WorldRefs, hooks: EnemyHooks) {
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
        if (o !== e && o.root.position.distanceTo(e.root.position) < o.cfg.alertRadius) o.hear(e.lastSeen);
      }
    }
  }

  /** 소리(플레이어 총소리): 들리는 거리 안의 적은 그곳을 수색하러 간다 */
  noise(at: THREE.Vector3) {
    for (const e of this.list) {
      if (e.root.position.distanceTo(at) < e.cfg.hearRange) e.hear(at);
    }
  }

  get aliveCount() {
    return this.list.filter((e) => e.alive).length;
  }
}
