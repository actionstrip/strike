# Credits

| 에셋 | 저작자 | 라이선스 | 출처 | 변경 내용 |
|---|---|---|---|---|
| Robot_RK11 (`public/models/robot.glb`) | Repka788rus | CC BY 4.0 | https://sketchfab.com/3d-models/robot-rk11-23215f643bf74275bc0442108e58b4bf | 운전 클립 제거, 이동 클립(Idle, WalkF/B, StrafeL/R, Run, Air) 추가, WebP/meshopt 압축 |
| G32 Lightweight Submachine Gun (`public/models/g32.glb`) | Bl4ckGh0st | CC BY 4.0 | https://sketchfab.com/3d-models/g32-lightweight-submachine-gun-fe11740d15f3498db52989dd8664d3dc | 단위·원점·방향 재정렬, 메시 병합(탄창·방아쇠·장전손잡이 분리), 소켓 노드 추가, specular 제거, WebP/meshopt 압축 |
| Animated ROBOT SDC (`public/models/enemy_robot.glb`) | SDC PERFORMANCE | CC BY 4.0 | https://sketchfab.com/3d-models/animated-robot-sdc-3d127f327a6c4033a32b810b5fb071ed | 강체 파츠를 단일 스킨 메시로 병합, 135k→14.3k 삼각형 감량, 리그 정리, Walk/Idle/Death 클립, meshopt 압축 |
| Tracer's Gun (`public/models/enemy_gun.glb`) | Nazareno_rojas | CC BY 4.0 | https://sketchfab.com/3d-models/tracers-gun-ac72d8f55dfa4267af89f15822f6a786 | 파츠 병합, 7.3k→2.2k 삼각형, Muzzle 소켓, 텍스처 WebP 512 |
| FPS \| TDM \| GAME \| MAP by ResoForge (`public/models/map.glb`) | Space_One | CC BY 4.0 | https://sketchfab.com/3d-models/lowpoly-fps-tdm-game-map-by-resoforge-d41a19f699ea421a9aa32b407cb7537b | ×2.75 스케일, 변환 적용, 같은 재질끼리 병합(draw call 10), 충돌 박스 생성(`map_colliders.json`), meshopt 압축 |
| Walking robot (`public/models/enemy2_robot.glb`) | komov | CC BY 4.0 | https://sketchfab.com/3d-models/walking-robot-bcc389f59ac747eeb7bf377c21b24d78 | spec-gloss 재질을 metal-rough로 변환, 텍스처 WebP 1024, meshopt 압축(3.9MB→664KB), 걷기 한 주기(116~148프레임)만 사용 |
| Backrooms VR (`public/models/map_backrooms.glb`) | VTX | CC BY 4.0 | https://sketchfab.com/3d-models/backrooms-vr-1a5c397f0a43408fa38b09ea5c041149 | 바닥 높이 0으로 이동, 문/의자/감지기 Decimate(7만→4만 삼각형), 같은 재질끼리 병합, 텍스처 WebP(20MB→1.5MB), 충돌 박스 생성(`map_backrooms_colliders.json`), 맵 썸네일 렌더 |
| 사막 마을·항구 창고 텍스처 (`public/models/map_desert.glb`, `map_port.glb`, `tools/desert_tex/`) | frostychaos144 | CC BY 4.0 | https://sketchfab.com/3d-models/sandyards-standoff-2-fbc824e0c4d3422796b67c7872e64621 | 원본(sandyards standoff 2)의 텍스처 아틀라스에서 회벽·돌·타일·콘크리트·녹슨 철판·나무판과 문/창/상자 그림만 잘라 사용. 맵 배치와 지오메트리는 `tools/build-desert.mjs`, `tools/build-port.mjs`에서 새로 만듦(항구 창고는 색을 바꿔 재사용, 골판 철판은 절차적 생성). WebP/meshopt 압축 |
| 인트로 배경 (`public/images/intro_bg.webp`) | 사용자 제공 | — | `images/background.png` | WebP 변환(2.8MB→240KB) |

> 주의: Tracer's Gun은 오버워치(Blizzard) 캐릭터 무기의 팬아트입니다. 모델 라이선스는 CC BY지만 디자인은 Blizzard IP이므로 상업화 전에 교체해야 합니다.

라이선스: https://creativecommons.org/licenses/by/4.0/
