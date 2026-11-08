"""
권이(gwon): 검은 퐁파두르(위에 작은 삐죽 2개), 흰 태권도 도복(검은 V깃·검은 띠), 넓은 소매·바지, 검은 신발.
참고: E:\\project\\+캐릭터들\\태권도 캐릭터 3D 모델링 가이드.png, 자신감 넘치는 로우폴리 무술가.png

몸·얼굴은 다른 캐릭터와 같은 비율(턱 1.05, 같은 뼈대), 퐁파두르만 그 위로 솟음 (홍이와 같은 방식).
치수는 시트 정면 패널에서 턱(1.05)~신발 바닥(0) 기준으로 잼.
"""
import bpy, math
import lowpoly_lib as L

ID = "gwon"
COLLECTION = "Gwon"

PALETTE = {
    "skin": ("#FDD4BC", 0.6), "hair": ("#2B3434", 0.45), "cheek": ("#EEB6C9", 0.7),
    "dobok": ("#EEF0F5", 0.65), "belt": ("#1E1E1D", 0.55), "shoe": ("#38393C", 0.55),
    "eye": ("#111111", 0.4), "mouth": ("#C8322F", 0.6),
}


def build(suffix=""):
    col = bpy.data.collections.get(COLLECTION + suffix)
    if not col:
        col = bpy.data.collections.new(COLLECTION + suffix)
        bpy.context.scene.collection.children.link(col)
    L.make_materials(PALETTE)
    # 팔뼈 끝은 실제 주먹(x 0.445)보다 안쪽: 뼈가 많이 기울면 Ride에서 팔을 앞으로 돌릴 때 두 손이 가운데로 모임. Ride 손 x ≈ ±0.21 (빙빙이·방울이와 같게) 되도록 맞춘 값
    rig = L.create_rig(col, f"RIG-{ID}{suffix}", shoulder=(0.25, 0.92), hand=(0.375, -0.01, 0.52), hip_x=0.13)
    b = L.Builder(col, rig, suffix)
    build_body(b)
    build_head(b)
    L.make_actions(rig, suffix)
    return rig


def build_body(b):
    # 도복 상의 (8각 평평한 면이 정면) + 띠 아래로 퍼지는 자락 + 목
    TB, TT, RB, RT, SY = 0.6, 1.0, 0.245, 0.24, 0.62
    b.make("GEO-jacket", L.cyl((0, 0, TB), (0, 0, TT), RB, RT, 8, 1, SY, math.pi / 8), "dobok", "spine")
    b.make("GEO-jacketskirt", L.cyl((0, 0, 0.45), (0, 0, 0.62), 0.27, 0.25, 8, 1, 0.66, math.pi / 8), "dobok", "hips")
    b.make("GEO-neck", L.cyl((0, 0, 0.96), (0, 0, 1.1), 0.075, 0.075, 8), "skin", "spine")

    def front_y(z):
        r = RB + (RT - RB) * (z - TB) / (TT - TB)
        return -(r * SY * math.cos(math.pi / 8)) - 0.004

    # 검은 V깃: 목 양옆에서 가슴 가운데로 모이는 띠 두 줄 + 그 안쪽 살색(목 아래 V)
    b.make("GEO-collar_v", L.flat_polygon([(-0.085, 1.0), (0.085, 1.0), (0, 0.84)], lambda z: front_y(z) - 0.001), "skin", "spine")
    for s, sd in L.SIDES:
        band = [(0.085 * s, 1.0), (0.14 * s, 1.0), (0.025 * s, 0.8), (0, 0.8), (0, 0.84)]
        b.make(f"GEO-collar_{sd}", L.flat_polygon(band if s < 0 else band[::-1], lambda z: front_y(z) - 0.002), "belt", "spine")
    b.make("GEO-collar_back", L.cyl((0, 0.02, 0.97), (0, 0.02, 1.02), 0.15, 0.13, 8, 1, 0.75, math.pi / 8), "belt", "spine")

    # 검은 띠 + 앞 매듭 + 아래로 벌어진 띠 끝 두 가닥
    BZ = 0.63
    b.make("GEO-belt", L.cyl((0, 0, BZ - 0.04), (0, 0, BZ + 0.04), 0.262, 0.258, 8, 1, 0.65, math.pi / 8), "belt", "spine")
    ky = -(0.26 * 0.65 * math.cos(math.pi / 8))
    knot = L.box((0, ky - 0.025, BZ), (0.085, 0.05, 0.085))
    tails = [L.cyl((0.015 * s, ky - 0.03, BZ - 0.02), (0.085 * s, ky - 0.04, 0.42), 0.032, 0.03, 4, 1, 0.45) for s, _ in L.SIDES]
    b.make("GEO-beltknot", L.merge([knot] + tails), "belt", "spine")

    for s, sd in L.SIDES:
        b.make(f"GEO-shoulder_{sd}", L.ellipsoid((0.21 * s, 0, 0.93), (0.1, 0.12, 0.09)), "dobok", f"arm.{sd}")
        b.make(f"GEO-sleeve_{sd}", L.cyl((0.23 * s, 0, 0.95), (0.41 * s, -0.01, 0.64), 0.095, 0.12, 8), "dobok", f"arm.{sd}")
        b.make(f"GEO-arm_{sd}", L.cyl((0.4 * s, -0.01, 0.67), (0.435 * s, -0.012, 0.56), 0.055, 0.055, 6), "skin", f"arm.{sd}")
        b.make(f"GEO-hand_{sd}", L.ico((0.445 * s, -0.015, 0.52), 0.1), "skin", f"arm.{sd}")
        b.make(f"GEO-pants_{sd}", L.cyl((0.12 * s, 0, 0.5), (0.175 * s, 0, 0.15), 0.115, 0.14, 8, 1, 0.9, math.pi / 8), "dobok", f"leg.{sd}")
        b.make(f"GEO-ankle_{sd}", L.cyl((0.18 * s, 0, 0.16), (0.18 * s, 0, 0.09), 0.06, 0.06, 6), "skin", f"leg.{sd}")
        b.make(f"GEO-shoe_{sd}", L.flat_bottom_dome((0.185 * s, -0.045, 0.0), (0.14, 0.2, 0.14), seg=10, rings=6), "shoe", f"leg.{sd}")


