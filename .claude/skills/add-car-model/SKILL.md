---
name: add-car-model
description: 이 레이싱 게임(Three.js/Vite)에 3D 모델을 플레이어 차량으로 추가하는 전체 절차. 모델 검토, 라이선스 확인, Blender 수정과 최적화, 도색 재질 분리, 총알 발사, 캐릭터 탑승 검토, 등록, 브라우저 검증까지 다룬다. 사용자가 3d/ 폴더의 glb나 다른 3D 모델을 언급하며 "이 차도 추가해줘", "차량으로 넣을 수 있는지 검토해줘", "이 모델 게임에 넣어줘", "총 쏘게 해줘", "캐릭터 태워줘"라고 하면 반드시 이 스킬을 쓴다. 이미 추가된 차의 도색 영역, 운전대, 좌석, 총, 캐릭터 위치를 고칠 때도 쓴다. 라이벌 차량을 교체할 때도 쓴다.
---

# 3D 모델을 차량으로 추가하기

사용자가 건넨 모델을 게임 차량으로 만드는 절차다. 사용자는 한국어로 대화하고, 결과를 보고 짧게 수정을 요청한다.

## 먼저 읽을 것

- `docs/adding-a-car.md`: 모델 규약(노드, 재질, 좌표, 크기), 빌드 단계, 능력치 표, 체크리스트, 문제 해결표. **규약의 기준이므로 항상 읽는다.**
- [references/character.md](references/character.md): 캐릭터 판단 순서와 새 클립 제작. 항상 읽는다.
- `.claude/skills/add-character/SKILL.md`: 운전자 캐릭터(방울 외 로봇 등)의 자세 확인과 수정. 새 차를 추가하면 그 스킬의 `DRIVE_CARS`(자동차)나 바이크 절차대로 로봇도 다시 빌드한다. 넣지 않으면 로봇이 그 차의 운전대를 잡지 못한다.
- [references/gun.md](references/gun.md): 총 관련 요청이나 총 달린 모델일 때 읽는다.
- [references/verify.md](references/verify.md): 브라우저 검증 단계에서 읽는다.
- `src/three/Kart.ts`의 `readCar`, `setupKartModel`: 규약이 코드와 맞는지 확인한다.

## 작업 규칙

- 커밋은 사용자가 "커밋해"라고 할 때만 한다. 푸시는 하지 않는다.
- 커밋에는 `models/x.glb`, `3d/X_game.blend`, 변경한 소스만 넣는다. 파일을 하나씩 지정한다. 원본 glb, `.blend1`, `race.zip`은 넣지 않는다.
- 원본 파일은 고치지 않는다. 스크립트로 다시 만들 수 있어야 사용자의 수정 요청에 빠르게 대응할 수 있다.
- 임시 스크립트는 세션 scratchpad에 둔다.
- 범위가 큰 추가는 검토 결과와 계획을 먼저 보여준다. 간단한 수정 요청은 바로 처리한다.
- 라이선스나 상표처럼 사용자가 결정할 문제만 묻고, 나머지는 판단해서 진행한다.

## 절차

### 1. 검토

`docs/adding-a-car.md` 2장의 명령으로 glb 헤더를 읽는다. 라이선스, 작성자, 주소, 삼각형 수, 재질, 텍스처, 애니메이션을 확인한다.

- CC BY-NC는 사용자 확인을 받는다. ND나 표시 없음은 쓰지 않는다.
- 게임 이름은 상표를 피해서 정한다.
- 원본의 삼각형 수와 목표(약 12,000~15,000개, 1MB 이하)를 비교한다.

사용자가 "검토해줘"라고만 했다면 여기서 결론을 보고한다. 가능 여부, 필요한 수정, 총과 캐릭터 처리 방향, 주의점을 적는다.

### 2. Blender로 확인

Blender 5.2를 CLI로 실행한다. MCP Blender는 보통 연결되어 있지 않다.

```powershell
$S='scratchpad 경로'; $K='C:\inetpub\wwwroot\test\race\.claude\skills\add-car-model\scripts'
$B='C:\Program Files\Blender Foundation\Blender 5.2\blender.exe'

$env:MODEL='C:\inetpub\wwwroot\test\race\3d\모델.glb'; $env:OUT="$S\x_raw.blend"
Copy-Item "$K\raw_import.py","$K\views.py","$K\blrun.py" $S
& $B --background --factory-startup --python "$S\blrun.py" -- "$S\raw_import.py" | Out-Null
Get-Content "$S\raw_import.py.json" -Raw

$env:BLEND="$S\x_raw.blend"; $env:PREFIX="$S\x"; $env:VIEW_SCALE='2.2'; $env:VIEW_Z='0'
& $B --background --factory-startup --python "$S\blrun.py" -- "$S\views.py" | Out-Null
```

