import * as THREE from 'three';

export interface SpreadOptions {
  colliders: THREE.Box3[];
  area: THREE.Box3;
  /** 플레이어 시작점에서 걸어서 갈 수 있는 곳인가 */
  reachable: (x: number, z: number) => boolean;
  rand: () => number;
  /** 서 있을 높이(이 높이까지 막힌 곳은 뺀다) */
  height: number;
  /** 벽에서 띄울 거리 */
  margin?: number;
  /** 후보 격자 간격 */
  step?: number;
  /** 이 점들(플레이어, 이미 놓인 것)에서 되도록 멀리. 첫 점부터 이들과 먼 곳을 고른다. */
  avoid?: THREE.Vector2[];
  /** 이 점에서 minFrom보다 가까운 후보는 후보가 모자랄 때만 쓴다 */
  from?: THREE.Vector3;
  minFrom?: number;
}

/**
 * 맵 바닥의 빈 칸에 count개 지점을 골고루 고른다.
 * 걸어서 갈 수 있는 빈 칸을 격자로 모은 뒤, 이미 고른 점(과 avoid)과의 최소 거리가 가장 큰 후보를 차례로 고른다(farthest point).
 * avoid가 없으면 첫 점은 rand로 고른다.
 */
export function spreadSpots(count: number, o: SpreadOptions): THREE.Vector2[] {
  const { colliders, area, reachable, rand, height } = o;
  const margin = o.margin ?? 0.9, step = o.step ?? 0.5;
  // 바닥 높이의 빈 칸만(경사로, 2층 제외). 머리 위가 막힌 곳(지붕 밑)도 키가 들어가면 된다.
  const blocked = (x: number, z: number) =>
    colliders.some((c) => c.max.y > 0.05 && c.min.y < height + 0.1 && x > c.min.x - margin && x < c.max.x + margin && z > c.min.z - margin && z < c.max.z + margin);
  const near: THREE.Vector2[] = [];
  const far: THREE.Vector2[] = [];
  for (let x = area.min.x + 1; x <= area.max.x - 1; x += step) {
    for (let z = area.min.z + 1; z <= area.max.z - 1; z += step) {
      // 약간 흔들어 격자 줄이 보이지 않게
      const px = x + (rand() - 0.5) * step * 0.6, pz = z + (rand() - 0.5) * step * 0.6;
      if (blocked(px, pz) || !reachable(px, pz)) continue;
      const isNear = o.from && Math.hypot(px - o.from.x, pz - o.from.z) < (o.minFrom ?? 0);
      (isNear ? near : far).push(new THREE.Vector2(px, pz));
    }
  }
  // 먼 후보가 모자라면(작은 맵) 가까운 후보도 쓴다
  const cand = far.length >= count * 4 ? far : far.concat(near);
  const out: THREE.Vector2[] = [];
  if (!cand.length) return out;
  const minD = new Float32Array(cand.length).fill(Infinity);
  const take = (p: THREE.Vector2) => {
    let best = -1;
    for (let k = 0; k < cand.length; k++) {
      const dk = Math.min(minD[k], cand[k].distanceTo(p));
      minD[k] = dk;
      if (best < 0 || dk > minD[best]) best = k;
    }
    return best;
  };
  let pick = Math.floor(rand() * cand.length);
  for (const a of o.avoid ?? []) pick = take(a);
  for (let n = 0; n < count; n++) {
    const p = cand[pick];
    out.push(p.clone());
    pick = take(p);
  }
  return out;
}
