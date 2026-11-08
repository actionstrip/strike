"""
스미스(smith): 큰 아프로 머리 + 머리 위 노란 둥근 선글라스, 초록 8번 민소매 유니폼, 진갈색 반바지,
초록 줄 흰 양말, 노란 밑창 진적갈색 운동화.
참고: E:\\project\\+캐릭터들\\아프로 소년 3D 캐릭터 시트.png, 8번 초록 유니폼의 꼬마 선수.png
키 비교(캐릭터키.png)로 아프로 꼭대기 약 2.24~2.29 → 2.27.

몸·얼굴은 다른 캐릭터와 같은 비율(턱 1.05, 같은 뼈대), 아프로만 그 위·옆으로 크게 부풂.
시트에 색상표가 없어 큰 렌더 이미지에서 색을 뽑음.
"""
import bpy, bmesh, math
from mathutils import Vector, noise
import lowpoly_lib as L

ID = "smith"
COLLECTION = "Smith"

PALETTE = {
    "skin": ("#C9784E", 0.6), "hair": ("#4A2A20", 0.75), "cheek": ("#DC503C", 0.7),
    "jersey": ("#0B7A47", 0.6), "white": ("#F4F4F2", 0.6), "shorts": ("#463129", 0.65),
    "frame": ("#F6B42A", 0.4), "lens": ("#3A1208", 0.2), "shoe": ("#6A2620", 0.5), "sole": ("#F2B01E", 0.5),
    "eye": ("#3A1E14", 0.4), "mouth": ("#D63A2A", 0.5),
}


def build(suffix=""):
    col = bpy.data.collections.get(COLLECTION + suffix)
    if not col:
        col = bpy.data.collections.new(COLLECTION + suffix)
        bpy.context.scene.collection.children.link(col)
    L.make_materials(PALETTE)
    # 팔뼈 끝 x는 Ride 손 x ≈ ±0.20 (다른 캐릭터와 같게) 되도록 맞춘 값
    rig = L.create_rig(col, f"RIG-{ID}{suffix}", shoulder=(0.26, 0.92), hand=(0.36, -0.01, 0.52), hip_x=0.13)
    b = L.Builder(col, rig, suffix)
    build_body(b)
    build_head(b)
    L.make_actions(rig, suffix)
    return rig


def afro(center, radii, face_cut=(0.42, 1.55, -0.05), bump=0.03, freq=5.0, seg=24, rings=18, seed=3.0):
    """
    울퉁불퉁한 아프로: 타원체 표면을 노이즈로 ±bump 만큼 밀고 당김(플랫 셰이딩이면 각진 곱슬처럼 보임).
    freq가 낮으면 덩어리째 일그러지므로 5 이상으로 잘게.
    face_cut=(반폭, 높이, y): 얼굴 앞 아래쪽 정점은 y를 뒤로 밀어 얼굴이 머리카락 앞으로 보이게 함.
    """
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=1.0)
    C = Vector(center)
    hw, hz, hy = face_cut
    for v in bm.verts:
        n = v.co.normalized()
        p = C + Vector((n.x * radii[0], n.y * radii[1], n.z * radii[2])) + n * bump * noise.noise(n * freq + Vector((seed, seed, seed)))
        if abs(p.x) < hw and p.z < hz and p.y < hy:
            p.y = hy
        v.co = p
    return bm


