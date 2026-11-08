import bpy, bmesh, math, os
from mathutils import Matrix, Vector

SCRATCH = r"C:\Users\striper\AppData\Local\Temp\claude\C--inetpub-wwwroot-test-race\061da792-9090-425d-ad62-7d2d401c06ed\scratchpad"
GAME = r"C:\inetpub\wwwroot\test\race"
SCALE = 0.09
SHARP = math.radians(38)

bpy.ops.wm.open_mainfile(filepath=SCRATCH + r"\enduro_raw.blend")
O = bpy.data.objects
coll = bpy.context.scene.collection
for m in list(bpy.data.materials):   # the source has its own 'glass': the game finds the glass by that exact name
    m.name = 'src_' + m.name
# the source has its front at x=0 and lies along +X; here the front is -Y
fix = Matrix.Scale(SCALE, 4) @ Matrix.Rotation(math.radians(90), 4, 'Z') @ Matrix.Translation((-16.45, -6.37, 0))


def material(name, color, rough=0.6, metal=0.0, alpha=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Metallic'].default_value = metal
    b.inputs['Roughness'].default_value = rough
    m.diffuse_color = (*color, alpha if alpha else 1)
    if alpha:
        b.inputs['Alpha'].default_value = alpha
        m.surface_render_method = 'BLENDED'
        m.use_backface_culling = False
    return m


M = {
    'body': material('body', (0.04, 0.2, 0.72), 0.35),
    'rims': material('rims', (0.62, 0.62, 0.64), 0.4, 0.2),
    'tyre': material('tyre', (0.018, 0.018, 0.02), 0.9),
    'black': material('black', (0.012, 0.012, 0.014), 0.7),
    'seat': material('interior', (0.42, 0.3, 0.2), 0.7),
    'metal': material('metal', (0.3, 0.3, 0.31), 0.4, 0.6),
    'light': material('light', (0.9, 0.88, 0.75), 0.2),
    'tail': material('taillight', (0.8, 0.03, 0.02), 0.3),
    'glass': material('glass', (0.04, 0.05, 0.06), 0.1, 0, 0.45),
}
SLOTS = list(M)


def find(key, mat=None):
    return O[key]


def tris(me):
    me.calc_loop_triangles()
    return len(me.loop_triangles)


def prepare(key, mat=None):
    """Takes a source mesh to game space and welds it, so loose pieces are real ones."""
    ob = find(key, mat)
    me = ob.data
    while me.uv_layers:
        me.uv_layers.remove(me.uv_layers[0])
    me.transform(fix)
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0015)
    bm.to_mesh(me)
    bm.free()
    return ob


def pieces(bm):
    seen, out = set(), []
    for v0 in bm.verts:
        if v0.index in seen:
            continue
        st, vs = [v0], []
        seen.add(v0.index)
        while st:
            v = st.pop()
            vs.append(v)
            for e in v.link_edges:
                w = e.other_vert(v)
                if w.index not in seen:
                    seen.add(w.index)
                    st.append(w)
        lo = Vector([min(v.co[i] for v in vs) for i in range(3)])
        hi = Vector([max(v.co[i] for v in vs) for i in range(3)])
        out.append((vs, lo, hi))
    return out


def keep_pieces(me, test):
    """Deletes the loose pieces whose bounds fail `test`."""
    bm = bmesh.new()
    bm.from_mesh(me)
    gone = [v for vs, lo, hi in pieces(bm) if not test(lo, hi) for v in vs]
    bmesh.ops.delete(bm, geom=gone, context='VERTS')
    bm.to_mesh(me)
    bm.free()


def split(ob, test, name):
    """Moves the loose pieces whose bounds pass `test` to a new object."""
    out = O.new(name, ob.data.copy())
    coll.objects.link(out)
    keep_pieces(out.data, test)
    keep_pieces(ob.data, lambda lo, hi: not test(lo, hi))
    return out


def prune(me, size):
    keep_pieces(me, lambda lo, hi: max(hi - lo) >= size)


