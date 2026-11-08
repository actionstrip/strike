"""
로우폴리 캐릭터 공통 블렌더 도구.
빙빙이(bingbing)·방울이(bangul)를 만들 때 쓴 코드를 재사용할 수 있게 정리한 것.

블렌더 MCP execute_blender_code 안에서 이렇게 불러 씀 (실행마다 새 네임스페이스이므로 매번 import):

    import sys, importlib
    sys.path.insert(0, r"E:\\inetpub\\wwwroot\\test\\pixi_ai\\threejs\\.claude\\skills\\lowpoly-character-pipeline\\scripts")
    import lowpoly_lib as L; importlib.reload(L)

규격: 키 2.0, 바닥 z=0, 정면 -Y, 캐릭터의 왼쪽 = +X (이름 접미사 _L / .L),
부위 메시를 뼈에 통째로 붙임(bone parenting), 플랫 셰이딩.
"""
import bpy, bmesh, math, os, json, struct
from mathutils import Vector, Matrix

BONES = ["root", "hips", "spine", "head", "arm.L", "arm.R", "leg.L", "leg.R"]
SIDES = ((1, "L"), (-1, "R"))


# ---------------------------------------------------------------- 재질
def srgb(hexstr):
    """'#RRGGBB' → 선형 RGB (Principled BSDF 입력용)"""
    h = hexstr.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]


def make_materials(palette):
    """palette = {"skin": ("#FAD0AE", 0.6), ...} → MAT-<name> 재질을 만들거나 색을 갱신"""
    out = {}
    for name, (hx, rough) in palette.items():
        m = bpy.data.materials.get("MAT-" + name) or bpy.data.materials.new("MAT-" + name)
        m.use_nodes = True
        b = m.node_tree.nodes["Principled BSDF"]
        c = srgb(hx)
        b.inputs["Base Color"].default_value = (*c, 1)
        b.inputs["Roughness"].default_value = rough
        m.diffuse_color = (*c, 1)
        out[name] = m
    return out


# ---------------------------------------------------------------- 뼈대
def create_rig(col, rig_name, shoulder=(0.27, 0.88), hand=(0.335, -0.01, 0.51), hip_x=0.11):
    """
    뼈 8개 (모든 캐릭터 공통 이름·구조). 위치는 캐릭터 비율에 맞춰 조금씩 다를 수 있음.
    빙빙이: hand=(0.345,-0.01,0.51), hip_x=0.12 / 방울이: 기본값
    """
    data = bpy.data.armatures.new(rig_name)
    rig = bpy.data.objects.new(rig_name, data)
    col.objects.link(rig)
    data.display_type = 'STICK'
    rig.show_in_front = True
    for o in bpy.context.selected_objects:
        o.select_set(False)
    bpy.context.view_layer.objects.active = rig
    rig.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    eb = data.edit_bones

    def bone(name, h, t, parent=None, connect=False):
        b = eb.new(name)
        b.head, b.tail, b.roll = Vector(h), Vector(t), 0
        if parent:
            b.parent = eb[parent]
            b.use_connect = connect

    bone("root", (0, 0, 0), (0, 0, 0.15))
    bone("hips", (0, 0, 0.42), (0, 0, 0.52), "root")
    bone("spine", (0, 0, 0.52), (0, 0, 0.98), "hips", True)
    bone("head", (0, 0, 1.0), (0, 0, 1.7), "spine")
    for s, sd in SIDES:
        bone(f"arm.{sd}", (shoulder[0] * s, 0, shoulder[1]), (hand[0] * s, hand[1], hand[2]), "spine")
        bone(f"leg.{sd}", (hip_x * s, 0, 0.46), (hip_x * s, 0, 0.12), "hips")
    bpy.ops.object.mode_set(mode='OBJECT')
    for pb in rig.pose.bones:
        pb.rotation_mode = 'XYZ'
    return rig


# ---------------------------------------------------------------- 메시 도구 (모두 월드 좌표로 만듦)
def xform(bm, M):
    bmesh.ops.transform(bm, matrix=M, verts=bm.verts)
    return bm


