"""
맵 빌드: 원본 glb -> scratch_build/*_raw.glb(시각용) + public/models/*_colliders.json(충돌 박스)

Blender에서 실행:  exec(open(r'C:/inetpub/wwwroot/test/shooting/tools/blender/map_build.py', encoding='utf-8').read())
그다음 build(MAP_ARENA) 또는 build(MAP_YARD). 단계별로 쓸 수 있게 함수로 나눴다.

- 가져온 뒤 모든 변환을 적용하고 SCALE배 한다(맵마다 캐릭터 1.8m 기준으로 맞춘 값).
- 작은데 삼각형이 많은 소품은 Decimate.
- 충돌: 물체마다 BVH를 만들고 CELL 간격 (x,y) 기둥마다 아래에서 위로 레이를 쏴서 들어감(법선 아래)/나감(법선 위) 구간을 얻는다.
  같은 높이 구간을 가진 이웃 기둥을 직사각형으로 합쳐 박스를 만든다. 문, 창, 통로는 뚫린 채로 남고 경사로는 잘게 나뉜 계단이 된다.
- 시각용 메시는 재질별로 합쳐 draw call을 줄인다.
"""
import bpy
import bmesh
import json
import math
import re
from mathutils import Vector
from mathutils.bvhtree import BVHTree

ROOT = r'C:/inetpub/wwwroot/test/shooting'

# 맵별 설정
MAP_ARENA = {
    # ResoForge TDM 맵(컨테이너 기지): ×2.75면 문 1.93m, 상자 1.1~1.4m, 벽 5.5m
    'src': '3d/map.glb', 'out_glb': 'scratch_build/map_raw.glb', 'out_json': 'public/models/map_colliders.json',
    'scale': 2.75,
    # 판자를 엮은 상자 30개만 해당되는데, 면이 모두 실제 판자라 Decimate하면 가시처럼 깨진다. 그래서 끈다(전체 58.7k).
    'decimate_min_tris': 100000, 'decimate_target_tris': 220, 'decimate_max_size': 1.6, 'decimate_min_ratio': 0.08, 'decimate_skip': None,
    'cell': 0.125, 'hq': 0.05, 'prop_max_size': 1.6, 'min_top': 0.0,
}
MAP_YARD = {
    # ResoForge 저폴리 맵 에셋(야적장): ×0.55면 차 5m, 콘크리트 방벽 0.9m, 상자 1.0m, 큰 컨테이너 2.4m, 외곽 방벽 6m
    'src': '3d/map3.glb', 'out_glb': 'scratch_build/map_yard_raw.glb', 'out_json': 'public/models/map_yard_colliders.json',
    'scale': 0.55,
    # 원기둥 748개(개당 127), 모래주머니/타이어 더미(최대 3.9k), 차(1.6k) 같은 소품이 삼각형 대부분(42.7만).
    # 물체마다 따로 줄인다(합친 뒤 줄이면 상자 모서리가 무너진다). 최소 비율 0.25로 실루엣을 지킨다.
    'decimate_min_tris': 100, 'decimate_target_tris': 40, 'decimate_max_size': 6.0, 'decimate_min_ratio': 0.25,
    # 차는 곡면이 많아 많이 줄이면 틈이 생긴다: 고정 비율
    'decimate_skip': None, 'decimate_fixed': [(r'^CAR', 0.55)],
    # 넓고 곡면/비스듬한 물체가 많아 0.125m 격자면 박스가 수만 개가 된다. 격자와 높이 단위를 키우고,
    # 3m 이하 물체(타이어 더미, 통, 상자, 방벽)는 외곽 박스 하나로, 0.25m보다 낮은 구간(팔레트 등)은 넘어가게 둔다.
    'cell': 0.25, 'hq': 0.2, 'prop_max_size': 3.0, 'min_top': 0.25,
}

SRC = OUT_GLB = OUT_JSON = ''
SCALE = 1.0
DECIMATE_MIN_TRIS = 100000
DECIMATE_TARGET_TRIS = 220
DECIMATE_MAX_SIZE = 1.6
DECIMATE_MIN_RATIO = 0.08
DECIMATE_SKIP = None
DECIMATE_FIXED = []
CELL = 0.125
MIN_TOP = 0.0
# 충돌 높이 양자화(박스 수를 줄인다)
HQ = 0.05
# 이보다 작은 물체(상자, 통, 소품)는 외곽 박스 하나로, 큰 구조물(벽, 방, 바닥, 경사로)만 격자로 쪼갠다
PROP_MAX_SIZE = 1.6
# 이보다 작은 소품(캔 등)은 충돌 없음(총알은 시각 메시에 맞는다)
PROP_MIN_SIZE = 0.3