`VIEW_SCALE`는 원본 길이에 조금 여유를 더한 값이다. 렌더를 읽고 확인한다.

- 앞뒤 방향, 운전석 쪽, 운전대와 좌석의 유무
- 창문이 메시인지 텍스처인지
- 로고, 번호판, 표식 (후면 포함)
- 튀어나온 조각
- 총의 구조와 받침대

추정한 값은 메시 수치로 다시 확인한다.

### 3. 캐릭터와 총 방향 결정

빌드 전에 결정한다. 노드 위치가 달라지기 때문이다.

- [references/character.md](references/character.md)의 판단 순서로 클립, `driverScale`, `Seat` 방향을 정한다.
- 총이 있으면 앉아서 운전하는지, 서서 쏘는지 사용자의 요청에 맞춘다. 앉는 차는 `Seat`, `Eye`를 차체에, 서는 차는 `Turret` 아래에 둔다.
- 없는 부품(운전대, 방석)을 만들 계획을 세운다.

### 4. 빌드 스크립트

`examples/`에서 가장 비슷한 차의 스크립트를 scratchpad로 복사해 고친다.

| 예시 | 이럴 때 |
|---|---|
| `scout_build.py` | 재질 하나로 뭉친 모델, 텍스처 아틀라스, 붙어 있는 총, 운전대와 방석 제작 |
| `humvee_build.py` | 텍스처 여러 장을 아틀라스로 합침, 포인트 색 텍스처, 분리된 총 |
| `stradale_build.py` | 텍스처 없이 재질로 색칠, 바퀴를 회전체로 새로 제작 |
| `vortex_build.py` | 조각 수천 개짜리 고폴리 모델을 재질별로 분리, 구겨지는 대시보드를 판으로 교체, 투톤 포인트 |
| `senna_ext.py`, `senna_build.py` | 외관 품질 우선. 보이는 면만 골라 재질별로 줄이고, 받침 껍데기와 원본 법선으로 매끈하게 |
| `monza_build.py` | 한 메시에 여러 부품이 섞인 모델, 조각 단위 분리, 스포크 휠과 운전대 제작 |
| `cuneo_build.py` | 메시와 재질이 잘 나뉜 초고폴리 모델, 여러 메시를 합쳐 줄이기, 엔진을 지운 자리 막기, 오른쪽 운전석 |
| `titan_build.py` | 궤도 차량. 조각을 위치로 분류, 궤도를 벨트로 교체(궤도 경로는 원본 슈 중심에서 재서 JSON으로 입력), 포탑 분리, 밝은 텍스처 하나로 합침 |
| `enduro_build.py`, `enduro_import.py` | 부품이 수천 개로 나뉜 바이크, 부모 이름으로 부품 고르기, 찢어진 패널 닫기, `Fork`와 `Steering` 구조, 스포크 휠 제작 |

예시의 `SCRATCH` 경로와 `uaz_raw.blend` 같은 입력 이름은 지금 세션에 맞게 바꾼다.

놓치기 쉬운 점이다. 각각 실제로 문제가 났던 항목이다.

- 면을 줄이기 전에 용접한다. glTF는 UV 경계에서 버텍스가 나뉘어 있어 그냥 줄이면 찢어진다.
- 바퀴는 연결 조각이 아니라 **위치**로 나눈다. 한 바퀴가 여러 UV 조각이라 일부만 분리되는 일이 생긴다.
- 차체 메시에 있는 허브 면도 바퀴로 옮긴다.
- 네 바퀴 좌표의 좌우 대칭을 확인한다.
- 합친 메시에는 재질 슬롯이 없다. 슬롯 수를 바꾸면 번호 상수도 바꾼다.

#### 도색 범위

처음부터 단순하게 나눈다. 사용자는 경계가 지저분한 도색을 싫어했고, Hunter에서는 지붕에서 후면으로 이어지는 넓은 덩어리를 포인트로 원했으며, Scout에서는 포인트를 없애고 전체를 칠하길 원했다.

