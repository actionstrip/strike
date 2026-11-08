"""
맵 빌드: 3d/map.glb -> scratch_build/map_raw.glb(시각용) + public/models/map_colliders.json(충돌 박스)

Blender에서 실행:  exec(open(r'C:/inetpub/wwwroot/test/shooting/tools/blender/map_build.py', encoding='utf-8').read())
단계별로 쓸 수 있게 함수로 나눴다. build()가 전체를 돌린다.

- 가져온 뒤 모든 변환을 적용하고 SCALE배 키운다(캐릭터 1.8~1.9m 기준으로 상자 1.0~1.25m, 벽 5m).
- 작은데 삼각형이 많은 소품은 Decimate.
- 충돌: 물체마다 BVH를 만들고 CELL 간격 (x,y) 기둥마다 아래에서 위로 레이를 쏴서 들어감(법선 아래)/나감(법선 위) 구간을 얻는다.
  같은 높이 구간을 가진 이웃 기둥을 직사각형으로 합쳐 박스를 만든다. 문, 창, 통로는 뚫린 채로 남고 경사로는 잘게 나뉜 계단이 된다.
- 시각용 메시는 재질별로 합쳐 draw call을 줄인다.
"""
import bpy
import bmesh
import json
import math
from mathutils import Vector
from mathutils.bvhtree import BVHTree

ROOT = r'C:/inetpub/wwwroot/test/shooting'
SRC = ROOT + '/3d/map.glb'
OUT_GLB = ROOT + '/scratch_build/map_raw.glb'
OUT_JSON = ROOT + '/public/models/map_colliders.json'
SCALE = 2.5
CELL = 0.125
# 이 이상 삼각형을 가진 작은 소품은 줄인다.
# 이 맵에서 대상은 판자를 엮은 상자 30개뿐인데, 면이 모두 실제 판자라 Decimate하면 가시처럼 깨진다(평면 병합으로도 줄지 않음).
# 그래서 끈다(전체 58.7k 삼각형은 GT 640에서도 부담이 작다). 다른 맵에서 필요하면 낮춘다.
DECIMATE_MIN_TRIS = 100000
DECIMATE_TARGET_TRIS = 220
DECIMATE_MAX_SIZE = 1.6
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
        if max(x1 - x0, y1 - y0, z1 - z0) < PROP_MIN_SIZE or z1 - z0 < 0.02:
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
        m = o.modifiers.new('dec', 'DECIMATE')
        m.ratio = max(0.08, DECIMATE_TARGET_TRIS / t)
        with bpy.context.temp_override(object=o, active_object=o, selected_objects=[o]):
            bpy.ops.object.modifier_apply(modifier=m.name)
        n += 1
    after = sum(tri_count(o) for o in meshes)
    return {'decimated': n, 'tris_before': before, 'tris_after': after}


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
                        start = enter if enter is not None else floor_z
                        if hit.z - start > 0.02:
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
        'source': '3d/map.glb', 'scale': SCALE, 'cell': CELL,
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


def build():
    meshes = import_map()
    info = decimate_props(meshes)
    cols, lo = column_intervals(meshes)
    boxes = greedy_boxes(cols, lo) + prop_boxes(meshes)
    info['boxes'] = write_colliders(boxes, meshes)
    info['columns'] = len(cols)
    info['materials'] = merge_by_material(meshes)
    export()
    return info
