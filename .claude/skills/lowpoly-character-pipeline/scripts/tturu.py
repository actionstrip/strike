"""
뚜루뚜루(tturu): 하늘색 캡슐 몸(머리=몸), 초록 공 안테나, 큰 까만 눈, 파란 미소, 물방울 팔, 짧은 다리 두 개.
참고: E:\\project\\+캐릭터들\\파스텔 3D 캐릭터 디자인 시트.png, 초록 안테나를 가진 파란 마스코트.png
키 비교: E:\\project\\+캐릭터들\\캐릭터키.png → 몸 꼭대기 약 1.25, 안테나 공 꼭대기 약 1.58 (다른 캐릭터 2.0 기준)

키가 작은 캐릭터: 뼈대·액션은 다른 캐릭터와 같게 두고(같은 Walk 보폭), 메시만 작게 만듦.
몸·얼굴은 spine에, 안테나는 head에 붙여 머리 흔들림에 살짝 같이 흔들리게 함.
치수는 시트 정면 패널에서 몸 꼭대기(1.25)~발바닥(0) 기준으로 잼.
"""
import bpy, bmesh, math
from mathutils import Matrix
import lowpoly_lib as L

ID = "tturu"
COLLECTION = "Tturu"

PALETTE = {
    "body": ("#C7DFF7", 0.35), "cheek": ("#ADCFF7", 0.5), "eye": ("#282827", 0.3),
    "mouth": ("#4E8FDB", 0.4), "antenna": ("#17AD55", 0.35), "stick": ("#9B9EA3", 0.4),
}


def build(suffix=""):
    col = bpy.data.collections.get(COLLECTION + suffix)
    if not col:
        col = bpy.data.collections.new(COLLECTION + suffix)
        bpy.context.scene.collection.children.link(col)
    L.make_materials(PALETTE)
    rig = L.create_rig(col, f"RIG-{ID}{suffix}", shoulder=(0.42, 0.72), hand=(0.5, -0.01, 0.42), hip_x=0.28)
    b = L.Builder(col, rig, suffix)
    body = build_body(b)
    build_face(b, body)
    L.make_actions(rig, suffix)
    return rig


def rounded_column(levels, seg=16, n=2.6):
    """
    높이별 둥근 사각(슈퍼타원) 단면을 이어 붙인 덩어리. levels = [(z, rx, ry)], 아래→위.
    rx=0인 첫/끝 단은 한 점(바닥·꼭대기). n이 클수록 단면이 네모에 가까움 (2 = 타원).
    """
    bm = bmesh.new()
    rings = []
    for z, rx, ry in levels:
        if rx <= 0:
            rings.append([bm.verts.new((0, 0, z))])
            continue
        ring = []
        for k in range(seg):
            a = 2 * math.pi * k / seg + math.pi / seg
            c, s = math.cos(a), math.sin(a)
            ring.append(bm.verts.new((rx * math.copysign(abs(c) ** (2 / n), c), ry * math.copysign(abs(s) ** (2 / n), s), z)))
        rings.append(ring)
    for r0, r1 in zip(rings, rings[1:]):
        if len(r0) == 1:
            for k in range(seg):
                bm.faces.new((r0[0], r1[(k + 1) % seg], r1[k]))
        elif len(r1) == 1:
            for k in range(seg):
                bm.faces.new((r0[k], r0[(k + 1) % seg], r1[0]))
        else:
            for k in range(seg):
                bm.faces.new((r0[k], r0[(k + 1) % seg], r1[(k + 1) % seg], r1[k]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def build_body(b):
    # 몸: 아래 둥근 모서리 → 곧은 옆면 → 둥근 꼭대기 (정면 반폭 0.43, 앞뒤 반깊이 0.36)
    body = b.make("GEO-body", rounded_column([
        (0.15, 0.0, 0.0), (0.155, 0.3, 0.25), (0.185, 0.4, 0.33), (0.24, 0.43, 0.36),
        (0.4, 0.435, 0.36), (0.65, 0.435, 0.36), (0.93, 0.43, 0.355),
        (1.04, 0.4, 0.33), (1.13, 0.33, 0.275), (1.2, 0.22, 0.185), (1.235, 0.11, 0.095), (1.25, 0.0, 0.0),
    ]), "body", "spine")

    for s, sd in L.SIDES:
        # 물방울 팔: 몸 옆 위쪽에 붙어 아래·바깥으로 처짐
        arm = L.ellipsoid((0, 0, 0), (0.075, 0.1, 0.195), seg=10, rings=7)
        L.xform(arm, Matrix.Translation((0.49 * s, 0.02, 0.56)) @ Matrix.Rotation(-0.5 * s, 4, 'Y'))
        b.make(f"GEO-arm_{sd}", arm, "body", f"arm.{sd}")
        # 짧은 다리 (아래가 조금 넓음, 윗부분은 몸 속에 묻힘)
        b.make(f"GEO-leg_{sd}", L.cyl((0.28 * s, -0.005, 0.0), (0.28 * s, -0.005, 0.27), 0.1, 0.085, 8, 1, 0.9, math.pi / 8), "body", f"leg.{sd}")

    # 안테나: 회색 막대 + 초록 공 (머리뼈에 붙임)
    b.make("GEO-antenna_stick", L.cyl((0, 0, 1.22), (0, 0, 1.39), 0.013, 0.013, 6), "stick", "head")
    b.make("GEO-antenna_ball", L.ellipsoid((0, 0, 1.47), (0.11, 0.11, 0.11), seg=10, rings=7), "antenna", "head")
    return body


def build_face(b, body):
    # 큰 까만 눈, 진한 하늘색 볼, 파란 미소: 몸 앞면에 레이캐스트로 붙임
    for s, sd in L.SIDES:
        loc, nrm = L.face_hit(body, 0.195 * s, 0.845)
        eye = L.ellipsoid((0, 0, 0), (0.064, 0.064, 0.016), seg=12, rings=6)
        L.xform(eye, Matrix.Translation(loc + nrm * 0.004) @ L.Vector((0, 0, 1)).rotation_difference(nrm).to_matrix().to_4x4())
        b.make(f"GEO-eye_{sd}", eye, "eye", "spine")
        b.make(f"GEO-cheek_{sd}", L.on_face_disc(body, 0.265 * s, 0.735, 0.068, "cheek"), "cheek", "spine")
    b.make("GEO-mouth", L.tube_mesh(L.smile_points(body, 0, 0.81, 0.068, 0.045, start=200, sweep=140), 0.013), "mouth", "spine")