def build_body(b):
    # 민소매 유니폼 (8각 평평한 면이 정면) + 흰 목·소매 테두리 + 가슴 8
    TB, TT, RB, RT, SY = 0.5, 1.0, 0.25, 0.235, 0.6
    b.make("GEO-jersey", L.cyl((0, 0, TB), (0, 0, TT), RB, RT, 8, 1, SY, math.pi / 8), "jersey", "spine")
    b.make("GEO-neck", L.cyl((0, 0, 0.95), (0, 0, 1.1), 0.075, 0.075, 8), "skin", "spine")

    def front_y(z):
        r = RB + (RT - RB) * (z - TB) / (TT - TB)
        return -(r * SY * math.cos(math.pi / 8))
    # 목 앞 U자 흰 테두리와 그 안 살색
    U = [(0.11 * math.cos(math.radians(a)), 1.0 + 0.1 * math.sin(math.radians(a))) for a in range(180, 361, 20)]
    b.make("GEO-neckskin", L.flat_polygon(U, lambda z: front_y(z) - 0.002), "skin", "spine")
    b.make("GEO-necktrim", L.tube_mesh([(x, front_y(z) - 0.004, z) for x, z in U], 0.014), "white", "spine")
    b.make("GEO-necktrim_back", L.cyl((0, 0.02, 0.985), (0, 0.02, 1.01), 0.13, 0.13, 8, 1, 0.75, math.pi / 8), "white", "spine")
    # 가슴 8: 위 작은 고리 + 아래 큰 고리
    y8 = front_y(0.74) - 0.008
    b.make("GEO-number8", L.merge([L.ring_frame((0, 0.785), 0.033, 0.014, y8, 12), L.ring_frame((0, 0.705), 0.042, 0.014, y8, 12)]), "white", "spine")

    for s, sd in L.SIDES:
        b.make(f"GEO-shoulder_{sd}", L.ellipsoid((0.235 * s, 0, 0.92), (0.075, 0.085, 0.07)), "skin", f"arm.{sd}")
        b.make(f"GEO-armtrim_{sd}", L.cyl((0.215 * s, 0, 0.89), (0.245 * s, 0, 0.895), 0.1, 0.1, 8, 1, 1.0), "white", "spine")
        b.make(f"GEO-arm_{sd}", L.cyl((0.26 * s, 0, 0.92), (0.4 * s, -0.01, 0.58), 0.058, 0.052, 6), "skin", f"arm.{sd}")
        b.make(f"GEO-hand_{sd}", L.ico((0.41 * s, -0.015, 0.52), 0.088), "skin", f"arm.{sd}")
        b.make(f"GEO-shorts_{sd}", L.cyl((0.115 * s, 0, 0.52), (0.13 * s, 0, 0.33), 0.135, 0.13, 8, 1, 0.95, math.pi / 8), "shorts", f"leg.{sd}")
        b.make(f"GEO-leg_{sd}", L.cyl((0.13 * s, 0, 0.36), (0.13 * s, 0, 0.2), 0.055, 0.055, 6), "skin", f"leg.{sd}")
        b.make(f"GEO-sock_{sd}", L.cyl((0.13 * s, 0, 0.27), (0.13 * s, 0, 0.1), 0.062, 0.065, 8), "white", f"leg.{sd}")
        b.make(f"GEO-sockstripe_{sd}", L.cyl((0.13 * s, 0, 0.215), (0.13 * s, 0, 0.235), 0.066, 0.066, 8), "jersey", f"leg.{sd}")
        b.make(f"GEO-shoe_{sd}", L.flat_bottom_dome((0.135 * s, -0.04, 0.04), (0.125, 0.19, 0.12)), "shoe", f"leg.{sd}")
        sole = L.cyl((0.135 * s, -0.045, 0), (0.135 * s, -0.045, 0.045), 1.0, 1.0, 12, 0.13, 0.2)
        laces = [L.box((0.135 * s, -0.1 + 0.05 * k, 0.15 - 0.012 * k), (0.07, 0.016, 0.014)) for k in range(2)]
        b.make(f"GEO-sole_{sd}", L.merge([sole] + laces), "sole", f"leg.{sd}")
    b.make("GEO-shortswaist", L.cyl((0, 0, 0.44), (0, 0, 0.53), 0.255, 0.255, 8, 1, 0.62, math.pi / 8), "shorts", "hips")


def build_head(b):
    head = b.make("GEO-head", L.head_mesh((0, 0.02, 1.42), (0.37, 0.36, 0.37)), "skin", "head")
    for s, sd in L.SIDES:
        b.make(f"GEO-ear_{sd}", L.ellipsoid((0.38 * s, 0.05, 1.28), (0.075, 0.06, 0.11)), "skin", "head")

    # 아프로: 중심 z 1.70, 꼭대기 약 2.27, 아래 끝 약 1.13, 폭 ±0.745
    b.make("GEO-afro", afro((0, 0.04, 1.70), (0.745, 0.56, 0.57)), "hair", "head")

    # 노란 둥근 선글라스: 아프로 앞 이마 위에 걸침, 진갈색 렌즈 + 흰 반짝임
    GZ, GX, R, T, GY = 1.69, 0.2, 0.13, 0.03, -0.49
    for s, sd in L.SIDES:
        b.make(f"GEO-frame_{sd}", L.ring_frame((GX * s, GZ), R, T, GY, 16), "frame", "head")
        b.make(f"GEO-lens_{sd}", L.disc_with_uv((GX * s, GZ), R, GY + 0.01), "lens", "head")
        b.make(f"GEO-glint_{sd}", L.disc_with_uv((GX * s - 0.045, GZ + 0.045), 0.028, GY - 0.003, 8), "white", "head")
        b.make(f"GEO-temple_{sd}", L.cyl(((GX + R) * s, GY + 0.02, GZ), ((GX + R + 0.02) * s, -0.3, GZ), 0.018, 0.018, 4), "frame", "head")
    b.make("GEO-bridge", L.box((0, GY, GZ + 0.02), (2 * (GX - R) + 0.03, 0.025, 0.03)), "frame", "head")

    # 짧은 눈썹, 점 눈, 넓적한 코, 빨간 볼·미소
    for s, sd in L.SIDES:
        y = L.face_hit(head, 0.15 * s, 1.35)[0].y
        b.make(f"GEO-eye_{sd}", L.ellipsoid((0.15 * s, y - 0.002, 1.35), (0.032, 0.012, 0.04)), "eye", "head")
        brow = []
        for k in range(5):
            a = math.radians(30 + 120 * k / 4)
            x, z = 0.15 * s + 0.045 * math.cos(a), 1.465 + 0.016 * math.sin(a)
            brow.append((x, L.face_hit(head, x, z)[0].y - 0.006, z))
        b.make(f"GEO-brow_{sd}", L.tube_mesh(brow, 0.011), "eye", "head")
        b.make(f"GEO-cheek_{sd}", L.on_face_disc(head, 0.22 * s, 1.24, 0.05, "cheek"), "cheek", "head")
    y = L.face_hit(head, 0, 1.27)[0].y
    b.make("GEO-nose", L.ico((0, y + 0.008, 1.27), 0.035, (1.35, 1, 0.8)), "skin", "head")
    b.make("GEO-mouth", L.tube_mesh(L.smile_points(head, 0, 1.2, 0.07, 0.035), 0.013), "mouth", "head")