def world_bb(o):
    bb = [o.matrix_world @ Vector(c) for c in o.bound_box]
    return (min(v.x for v in bb), min(v.y for v in bb), min(v.z for v in bb),
            max(v.x for v in bb), max(v.y for v in bb), max(v.z for v in bb))


def is_structure(o):
    x0, y0, z0, x1, y1, z1 = world_bb(o)
    return max(x1 - x0, y1 - y0) > PROP_MAX_SIZE


def prop_boxes(meshes):
    out = []
    for o in meshes:
        if is_structure(o):
            continue
        x0, y0, z0, x1, y1, z1 = world_bb(o)
        if max(x1 - x0, y1 - y0, z1 - z0) < PROP_MIN_SIZE or z1 - z0 < 0.02 or z1 < MIN_TOP:
            continue
        out.append((x0, y0, max(0.0, z0), x1, y1, z1))
    return out


def tri_count(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)


def import_map():
    # read_homefile은 MCP 실행 중 창 컨텍스트를 잃게 해서(이후 연산자 실패) 쓰지 않고, 씬을 비운다
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.images):
        for d in list(coll):
            if d.users == 0:
                coll.remove(d)
    bpy.ops.import_scene.gltf(filepath=SRC)
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    # 가져온 직후에는 matrix_world가 갱신 전이라 부모 해제가 엉뚱한 변환을 굽는다
    bpy.context.view_layer.update()
    # 부모 변환을 메시에 굽고 빈 노드는 지운다(연산자는 선택되지 않는 물체를 건너뛰므로 데이터로 직접)
    world = {o: o.matrix_world.copy() for o in meshes}
    # 부모를 떼기 전에 원본 물체 이름(Object_123이 아닌 가장 가까운 조상, 예: CAR.002_8)을 기록한다
    for o in meshes:
        p = o
        while p is not None and re.match(r'^(Object_\d+|Object_\d+\.\d+)$', p.name):
            p = p.parent
        o['src_name'] = p.name if p is not None else o.name
    for o in meshes:
        o.parent = None
        o.matrix_world = world[o]
    for o in list(bpy.data.objects):
        if o.type != 'MESH':
            bpy.data.objects.remove(o, do_unlink=True)
    bpy.context.view_layer.update()
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    # 공유 메시 데이터는 변환 적용 전에 분리
    for o in meshes:
        if o.data.users > 1:
            o.data = o.data.copy()
    # 변환을 정점에 굽는다(연산자 대신 데이터로: 선택 상태와 무관하게)
    from mathutils import Matrix
    S = Matrix.Scale(SCALE, 4)
    for o in meshes:
        o.data.transform(S @ o.matrix_world)
        if o.matrix_world.determinant() < 0:
            o.data.flip_normals()
        o.matrix_world = Matrix.Identity(4)
        o.data.update()
    bpy.context.view_layer.update()
    return meshes


def decimate_props(meshes):
    before = sum(tri_count(o) for o in meshes)
    n = 0
    for o in meshes:
        t = tri_count(o)
        if t < DECIMATE_MIN_TRIS or max(o.dimensions) > DECIMATE_MAX_SIZE:
            continue
        name = o.get('src_name', '')
        if DECIMATE_SKIP and re.match(DECIMATE_SKIP, name):
            continue
        ratio = max(DECIMATE_MIN_RATIO, DECIMATE_TARGET_TRIS / t)
        for pat, r in DECIMATE_FIXED:
            if re.match(pat, name):
                ratio = r
        if ratio >= 1:
            continue
        m = o.modifiers.new('dec', 'DECIMATE')
        m.ratio = ratio
        m.use_collapse_triangulate = True
        with bpy.context.temp_override(object=o, active_object=o, selected_objects=[o]):
            bpy.ops.object.modifier_apply(modifier=m.name)
        n += 1
    after = sum(tri_count(o) for o in meshes)
    return {'decimated': n, 'tris_before': before, 'tris_after': after}


_HDIRS = [Vector((1, 0, 0)), Vector((-1, 0, 0)), Vector((0, 1, 0)), Vector((0, -1, 0))]


