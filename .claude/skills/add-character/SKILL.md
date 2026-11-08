---
name: add-character
description: 이 레이싱 게임(Three.js/Vite)에 운전자 캐릭터(사람, 로봇, 동물 등 3D 모델)를 추가하고, 모든 자동차·오토바이·포탑에 앉힌 자세를 확인하고 고치는 절차. 사용자가 3d/ 폴더의 캐릭터 모델을 주며 "캐릭터로 추가해줘", "운전자로 넣어줘", "AI가 타게 해줘"라고 하거나, 이미 있는 캐릭터의 자세를 고칠 때("엉덩이가 떠있어", "핸들을 안 잡아", "고개가 이상해", "덩치를 키워줘", "다리가 움직여") 반드시 이 스킬을 쓴다. 새 차를 추가한 뒤 캐릭터들을 그 차에 맞출 때도 쓴다.
---

# 캐릭터 추가와 자세 맞추기

사용자는 한국어로 대화하고, 게임 화면을 보며 짧게 고칠 점을 말한다("엉덩이가 떠있어", "1.2배 키워"). 이 스킬은 캐릭터를 게임에 넣는 일과, 그 뒤 탈것마다 자세를 확인하고 고치는 반복을 다룬다.

## 먼저 읽을 것

- [references/grip.md](references/grip.md): 운전대와 핸들을 잡는 기본 자세. 사용자가 맞다고 한 기준이다. **항상 읽는다.**
- [references/bikes.md](references/bikes.md): 오토바이, 쿼드에 앉힐 때의 주의점
- [references/cars.md](references/cars.md): 자동차, 포탑에 앉힐 때의 주의점
- `.claude/skills/add-car-model/references/character.md`: 뼈대, 클립, `driverScale`, `Seat`의 구조와 로봇을 만들며 겪은 함정
- `.claude/skills/add-car-model/examples/robot_build.py`: 지금까지의 캐릭터 빌드 스크립트. 새 캐릭터도 이것을 복사해 시작한다.

## 작업 규칙

- 커밋은 사용자가 "커밋해"라고 할 때만 한다. 푸시는 하지 않는다. 파일을 하나씩 지정한다(`models/x.glb`, `3d/X_game.blend`, 변경한 소스, 스킬 문서). 원본 glb, `.blend1`, `race.zip`은 넣지 않는다.
- 원본 모델은 고치지 않는다. 빌드 스크립트 한 번으로 blend와 glb를 다시 만들 수 있어야 수정 요청에 빨리 답할 수 있다.
- 임시 스크립트와 렌더는 세션 scratchpad에 둔다.
- 자세 값(크기, 각도, 위치)은 코드가 아니라 빌드 스크립트의 클립에 넣는다. 코드에서 운전자 그룹 크기를 바꾸면 손이 운전대에서 떨어진다.
- 사용자의 말을 문서에 짧게 인용해 둔다. 다음에 같은 요청이 오면 기준이 된다.

## 구조 (요약)

- 모든 캐릭터는 방울의 Mixamo 뼈대(`3d/bangul_m_drive.blend`)와 클립 이름(`Drive`, `Moto`, `Cruiser`, `Dirt`, `Quad`, `Gunner`)을 쓴다. 그래서 어느 차에도 앉는다.
- 게임은 차 모델의 `Seat` 아래에 캐릭터를 붙이고 `ride.driverScale`로 줄인 뒤 `ride.clip`을 재생한다. 그 차 전용 클립(`Drive.senna`, `Gunner.titan`)이 glb에 있으면 그것을 먼저 쓴다(`Driver.play(ride, carId)`).
- 캐릭터 목록은 `src/config.ts`의 `CHARACTERS`, AI 운전자는 `AI_CHARACTER`. 개러지의 캐릭터 칩은 `GaragePanel.ts`가 이 목록으로 만든다.

## 절차

### 1. 검토