def thin(ob, count, weld=None):
    me = ob.data
    if weld:
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=weld)
        bm.to_mesh(me)
        bm.free()
    if count and tris(me) > count:
        bpy.context.view_layer.objects.active = ob
        ob.select_set(True)
        m = ob.modifiers.new('d', 'DECIMATE')
        m.ratio = count / tris(me)
        bpy.ops.object.modifier_apply(modifier='d')
        ob.select_set(False)


def slot_all(ob, slot):
    me = ob.data
    me.materials.clear()
    for s in SLOTS:
        me.materials.append(M[s])
    for f in me.polygons:
        f.material_index = SLOTS.index(slot)


def join(objs, name):
    bm = bmesh.new()
    for o in objs:
        bm.from_mesh(o.data)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for s in SLOTS:
        me.materials.append(M[s])
    for o in objs:
        O.remove(o, do_unlink=True)
    ob = O.new(name, me)
    coll.objects.link(ob)
    return ob


def smooth(ob, angle=SHARP):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    for f in bm.faces:
        f.smooth = True
    for e in bm.edges:
        e.smooth = len(e.link_faces) == 2 and e.calc_face_angle(0) < angle
    bm.to_mesh(ob.data)
    bm.free()


def box_mesh(name, lo, hi, slot):
    bm = bmesh.new()
    r = bmesh.ops.create_cube(bm, size=1)
    for v in r['verts']:
        v.co = Vector([(lo[i] + hi[i]) / 2 + v.co[i] * (hi[i] - lo[i]) for i in range(3)])
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = O.new(name, me)
    coll.objects.link(ob)
    slot_all(ob, slot)
    return ob


def lathe(bm, profile, material):
    """Turns (axle position, radius) points around the X axle; a radius of 0 closes the end."""
    rings = []
    for x, r in profile:
        if r == 0:
            rings.append([bm.verts.new((x, 0, 0))])
            continue
        rings.append([bm.verts.new((x, r * math.cos(i * 2 * math.pi / SIDES), r * math.sin(i * 2 * math.pi / SIDES))) for i in range(SIDES)])
    for a, b in zip(rings, rings[1:]):
        for i in range(SIDES):
            if len(a) == 1:
                vs = (a[0], b[(i + 1) % SIDES], b[i])
            elif len(b) == 1:
                vs = (a[i], a[(i + 1) % SIDES], b[0])
            else:
                vs = (a[i], a[(i + 1) % SIDES], b[(i + 1) % SIDES], b[i])
            bm.faces.new(vs).material_index = material



import re
BASE = re.compile(r'(_?\d+_?)+$')
SIDES = 20


def gather(names=(), test=None, name='g'):
    """Joins, in game space, the source meshes of these parts, and those `test` picks among the rest."""
    bm = bmesh.new()
    for o in O:
        if o.type != 'MESH' or o.get('used'):
            continue
        base = BASE.sub('', o['part'])
        if base in names or (test and test(o, base)):
            o['used'] = 1
            me = o.data
            while me.uv_layers:
                me.uv_layers.remove(me.uv_layers[0])
            bm.from_mesh(me)
    bmesh.ops.transform(bm, matrix=fix, verts=bm.verts)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0015)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = O.new(name, me)
    ob['used'] = 1
    coll.objects.link(ob)
    return ob


parts, front, kept = [], [], {}


def add(ob, count, slot, to=parts, small=None, weld=None):
    was = tris(ob.data)
    if small:
        prune(ob.data, small)
    thin(ob, count, weld)
    slot_all(ob, slot)
    kept[ob.name] = [was, tris(ob.data), slot]
    to.append(ob)


def engine(o, base):
    """The engine cases have no names: they fill the frame and are not flat like a sticker."""
    if base != 'unnamed':
        return False
    vs = [v.co for v in o.data.vertices]
    lo = [min(v[k] for v in vs) for k in range(3)]
    hi = [max(v[k] for v in vs) for k in range(3)]
    return lo[0] > 13.5 and hi[0] < 20.6 and lo[2] > 5 and hi[2] < 11.2 and lo[1] > 3.5 and hi[1] < 9 and min(hi[k] - lo[k] for k in range(3)) > 0.3


