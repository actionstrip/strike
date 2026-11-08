# 총알 발사

요청에 총이 있거나 모델에 총이 달려 있을 때 읽는다. 기준 코드는 `src/three/Bullets.ts`, `GUN`(`src/config.ts`), `src/Game.ts`다. 값이 바뀌었을 수 있으니 먼저 `GUN`을 확인한다.

## 코드는 보통 건드리지 않는다

`Bullets`는 차의 `Turret`과 `Muzzle` 노드만 본다. 두 노드가 있으면 다음이 자동으로 된다.

- `F` 키 발사 (`src/three/Input.ts`의 `fire`)
- 포탑 자동 조준
- HUD 탄약과 `재장전` 표시
- 재시작 때 탄약과 포탑 복구
- 다른 차로 바꾸면 발사 안 됨

새 차에 필요한 코드 수정은 도움말 한 줄뿐이다. `index.html`의 `F 발사(Hunter, Scout)`에 이름을 추가한다.

`GUN` 값을 바꾸면 **총 달린 모든 차**가 바뀐다. 차별로 다른 총을 원하면 먼저 사용자에게 알린다.

## 지금 동작

| 항목 | 값 | 설명 |
|---|---|---|
| 연사 | 8발/초 | `rate` |
| 탄창 | 20발 | `magazine` |
| 재장전 | 3초 | `reload`. 탄창이 빌 때 자동 시작 |
| 총알 속도 | 140 + 차 속도 | `bulletSpeed` |
| 총알 수명 | 1초 | `bulletLife` |
| 조준 거리 | 60 | `aimRange` |
| 조준 각도 | 좌우 0.52rad | `aimCone` |
| 포탑 회전 | 6rad/초 | `aimSpeed` |
| 조준 높이 | 라이벌 도로 위 1 | `aimHeight` |
| 스핀 | 연속 5발 | `hitsToSpin`, 탄창당 1회 |
| 판정 높이 | 도로 아래 0.5 ~ 위 2.5 | `hitBelow`, `hitHeight` |

## 명중 판정

- 라이벌의 `hitBox` 상자를 그 프레임의 총알 이동 선이 지나면 명중이다. 모델 면이 아니라 상자로 판정한다.
- `hitBox`의 폭과 길이는 라이벌 모델 bounds에서 계산한다. 높이는 고정이다.
- 대상은 라이벌뿐이다. 벽, 지형, 장애물은 총알을 막지 않는다.
- 라이벌은 쏘지 않는다. 혼자 달리기에서는 대상이 없어 포탑이 정면에 고정된다.
- 빗나간 총알이 수명을 다하면 연속 횟수가 0이 된다.
- 스핀 효과는 `Game`의 콜백이 `rival.spinOut()`을 호출하고, 성공하면 `명중!`을 띄운다.
- 연속 횟수는 재장전으로 지워지지 않는다. 앞 탄창 끝의 명중이 다음 탄창으로 이어진다.

## 모델 쪽 준비

### 총이 메시로 분리돼 있을 때

분리된 메시를 `Gun`으로 합쳐 `Turret` 자식으로 넣는다. Hunter 예시는 `examples/humvee_build.py`.

### 총이 차체와 붙어 있을 때

Scout 예시는 `examples/scout_build.py`.

1. 받침대 높이별 단면 폭을 수치로 뽑는다.
2. 가장 가는 높이를 찾는다. 돌아가도 이음매가 보이지 않는 곳이다.
3. 그 위의 면을 전부 `Gun`으로 옮긴다. 아래쪽 받침대는 차체에 남는다.
4. 그 높이의 단면 중심을 `Turret` 위치로 잡는다.

### 공통 규칙

- `Turret`은 빈 노드로 만들고 회전값을 두지 않는다. 포탑의 `+Z`가 발사 방향이다. 총이 비스듬하면 메시를 돌려 맞춘다.
- `Gun` 메시는 `Turret` 기준으로 옮긴다: `gun.data.transform(Matrix.Translation(-NECK))`
- `Muzzle`은 `Turret`의 자식으로, 총구 끝에 둔다.
- 총은 칠해지지 않는 재질로 둔다. 텍스처를 공유해도 재질 번호를 고정 색으로 강제한다.
- 총구를 수평으로 맞출 필요는 없다. 발사 방향의 높이는 조준 때 코드가 보정한다.
- 차보다 길게 튀어나오는 총은 `hitBox`, `noseZ`를 키운다. 충돌과 라이벌 판정이 어색하면 메시를 줄이거나 뒤로 당긴다.
- 삼각형 약 1,300개 이하로 줄인다.