`add-car-model` 스킬 1장처럼 glb 헤더를 읽는다. 라이선스(CC BY-NC는 확인, ND는 사용 불가), 삼각형 수(약 8,000 목표, AI 여러 대가 복사해 쓴다), 텍스처, 뼈대와 애니메이션 유무를 본다. `raw_import.py`, `views.py`로 원본 자세(T/A 포즈), 앞 방향, 관절 위치를 렌더해 본다.

### 2. 빌드 스크립트

`examples/robot_build.py`를 scratchpad로 복사해 고친다. 하는 일은 다음과 같다.

1. `bangul_m_drive.blend`를 열어 뼈대와 Action만 남긴다.
2. 새 모델을 뼈대 높이에 맞춰 축척하고, 뼈 관절 위치를 새 모델 관절로 옮긴다. 뼈 방향과 roll은 크게 바꾸지 않는다.
3. 기계 부품은 조각마다 가장 가까운 뼈 하나에 가중치 1을 준다(자동 가중치는 고무처럼 휜다).
4. 체형 보정: 너무 가늘면 뼈와 수직 방향으로만 키운다(`BULK_*`).
5. 클립마다 캐릭터 전용 클립을 새로 만든다. 방울의 엉덩이 위치와 척추·머리 각도만 가져오고, 방울의 뼈 늘이기와 머리 줄이기는 버린다. 팔다리는 IK로 다시 놓는다. 자세 규칙은 [grip.md](references/grip.md), [bikes.md](references/bikes.md), [cars.md](references/cars.md)를 따른다.
6. 저장 전에 `bpy.context.preferences.filepaths.save_version = 0`(`.blend1` 잠금 오류 방지), glTF는 `export_animation_mode='ACTIONS'`, `export_skins=True`로 내보낸다. 결과 `result`에 차별 진단값(기울기, 이동, 크기, 머리 위 여유, 골반 틈)을 담는다.

실행:

```powershell
$S='scratchpad 경로'; $B='C:\Program Files\Blender Foundation\Blender 5.2\blender.exe'
Copy-Item 'C:\inetpub\wwwroot\test\race\.claude\skills\add-car-model\scripts\blrun.py' $S
& $B --background --factory-startup --python "$S\blrun.py" -- "$S\x_build.py" | Out-Null
Get-Content "$S\x_build.py.json" -Raw
```

`"error"` 키가 있으면 traceback이다. 빌드는 1분 남짓 걸린다.

### 3. 코드 등록

- `CharacterId`, `CHARACTERS`에 항목 추가(`helmets`: 헬멧을 쓰는 체형인지, `credit`: 출처). AI가 타게 하려면 `AI_CHARACTER`.
- `CREDITS.md`에 출처와 수정 내용.
- 새 클립 이름 접두사가 `CARS`의 `ride.clip` 중 하나여야 `Driver`가 읽는다(`Drive.x`, `Gunner.x`).

### 4. 렌더로 확인 (매번)

`scripts/`의 두 스크립트로 모든 탈것을 본다. 차 glb를 `Seat` 기준 캐릭터 좌표로 불러와 게임과 같은 자리에 겹친다.

```powershell
$K='C:\inetpub\wwwroot\test\race\.claude\skills\add-character\scripts'
Copy-Item "$K\seat_check.py","$K\seat_view.py" $S   # 결과 json이 스크립트 옆에 생기므로 scratchpad에서 돌린다 (cars.py는 $K에서 읽는다)
$env:BLEND='C:\inetpub\wwwroot\test\race\3d\X_game.blend'; $env:OUT=$S
$env:CARS='f1,racer,corsa,barchetta,cuneo,vortex,senna,pony,scout,hunter,titan,moto,cruiser,enduro,mantis'
& $B --background --factory-startup --python "$S\blrun.py" -- "$S\seat_check.py" | Out-Null; Get-Content "$S\seat_check.py.json" -Raw
& $B --background --factory-startup --python "$S\blrun.py" -- "$S\seat_view.py" | Out-Null   # $S\seat_<car>.png
```