def along(p1, p2):
    """p1→p2 축으로 세우는 행렬과 길이 (Z축 원기둥을 두 점 사이에 놓을 때)"""
    p1, p2 = Vector(p1), Vector(p2)
    d = p2 - p1
    R = Vector((0, 0, 1)).rotation_difference(d.normalized()).to_matrix().to_4x4()
    return Matrix.Translation((p1 + p2) / 2) @ R, d.length


def cyl(p1, p2, r1, r2=None, seg=8, sx=1.0, sy=1.0, rot=0.0):
    """두 점 사이 각진 원기둥/원뿔. sx·sy로 단면을 납작하게, rot(=π/8이면 8각형 평평한 면이 정면)"""
    M, L = along(p1, p2)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r1,
                          radius2=r1 if r2 is None else r2, depth=L)
    return xform(bm, M @ Matrix.Diagonal((sx, sy, 1, 1)) @ Matrix.Rotation(rot, 4, 'Z'))


def box(center, size):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    return xform(bm, Matrix.Translation(center) @ Matrix.Diagonal((*size, 1)))


def ellipsoid(center, radii, seg=8, rings=6):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=1.0)
    return xform(bm, Matrix.Translation(center) @ Matrix.Diagonal((*radii, 1)))


def ico(center, r, scale=(1.0, 0.95, 1.08)):
    """주먹 (icosphere subdiv 1)"""
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=1, radius=r)
    return xform(bm, Matrix.Translation(center) @ Matrix.Diagonal((*scale, 1)))


def merge(parts):
    out = bmesh.new()
    tmp = bpy.data.meshes.new("tmp_merge")
    for p in parts:
        p.to_mesh(tmp)
        p.free()
        out.from_mesh(tmp)
    bpy.data.meshes.remove(tmp)
    return out


def flat_bottom_dome(center, radii, seg=12, rings=8):
    """아래 절반을 납작하게 누른 구 (신발 윗부분, 앞코)"""
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=1.0)
    xform(bm, Matrix.Diagonal((*radii, 1)))
    for v in bm.verts:
        if v.co.z < 0:
            v.co.z = 0.0
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    return xform(bm, Matrix.Translation(center))


def head_mesh(center, radii, fullness=0.3):
    """통통한 볼의 얼굴: 구의 아래쪽 절반을 바깥으로 부풀림. 빙빙이 (0,0.02,1.45)/(0.425,0.40,0.42), 방울이 (0,0.02,1.47)/(0.40,0.38,0.41)"""
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=14, v_segments=10, radius=1.0)
    c = Vector(center)
    for v in bm.verts:
        n = v.co.copy()
        k = 1 + fullness * (-n.z) * (1 + n.z) if n.z < 0 else 1.0
        v.co = Vector((n.x * radii[0] * k, n.y * radii[1] * k, n.z * radii[2])) + c
    return bm


def _spow(x, e):
    return math.copysign(abs(x) ** e, x)