def inside(bvh, p):
    """수평 4방향 레이로 안쪽 판정: 가장 가까운 면을 뒤에서(안에서) 만나는 방향이 3개 이상이면 안쪽."""
    n = 0
    for d in _HDIRS:
        hit, normal, _i, _d = bvh.ray_cast(p, d, 60.0)
        if hit is not None and normal.dot(d) > 0:
            n += 1
    return n >= 3


def solid_bottom(bvh, x, y, lo, hi):
    """아랫면 없이 윗면을 만났을 때 실제로 막힌 구간의 바닥 높이.
    문틀 윗부분(인방)처럼 아랫면이 빠진 메시에서 문 구멍까지 막히지 않도록,
    아래부터 올라가며 처음으로 '안쪽'인 높이를 찾는다."""
    z = lo + 0.025
    while z < hi - 0.01:
        if inside(bvh, Vector((x, y, z))):
            return max(lo, z - 0.025)
        z += 0.05
    return hi


def column_intervals(meshes):
    """(i, j) 격자 기둥 -> 높이 구간 목록(z0, z1). Blender 좌표(Z 위)."""
    dg = bpy.context.evaluated_depsgraph_get()
    cols = {}
    lo = Vector((min(min((o.matrix_world @ Vector(c)).x for c in o.bound_box) for o in meshes),
                 min(min((o.matrix_world @ Vector(c)).y for c in o.bound_box) for o in meshes), 0))
    for o in meshes:
        if not is_structure(o):
            continue
        bvh = BVHTree.FromObject(o, dg)
        bb = [o.matrix_world @ Vector(c) for c in o.bound_box]
        x0, x1 = min(v.x for v in bb), max(v.x for v in bb)
        y0, y1 = min(v.y for v in bb), max(v.y for v in bb)
        zmin = max(0.0, min(v.z for v in bb))
        z0 = min(v.z for v in bb) - 0.5
        if max(v.z for v in bb) - min(v.z for v in bb) < 0.02:
            continue  # 두께 없는 판(바닥)
        i0 = math.floor((x0 - lo.x) / CELL)
        i1 = math.ceil((x1 - lo.x) / CELL)
        j0 = math.floor((y0 - lo.y) / CELL)
        j1 = math.ceil((y1 - lo.y) / CELL)
        for i in range(i0, i1):
            x = lo.x + (i + 0.5) * CELL
            for j in range(j0, j1):
                y = lo.y + (j + 0.5) * CELL
                origin = Vector((x, y, z0))
                enter = None
                # 바닥면이 없는 메시(게임 에셋에 흔함): 아랫면 없이 윗면을 만나면 물체 바닥(또는 직전 윗면)부터 막힌 것으로 본다
                floor_z = zmin
                guard = 0
                while guard < 64:
                    guard += 1
                    hit, normal, _idx, _d = bvh.ray_cast(origin, Vector((0, 0, 1)))
                    if hit is None:
                        break
                    if normal.z < -0.05:
                        if enter is None:
                            enter = hit.z
                    elif normal.z > 0.05:
                        start = enter if enter is not None else solid_bottom(bvh, x, y, floor_z, hit.z)
                        if hit.z - start > 0.02 and hit.z > MIN_TOP:
                            cols.setdefault((i, j), []).append((start, hit.z))
                        enter = None
                        floor_z = hit.z
                    origin = hit + Vector((0, 0, 1e-4))
    # 기둥마다 겹치는 구간을 합치고 높이를 1cm로 맞춘다
    out = {}
    for k, iv in cols.items():
        iv.sort()
        merged = []
        for a, b in iv:
            a, b = math.floor(a / HQ + 1e-6) * HQ, math.ceil(b / HQ - 1e-6) * HQ
            a, b = round(a, 3), round(b, 3)
            if merged and a <= merged[-1][1] + 0.01:
                merged[-1][1] = max(merged[-1][1], b)
            else:
                merged.append([a, b])
        out[k] = [tuple(m) for m in merged]
    return out, lo


def greedy_boxes(cols, lo):
    """같은 높이 구간을 가진 이웃 기둥을 직사각형으로 합친다."""
    by_iv = {}
    for k, ivs in cols.items():
        for iv in ivs:
            by_iv.setdefault(iv, set()).add(k)
    boxes = []
    for (z0, z1), cells in by_iv.items():
        cells = set(cells)
        while cells:
            i, j = min(cells)
            # i 방향으로 최대한
            i2 = i
            while (i2 + 1, j) in cells:
                i2 += 1
            # j 방향으로 같은 폭 줄을 쌓는다
            j2 = j
            while all((ii, j2 + 1) in cells for ii in range(i, i2 + 1)):
                j2 += 1
            for ii in range(i, i2 + 1):
                for jj in range(j, j2 + 1):
                    cells.discard((ii, jj))
            boxes.append((lo.x + i * CELL, lo.y + j * CELL, z0, lo.x + (i2 + 1) * CELL, lo.y + (j2 + 1) * CELL, z1))
    return boxes