- `seat_view.py`: 반투명 측면 렌더. `SOLO=1`은 캐릭터만(자세 모양), `OPAQUE=1`은 불투명 차(밖으로 튀어나온 곳), `OTHER=1`은 반대편.
- `seat_check.py`: 손목과 잡을 곳(`gap` 약 0.2가 정상, 0.35 넘으면 안 잡은 것), 발끝과 바닥, 머리 위 여유, 클립 동안 관절 이동량(`travel`, 자동차는 0에 가까워야 함). `PROFILE=1`이면 x=`X` 단면을 위에서 아래로 쏜 높이들(방석, 등받이, 바닥 모양 파악).
- 차 목록은 `scripts/cars.py`. 차를 추가하거나 `driverScale`을 바꾸면 함께 고친다.

렌더 읽는 법: 캐릭터는 왼쪽을 본다. 확인할 것은 [grip.md](references/grip.md)의 "확인 목록"이다. 이상하면 원인을 숫자로 찾는다(단면, 손 위치, 이동량). 추측으로 값을 바꾸지 않는다.

### 5. 게임에서 확인

`add-car-model/references/verify.md`대로 vite(예: 5199 포트)를 띄워 개러지에서 캐릭터를 고르고 차를 바꿔 본다. 개러지는 끌어서 돌릴 수 있다. 짙은 유리 차(Racer 측면, Senna)는 안이 보이지 않으니 렌더로 판단한다. AI 레이스(1:1, 여러 대)에서 AI 차에 앉는지도 본다. 콘솔 오류, `npx tsc --noEmit`, `npm run build`. 끝나면 탭을 닫고 서버를 끈다.

### 6. 문서와 보고

- 빌드 스크립트를 `add-car-model/examples/`에 복사하고, 새로 겪은 문제는 이 스킬의 references에 추가한다.
- 한국어로 보고한다. 결론 먼저, 무엇을 고쳤는지 원인과 함께, 렌더로만 본 것과 게임에서 본 것을 나눠 적고, 요청과 다르게 된 값(예: 지붕 때문에 1.4배 대신 1.25배)은 이유와 선택지를 적는다. 커밋 대상 파일을 적는다.

## 수정 요청 대응표

| 요청 | 원인 후보 | 고칠 곳 |
|---|---|---|
| 덩치가 작다/크다 (전체) | 클립별 높이 | `HEIGHT` (엉덩이 위 높이를 방울의 몇 배로) |
| 이 차만 키워줘 | | `CAR_SIZE[car]`, 포탑 차는 `GUNNER_CARS`에도 |
| 엉덩이가 묻혀/떠 있다 (바이크) | 가장 낮은 점만 맞춤 | `HIP_SHIFT` (bikes.md의 앞뒤 구간 측정) |
| 엉덩이가 앞으로 빠져 누워 있다 (차) | 등받이 기울기만 따름 | `sit_back` (cars.md) |
| 좌석 위로 떠 있다 (차) | 기울어진 등받이를 방석으로 읽음 | `settle`의 수평면 조건 |
| 핸들을 안 잡는다 | 방울의 손 위치 사용 | 차의 `Steering` 테두리 (grip.md) |
| 얼굴이 핸들에 붙었다 | 숙임이 큼 | `FACE_CLEAR`, `MAX_BACK` |
| 고개가 들렸다/숙였다 | 척추 회전이 머리까지 감 | `look_ahead`, `upright(['Neck','Head'])` |
| 머리가 지붕을 뚫는다 | 몸이 서 있거나 좌석이 높음 | `fit_roof`, 눕힘 각도 `RECLINE_FIX` |
| 발이 바닥을 뚫는다/떠 있다 | 바닥 광선이 대시보드에 맞음 | `place_limbs`의 바닥 광선 시작 높이 |
| 다리가 움직인다 | 프레임마다 바닥 광선이 다른 면에 맞음 | `foot_lock` (첫 프레임 고정) |
| 팔꿈치/무릎이 뒤집혔다 | 방울의 굽는 면 사용 | `ELBOW_POINTS`, `KNEE_POINTS` |