def reshell(ob, thick, voxel):
    """The source panels are torn. Thickened and remeshed, they close into one clean skin."""
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    m = ob.modifiers.new('s', 'SOLIDIFY')
    m.thickness = thick
    m.offset = 0
    bpy.ops.object.modifier_apply(modifier='s')
    m = ob.modifiers.new('r', 'REMESH')
    m.mode = 'VOXEL'
    m.voxel_size = voxel
    bpy.ops.object.modifier_apply(modifier='r')
    m = ob.modifiers.new('c', 'SMOOTH')
    m.iterations = 4
    bpy.ops.object.modifier_apply(modifier='c')
    ob.select_set(False)
    return ob


def overlay(o, base):
    """Graphic pieces that fill the holes in the side panels and the number plate. The brand letters stay out."""
    if base != 'unnamed':
        return False
    vs = [v.co for v in o.data.vertices]
    lo = [min(v[k] for v in vs) for k in range(3)]
    hi = [max(v[k] for v in vs) for k in range(3)]
    size = max(hi[k] - lo[k] for k in range(3))
    letters = lo[0] > 21.9 and hi[0] < 25.4 and lo[2] > 13.6
    side = lo[0] > 19 and hi[0] < 27 and lo[2] > 9.5 and hi[2] < 14 and (lo[1] < 5 or hi[1] > 7.7) and size > 2
    plate = lo[0] > 9.3 and hi[0] < 11.5 and lo[2] > 14 and hi[2] < 17.8 and hi[1] - lo[1] > 2
    return not letters and (side or plate)


# ---- what turns with the bars
add(gather(('front_fender',), name='fender'), 500, 'body', front)
add(reshell(gather(('fnp',), test=lambda o, b: overlay(o, b) and max(v.co[0] for v in o.data.vertices) < 12, name='plate'), 0.03, 0.02), 240, 'body', front)
add(gather(('fork_leg_top', 'fork', 'fork_wiper'), name='legs'), 420, 'metal', front, weld=0.004)
add(gather(('right_fork_guard', 'left_fork_guard'), name='guards'), 200, 'black', front)
add(gather(('tripple_clamp_half', 'forks_top_clamp'), name='clamps'), 260, 'black', front, weld=0.004)
add(gather(('Renthal_Limited_Edition_Bars',), name='bars'), 300, 'metal', front, weld=0.004)
add(gather(('renthal_left_hand_grip', 'waffle_grip_part', 'throttle'), name='grips'), 200, 'black', front, weld=0.004)
add(gather(('front_brake_master', 'clutch_perch'), name='levers'), 200, 'black', front, weld=0.004)

# ---- the rest
add(reshell(gather(('radiator_shroud', 'fuel_tank_half'), name='tank'), 0.06, 0.03), 1900, 'body')
add(reshell(gather(('rear_fender_half', 'rear_number_plate'), test=overlay, name='tail'), 0.06, 0.03), 1100, 'body')
add(gather(('air_box_half', 'air_cleaner', 'air_boot', 'sub_frame_half', 'cr_frame'), name='airbox'), 300, 'black', weld=0.004)
add(gather(('seat_half',), name='seat'), 420, 'black')
add(gather(('frame_half',), name='frame'), 800, 'metal', weld=0.004)
add(gather(('swing_arm_half',), name='swing'), 500, 'black', weld=0.004)
add(gather(('expansion_chamber',), name='pipe'), 420, 'metal')
add(gather(('skark_arrestor_half', 'spark_arrestor'), name='muffler'), 300, 'metal')
add(gather(('rear_shock',), name='shock'), 240, 'black', small=0.08, weld=0.006)
add(gather(('radiator', 'radiator_plastic_fins'), name='radiators'), 260, 'black', weld=0.004)
add(gather(('skid_plate', 'clutch_cover', 'carburator'), test=engine, name='engine'), 1100, 'metal', small=0.05, weld=0.004)
add(gather(('rear_shock_arm_sub_assembly_half', 'rear_shock_linkage_half', 'rear_shock_plate_half'), name='links'), 120, 'black')
add(gather(test=lambda o, b: b.startswith('fastway'), name='pegs'), 120, 'metal')

