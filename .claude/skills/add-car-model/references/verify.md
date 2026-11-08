# 브라우저 검증

Claude in Chrome으로 실제 게임을 돌려 확인한다. 도구를 처음 쓸 때는 `anthropic-skills:chrome-browser` 스킬 안내를 따른다.

## 시작

```bash
npx vite --port 5199 --strictPort    # run_in_background
```

curl로 서버가 뜬 것을 확인하고, 새 탭에서 `http://localhost:5199/`를 연다. 로딩에 약 4초 걸린다.

- 페이지가 뜨기 전에 클릭하면 차가 선택되지 않는다. 스크린샷으로 선택 상태를 본다.
- 스크린샷이 작으면 무늬를 놓치므로 도색은 원본 크기나 확대로 본다.
- 백그라운드 탭은 FPS가 떨어진다. FPS 대신 HUD의 CPU와 드로콜을 비교한다.

## 개러지

개러지 패널은 `k.selectCar`로 바꾸면 갱신되지 않는다. 도색을 볼 때는 차량 버튼을 실제로 클릭한다. 시점은 코드로 돌린다.

```js
window.game.garage.yaw = -Math.PI / 2 + 0.15;   // 왼쪽 측면
window.game.garage.yaw = Math.PI * 0.72;        // 뒤쪽 대각선
```

확인 순서: 기본색 → 색 변경 → 포인트가 있으면 포인트 → 패턴 전부 → `기본값으로`.

패턴은 체커, 스트라이프, 플레임을 각각 눌러 본다. 면이 찢어져 보이거나 한 색으로 뭉치면 문제다.

## 시뮬레이션 준비

게임 루프를 멈추고 직접 프레임을 돌린다. 봇이 플레이어 차를 운전한다.

```js
const g = window.game, k = g.kart;
await k.selectCar('차량id');
await new Promise(r => setTimeout(r, 800));
const up = Object.getPrototypeOf(g).update.bind(g);
g.update = () => {};
g.selectMode('rival'); g.enterModeSelect(); g.leaveGarage(); g.selectMap('valley');
await new Promise(r => setTimeout(r, 1500));
g.startCountdown(); g.countdown = .001;
document.getElementById('banner').style.display = 'none';
const step = n => { for (let i = 0; i < n; i++) { up(1 / 60); g.input.endFrame(); } };
window.__step = step;
const Bot = g.rivalDriver.constructor, bot = new Bot(k), ku = k.update.bind(k);
window.__bot = bot;
k.update = (dt, inp, tr) => {
  if (!inp) return ku(dt, inp, tr);
  bot.update(dt, tr, g.world.obstacles(), g.rival, 0, false);
  k.speedScale = 1; k.offScreen = false;
  return ku(dt, bot, tr);
};
step(2); bot.reset(); step(240);
```

## 운전자 시점

```js
g.rig.toggle(); k.setCockpit(g.rig.mode === 'cockpit'); step(20);
```

추적 시점으로 돌아갈 때도 같은 코드를 쓴다.

## 맵 5개 주행

```js
const out = {};
for (const map of ['valley', 'canyon', 'neon', 'glacier', 'volcano', 'coast']) {
  g.selectMap(map); await new Promise(r => setTimeout(r, 1500));
  g.startCountdown(); g.countdown = .001; step(2); bot.reset();
  const ammo0 = g.bullets.ammo; let slow = 0, fired = 0;
  g.input.held.add('KeyF');
  for (let i = 0; i < 60 * 40; i++) {
    const a = g.bullets.ammo; step(1);
    if (g.bullets.ammo < a) fired++;
    if (g.state === 'race' && Math.abs(k.speed) < 8 && i > 120) slow++;
  }
  g.input.held.delete('KeyF');
  out[map] = { state: g.state, ammo0, fired, slow, speed: +k.speed.toFixed(1) };
}
out;
```

`slow`가 수백 프레임 이하이고 `speed`가 살아 있으면 끼지 않은 것이다. `ammo0`이 20이면 재시작 복구도 정상이다.

## 전체 차량 전환

차 id는 `CARS`에서 확인해 모두 넣는다.

```js
const out = {};
for (const id of ['f1', 'senna', 'pony', 'racer', 'moto', 'cruiser', 'mantis', 'hunter', 'corsa', 'scout']) {
  await k.selectCar(id); await new Promise(r => setTimeout(r, 250));
  g.startCountdown(); g.countdown = .001; step(2); __bot.reset();
  let fired = 0; g.input.held.add('KeyF');
  for (let i = 0; i < 40; i++) { const x = g.bullets.ammo; step(1); if (g.bullets.ammo < x) fired++; }
  g.input.held.delete('KeyF');
  out[id] = { fired, gun: !!k.model.muzzle, wheels: k.model.wheels.length, steer: !!k.model.steering };
}
out;
```

## 혼자 달리기

```js
g.selectMode('solo'); g.selectMap('valley'); await new Promise(r => setTimeout(r, 1200));
g.startCountdown(); g.countdown = .001; step(2); __bot.reset();
```

## 정리

저장값을 지운다. 게임이 페이지를 떠날 때 다시 저장하므로 리스너도 건다.

```js
const clean = () => { for (const key of Object.keys(localStorage)) if (key.startsWith('kart-')) localStorage.removeItem(key); };
clean(); addEventListener('pagehide', clean);
```

탭을 닫고 서버를 포트로 종료한다. 이때 오는 `exit code 127` 알림은 강제 종료 때문이므로 무시한다.

```powershell
Get-NetTCPConnection -LocalPort 5199 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

마지막으로 `npx tsc --noEmit`과 `npm run build`를 실행한다. 500KB 청크 경고는 기존 것이다.