def write_colliders(boxes, meshes):
    # Blender(x, y, z위) -> three(x, z위, -y)
    out = []
    for x0, y0, z0, x1, y1, z1 in boxes:
        out.append([round(x0, 3), round(z0, 3), round(-y1, 3), round(x1, 3), round(z1, 3), round(-y0, 3)])
    xs = [v for b in out for v in (b[0], b[3])]
    zs = [v for b in out for v in (b[2], b[5])]
    data = {
        'source': SRC.replace(ROOT + '/', ''), 'scale': SCALE, 'cell': CELL,
        'bounds': [min(xs), 0, min(zs), max(xs), max(b[4] for b in out), max(zs)],
        'boxes': out,
    }
    with open(OUT_JSON, 'w', encoding='utf-8') as f:
        json.dump(data, f, separators=(',', ':'))
    return len(out)


def merge_by_material(meshes):
    """재질별로 하나의 메시로 합친다(연산자 대신 bmesh: 선택/컨텍스트와 무관). 정점 변환은 이미 월드에 구워져 있다."""
    acc = {}
    for o in meshes:
        mats = list(o.data.materials) or [None]
        for k, mat in enumerate(mats):
            tmp = o.data.copy()
            bm = bmesh.new()
            bm.from_mesh(tmp)
            bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index != k], context='FACES')
            for f in bm.faces:
                f.material_index = 0
            bm.to_mesh(tmp)
            bm.free()
            if len(tmp.polygons):
                key = mat.name if mat else 'none'
                if key not in acc:
                    acc[key] = (bmesh.new(), mat)
                acc[key][0].from_mesh(tmp)
            bpy.data.meshes.remove(tmp)
    for o in meshes:
        bpy.data.objects.remove(o, do_unlink=True)
    coll = bpy.context.scene.collection
    for key, (bm, mat) in acc.items():
        me = bpy.data.meshes.new('Map_' + key)
        bm.to_mesh(me)
        bm.free()
        if mat:
            me.materials.append(mat)
        ob = bpy.data.objects.new('Map_' + key, me)
        coll.objects.link(ob)
    return len(acc)


def export():
    bpy.ops.export_scene.gltf(filepath=OUT_GLB, export_format='GLB', use_selection=False, export_yup=True,
                              export_apply=True, export_materials='EXPORT', export_normals=True,
                              export_texcoords=False, export_animations=False)


def configure(cfg):
    global SRC, OUT_GLB, OUT_JSON, SCALE, DECIMATE_MIN_TRIS, DECIMATE_TARGET_TRIS, DECIMATE_MAX_SIZE, DECIMATE_MIN_RATIO, DECIMATE_SKIP, DECIMATE_FIXED, CELL, HQ, PROP_MAX_SIZE, MIN_TOP
    SRC = ROOT + '/' + cfg['src']
    OUT_GLB = ROOT + '/' + cfg['out_glb']
    OUT_JSON = ROOT + '/' + cfg['out_json']
    SCALE = cfg['scale']
    DECIMATE_MIN_TRIS = cfg['decimate_min_tris']
    DECIMATE_TARGET_TRIS = cfg['decimate_target_tris']
    DECIMATE_MAX_SIZE = cfg['decimate_max_size']
    DECIMATE_MIN_RATIO = cfg['decimate_min_ratio']
    DECIMATE_SKIP = cfg.get('decimate_skip')
    DECIMATE_FIXED = cfg.get('decimate_fixed', [])
    CELL = cfg['cell']
    HQ = cfg['hq']
    PROP_MAX_SIZE = cfg['prop_max_size']
    MIN_TOP = cfg['min_top']


def build(cfg=MAP_ARENA):
    configure(cfg)
    meshes = import_map()
    info = decimate_props(meshes)
    cols, lo = column_intervals(meshes)
    boxes = greedy_boxes(cols, lo) + prop_boxes(meshes)
    info['boxes'] = write_colliders(boxes, meshes)
    info['columns'] = len(cols)
    info['materials'] = merge_by_material(meshes)
    export()
    return info