# ---- a chain and sprockets, far simpler than the 60,000 triangles of real links
FRONT_R, REAR_R = 5.3 * SCALE, 5.06 * SCALE
AXLE_Y = 11.15 * SCALE
REAR_SPROCKET = (1.22 * SCALE, AXLE_Y, 5.1 * SCALE, 2.4 * SCALE)    # x, y, z, radius
FRONT_SPROCKET = (1.22 * SCALE, 1.65 * SCALE, 7.1 * SCALE, 0.8 * SCALE)


def chain():
    n = 18
    ring = []
    for i in range(n):
        a = i * 2 * math.pi / n
        s = REAR_SPROCKET if math.cos(a) >= 0 else FRONT_SPROCKET
        ring.append((s[1] + s[3] * math.cos(a), s[2] + s[3] * math.sin(a)))
    x = REAR_SPROCKET[0]
    bm = bmesh.new()
    a = [bm.verts.new((x - 0.012, y, z)) for y, z in ring]
    b = [bm.verts.new((x + 0.012, y, z)) for y, z in ring]
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((a[i], a[j], b[j], b[i]))
    me = bpy.data.meshes.new('chain')
    bm.to_mesh(me)
    bm.free()
    ob = O.new('chain', me)
    coll.objects.link(ob)
    slot_all(ob, 'black')
    return ob


def sprocket(s):
    bm = bmesh.new()
    lathe(bm, [(-0.014, 0), (-0.014, s[3]), (0.014, s[3]), (0.014, 0)], SLOTS.index('metal'))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bmesh.ops.translate(bm, vec=s[:3], verts=bm.verts)
    me = bpy.data.meshes.new('sprocket')
    bm.to_mesh(me)
    bm.free()
    ob = O.new('sprocket', me)
    coll.objects.link(ob)
    return ob


parts += [chain(), sprocket(REAR_SPROCKET), sprocket(FRONT_SPROCKET)]

body = join(parts, 'Body')
smooth(body)
fork = join(front, 'Fork')
smooth(fork)

SIDES = 20


def rod(bm, a, b, t, material):
    a, b = Vector(a), Vector(b)
    d = (b - a).normalized()
    u = d.orthogonal().normalized() * t
    v = d.cross(u).normalized() * t
    ra = [bm.verts.new(a + p) for p in (u, v, -u, -v)]
    rb = [bm.verts.new(b + p) for p in (u, v, -u, -v)]
    for i in range(4):
        j = (i + 1) % 4
        bm.faces.new((ra[i], rb[i], rb[j], ra[j])).material_index = material