- 차체 전체를 `body`로 둔다.
- 메시 경계가 분명하고 넓은 부위가 있을 때만 `Livery Colour 2`를 쓴다.
- 고정 색은 바닥, 좌석, 바퀴, 총, 연료통, 후미등처럼 다른 물체로 보이는 것만 둔다.
- 어두운 텍스처는 밝은 전용 텍스처로 바꾸고 원래 어둡기는 재질 색으로 옮긴다.
- 칠하는 부위의 metallic은 낮춘다. 환경맵이 없어 금속이 검게 보인다.

### 5. 렌더로 검증

```powershell
$env:BLEND='C:\inetpub\wwwroot\test\race\3d\X_game.blend'; $env:PREFIX="$S\x_built"; $env:VIEW_SCALE='6.2'; $env:VIEW_Z='1.2'; $env:VIEW_MODE='MATERIAL'
& $B --background --factory-startup --python "$S\blrun.py" -- "$S\views.py" | Out-Null
```

`MATERIAL`은 형태와 재질 분류를, `TEXTURE`는 표식 제거와 색을 보여준다. 게임에서는 재질 색이 곱해지므로 `body` 텍스처는 렌더에서 밝게 보이는 것이 정상이다.

### 6. 코드 등록

`docs/adding-a-car.md` 6장을 따른다.

- `src/config.ts`: `CarId`, `CARS` 항목, 필요하면 `CarRide`
- 능력치 합 15, 각 값 1~5, 기존 차와 겹치지 않게
- `CREDITS.md`: 출처와 수정 내용
- 새 차는 따로 등록하지 않아도 상대 차 선택 화면(`RivalPanel`, `AI_CAR_CHOICES`)에 나와 AI가 탈 수 있다. AI 차는 개러지 도색 없이 기본 색이다.
- 총이 있으면 `index.html` 도움말

### 7. 브라우저 검증

[references/verify.md](references/verify.md)대로 실행한다. 렌더에서 괜찮아도 게임에서 다른 문제가 나온다. Scout의 운전대 문제와 패턴 문제가 게임에서만 발견됐다.

순서는 다음과 같다.

1. 개러지: 모든 각도, 색, 패턴
2. 캐릭터: 측면에서 자세, 운전대와의 틈
3. 운전자 시점: 운전대, 시야
4. 총: [references/gun.md](references/gun.md)의 발사 검증
5. 맵 5개 주행, 전체 차량 전환, 혼자 달리기
6. 콘솔 오류, `tsc`, `npm run build`
7. 저장값, 탭, 서버 정리

모델이나 코드를 고치면 영향받는 항목을 다시 확인한다. 공용 코드(`CarPaint`, `Bullets`, 캐릭터)를 고치면 다른 차도 확인한다.

### 8. 보고

한국어로 보고한다.

- 결론 먼저. 무엇이 됐는지
- 삼각형 수, 파일 크기, 능력치
- 캐릭터와 총을 어떻게 처리했는지
- 검증한 범위. 다시 확인하지 못한 항목은 그렇게 적는다
- 남은 문제, 커밋 대상

## 수정 요청을 받았을 때

사용자는 게임을 보고 짧게 요청한다. 스크립트 값을 고쳐 다시 빌드한다.

| 요청 | 고칠 곳 |
|---|---|
| 운전대가 겹친다, 안 보인다 | `STEER`, `Eye`, `eyePitch` |
| 캐릭터가 크다, 뜬다, 뚫는다 | `driverScale`, `Seat`, 방석 |
| 색 바뀌는 영역이 이상하다 | 재질 분류 코드. 단순하게 만든다 |
| 색이 탁하다 | 전용 밝은 텍스처, 재질 색 |
| 총이 이상하다 | `Turret`, `Muzzle`, 자르는 높이 |
| 차가 빠르다, 느리다 | `CARS`의 `stats`, 합 15 유지 |

수정 뒤에는 관련 항목을 게임에서 다시 보고, 공용 기능을 없앴다면(예: 포인트 재질) 그것에 기대던 기능(패턴 두 번째 색)도 확인한다.

## 절차를 개선할 때

새로 겪은 문제는 `docs/adding-a-car.md`의 문제 해결표나 이 스킬에 추가한다. 새로 만든 빌드 스크립트가 쓸모 있으면 `examples/`에 넣는다.
