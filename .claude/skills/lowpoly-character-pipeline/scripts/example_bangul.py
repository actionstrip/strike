"""
방울이(bangul)를 lowpoly_lib로 다시 만드는 예제 = 새 캐릭터 템플릿.
새 캐릭터는 이 파일을 scripts/<id>.py 로 복사해서 위쪽 치수·색·부위만 참고 시트에 맞게 고침.

블렌더 MCP에서:
    import sys, importlib
    sys.path.insert(0, r"E:\\inetpub\\wwwroot\\test\\pixi_ai\\threejs\\.claude\\skills\\lowpoly-character-pipeline\\scripts")
    import lowpoly_lib as L, example_bangul as C; importlib.reload(L); importlib.reload(C)
    rig = C.build()            # 몸 + 머리 + 애니메이션까지
    result = {"objs": len(rig.users_collection[0].objects)}

치수는 참고 시트 정면 패널에서 픽셀로 잼: 1px = 2.0 / (신발 바닥 y - 머리 꼭대기 y), z = (신발 바닥 y - 그 점 y) * 1px
"""
import bpy, math
import lowpoly_lib as L

ID = "bangul"                 # 파일·객체 이름용 로마자 (한글 이름에서 '이'를 뺌)
COLLECTION = "Bangul"

PALETTE = {                   # 참고 시트 '주요 색상' 칸에서 고름
    "skin": ("#FAD0AE", 0.6), "hair": ("#4B2230", 0.45), "glassframe": ("#D8232C", 0.35),
    "cheek": ("#F5A3B4", 0.7), "dress": ("#E1262F", 0.6), "tee": ("#F6F5F3", 0.6),
    "sock": ("#4A1F47", 0.6), "shoe": ("#6A285F", 0.5), "sole": ("#F7F7F5", 0.5),
    "eye": ("#3E1F3A", 0.4), "mouth": ("#C8322F", 0.6), "star": ("#FFFFFF", 0.6),
}


def build(suffix=""):
    col = bpy.data.collections.get(COLLECTION + suffix)
    if not col:
        col = bpy.data.collections.new(COLLECTION + suffix)
        bpy.context.scene.collection.children.link(col)
    L.make_materials(PALETTE)
    rig = L.create_rig(col, f"RIG-{ID}{suffix}", shoulder=(0.27, 0.88), hand=(0.335, -0.01, 0.51), hip_x=0.11)
    b = L.Builder(col, rig, suffix)
    build_body(b)
    build_head(b)
    L.make_actions(rig, suffix)
    return rig


def build_body(b):
    # 원피스(A라인, 8각 평평한 면이 정면) + 흰 밑단 + 흰 티 칼라
    DT, DB, RT, RB, SY = 0.98, 0.53, 0.235, 0.335, 0.62
    b.make("GEO-dress", L.cyl((0, 0, DB), (0, 0, DT), RB, RT, 8, 1, SY, math.pi / 8), "dress", "spine")
    b.make("GEO-hem", L.cyl((0, 0, DB - 0.035), (0, 0, DB + 0.01), RB + 0.012, RB + 0.008, 8, 1, SY + 0.015, math.pi / 8), "tee", "spine")
    b.make("GEO-collar", L.cyl((0, 0, 0.96), (0, 0, 1.01), 0.115, 0.1, 8, 1, 0.9), "tee", "spine")
    b.make("GEO-neck", L.cyl((0, 0, 0.95), (0, 0, 1.09), 0.075, 0.075, 8), "skin", "spine")

    # 가슴 별: 기울어진 원피스 앞면에 정확히 붙도록 z마다 앞면 깊이를 계산
    def front_y(z):
        r = RB + (RT - RB) * (z - DB) / (DT - DB)
        return -(r * SY * math.cos(math.pi / 8)) - 0.005
    b.make("GEO-dress_star", L.flat_polygon(L.star_points(0, 0.84, 0.075, 0.032), front_y), "star", "spine")

    for s, sd in L.SIDES:
        b.make(f"GEO-sleeve_{sd}", L.cyl((0.2 * s, 0, 0.95), (0.33 * s, 0, 0.8), 0.1, 0.095, 8), "tee", f"arm.{sd}")
        b.make(f"GEO-arm_{sd}", L.cyl((0.31 * s, 0, 0.82), (0.335 * s, -0.01, 0.56), 0.052, 0.049, 6), "skin", f"arm.{sd}")
        b.make(f"GEO-hand_{sd}", L.ico((0.335 * s, -0.015, 0.51), 0.082), "skin", f"arm.{sd}")
        b.make(f"GEO-leg_{sd}", L.cyl((0.11 * s, 0, 0.56), (0.11 * s, 0, 0.3), 0.058, 0.056, 6), "skin", f"leg.{sd}")
        b.make(f"GEO-sock_{sd}", L.cyl((0.11 * s, 0, 0.37), (0.11 * s, 0, 0.12), 0.068, 0.07, 8), "sock", f"leg.{sd}")
        # 운동화: 보라 윗부분 + (흰 밑창 + 흰 앞코 + 옆 흰 점) 한 객체
        b.make(f"GEO-shoe_{sd}", L.flat_bottom_dome((0.115 * s, -0.04, 0.045), (0.115, 0.175, 0.13)), "shoe", f"leg.{sd}")
        sole = L.cyl((0.115 * s, -0.045, 0), (0.115 * s, -0.045, 0.05), 1.0, 1.0, 12, 0.125, 0.19)
        toe = L.flat_bottom_dome((0.115 * s, -0.15, 0.045), (0.1, 0.075, 0.075), seg=10, rings=6)
        dot = L.cyl((0.227 * s, -0.02, 0.1), (0.233 * s, -0.02, 0.1), 0.022, 0.022, 8)
        b.make(f"GEO-shoesole_{sd}", L.merge([sole, toe, dot]), "sole", f"leg.{sd}")