def wheel_mesh(name, r, width):
    w = width / 2
    bm = bmesh.new()
    tyre, rims, black = SLOTS.index('tyre'), SLOTS.index('rims'), SLOTS.index('black')
    lathe(bm, [(-w * 0.8, 0.76 * r), (-w, 0.86 * r), (-w * 0.7, 0.95 * r), (0, 0.97 * r), (w * 0.7, 0.95 * r), (w, 0.86 * r), (w * 0.8, 0.76 * r)], tyre)
    lathe(bm, [(w * 0.8, 0.76 * r), (w * 0.6, 0.73 * r), (-w * 0.6, 0.73 * r), (-w * 0.8, 0.76 * r)], rims)
    lathe(bm, [(-w * 0.75, 0.13 * r), (w * 0.75, 0.13 * r)], black)
    lathe(bm, [(w * 0.75, 0.13 * r), (w * 0.75, 0)], rims)
    lathe(bm, [(-w * 0.75, 0.13 * r), (-w * 0.75, 0)], rims)
    # spokes cross from the hub to the rim
    n = 12
    for i in range(n):
        a0 = i * 2 * math.pi / n
        a1 = a0 + (0.5 if i % 2 else -0.5)
        side = 0.6 if i % 2 else -0.6
        rod(bm, (w * side, 0.12 * r * math.cos(a0), 0.12 * r * math.sin(a0)), (0, 0.73 * r * math.cos(a1), 0.73 * r * math.sin(a1)), 0.006, rims)
    # the knobs give the tyre its outline
    k = 26
    for i in range(k):
        a = (i + (0.5 if i % 2 else 0)) * 2 * math.pi / k
        x = 0.42 * w if i % 2 else -0.42 * w
        c, s = math.cos(a), math.sin(a)
        d = bmesh.ops.create_cube(bm, size=1)['verts']
        for v in d:
            q = Vector((x + v.co.x * w * 0.62, 0.975 * r + v.co.y * 0.05 * r, v.co.z * 0.075 * r))
            v.co = Vector((q.x, q.y * c - q.z * s, q.y * s + q.z * c))
        for f in {f for v in d for f in v.link_faces}:
            f.material_index = tyre
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for s in SLOTS:
        me.materials.append(M[s])
    ob = O.new(name, me)
    coll.objects.link(ob)
    return ob


# ---- the steering axis leans back 30 degrees; in Blender its local Y runs up it, as on the Moto
steer = O.new('Steering', None)
coll.objects.link(steer)
steer.empty_display_size = 0.1
steer.location = (0, -4.05 * SCALE, 17 * SCALE)
steer.rotation_euler = (math.radians(60), 0, 0)
bpy.context.view_layer.update()
inv = steer.matrix_world.inverted()
fork.data.transform(inv)
fork.parent = steer

wf = wheel_mesh('Wheel_F', FRONT_R, 1.8 * SCALE)
smooth(wf, math.radians(50))
wf.parent = steer
wf.matrix_local = inv @ Matrix.Translation((0, -AXLE_Y, FRONT_R))
wr = wheel_mesh('Wheel_R', REAR_R, 2 * SCALE)
smooth(wr, math.radians(50))
wr.location = (0, AXLE_Y, REAR_R)

SEAT = Vector((0, 0.34, 0.88))
EYE = Vector((0, 0.04, 2.1))


def empty(name, loc):
    e = O.new(name, None)
    coll.objects.link(e)
    e.empty_display_size = 0.1
    e.location = loc


empty('Seat', SEAT)
empty('Eye', EYE)
for name, x in (('Exhaust_L', -0.14), ('Exhaust_R', -0.19)):
    empty(name, (x, 11.85 * SCALE, 11.7 * SCALE))

keep = {'Body', 'Fork', 'Steering', 'Seat', 'Eye', 'Exhaust_L', 'Exhaust_R', 'Wheel_F', 'Wheel_R'}
for o in list(O):
    if o.name not in keep:
        O.remove(o, do_unlink=True)
for coll_data, in ((bpy.data.meshes,), (bpy.data.materials,), (bpy.data.images,)):
    for d in list(coll_data):
        if d.users == 0:
            coll_data.remove(d)
bpy.context.view_layer.update()

bpy.ops.wm.save_as_mainfile(filepath=GAME + r"\3d\Enduro_game.blend")
out = GAME + r"\models\enduro.glb"
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=False, export_yup=True, export_apply=True, export_animations=False,
                          export_cameras=False, export_lights=False, export_extras=False)

meshes = [o for o in O if o.type == 'MESH']
all_v = [o.matrix_world @ v.co for o in meshes for v in o.data.vertices]
result = dict(kept=kept, tris={o.name: tris(o.data) for o in meshes}, total=sum(tris(o.data) for o in meshes), kb=os.path.getsize(out) // 1024,
              box=[round(min(v[i] for v in all_v), 3) for i in range(3)] + [round(max(v[i] for v in all_v), 3) for i in range(3)])