def build_head(b):
    head = b.make("GEO-head", L.head_mesh((0, 0.02, 1.46), (0.39, 0.37, 0.41)), "skin", "head")
    for s, sd in L.SIDES:
        b.make(f"GEO-ear_{sd}", L.ellipsoid((0.43 * s, 0.05, 1.3), (0.09, 0.07, 0.13)), "skin", "head")

    # 뒷머리 돔: 앞 1.68 / 옆 1.36 / 뒤 1.1, 뒤로 볼록
    hair = b.make("GEO-hair", L.hair_dome((0, 0.08, 1.6), 0.5, 0.44, 0.56, 0.52,
                                          L.zcut_quadratic(1.68, 1.36, 1.1)), "hair", "head")
    sol = hair.modifiers.new("Solidify", "SOLIDIFY")
    sol.thickness, sol.offset = 0.045, -1
    b.make("GEO-hairmass", L.ellipsoid((-0.05, 0.04, 1.96), (0.42, 0.44, 0.23), seg=10, rings=7), "hair", "head")

    # 퐁파두르: 캐릭터 왼쪽(+X) 옆머리에서 이마 위를 지나 캐릭터 오른쪽(-X) 위로 솟은 끝
    b.make("GEO-pompadour", L.swept_crescent([
        (0.5, -0.26, 1.84, 0.0, 0.0, 0.0),
        (0.38, -0.34, 1.85, 0.13, 0.2, 0.35),
        (0.15, -0.38, 1.92, 0.22, 0.32, 0.55),
        (-0.1, -0.38, 1.96, 0.23, 0.36, 0.6),
        (-0.32, -0.36, 2.07, 0.22, 0.32, 0.55),
        (-0.44, -0.36, 2.21, 0.16, 0.22, 0.4),
        (-0.47, -0.37, 2.33, 0.08, 0.1, 0.15),
        (-0.46, -0.38, 2.43, 0.0, 0.0, 0.0),
    ]), "hair", "head")
    # 꼭대기 뒤쪽 작은 삐죽 머리 두 개 (정면에서 큰 끝 오른쪽에 차례로 보임)
    spikes = [L.cyl(base, tip, 0.08, 0.0, 6) for base, tip in (
        ((-0.26, -0.2, 2.12), (-0.33, -0.26, 2.38)),
        ((-0.15, -0.14, 2.06), (-0.22, -0.18, 2.31)))]
    b.make("GEO-spikes", L.merge(spikes), "hair", "head")

    # 눈(검은 점), 굵고 비스듬한 눈썹, 사선 볼터치 3줄, 코, 미소
    for s, sd in L.SIDES:
        y = L.face_hit(head, 0.17 * s, 1.355)[0].y
        b.make(f"GEO-eye_{sd}", L.ellipsoid((0.17 * s, y - 0.002, 1.355), (0.042, 0.012, 0.046)), "eye", "head")
        brow = []
        for k in range(4):
            u = k / 3
            x, z = s * (0.27 - 0.17 * u), 1.485 - 0.05 * u
            brow.append((x, L.face_hit(head, x, z)[0].y - 0.01, z))
        b.make(f"GEO-brow_{sd}", L.tube_mesh(brow, 0.022), "eye", "head")
        marks = []
        for k in range(3):
            x0, z0 = s * (0.2 + 0.035 * k), 1.24
            pts = [(x0 + 0.012, 1.26), (x0 - 0.012, 1.22)]
            marks.append(L.tube_mesh([(x, L.face_hit(head, x, z)[0].y - 0.004, z) for x, z in pts], 0.006))
        b.make(f"GEO-cheek_{sd}", L.merge(marks), "cheek", "head")
    y = L.face_hit(head, 0, 1.31)[0].y
    b.make("GEO-nose", L.ico((0, y + 0.006, 1.31), 0.028, (1.0, 1, 0.9)), "skin", "head")
    smile = []
    for k in range(7):
        a = math.radians(205 + 130 * k / 6)
        x = 0.01 + 0.08 * math.cos(a)
        z = 1.225 + 0.025 * math.sin(a) + 0.15 * (x - 0.01)
        smile.append((x, L.face_hit(head, x, z)[0].y - 0.006, z))
    b.make("GEO-mouth", L.tube_mesh(smile, 0.009), "mouth", "head")
