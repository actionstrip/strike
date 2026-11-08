"""
홍이(hong): 빨간 초승달 퀴프 + 낮은 양갈래, 노란 점프수트(주황 지퍼·번개 고리), 검은 신발.
참고: E:\\project\\+캐릭터들\\로우폴리 캐릭터 디자인 시트.png, 빨간 퀴프의 노란 슈트 캐릭터.png

몸·얼굴은 다른 캐릭터와 같은 비율(턱 1.05, 같은 뼈대)로 맞추고, 퀴프만 그 위로 솟음 → 전체 높이 약 2.55.
치수는 시트 정면 패널에서 턱(1.05)~신발 바닥(0) 기준으로 잼.
"""
import bpy, math
import lowpoly_lib as L

ID = "hong"
COLLECTION = "Hong"

PALETTE = {
    "skin": ("#FDCEBD", 0.6), "hair": ("#C32022", 0.45), "cheek": ("#FDACAC", 0.7),
    "suit": ("#FDD62B", 0.6), "zip": ("#FBA72B", 0.5), "shoe": ("#3E3E3E", 0.55),
    "eye": ("#151213", 0.4), "brow": ("#A3161C", 0.5), "mouth": ("#B8222A", 0.6),
}


def build(suffix=""):
    col = bpy.data.collections.get(COLLECTION + suffix)
    if not col:
        col = bpy.data.collections.new(COLLECTION + suffix)
        bpy.context.scene.collection.children.link(col)
    L.make_materials(PALETTE)
    rig = L.create_rig(col, f"RIG-{ID}{suffix}", shoulder=(0.25, 0.92), hand=(0.36, -0.01, 0.53), hip_x=0.12)
    b = L.Builder(col, rig, suffix)
    build_body(b)
    build_head(b)
    L.make_actions(rig, suffix)
    return rig


def build_body(b):
    # 점프수트 몸통 (8각 평평한 면이 정면) + 높은 칼라 + 목
    TB, TT, RB, RT, SY = 0.48, 1.0, 0.235, 0.24, 0.66
    b.make("GEO-suit", L.cyl((0, 0, TB), (0, 0, TT), RB, RT, 8, 1, SY, math.pi / 8), "suit", "spine")
    b.make("GEO-collar", L.cyl((0, 0, 0.97), (0, 0, 1.07), 0.125, 0.11, 8, 1, 0.9, math.pi / 8), "suit", "spine")
    b.make("GEO-neck", L.cyl((0, 0, 0.98), (0, 0, 1.1), 0.075, 0.075, 8), "skin", "spine")

    # 주황 지퍼 줄 + 아래 번개 모양 고리: 몸통 앞면 깊이에 붙임
    def front_y(z):
        r = RB + (RT - RB) * (z - TB) / (TT - TB)
        return -(r * SY * math.cos(math.pi / 8)) - 0.004
    w = 0.008
    b.make("GEO-zip", L.flat_polygon([(-w, 0.70), (w, 0.70), (w, 1.0), (-w, 1.0)], front_y), "zip", "spine")
    bolt = [(-w, 0.705), (w, 0.705), (0.004, 0.672), (0.03, 0.672), (-0.012, 0.615),
            (-0.002, 0.655), (-0.03, 0.655)]
    b.make("GEO-zipbolt", L.flat_polygon(bolt, front_y), "zip", "spine")

    for s, sd in L.SIDES:
        b.make(f"GEO-shoulder_{sd}", L.ellipsoid((0.2 * s, 0, 0.93), (0.1, 0.11, 0.09)), "suit", f"arm.{sd}")
        b.make(f"GEO-sleeve_{sd}", L.cyl((0.24 * s, 0, 0.95), (0.345 * s, -0.01, 0.6), 0.085, 0.075, 8), "suit", f"arm.{sd}")
        b.make(f"GEO-hand_{sd}", L.ico((0.36 * s, -0.015, 0.53), 0.095), "skin", f"arm.{sd}")
        b.make(f"GEO-leg_{sd}", L.cyl((0.12 * s, 0, 0.53), (0.122 * s, 0, 0.15), 0.088, 0.082, 8, 1, 1, math.pi / 8), "suit", f"leg.{sd}")
        b.make(f"GEO-shoe_{sd}", L.flat_bottom_dome((0.125 * s, -0.045, 0.0), (0.13, 0.2, 0.2), seg=10, rings=6), "shoe", f"leg.{sd}")


