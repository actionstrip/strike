---
name: lowpoly-character-pipeline
description: 참고 이미지(캐릭터 시트, 로우폴리 렌더)로 이 프로젝트용 로우폴리 캐릭터를 블렌더에서 만들고, 뼈대와 Idle/Walk/Ride 애니메이션을 넣어 GLB로 내보낸 뒤, 미니홈피 방 게임에 조작 가능한 캐릭터로 연결하는 전체 과정. 빙빙이·방울이를 만든 방식 그대로. "캐릭터 만들어줘", "블렌더로 캐릭터", "게임에 연결", "애니메이션 넣어줘", 새 캐릭터 시트 이미지를 줄 때 사용.
---

# 로우폴리 캐릭터 제작 → 애니메이션 → 게임 연결

2026-10-22에 **빙빙이**(bingbing)와 **방울이**(bangul)를 만든 과정을 정리한 것. 새 캐릭터도 **반드시 같은 규격·방식**으로 만든다 (사용자 요구: "스케일이나 방식은 똑같아야 해").
사용자와는 **한국어**로 대화한다.

## 0. 파일 위치와 이름 규칙

| 무엇 | 위치 |
|---|---|
| 참고 이미지 | `E:\project\+캐릭터들\*.png` (캐릭터 시트 = 정면/45도/측면/후면/상면 + 색상표, 로우폴리 렌더 1장) |
| 블렌더 원본 | `E:\project\+캐릭터들\blender\<id>_motion.blend` (캐릭터 하나당 파일 하나) |
| 비교 렌더 | `E:\project\+캐릭터들\blender\<id>_renders\` (사용자가 저장을 원함) |
| GLB | 저장소 `models/<id>.glb` |
| 게임 등록 | `src/config.ts`의 `FIGURES` 배열 |
| 블렌더 도구 | 이 스킬의 `scripts/lowpoly_lib.py`, 템플릿 `scripts/example_bangul.py` |

- `<id>` = 한글 이름에서 끝의 '이'를 뺀 로마자: 빙빙이 → `bingbing`, 방울이 → `bangul`.
- 이름을 모르면 먼저 물어보거나, 임시 id로 만들고 나중에 `mv`로 파일 이름을 바꾼다. 파일 삭제(`rm`)는 권한이 거부되므로 쓰지 않는다.
- 블렌더 안 이름: 컬렉션 `<Id>`, 뼈대 `RIG-<id>`, 부위 `GEO-<부위>[_L|_R]`, 재질 `MAT-<이름>`.

## 1. 공통 규격 (절대 바꾸지 말 것)

- 키 **2.0**, 발바닥 **z=0**, 정면 **-Y**, 캐릭터의 왼쪽 = **+X** (`_L`, `.L`).
- 머리(머리카락 포함)가 키의 약 절반, 턱 z ≈ 1.03~1.06.
- 부위별 메시를 뼈 하나에 통째로 붙임 (bone parenting, 가중치 없음), **플랫 셰이딩**.
- 뼈 8개 `root, hips, spine, head, arm.L/R, leg.L/R`. 위치는 `create_rig` 기본값 (팔·다리 x만 캐릭터에 맞게 조금 조정).
- 액션 **Idle(48f) / Walk(24f) / Ride(48f)**, 24fps, 모든 뼈에 키 → `make_actions`로 만들면 값이 모든 캐릭터에서 같음.
  - Ride = 세그웨이 손잡이를 잡는 자세 (팔 -1.45rad 앞으로)
  - Walk 보폭이 같아서 게임 `FIGURE.walkStride = 0.8`을 공유. 다리 길이(고관절 0.46)를 크게 바꾸면 보폭을 다시 계산.
- 게임은 모든 모델을 같은 배율 `FIGURE.height / FIGURE.modelHeight` = 1.8 / 2.0 = 0.9배로 키움. 몸(턱 1.03~1.06, 신발~턱 비율)은 규격대로 두고, 머리 위로 솟은 장식(홍이 퀴프)은 2.0을 넘어도 됨 → 조작 화살표는 실제 꼭대기 위에 뜸.
- **키가 다른 캐릭터**(뚜루뚜루 1.58): 사용자가 키 비교 그림(`E:\project\+캐릭터들\캐릭터키.png`)을 주면 빙빙이(2.0) 기준 픽셀 비율로 키를 정함. 뼈대·액션은 그대로(같은 Walk 보폭), 메시만 작게. 머리와 몸이 한 덩어리면 몸·얼굴은 spine에, 안테나 같은 머리 장식은 head에 붙임.

## 2. 작업 순서

### 2-1. 블렌더 준비
1. 블렌더 MCP(공식 backend) 연결 확인: `bpy.data.filepath`, `bpy.data.is_dirty` 확인.
2. 열린 파일이 저장돼 있으면 **새 이름으로 `save_as_mainfile` 먼저** → 그 다음 새 파일 안에서 이전 캐릭터 데이터를 지운다 (원본 .blend는 디스크에 그대로 남음).
   - 이전 컬렉션 객체 삭제, `Idle/Walk/Ride` 액션 삭제, `bpy.data.orphans_purge(do_recursive=True)` 3번.
   - `Light`, `Camera`, `GND-floor`(바닥)는 렌더 확인용으로 남겨 둠.
   - ⚠️ `wm.read_homefile` / `read_factory_settings`는 MCP 연결이 끊길 수 있으니 쓰지 않는다.
3. **.blend 하나에 캐릭터 하나만** 둔다 (GLB `ACTIONS` 모드가 파일 안의 모든 액션을 내보냄).

### 2-2. 참고 이미지 분석 (치수 재기)
캐릭터 시트 **정면 패널**에서 픽셀로 잰다.
- `1px = 2.0 / (신발 바닥 y − 머리 꼭대기 y)`, `z = (신발 바닥 y − 점 y) × 1px`, `x = (점 x − 몸 중심 x) × 1px`
- 잴 것: 머리카락 폭·앞/옆/뒤 끝 높이, 턱, 얼굴 폭, 안경(중심·크기), 눈·입 높이, 귀, 옷 위·아래 끝과 폭, 소매, 주먹, 다리·양말·신발 높이와 폭.
- 측면 패널로 깊이(머리카락 앞뒤, 몸통 두께, 신발 길이), 후면으로 뒷머리 끝 높이를 확인.
- 색은 시트의 **주요 색상** 칸에서 hex로 고른다.
- 사용자에게 먼저 짧게 "이 캐릭터의 특징" 목록을 보여주고 시작.


```python
import sys, importlib
sys.path.insert(0, r"E:\inetpub\wwwroot\test\pixi_ai\threejs\.claude\skills\lowpoly-character-pipeline\scripts")
import lowpoly_lib as L, <id> as C; importlib.reload(L); importlib.reload(C)
rig = C.build()
result = {"objs": len(rig.users_collection[0].objects)}
```
- 템플릿 구조: `PALETTE` → `create_rig` → `build_body` → `build_head` → `make_actions`.
- **얼굴(`GEO-head`)을 먼저** 만들고, 눈·입·볼·안경 깊이는 `L.face_hit`(레이캐스트)로 얼굴 표면에 붙인다. 얼굴 실루엣 끝(x가 너무 바깥)은 빗나가므로 안쪽으로.
- 수정을 반복할 땐 같은 이름으로 `b.make(...)`를 다시 부르면 메시만 갈아끼워진다 (뼈 연결 유지). 이때 `rig.data.pose_position = 'REST'` (Builder가 자동으로 함).
- 쓸 수 있는 부품 함수 (`lowpoly_lib.py`):
  - 몸통·팔다리: `cyl`(8각 평평한 면이 정면이려면 `rot=π/8`), `box`, `ellipsoid`, `ico`(주먹)
  - 얼굴: `head_mesh`(볼 통통), `hair_dome` + `zcut_quadratic`(앞/옆/뒤 끝 높이, `tilt`=옆가르마), `tapered_bundle`(양갈래), `swept_crescent`(퀴프·퐁파두르. 뒷머리 돔과 사이는 ellipsoid로 채움)
  - 머리=몸 한 덩어리(마스코트형): `scripts/tturu.py`의 `rounded_column` (높이별 둥근 사각 단면)
  - 아프로·곱슬 덩어리: `scripts/smith.py`의 `afro` (노이즈 혹은 ±0.03, freq 5 이상. 낮으면 덩어리째 일그러짐)
  - 안경: `ring_frame`(둥근 테), `rect_frame`(사각 테), `disc_with_uv` + `spiral_image`(나선 렌즈)
  - 장식·얼굴 디테일: `flat_polygon` + `star_points`(가슴 무늬), `flat_bottom_dome`(신발·앞코), `tube_mesh` + `smile_points`(입·눈썹), `on_face_disc`(볼)
- 머리카락 두께: 객체에 `Solidify(thickness 0.04~0.045, offset -1)`.

### 2-4. 참고 시트와 비교 → 수정 반복
```python
files = L.render_views(r"E:\project\+캐릭터들\blender\<id>_renders", "v1", hide=[rig])
# 머리 위 장식이 큰 캐릭터: views 높이 1.25 + ortho=2.9
# 키 작은 캐릭터: views 높이 0.78 + ortho=1.8 + target=(0, 0, 0.78) (기본 target 높이 1.0이면 다리가 잘림)
```
- 정면/측면/후면/45도/뒤45도 직교 렌더를 Read로 보고 시트와 비교 → 다른 점을 표로 정리 → 수정 → `v2`, `v3`…
- 작은 디테일(눈 등)은 전체 렌더에서 안 보일 수 있다 → 얼굴 클로즈업(ortho_scale 1.0, 카메라 (0,-6,1.35))으로 확인.
- 자주 고친 것: 머리카락 볼륨(뒤로 물러나 얼굴이 튀어나와 보임 → 앞쪽 `ry_front` 키우고 `E=0.8`), 뒷머리를 뒷목까지, 안경 크기/간격, 볼이 얼굴 밖으로 나감.

### 2-5. 애니메이션 확인
```python
L.render_views(out, "v2", hide=[rig], shots=[("Walk",7,(-4.2,-4.2,1.0),"walk7_45"), ("Walk",7,(-6,0,1.0),"walk7_side"), ("Ride",1,(-4.2,-4.2,1.0),"ride_45")])
```
- Walk 7프레임 = 왼발 앞 최대, Ride = 양손 앞. 팔·소매가 몸을 뚫거나 어색하면 부위 위치를 조정 (액션 값은 바꾸지 않음).
- Ride 손 위치 확인: 손 메시 중심 x가 **±0.20~0.21** (빙빙이 0.202, 방울이 0.21, 권이 0.201, 스미스 0.216, 홍이만 0.153). 팔뼈가 많이 기울면(`hand` x가 어깨보다 훨씬 바깥) 팔을 앞으로 돌릴 때 두 손이 가운데로 모임 → 손 메시는 그대로 두고 `create_rig`의 `hand` x만 조정 (권이: 주먹 0.445, 뼈 끝 0.375).

### 2-6. 내보내기 + 저장
```python
info = L.export_glb(col, rig, r"E:\inetpub\wwwroot\test\pixi_ai\threejs\models\<id>.glb")
bpy.ops.wm.save_mainfile()
```
- 확인: `anims == ["Idle","Ride","Walk"]`, `height == 2.0` (머리 위 장식이 있으면 그만큼 큼, 홍이 2.57), `min_z == 0`, 모든 부위가 뼈 노드 아래에 있음 (`bone_children`).

### 2-7. 게임 연결
1. `src/config.ts`의 `FIGURES`에 한 줄 추가:
   ```ts
   { id: '<id>', name: '<한글 이름>', url: new URL('../models/<id>.glb', import.meta.url).href },
   ```
   → 방의 빈 자리에 세워지고, F 키 조작 순환(세그웨이 → FIGURES 순서)에 들어가고, E로 세그웨이에 탈 수 있음.
2. `src/ui/Hud.ts`의 안내 문구 `F 조작 대상 전환(세그웨이/빙빙이/방울이)`에 이름 추가.
3. `npx tsc --noEmit`.
4. 브라우저 확인 (아래 3번 참고): F 순환, 걷기 `Walk`, 세그웨이 옆 E → `Ride`, 다시 E → 내림, 콘솔 에러 없음.
5. 커밋은 사용자가 요청할 때만 (`dev` 브랜치, 저장소 밖 .blend는 커밋 안 됨). 메모리 `lowpoly-characters.md`에 캐릭터 추가.

### 2-8. 이미 리깅된 모델 가져오기 (Mixamo FBX 등) — 방울이M(`bangul_m`) 방식
직접 만들지 않고 사용자가 리깅된 모델을 블렌더에 열어 준 경우. 템플릿은 `scripts/bangul_m.py`.
1. **먼저 읽기 전용으로 검토**하고 결과를 보고:
   - 메시별 삼각형 수: 우리 캐릭터는 1~3k
   - 뼈 이름·개수, 가중치 없는 정점, 정점당 뼈 영향 수(glTF는 4개까지)
   - 액션, 비어 있는 이미지 텍스처
   - 월드 높이와 축 (FBX는 Armature 회전 90°·배율 0.01)
2. 원본은 두고 `blender\<id>_motion.blend`로 새로 저장한 뒤 작업.
3. 기존 액션을 떼고 지운 뒤, Armature와 메시를 함께 선택해 `transform_apply`로 회전·배율을 적용. Armature 배율로 키 2.0, 발바닥 z=0을 맞추고 다시 적용. 정면 -Y, 왼쪽 +X 확인.
4. 빈 텍스처 재질은 단색으로 바꿈. 눈은 구의 면을 방향으로 골라 하이라이트 면만 흰색.
5. 메시마다 `vertex_group_limit_total(limit=4)` + `vertex_group_normalize_all`.
6. 무거운 메시(손가락 손, 눈썹, 머리끝, 안경 등)는 Decimate(Collapse)를 맨 앞에 넣고 적용 → 전체 약 10k. 가중치는 유지됨. 렌더로 실루엣 확인.
7. 애니메이션은 `bangul_m.py`의 `Pose`처럼 **월드 축 회전을 뼈 로컬 quaternion으로 바꿔** 넣음 (`rest⁻¹ · q · rest`). Mixamo 뼈 축을 몰라도 됨.
   - 팔은 T자에서 Y축으로 내림
   - 다리는 `UpLeg` 흔들기 + `Leg` 무릎(앞으로 지나갈 때 굽힘) + `Foot` 수평 유지, 다리가 벌어질 때 `Hips`를 낮춤
   - 보폭: Walk 7프레임의 두 발끝 y 차이 × 2 ≈ **0.889** (게임 0.8 ÷ 0.9배)가 되게 다리 흔들기 각도를 맞춤
   - Ride 손 x ≈ ±0.20
8. 내보내기는 `lowpoly_lib.export_glb`가 아니라 스킨용 설정으로: `export_apply=False`(Armature 수정자 적용 안 함), `export_skins=True`, `export_influence_nb=4`, ACTIONS.
9. 선택 동작 `Jump` (방울이M만): 16프레임(0.67초), 높이 0.9, 루프 아님.
   - 팔이 짧고 머리가 큰 캐릭터는 팔을 머리 위로 올리면 머리에 묻힘 → 공중에서는 양옆 위로 벌림
   - 엉덩이를 들어 몸 전체가 뜨게 함. 웅크릴 때는 `acos(1 - 낮춘 높이 / 고관절~발목 길이)`만큼 다리를 접어야 발이 바닥을 뚫지 않음
   - 게임은 `Figure.jump()`가 한 번 재생(`LoopOnce` + `clampWhenFinished`)하고, `finished` 이벤트 뒤 Walk/Idle로 돌아감. 키는 `CONTROLS.jumpKey`(Space)
   - Jump 클립이 없는 캐릭터는 반응하지 않음
10. three.js 0.180의 `Box3.setFromObject`는 스킨 메시를 불러온 순간의 기본 자세로 재므로, 높이·발바닥이 그대로 맞음 (Figure.ts 수정 불필요).

## 3. 게임 쪽 구조 (이미 만들어져 있음)

- `src/three/Figure.ts`: GLB 로드, 키 1.8로 맞춤, `AnimationMixer`로 Idle/Walk/Ride 크로스페이드, Walk 재생 속도 = 이동속도 / `walkStride`.
  - 로더가 여러 트랙에 **같은 시간 배열을 공유**하므로, 1프레임(1/24초) 시작을 0으로 당길 때 배열마다 한 번만 당긴다 (이미 처리됨. 안 하면 Walk가 0.7초로 짧아짐).
- `src/Game.ts`: `figures[]`, `control`(null = 세그웨이), `walker`(조작 중이고 안 탄 캐릭터), F/E/C 키, 충돌(`resolve` + `standingObstacles`), 조작 표시 화살표(`ControlArrow`).
- 브라우저 확인 방법:
  - `npx vite --port 5199 --strictPort`를 백그라운드로 실행 → Chrome에서 **`http://[::1]:5199/`** (localhost가 안 열릴 때가 있음).
  - 개발 모드에서 `window.game` 노출. 예:
    ```js
    const g = window.game; window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyF'}));
    const f = g.figures[1]; const s = g.segway.root.position; f.group.position.set(s.x - 1, 0, s.z); // 세그웨이 옆에 세우기
    window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyE'}));   // 태우기
    g.input.target = new s.constructor(s.x + 2.5, 0, s.z);                // 클릭 이동
    JSON.stringify({ rider: g.rider?.name, clip: f.current })
    ```
  - 가운데 둥근 탁자 등 가구에 막히면 멈추는 게 정상 (충돌). 자동화 탭은 초당 몇 프레임이라 애니메이션 전환이 늦게 보일 수 있음.
  - 끝나면 탭 닫고 TaskStop + `netstat -ano | grep :5199`로 남은 vite 프로세스 `taskkill //PID <pid> //T //F`.