def build_head(b):
    # 얼굴을 먼저 만들어야 눈·입·볼을 표면에 레이캐스트로 붙일 수 있음
    head = b.make("GEO-head", L.head_mesh((0, 0.02, 1.47), (0.40, 0.38, 0.41)), "skin", "head")
    for s, sd in L.SIDES:
        b.make(f"GEO-ear_{sd}", L.ellipsoid((0.41 * s, 0.04, 1.27), (0.055, 0.085, 0.11)), "skin", "head")

    # 머리카락: 앞 1.55 / 옆 1.36 / 뒤 1.26, 캐릭터 왼쪽 앞머리가 높은 옆가르마, 오른쪽 앞에 뾰족한 끝
    def spike(j, phi):
        if math.cos(phi) > 0.3 and math.sin(phi) < 0.2 and j % 2 == 1:
            return (-0.08, 0.02)
    hair = b.make("GEO-hair", L.hair_dome((0, 0.03, 1.56), 0.47, 0.45, 0.44, 0.44,
                                          L.zcut_quadratic(1.55, 1.36, 1.26, tilt=0.09), spike), "hair", "head")
    sol = hair.modifiers.new("Solidify", "SOLIDIFY")
    sol.thickness, sol.offset = 0.04, -1

    # 양갈래 + 빨간 머리끈
    for s, sd in L.SIDES:
        a0, a1 = (0.44 * s, 0.08, 1.44), (0.76 * s, 0.11, 1.17)
        b.make(f"GEO-pigtail_{sd}", L.tapered_bundle(a0, a1), "hair", "head")
        axis = (L.Vector(a1) - L.Vector(a0)).normalized()
        b.make(f"GEO-hairtie_{sd}", L.cyl(L.Vector(a0) - axis * 0.06, L.Vector(a0) + axis * 0.035, 0.078, 0.078, 8), "glassframe", "head")

    # 빨간 사각 안경: 렌즈 없이 테만, 얼굴에서 0.035 앞
    LZ, LX, W, H, T = 1.29, 0.165, 0.27, 0.15, 0.022
    LY = min(L.face_hit(head, 0, LZ)[0].y, L.face_hit(head, LX, LZ)[0].y) - 0.035
    for s, sd in L.SIDES:
        b.make(f"GEO-glassframe_{sd}", L.rect_frame((LX * s, LZ), W, H, T, LY), "glassframe", "head")
        b.make(f"GEO-glasstemple_{sd}", L.cyl((s * (LX + W / 2 - 0.01), LY + 0.01, LZ + 0.04), (s * 0.405, 0.03, LZ + 0.04), 0.014, 0.014, 4), "glassframe", "head")
    b.make("GEO-glassbridge", L.box((0, LY, LZ + 0.03), (2 * (LX - W / 2) + 0.02, 0.022, 0.02)), "glassframe", "head")

    # 눈(세로 타원), 눈썹(호), 볼(원판), 코, 입
    for s, sd in L.SIDES:
        y = L.face_hit(head, 0.15 * s, 1.275)[0].y
        b.make(f"GEO-eye_{sd}", L.ellipsoid((0.15 * s, y - 0.002, 1.275), (0.034, 0.012, 0.06)), "eye", "head")
        brow = []
        for k in range(5):
            a = math.radians(30 + 120 * k / 4)
            x, z = 0.15 * s + 0.05 * math.cos(a), 1.405 + 0.022 * math.sin(a)
            brow.append((x, L.face_hit(head, x, z)[0].y - 0.006, z))
        b.make(f"GEO-brow_{sd}", L.tube_mesh(brow, 0.008), "eye", "head")
        b.make(f"GEO-cheek_{sd}", L.on_face_disc(head, 0.215 * s, 1.175, 0.05, "cheek"), "cheek", "head")
    y = L.face_hit(head, 0, 1.215)[0].y
    b.make("GEO-nose", L.ico((0, y + 0.004, 1.215), 0.022, (1, 1, 1)), "skin", "head")
    b.make("GEO-mouth", L.tube_mesh(L.smile_points(head, 0, 1.155, 0.055, 0.035), 0.009), "mouth", "head")
