import * as THREE from 'three';
import type { Assets } from './assets';
import { ENEMY, ENEMY2 } from './config';
import { AREA, GunnerEnemy, mulberry32, type Enemy, type EnemyHooks, type WorldRefs } from './enemy';
import { WalkerEnemy } from './enemy2';
import type { Player } from './player';

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
    // 바닥 높이의 빈 칸만(경사로, 2층 제외). 머리 위가 막힌 곳(지붕 밑)도 키가 들어가면 된다.
    const blocked = (x: number, z: number, h: number) =>
      colliders.some((c) => c.max.y > 0.05 && c.min.y < h + 0.1 && x > c.min.x - 0.9 && x < c.max.x + 0.9 && z > c.min.z - 0.9 && z < c.max.z + 0.9);
    // 후보: 0.5m 격자의 빈 칸 중 걸어서 갈 수 있고 플레이어에게서 충분히 먼 곳(약간 흔들어 격자 줄이 보이지 않게)
    const h = Math.max(ENEMY.height, ENEMY2.height);
    const step = 0.5;
    const near: THREE.Vector2[] = [];
    const far: THREE.Vector2[] = [];
    for (let x = area.min.x + 1; x <= area.max.x - 1; x += step) {
      for (let z = area.min.z + 1; z <= area.max.z - 1; z += step) {
        const px = x + (rand() - 0.5) * step * 0.6, pz = z + (rand() - 0.5) * step * 0.6;
        if (blocked(px, pz, h) || !reachable(px, pz)) continue;
        (Math.hypot(px - playerPos.x, pz - playerPos.z) < ENEMY.spawnFromPlayer ? near : far).push(new THREE.Vector2(px, pz));
      }
    }
    // 먼 후보가 모자라면(작은 맵) 가까운 후보도 쓴다
    const cand = far.length >= kinds.length * 4 ? far : far.concat(near);
    // 골고루 퍼지게: 첫 자리는 시드로 고르고, 다음부터는 이미 놓인 적들과의 최소 거리가 가장 큰 후보를 고른다(farthest point)
    const minD = new Float32Array(cand.length).fill(Infinity);
    let pick = Math.floor(rand() * cand.length);
    for (let n = 0; n < kinds.length && cand.length > 0; n++) {
      const p = cand[pick];
      const kind = kinds[n];
      const r = mulberry32(seed * 977 + n * 131);
      const e: Enemy = kind === 'gunner' ? new GunnerEnemy(this.assets, r, this.flashTex) : new WalkerEnemy(this.assets, r, this.flashTex);
      e.place(p.x, p.y, rand() * Math.PI * 2);
      this.scene.add(e.root);
      this.list.push(e);
      let best = -1;
      for (let k = 0; k < cand.length; k++) {
        const dk = Math.min(minD[k], cand[k].distanceTo(p));
        minD[k] = dk;
        if (best < 0 || dk > minD[best]) best = k;
      }
      pick = best;
    }
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