def build_head(b):
    head = b.make("GEO-head", L.head_mesh((0, 0.02, 1.46), (0.40, 0.38, 0.41)), "skin", "head")
    for s, sd in L.SIDES:
        b.make(f"GEO-ear_{sd}", L.ellipsoid((0.43 * s, 0.05, 1.31), (0.09, 0.07, 0.13)), "skin", "head")

    # 뒷머리 돔: 앞 1.69 / 옆 1.38 / 뒤 1.14, 뒤로 볼록
    hair = b.make("GEO-hair", L.hair_dome((0, 0.06, 1.62), 0.5, 0.45, 0.56, 0.5,
                                          L.zcut_quadratic(1.69, 1.38, 1.14)), "hair", "head")
    sol = hair.modifiers.new("Solidify", "SOLIDIFY")
    sol.thickness, sol.offset = 0.045, -1

    # 초승달 퀴프: 캐릭터 왼쪽(+X) 앞 낮은 끝 → 이마 위 → 캐릭터 오른쪽(-X) 위로 솟은 끝
    b.make("GEO-quiff", L.swept_crescent([
        (0.52, -0.36, 1.88, 0.0, 0.0, 0.0),
        (0.36, -0.40, 1.88, 0.13, 0.2, 0.3),
        (0.14, -0.40, 1.93, 0.24, 0.32, 0.5),
        (-0.10, -0.38, 2.02, 0.30, 0.36, 0.6),
        (-0.32, -0.36, 2.16, 0.30, 0.34, 0.55),
        (-0.45, -0.36, 2.32, 0.22, 0.26, 0.4),
        (-0.44, -0.38, 2.46, 0.12, 0.16, 0.22),
        (-0.36, -0.44, 2.57, 0.0, 0.0, 0.0),
    ]), "hair", "head")

    # 퀴프와 뒷머리 사이를 채워 옆에서 볼 때 뒤 → 앞 끝으로 이어지는 물방울 실루엣
    b.make("GEO-hairmass", L.ellipsoid((-0.08, 0.02, 2.04), (0.4, 0.44, 0.27), seg=10, rings=7), "hair", "head")

    # 귀 뒤에서 옆·뒤·아래로 뻗은 양갈래
    for s, sd in L.SIDES:
        b.make(f"GEO-tail_{sd}", L.tapered_bundle((0.34 * s, 0.22, 1.2), (0.72 * s, 0.42, 0.85),
                                                  profile=((0.0, 0.1), (0.3, 0.19), (0.65, 0.14))), "hair", "head")

    # 눈(검은 점), 성난 눈썹, 볼, 코, 비스듬한 미소
    for s, sd in L.SIDES:
        y = L.face_hit(head, 0.17 * s, 1.365)[0].y
        b.make(f"GEO-eye_{sd}", L.ellipsoid((0.17 * s, y - 0.002, 1.365), (0.042, 0.012, 0.045)), "eye", "head")
        brow = []
        for k in range(4):
            u = k / 3
            x, z = s * (0.26 - 0.15 * u), 1.545 - 0.075 * u
            brow.append((x, L.face_hit(head, x, z)[0].y - 0.008, z))
        b.make(f"GEO-brow_{sd}", L.tube_mesh(brow, 0.017), "brow", "head")
        b.make(f"GEO-cheek_{sd}", L.on_face_disc(head, 0.25 * s, 1.27, 0.085, "cheek"), "cheek", "head")
    y = L.face_hit(head, 0, 1.33)[0].y
    b.make("GEO-nose", L.ico((0, y + 0.006, 1.33), 0.03, (1.1, 1, 0.9)), "skin", "head")
    smile = []
    for k in range(7):
        a = math.radians(205 + 130 * k / 6)
        x = -0.01 + 0.085 * math.cos(a)
        z = 1.26 + 0.03 * math.sin(a) + 0.18 * (x + 0.01)
        smile.append((x, L.face_hit(head, x, z)[0].y - 0.006, z))
    b.make("GEO-mouth", L.tube_mesh(smile, 0.01), "mouth", "head")
