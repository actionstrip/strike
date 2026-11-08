# Numbers for a seated character, per car, in the character's frame (Seat at the origin, divided by driverScale;
# Blender axes: the character faces -Y, +Z up):
#   hands / grips    wrists against the Steering rim at a quarter to three (cars with a Steering node)
#   feet / floor     toes and ankles against the floor below them
#   head_room        roof above the head top (97th percentile of head z, past the antenna), None when open
#   travel           how far hips, knees, feet and hands move over the clip (should be ~0 for cars)
#   profile          (with PROFILE=1) first hits straight down at x=X every 0.1 along y: cushion, seatback, floor
#   BLEND, CARS, CLIP as in seat_view.py
import bpy, os
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

HERE = r"C:\inetpub\wwwroot\test\race\.claude\skills\add-character\scripts"
exec(open(os.path.join(HERE, 'cars.py'), encoding='utf8').read())
BLEND = os.environ.get('BLEND', r"C:\inetpub\wwwroot\test\race\3d\Robot_game.blend")
UP = Vector((0, 0, 1))
result = {}
bpy.ops.wm.open_mainfile(filepath=BLEND)
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
body = next(o for o in bpy.data.objects if o.type == 'MESH' and any(m.type == 'ARMATURE' for m in o.modifiers))


def bone(n):
    return next(p for p in arm.pose.bones if p.name.split(':')[-1] == n)


def at(n, tail=False):
    pb = bone(n)
    return arm.matrix_world @ (pb.tail if tail else pb.head)


def r3(v):
    return [round(c, 2) for c in v]


for car in os.environ.get('CARS', 'racer').split(','):
    file, scale, clip = CARS[car]
    name = os.environ.get('CLIP') or (f'{clip}.{car}' if f'{clip}.{car}' in bpy.data.actions else clip)
    act = bpy.data.actions[name]
    arm.animation_data.action = act
    arm.animation_data.action_slot = act.slots[0]
    a, b = (int(f) for f in act.frame_range)
    joints = ('Hips', 'LeftLeg', 'LeftFoot', 'RightFoot', 'LeftHand', 'RightHand')
    start, travel = {}, {n: 0.0 for n in joints}
    for f in range(a, b + 1):
        bpy.context.scene.frame_set(f)
        for n in joints:
            p = at(n)
            start.setdefault(n, p.copy())
            travel[n] = max(travel[n], (p - start[n]).length)
    bpy.context.scene.frame_set(a)
    r = {'clip': name, 'travel': {n: round(v, 3) for n, v in travel.items()}}

    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(MODELS, file))
    new = [o for o in bpy.data.objects if o not in before]
    seat = next(o for o in new if o.name.split('.')[0] == 'Seat')
    to_char = (seat.matrix_world @ Matrix.Scale(scale, 4)).inverted()
    dg = bpy.context.evaluated_depsgraph_get()
    verts, polys = [], []
    for o in new:
        if o.type != 'MESH':
            continue
        m = o.evaluated_get(dg).to_mesh()
        mw = to_char @ o.matrix_world
        base = len(verts)
        verts += [mw @ v.co for v in m.vertices]
        polys += [[base + i for i in p.vertices] for p in m.polygons]
    bvh = BVHTree.FromPolygons(verts, polys)

    wheel = next((o for o in new if o.name.split('.')[0] == 'Steering'), None)
    if wheel:
        rim = [to_char @ o.matrix_world @ v.co for o in [wheel] + list(wheel.children_recursive) if o.type == 'MESH'
               for v in o.data.vertices]
        lo = Vector([min(p[i] for p in rim) for i in range(3)])
        hi = Vector([max(p[i] for p in rim) for i in range(3)])
        mid, half = (lo + hi) / 2, (hi - lo) / 2
        for side, out in (('Left', 1), ('Right', -1)):
            part = [p for p in rim if (p.x - mid.x) * out > 0.6 * half.x and mid.z < p.z < mid.z + 0.5 * half.z]
            # handlebars have no rim: their outer ends are the grips
            part = part or [p for p in rim if (p.x - mid.x) * out > 0.8 * half.x]
            grip = sum(part, Vector()) / len(part)
            r[side + 'Hand'] = {'wrist': r3(at(side + 'Hand')), 'grip': r3(grip), 'gap': round((at(side + 'Hand') - grip).length, 3)}
    for side in ('Left', 'Right'):
        toe = at(side + 'ToeBase', tail=True)
        hit = bvh.ray_cast(Vector((toe.x, toe.y, max(toe.z, at('Hips').z))), -UP, 10)[0]
        r[side + 'Foot'] = {'toe': r3(toe), 'floor_z': round(hit.z, 2) if hit else None}
    dgc = bpy.context.evaluated_depsgraph_get()
    hm = body.evaluated_get(dgc).to_mesh()
    gi = body.vertex_groups[bone('Head').name].index
    zs = sorted((body.matrix_world @ v.co for v in hm.vertices
                 if any(g.group == gi and g.weight > 0.5 for g in v.groups)), key=lambda p: p.z)
    top = zs[int(len(zs) * 0.97)]
    roof = bvh.ray_cast(top + UP * 5, -UP, 10)[0]
    r['head_room'] = round(roof.z - top.z, 3) if roof and roof.z > at('Neck').z else None
    r['hips'] = r3(at('Hips'))
    if os.environ.get('PROFILE') == '1':
        x = float(os.environ.get('X', '0'))
        prof = {}
        for i in range(-30, 21):
            y, z, hits = i * 0.1, 4.0, []
            while len(hits) < 6:
                h = bvh.ray_cast(Vector((x, y, z)), -UP, 10)
                if not h[0]:
                    break
                hits.append(round(h[0].z, 2))
                z = h[0].z - 0.005
            prof[f'{y:.1f}'] = hits
        r['profile'] = prof
    result[car] = r
    for o in new:
        bpy.data.objects.remove(o, do_unlink=True)
