import * as THREE from 'three';
import type { Assets } from './assets';
import { ENEMY, ENEMY2 } from './config';
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

  update(dt: number, player: Player, playerHead: THREE.Vector3, world: WorldRefs, hooks: EnemyHooks) {
    for (const e of this.list) e.update(dt, player, playerHead, world, hooks);
  }

  get aliveCount() {
    return this.list.filter((e) => e.alive).length;
  }
}