## 4. 겪은 문제와 해결

- MCP `result`는 **dict**여야 함 (list면 에러).
- bmesh: `bisect_plane(plane_co=, plane_no=)` (co/no 아님), `create_cone(radius1, radius2, depth, segments)`.
- 부위를 뼈에 붙일 때 rig는 **REST** 자세, 붙인 뒤 `matrix_world = Identity` (정점을 월드 좌표로 만들었으므로).
- 커브(입)는 GLB 전에 메시로 바꿔야 함 → `tube_mesh`가 처음부터 메시로 만듦.
- 렌즈 등 한쪽만 보여야 하는 면: 재질 `use_backface_culling = True` (GLB doubleSided=false).
- 높이 측정은 REST 자세에서 (`export_glb`가 처리).
- 비교·확인 렌더는 임시 카메라(`TMP-cam`)로 하고 지움, 사용자 씬 카메라는 그대로 둠.

## 5. 만든 캐릭터 기록 (치수 참고용)

| | 빙빙이 bingbing | 방울이 bangul | 홍이 hong | 권이 gwon | 뚜루뚜루 tturu | 스미스 smith |
|---|---|---|---|---|---|---|
| 특징 | 최면 나선 둥근 안경, 바가지 머리, 주황 번개 티, 청록 반바지, 클로그 | 빨간 사각 안경, 옆가르마+양갈래, 흰 티+빨간 A라인 원피스(흰 별), 진보라 긴 양말, 보라 운동화 | 빨간 초승달 퀴프+낮은 양갈래, 성난 눈썹·점 눈, 큰 귀, 노란 점프수트(주황 지퍼·번개 고리), 검은 신발 | 검은 퐁파두르+삐죽 2개, 굵은 눈썹·사선 볼터치, 흰 도복(검은 V깃·검은 띠·띠 끝 두 가닥), 넓은 소매·바지, 검은 신발 | 하늘색 캡슐 몸(머리=몸), 초록 공 안테나, 큰 까만 눈·파란 미소·하늘색 볼, 물방울 팔, 짧은 다리. **키 작음** (몸 1.25, 안테나 1.58) | 큰 아프로(노이즈 혹) + 머리 위 노란 둥근 선글라스, 초록 8번 민소매(흰 테두리), 진갈색 반바지, 초록 줄 흰 양말, 노란 밑창 운동화. 시트에 색상표 없음 → 큰 렌더에서 색 추출 |
| 얼굴 head_mesh | (0,0.02,1.45) / (0.425,0.40,0.42) | (0,0.02,1.47) / (0.40,0.38,0.41) | (0,0.02,1.46) / (0.40,0.38,0.41) | (0,0.02,1.46) / (0.39,0.37,0.41) | 없음 (몸 `rounded_column` z .15–1.25, 반폭 .435, 반깊이 .36, n 2.6) | (0,0.02,1.42) / (0.37,0.36,0.37) |
| 머리카락 hair_dome | C(0,0.03,1.53) rx .535 ry .49/.47 rz .47, 끝 앞1.49/옆1.38/뒤1.12 | C(0,0.03,1.56) rx .47 ry .45/.44 rz .44, 끝 앞1.55/옆1.36/뒤1.26 tilt .09 | C(0,0.06,1.62) rx .5 ry .45/.56 rz .5, 끝 앞1.69/옆1.38/뒤1.14 + 사이 채움 ellipsoid + 퀴프 `swept_crescent` 꼭대기 2.57 | C(0,0.08,1.6) rx .5 ry .44/.56 rz .52, 끝 앞1.68/옆1.36/뒤1.1 + 채움 ellipsoid + 퐁파두르 꼭대기 2.43 | 없음 (안테나 막대 z 1.22–1.39, 공 z 1.47 r .11, head 뼈) | `afro` (smith.py) C(0,0.04,1.70) r (.745,.56,.57), bump .03 freq 5, 얼굴 앞(abs x<.42, z<1.55) y→-0.05, 꼭대기 2.27 |
| 안경 | 둥근 r .14, 중심 ±0.235, z 1.28 | 사각 .27×.15, 중심 ±0.165, z 1.29 | 없음 (눈 ±0.17 z 1.365) | 없음 (눈 ±0.17 z 1.355) | 없음 (눈 ±0.195 z .845 r .064) | 둥근 선글라스 r .13 tube .03, 중심 ±0.2 z 1.69 y -0.49 (아프로 앞에 걸침) |
| 몸통 | 셔츠 cyl z .50–.99 r .305→.285 sy .56 | 원피스 cyl z .53–.98 r .335→.235 sy .62 | 점프수트 cyl z .48–1.0 r .235→.24 sy .66, 다리도 노란 cyl | 도복 cyl z .6–1.0 r .245→.24 sy .62 + 자락 z .45–.62, 띠 z .63, 바지 r .115→.14 | 팔 ellipsoid (.075,.1,.195) 중심 ±.49 z .56, Y축 -0.5 기울임 | 유니폼 cyl z .5–1.0 r .25→.235 sy .6, 8 = ring_frame 두 개 |
| 다리 x | ±0.12 | ±0.11 | ±0.12 | ±0.13 (발목 ±0.18), rig hand (0.375,-0.01,0.52) | ±0.28 (다리 r .1→.085, z 0–.27), rig shoulder (.42,.72) hand (.5,-.01,.42) | ±0.13, rig hand (0.36,-0.01,0.52) → Ride 손 ±0.216 |
| 원본 시트 | `3D 캐릭터 모델링 참고 시트.png` | `귀여운 치비 소녀 3D 캐릭터 시트.png` | `로우폴리 캐릭터 디자인 시트.png` | `태권도 캐릭터 3D 모델링 가이드.png` | `파스텔 3D 캐릭터 디자인 시트.png` | `아프로 소년 3D 캐릭터 시트.png` |