def hair_dome(center, rx, ry_front, ry_back, rz, zcut, spike=None, E=0.8, seg=18, rows=8):
    """
    바가지 머리 돔. 위 꼭짓점에서 아래로 rows줄, 아래 끝선은 방위각마다 zcut(phi)에서 끊김.
      phi: 0 = 정면(-Y), +면 캐릭터 왼쪽(+X)
      zcut(phi) → 그 방향 머리카락 아래 끝 높이 (앞머리/옆/뒤)
      spike(j, phi) → 맨 아래 꼭짓점 (dz, dy) 이동 (앞머리 끝 뾰족뾰족). None이면 그대로
      E < 1 이면 세로 단면이 각져서 버섯처럼 부푼 모양 (E=2/2.5)
    두께는 객체에 Solidify(thickness 0.04~0.045, offset -1)를 붙여서 줌.
    """
    C = Vector(center)
    bm = bmesh.new()
    pole = bm.verts.new(C + Vector((0, 0, rz)))
    rings_ = []
    for j in range(seg):
        phi = 2 * math.pi * j / seg
        ny = -math.cos(phi)
        tmax = math.acos(_spow(max(-1.0, min(1.0, (zcut(phi) - C.z) / rz)), 1 / E))
        col = []
        for k in range(1, rows + 1):
            t = tmax * k / rows
            st, ct = _spow(math.sin(t), E), _spow(math.cos(t), E)
            p = C + Vector((rx * st * math.sin(phi), (ry_front if ny < 0 else ry_back) * st * ny, rz * ct))
            if k == rows and spike:
                d = spike(j, phi)
                if d:
                    p.z += d[0]
                    p.y += d[1]
            col.append(bm.verts.new(p))
        rings_.append(col)
    for j in range(seg):
        a, b = rings_[j], rings_[(j + 1) % seg]
        bm.faces.new((pole, b[0], a[0]))
        for k in range(rows - 1):
            bm.faces.new((a[k], b[k], b[k + 1], a[k + 1]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def zcut_quadratic(front, side, back, tilt=0.0):
    """앞/옆/뒤 끝 높이로 zcut(phi)를 만듦. tilt>0이면 캐릭터 왼쪽(+X) 앞머리가 높아짐 (옆으로 넘긴 앞머리)"""
    a = side
    c = (front + back) / 2 - side
    b = (back - front) / 2

    def f(phi):
        ny = -math.cos(phi)
        return a + b * ny + c * ny * ny + tilt * math.sin(phi) * max(0.0, math.cos(phi))
    return f


def tapered_bundle(a0, a1, profile=((0.0, 0.065), (0.3, 0.13), (0.65, 0.105)), seg=7):
    """머리 묶음(양갈래 등): a0(묶은 곳)에서 부풀었다가 a1에서 뾰족해지는 다발"""
    a0, a1 = Vector(a0), Vector(a1)
    R = Vector((0, 0, 1)).rotation_difference((a1 - a0).normalized()).to_matrix()
    bm = bmesh.new()
    rings_ = []
    for t, r in profile:
        c = a0 + (a1 - a0) * t
        rings_.append([bm.verts.new(c + R @ Vector((r * math.cos(2 * math.pi * i / seg + 0.3),
                                                    r * math.sin(2 * math.pi * i / seg + 0.3), 0)))
                       for i in range(seg)])
    tip = bm.verts.new(a1)
    bm.faces.new(list(reversed(rings_[0])))
    for k in range(len(rings_) - 1):
        for i in range(seg):
            bm.faces.new((rings_[k][i], rings_[k][(i + 1) % seg], rings_[k + 1][(i + 1) % seg], rings_[k + 1][i]))
    for i in range(seg):
        bm.faces.new((rings_[-1][i], rings_[-1][(i + 1) % seg], tip))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def swept_crescent(points, seg=8):
    """
    정면(xz)에서 본 중심선을 따라 타원 단면을 이어 붙인 덩어리 (홍이 퀴프, 권이 퐁파두르).
    points = [(x, y, z, h, df, db)]: h = 정면에서 본 반두께(중심선에 수직), df/db = 앞/뒤(y) 반깊이. 양 끝 h=0이면 뾰족.
    db를 크게 하면 뒷머리 돔 속으로 이어져 옆에서 볼 때 끊김이 없음.
    """
    P = [Vector(p[:3]) for p in points]
    bm = bmesh.new()
    rings = []
    for i, (x, y, z, h, df, db) in enumerate(points):
        a, c = P[max(i - 1, 0)], P[min(i + 1, len(P) - 1)]
        t = Vector((c.x - a.x, 0, c.z - a.z)).normalized()
        n = Vector((-t.z, 0, t.x))
        if h <= 0:
            rings.append([bm.verts.new(P[i])])
            continue
        ring = []
        for k in range(seg):
            sn = math.sin(2 * math.pi * k / seg)
            ring.append(bm.verts.new(P[i] + n * h * math.cos(2 * math.pi * k / seg) + Vector((0, (db if sn > 0 else df) * sn, 0))))
        rings.append(ring)
    for r0, r1 in zip(rings, rings[1:]):
        if len(r0) == 1:
            for k in range(seg):
                bm.faces.new((r0[0], r1[k], r1[(k + 1) % seg]))
        elif len(r1) == 1:
            for k in range(seg):
                bm.faces.new((r0[k], r0[(k + 1) % seg], r1[0]))
        else:
            for k in range(seg):
                bm.faces.new((r0[k], r0[(k + 1) % seg], r1[(k + 1) % seg], r1[k]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def ring_frame(center, radius, tube, y, seg=16):
    """둥근 안경테 (단면 사각 토러스, 정면을 봄)"""
    cx, cz = center
    bm = bmesh.new()
    grid = []
    for i in range(seg):
        a = 2 * math.pi * i / seg
        ring = []
        for j in range(4):
            b = 2 * math.pi * j / 4 + math.pi / 4
            rr = radius + tube * math.cos(b)
            ring.append(bm.verts.new((cx + rr * math.cos(a), y + tube * math.sin(b), cz + rr * math.sin(a))))
        grid.append(ring)
    for i in range(seg):
        for j in range(4):
            bm.faces.new((grid[i][j], grid[(i + 1) % seg][j], grid[(i + 1) % seg][(j + 1) % 4], grid[i][(j + 1) % 4]))
    return bm


def rect_frame(center, w, h, t, y, depth=0.025):
    """사각 안경테 (막대 4개)"""
    cx, cz = center
    return merge([box((cx, y, cz + h / 2 - t / 2), (w, depth, t)), box((cx, y, cz - h / 2 + t / 2), (w, depth, t)),
                  box((cx - w / 2 + t / 2, y, cz), (t, depth, h)), box((cx + w / 2 - t / 2, y, cz), (t, depth, h))])


def disc_with_uv(center, r, y, seg=16):
    """정면을 보는 원판 + 평면 UV (나선 렌즈 등 텍스처용). 정점 순서상 법선이 -Y(정면)"""
    cx, cz = center
    bm = bmesh.new()
    vs = [bm.verts.new((cx + r * math.cos(2 * math.pi * k / seg), y, cz + r * math.sin(2 * math.pi * k / seg)))
          for k in range(seg)]
    f = bm.faces.new(vs)
    uv = bm.loops.layers.uv.new("UV")
    for l in f.loops:
        l[uv].uv = ((l.vert.co.x - cx) / (2 * r) + 0.5, (l.vert.co.z - cz) / (2 * r) + 0.5)
    return bm


def flat_polygon(points_xz, y_fn):
    """정면 장식(번개, 별 등): xz 점들을 y_fn(z) 깊이에 붙인 다각형 한 면"""
    bm = bmesh.new()
    bm.faces.new([bm.verts.new((x, y_fn(z), z)) for x, z in points_xz])
    return bm


def star_points(cx, cz, r_out, r_in):
    return [(cx + (r_out if k % 2 == 0 else r_in) * math.cos(math.pi / 2 + k * math.pi / 5),
             cz + (r_out if k % 2 == 0 else r_in) * math.sin(math.pi / 2 + k * math.pi / 5)) for k in range(10)]


def tube_mesh(points, r):
    """점들을 잇는 가는 관 (입, 눈썹). 커브를 잠깐 만들어 메시로 바꿈"""
    cd = bpy.data.curves.new("tmp_tube", "CURVE")
    cd.dimensions = '3D'
    cd.bevel_depth = r
    cd.bevel_resolution = 0
    sp = cd.splines.new('POLY')
    sp.points.add(len(points) - 1)
    for p, c in zip(sp.points, points):
        p.co = (*c, 1)
    t = bpy.data.objects.new("tmp_tube", cd)
    bpy.context.scene.collection.objects.link(t)
    bpy.context.view_layer.update()
    me = bpy.data.meshes.new_from_object(t.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    bpy.data.objects.remove(t)
    bpy.data.curves.remove(cd)
    bm = bmesh.new()
    bm.from_mesh(me)
    bpy.data.meshes.remove(me)
    return bm


def spiral_image(name, stripe_hex="#87CCF2", base_hex="#F2FCFF", size=256, turns=19):
    """흰 바탕 + 하늘색 나선 이미지 (빙빙이 렌즈). 파일에 pack 됨"""
    img = bpy.data.images.get(name) or bpy.data.images.new(name, size, size)
    a_c, b_c = srgb(stripe_hex), srgb(base_hex)
    px = [0.0] * (size * size * 4)
    for j in range(size):
        for i in range(size):
            u, v = (i / (size - 1)) * 2 - 1, (j / (size - 1)) * 2 - 1
            c = a_c if math.sin(math.hypot(u, v) * turns + math.atan2(v, u)) > 0.2 else b_c
            k = (i + j * size) * 4
            px[k:k + 4] = (*c, 1.0)
    img.pixels = px
    img.pack()
    return img


# ---------------------------------------------------------------- 객체 만들기 / 뼈에 붙이기
class Builder:
    """
    b = L.Builder(col, rig)
    b.make("GEO-shirt", L.cyl(...), "shirt", "spine")
    이미 있는 이름이면 메시만 갈아끼움 (수정 반복에 편함). 만드는 동안 rig는 REST 자세여야 함.
    suffix: 같은 .blend 안에서 시험으로 한 벌 더 만들 때 객체 이름 뒤에 붙임 (보통 "")
    """

    def __init__(self, col, rig, suffix=""):
        self.col, self.rig, self.suffix = col, rig, suffix
        rig.data.pose_position = 'REST'

    def make(self, name, bm, mat, bone):
        name += self.suffix
        me = bpy.data.meshes.new(name.replace("GEO-", ""))
        bm.to_mesh(me)
        bm.free()
        me.materials.append(bpy.data.materials["MAT-" + mat])
        for p in me.polygons:
            p.use_smooth = False
        o = bpy.data.objects.get(name)
        if o:
            old = o.data
            o.data = me
            o.modifiers.clear()
            if old.users == 0:
                bpy.data.meshes.remove(old)
        else:
            o = bpy.data.objects.new(name, me)
            self.col.objects.link(o)
        o.rotation_mode = 'XYZ'
        o.parent = self.rig
        o.parent_type = 'BONE'
        o.parent_bone = bone
        bpy.context.view_layer.update()
        o.matrix_world = Matrix.Identity(4)   # 정점이 이미 월드 좌표
        bpy.context.view_layer.update()
        return o


def face_hit(head_obj, x, z):
    """정면(-Y)에서 얼굴 표면까지 레이캐스트 → (위치, 법선). 얼굴 실루엣 끝에서는 빗나가므로 x를 안쪽으로"""
    ok, loc, nrm, _ = head_obj.ray_cast(Vector((x, -2, z)), Vector((0, 1, 0)))
    if not ok:
        raise ValueError(f"face_hit miss at x={x}, z={z} (얼굴 안쪽으로 옮길 것)")
    return loc, nrm


def on_face_disc(head_obj, x, z, r, mat_name, depth=0.006):
    """얼굴 표면에 붙는 얇은 원판 (볼터치)"""
    loc, nrm = face_hit(head_obj, x, z)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=10, radius1=r, radius2=r, depth=depth)
    return xform(bm, Matrix.Translation(loc + nrm * 0.002) @ Vector((0, 0, 1)).rotation_difference(nrm).to_matrix().to_4x4())


def smile_points(head_obj, cx, cz, half_w, h, n=7, start=205, sweep=130):
    """얼굴 표면을 따라가는 미소 곡선 점들 (tube_mesh에 넘김)"""
    pts = []
    for k in range(n):
        a = math.radians(start + sweep * k / (n - 1))
        x, z = cx + half_w * math.cos(a), cz + h * math.sin(a)
        pts.append((x, face_hit(head_obj, x, z)[0].y - 0.006, z))
    return pts


# ---------------------------------------------------------------- 애니메이션 (모든 캐릭터 같은 값)
def make_actions(rig, suffix=""):
    """
    suffix: 시험용으로 액션 이름 뒤에 붙임 (보통 "". 게임은 정확히 Idle / Walk / Ride 이름을 찾음)
    Idle(48f) / Walk(24f) / Ride(48f) 액션. 모든 뼈에 키를 넣어 three.js에서 액션을 바꿔도 이전 자세가 남지 않음.
    부호: 팔·다리 rotation_euler.x 음수 = 앞으로, spine/head x 양수 = 앞으로 숙임 (정면 -Y 기준).
    Walk 보폭: 고관절 높이 0.46, 흔들기 ±0.5rad → 한 주기 약 0.88 (게임 키 1.8 배율이면 0.79 → walkStride 0.8)
    """
    sc = bpy.context.scene
    rig.animation_data_create()
    for pb in rig.pose.bones:
        pb.rotation_mode = 'XYZ'
    S = lambda t, k=1, ph=0: math.sin(2 * math.pi * (k * t + ph))

    def make(name, length, step, pose_fn):
        name += suffix
        old = bpy.data.actions.get(name)
        if old:
            bpy.data.actions.remove(old)
        act = bpy.data.actions.new(name)
        act.use_fake_user = True
        rig.animation_data.action = act
        for f in range(1, length + 2, step):
            t = (f - 1) / length     # 마지막 키 = 첫 키 (이음새 없는 루프)
            for pb in rig.pose.bones:
                pb.location = (0, 0, 0)
                pb.rotation_euler = (0, 0, 0)
            pose_fn(t, rig.pose.bones)
            for bn in BONES:
                pb = rig.pose.bones[bn]
                pb.keyframe_insert("rotation_euler", frame=f)
                pb.keyframe_insert("location", frame=f)
        act.frame_range = (1, length + 1)
        act.use_frame_range = True
        act.use_cyclic = True

    def walk(t, P):
        s = S(t)
        P["leg.L"].rotation_euler.x = -0.5 * s
        P["leg.R"].rotation_euler.x = 0.5 * s
        P["arm.L"].rotation_euler.x = 0.45 * s
        P["arm.R"].rotation_euler.x = -0.45 * s
        P["arm.L"].rotation_euler.z = 0.06
        P["arm.R"].rotation_euler.z = -0.06
        P["hips"].location.y = 0.03 * abs(math.cos(2 * math.pi * t)) - 0.01
        P["hips"].rotation_euler.y = 0.1 * s
        P["spine"].rotation_euler.y = -0.12 * s
        P["spine"].rotation_euler.z = 0.04 * S(t, 1, 0.25)
        P["spine"].rotation_euler.x = 0.06
        P["head"].rotation_euler.y = 0.04 * s
        P["head"].rotation_euler.x = -0.03 + 0.02 * S(t, 2)

    def idle(t, P):
        P["spine"].rotation_euler.x = 0.015 + 0.015 * S(t)
        P["hips"].location.y = 0.006 * S(t)
        P["head"].rotation_euler.x = 0.03 * S(t, 1, -0.15)
        P["head"].rotation_euler.z = 0.025 * S(t, 1, 0.3)
        P["arm.L"].rotation_euler.z = -0.03 - 0.02 * S(t, 1, -0.1)
        P["arm.R"].rotation_euler.z = 0.03 + 0.02 * S(t, 1, -0.1)

    def ride(t, P):
        # 세그웨이 손잡이: 발 기준 위 0.93, 앞 0.29 (모델 단위) → 팔을 거의 수평으로 앞으로
        P["arm.L"].rotation_euler.x = -1.45 + 0.02 * S(t)
        P["arm.R"].rotation_euler.x = -1.45 + 0.02 * S(t)
        P["arm.L"].rotation_euler.z = 0.05
        P["arm.R"].rotation_euler.z = -0.05
        P["spine"].rotation_euler.x = 0.06 + 0.01 * S(t)
        P["head"].rotation_euler.x = -0.06
        P["hips"].location.y = 0.004 * S(t)

    make("Walk", 24, 2, walk)
    make("Ride", 48, 4, ride)
    make("Idle", 48, 4, idle)
    sc.frame_start, sc.frame_end = 1, 48
    rig.animation_data.action = bpy.data.actions["Idle" + suffix]
    sc.frame_set(1)
    rig.data.pose_position = 'POSE'


# ---------------------------------------------------------------- 확인 렌더
VIEWS = {"front": (0, -6, 1.0), "side": (6, 0, 1.0), "back": (0, 6, 1.0), "45": (-4.2, -4.2, 1.0), "back45": (4.2, 4.2, 1.0)}


def render_views(out_dir, prefix, views=VIEWS, shots=None, ortho=2.4, res=400, hide=(), target=(0, 0, 1.0)):
    """
    직교 카메라로 여러 방향 렌더 (참고 시트와 비교용). 임시 카메라는 끝나면 지움.
    shots = [("Walk", 7, (-4.2,-4.2,1.0), "walk7_45"), ...] 를 주면 액션·프레임별로 렌더
    target: 카메라가 바라보는 점 (키 작은 캐릭터는 (0,0,0.75) + ortho 1.8, 머리 위 장식이 큰 캐릭터는 ortho 2.9)
    """
    sc = bpy.context.scene
    os.makedirs(out_dir, exist_ok=True)
    cd = bpy.data.cameras.new("TMP-cam")
    cd.type = 'ORTHO'
    cd.ortho_scale = ortho
    cam = bpy.data.objects.new("TMP-cam", cd)
    sc.collection.objects.link(cam)
    old = (sc.camera, sc.render.resolution_x, sc.render.resolution_y, sc.render.filepath)
    sc.camera = cam
    sc.render.resolution_x = sc.render.resolution_y = res
    hidden = [(o, o.hide_render) for o in hide]
    for o in hide:
        o.hide_render = True
    files = []
    jobs = shots or [(None, None, p, k) for k, p in views.items()]
    rigs = [o for o in hide if o.type == 'ARMATURE']
    for act, frame, pos, tag in jobs:
        if act and rigs:
            rigs[0].animation_data.action = bpy.data.actions[act]   # 시험용 suffix가 있으면 act에 포함해서 넘김
            sc.frame_set(frame)
        cam.location = pos
        cam.rotation_euler = (Vector(target) - Vector(pos)).to_track_quat('-Z', 'Y').to_euler()
        sc.render.filepath = os.path.join(out_dir, f"{prefix}_{tag}.png")
        bpy.ops.render.render(write_still=True)
        files.append(sc.render.filepath)
    for o, h in hidden:
        o.hide_render = h
    sc.camera, sc.render.resolution_x, sc.render.resolution_y, sc.render.filepath = old
    bpy.data.objects.remove(cam)
    bpy.data.cameras.remove(cd)
    return files


# ---------------------------------------------------------------- 내보내기
def export_glb(col, rig, path):
    """
    뼈대 + 부위만 GLB로. 내보낸 파일을 다시 읽어 요약을 돌려줌.
    주의: ACTIONS 모드는 .blend 안의 '모든' 액션을 내보냄 → .blend 하나에는 캐릭터 하나만 둘 것.
    """
    rig.hide_render = False
    # 높이는 기본 자세에서 잼 (걷기 자세면 발끝이 바닥 아래로 내려가 보임)
    rig.data.pose_position = 'REST'
    bpy.context.view_layer.update()
    zs = [(o.matrix_world @ v.co).z for o in col.objects if o.type == 'MESH' for v in o.data.vertices]
    rig.data.pose_position = 'POSE'
    if rig.animation_data and "Idle" in bpy.data.actions:
        rig.animation_data.action = bpy.data.actions["Idle"]
    bpy.context.scene.frame_set(1)
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for o in col.objects:
        o.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True,
                              export_apply=True, export_yup=True, export_cameras=False, export_lights=False,
                              export_animations=True, export_animation_mode='ACTIONS', export_force_sampling=True,
                              export_frame_range=False, export_anim_single_armature=True)
    b = open(path, 'rb').read()
    n = struct.unpack('<I', b[12:16])[0]
    j = json.loads(b[20:20 + n])
    N = j["nodes"]
    return {
        "size": len(b),
        "anims": sorted(a["name"] for a in j.get("animations", [])),
        "meshes": len(j["meshes"]),
        "materials": len(j["materials"]),
        "bone_children": {nd["name"]: len([c for c in nd.get("children", []) if "mesh" in N[c]])
                          for nd in N if "mesh" not in nd},
        "height": round(max(zs) - min(zs), 3),
        "min_z": round(min(zs), 3),
    }