### 총이 없는 차에 달아 달라는 요청

모델에 없으면 원통과 상자로 총을 만들어 같은 노드 구조로 넣는다. 다른 모델의 총을 가져오려면 그 모델의 라이선스도 확인한다.

## 캐릭터와의 관계

| 방식 | `Seat`, `Eye` 위치 | 클립 | 예 |
|---|---|---|---|
| 앉아서 운전, 총만 돎 | 차체 | `Drive` | Scout |
| 서서 총을 잡음, 몸도 돎 | `Turret`의 자식 | `Gunner` | Hunter |

- 앉는 방식은 추가 클립이 필요 없고 운전대가 있어야 한다.
- 서는 방식은 손을 총 손잡이에 맞춰야 한다. `Gunner` 클립의 손 위치는 Hunter의 총에 맞춰져 있다. 총 모양이 다르면 `Seat` 위치와 `driverScale`로 먼저 맞춰 보고, 안 맞으면 [character.md](character.md)대로 새 클립을 만든다.
- 총열이 머리 높이를 지나가면 포탑이 돌 때 머리에 닿지 않는지 본다.
- 운전자 시점에서 총이 시야를 가리면 `Eye`를 옮기거나 총을 높인다.

## 발사 검증

`references/verify.md`의 시뮬레이션 준비를 먼저 실행한 뒤 이 코드를 쓴다.

```js
const g = window.game, k = g.kart, b = g.bullets, m = k.model;
let spins = 0; const os = b.onSpin; b.onSpin = (...a) => { spins++; return os?.(...a); };
const seat = m.seat.position.clone();
const seen = [], yaw = [];
g.input.held.add('KeyF');
for (let i = 0; i < 60 * 12; i++) {
  step(1);
  yaw.push(Math.abs(m.turret.rotation.y));
  if (i % 60 === 0) seen.push({ t: i / 60, ammo: b.ammo, reload: +b.reloadTime.toFixed(2), streak: b.streak, spent: b.spent });
}
g.input.held.delete('KeyF');
({ seen, spins, maxYaw: Math.max(...yaw), seatMoved: seat.distanceTo(m.seat.position) });
```

### 기대 결과

- 탄약이 20에서 0으로 줄고, 약 3초 뒤 20으로 돌아온다.
- 12초 동안 스핀은 탄창 수 이하다.
- `maxYaw`가 0보다 크고 0.52 이하다.
- 앉는 차는 `seatMoved`가 0이다.

### 눈으로 볼 것

- 예광탄이 총구에서 나간다. 차체나 받침대 중간에서 나오면 `Muzzle`이 잘못됐다.
- 포탑이 받침대 축에서 돈다. 총이 옆으로 밀리면 `Turret` 위치가 축에서 벗어났다.
- 정면 복귀할 때 총이 뒤틀리지 않는다.
- 추적 시점과 운전자 시점 모두에서 총구 불꽃이 자연스럽다.
- 혼자 달리기에서 발사되고 포탑은 정면이다.
- 총 없는 차로 바꾸면 `F`를 눌러도 발사되지 않고 탄약 표시가 없다.

## 밸런스

총은 라이벌을 멈출 수 있어 라이벌전에서 유리하다. 총 달린 차는 능력치를 낮게 잡는 쪽이 공정하다. Hunter는 가속 2, 핸들링 2로 무겁다. 총 달린 차가 늘면 라이벌 난이도가 맞는지 사용자에게 알린다.

## 대포

`Turret` 자식으로 포구 끝에 빈 노드 `Cannon`을 넣으면 코드 수정 없이 `G` 키 대포, HUD 장전 표시, 개러지 특수 기능이 켜진다. 포탑 회전은 `Bullets`가 맡으므로 `Muzzle`도 있어야 한다. 값은 `src/config.ts`의 `CANNON`에서 조절한다.
