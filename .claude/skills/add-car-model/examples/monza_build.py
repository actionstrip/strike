import bpy, bmesh, math, os
from mathutils import Matrix, Vector

SCRATCH = r"C:\Users\striper\AppData\Local\Temp\claude\C--inetpub-wwwroot-test-race\061da792-9090-425d-ad62-7d2d401c06ed\scratchpad"
GAME = r"C:\inetpub\wwwroot\test\race"
SCALE = 112
SHARP = math.radians(38)

bpy.ops.wm.open_mainfile(filepath=SCRATCH + r"\monza_raw.blend")
O = bpy.data.objects
coll = bpy.context.scene.collection
fix = Matrix.Scale(SCALE, 4) @ Matrix.Translation((0, 0, 3.56e-5))


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
    'body': material('body', (0.62, 0.012, 0.012), 0.35),
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
    return next(o for o in O if o.type == 'MESH' and key in o.name and (mat is None or mat in o.name))


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


# ---- the original steering wheel leans back, and a leaning wheel wobbles when it turns
def not_wheel(lo, hi):
    return not (lo.x > 0.2 and hi.x < 0.7 and lo.y > -0.25 and hi.y < 0.25 and lo.z > 0.6)


def under_skin(c):
    """True for what lies beneath the hood and the rear deck: thinned, the paint would sink below it."""
    return (c.y < -0.72 and c.z > 0.58 and abs(c.x) < 0.98 and c.y > -2.3) or (c.y > 1.1 and c.z > 0.72 and abs(c.x) < 1.0)


def clear_skin(ob):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if under_skin(f.calc_center_median())], context='FACES')
    bm.to_mesh(ob.data)
    bm.free()


parts, kept = [], {}


def add(ob, count, slot, weld=None, small=None):
    was = tris(ob.data)
    if slot == 'black':
        clear_skin(ob)
    if small:
        prune(ob.data, small)
    thin(ob, count, weld)
    slot_all(ob, slot)
    kept[ob.name[:28]] = [was, tris(ob.data), slot]
    parts.append(ob)


add(prepare('Kit1_Paint'), 8600, 'body', small=0.1)

carbon = prepare('Kit1_Carbon2')
keep_pieces(carbon.data, not_wheel)
add(carbon, 1200, 'black', small=0.15)

interior = prepare('Kit1_Interior')
keep_pieces(interior.data, not_wheel)
seats = split(interior, lambda lo, hi: lo.y > 0.1 and hi.z > 1.2 and hi.x - lo.x > 0.5, 'seats')
add(seats, 800, 'seat', weld=0.03, small=0.3)
add(interior, 420, 'black', weld=0.02, small=0.2)

coloured = prepare('Kit1_Coloured')
keep_pieces(coloured.data, not_wheel)
tips = split(coloured, lambda lo, hi: lo.y > 2.0 and hi.z < 0.55 and min(abs(lo.x), abs(hi.x)) > 0.55, 'tips')
add(tips, 220, 'metal', small=0.05)
keep_pieces(coloured.data, lambda lo, hi: not (lo.y > 0.8 and hi.z > 1.2))  # the layer under the rear deck
add(coloured, 300, 'black', small=0.12)

# the engine mesh also holds the front wheel arches and the ducts; the engine itself stays out
arches = prepare('Kit1_Engine')
keep_pieces(arches.data, lambda lo, hi: lo.z < 0.2 and min(abs(lo.x), abs(hi.x)) > 0.45)
add(arches, 220, 'black')

add(prepare('Base_Geo'), 300, 'black', small=0.1)
add(prepare('Grille1_Geo'), 240, 'black', small=0.05)
add(prepare('Grille2_Geo'), 160, 'black', small=0.05)
add(prepare('Grille5_Geo'), 60, 'black', small=0.05)

lamps = prepare('Light_Geo', 'LightA')
tail = split(lamps, lambda lo, hi: hi.y > 1.0, 'tail')
add(lamps, 260, 'light', small=0.1)
add(tail, 120, 'tail', small=0.1)
add(prepare('Kit1_Window', 'phong1'), 120, 'tail')
add(prepare('Kit1_Window', 'Window_Material'), 340, 'glass', small=0.1)

# the underside would otherwise let the sky through the wheel arches
parts.append(box_mesh('floor', (-0.9, -2.1, 0.2), (0.9, 2.05, 0.24), 'black'))

body = join(parts, 'Body')
smooth(body)

# ---- wheels are made new: they stay round and lose the badges on their hubs
SIDES = 20
SPOKES = 5


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


def spoke(bm, angle, r, w, material):
    """A spoke from the hub to the rim, wide at the hub and swept a little."""
    def at(rad, off, x):
        a = angle + 0.22 * rad / (0.66 * r)
        return (x, rad * math.cos(a) - off * math.sin(a), rad * math.sin(a) + off * math.cos(a))

    x0, x1, near, far = w * 0.72, w * 0.36, 0.13 * r, 0.68 * r
    ring = [(near, -0.13 * r), (near, 0.13 * r), (far, 0.075 * r), (far, -0.075 * r)]
    front = [bm.verts.new(at(a, b, x0)) for a, b in ring]
    back = [bm.verts.new(at(a, b, x1)) for a, b in ring]
    faces = [front, *[[front[i], back[i], back[(i + 1) % 4], front[(i + 1) % 4]] for i in range(4)]]
    for vs in faces:
        bm.faces.new(vs).material_index = material


def wheel_mesh(name, radius, width, side):
    w, r = width / 2 * side, radius
    bm = bmesh.new()
    tyre, rims, black = SLOTS.index('tyre'), SLOTS.index('rims'), SLOTS.index('black')
    lathe(bm, [(-w, 0.68 * r), (-w * 1.04, 0.86 * r), (-w * 0.82, 0.98 * r), (0, r), (w * 0.82, 0.98 * r), (w * 1.04, 0.86 * r), (w, 0.68 * r)], tyre)
    lathe(bm, [(w, 0.68 * r), (w * 0.86, 0.72 * r), (w * 0.5, 0.66 * r), (-w * 0.6, 0.66 * r)], rims)
    lathe(bm, [(w * 0.1, 0.66 * r), (w * 0.1, 0)], black)
    lathe(bm, [(w * 0.3, 0.16 * r), (w * 0.8, 0.14 * r), (w * 0.86, 0.09 * r), (w * 0.86, 0)], rims)
    for i in range(SPOKES):
        spoke(bm, i * 2 * math.pi / SPOKES, r, w, rims)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for s in SLOTS:
        me.materials.append(M[s])
    ob = O.new(name, me)
    coll.objects.link(ob)
    return ob


# measured from the original tyres, in game units
WHEEL = {'F': dict(y=-1.512, r=0.397, outer=1.115, w=0.33), 'R': dict(y=1.54, r=0.403, outer=1.11, w=0.37)}
wheels = {}
for end, side in (('F', 'L'), ('F', 'R'), ('R', 'L'), ('R', 'R')):
    d = WHEEL[end]
    sign = 1 if side == 'L' else -1
    ob = wheel_mesh('Wheel_' + end + side, d['r'], d['w'], sign)
    smooth(ob, math.radians(50))
    ob.location = (sign * (d['outer'] - d['w'] / 2), d['y'], d['r'])
    wheels[ob.name] = ob

# ---- the driver sits on the left, on +X
SEAT = Vector((0.45, 0.62, 0.56))
STEER = Vector((0.45, 0.16, 0.8))


def steering():
    R, TUBE, SEG, ARC = 0.17, 0.022, 18, 6
    bm = bmesh.new()
    rings = []
    for i in range(SEG):
        a = i * 2 * math.pi / SEG
        ring = []
        for k in range(ARC):
            b = k * 2 * math.pi / ARC
            rad = R + TUBE * math.cos(b)
            ring.append(bm.verts.new((rad * math.cos(a), TUBE * math.sin(b), rad * math.sin(a))))
        rings.append(ring)
    for i in range(SEG):
        for k in range(ARC):
            a, b = rings[i], rings[(i + 1) % SEG]
            bm.faces.new((a[k], b[k], b[(k + 1) % ARC], a[(k + 1) % ARC]))
    for lo, hi in (((-0.05, -0.02, -0.05), (0.05, 0.03, 0.05)), ((-R, -0.012, -0.018), (R, 0.012, 0.018)), ((-0.018, -0.012, -R), (0.018, 0.012, 0))):
        r = bmesh.ops.create_cube(bm, size=1)
        for v in r['verts']:
            v.co = Vector([(lo[i] + hi[i]) / 2 + v.co[i] * (hi[i] - lo[i]) for i in range(3)])
    me = bpy.data.meshes.new('Steering')
    bm.to_mesh(me)
    bm.free()
    ob = O.new('Steering', me)
    coll.objects.link(ob)
    slot_all(ob, 'seat')  # black would vanish against the dark cabin in the driver's view
    smooth(ob, math.radians(50))
    ob.location = STEER
    return ob


steer = steering()
column = box_mesh('Column', (STEER.x - 0.025, -0.3, STEER.z - 0.025), (STEER.x + 0.025, STEER.y - 0.02, STEER.z + 0.025), 'black')


def empty(name, loc):
    e = O.new(name, None)
    coll.objects.link(e)
    e.empty_display_size = 0.1
    e.location = loc


empty('Seat', SEAT)
empty('Eye', Vector((0.45, 0.8, 1.24)))
for name, side in (('Exhaust_L', 1), ('Exhaust_R', -1)):
    empty(name, (side * 0.76, 2.52, 0.37))

keep = {'Body', 'Steering', 'Column', 'Seat', 'Eye', 'Exhaust_L', 'Exhaust_R', *wheels}
for o in list(O):
    if o.name not in keep:
        O.remove(o, do_unlink=True)
for coll_data, in ((bpy.data.meshes,), (bpy.data.materials,), (bpy.data.images,)):
    for d in list(coll_data):
        if d.users == 0:
            coll_data.remove(d)
bpy.context.view_layer.update()

bpy.ops.wm.save_as_mainfile(filepath=GAME + r"\3d\Barchetta_game.blend")
out = GAME + r"\models\barchetta.glb"
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=False, export_yup=True, export_apply=True, export_animations=False,
                          export_cameras=False, export_lights=False, export_extras=False)

meshes = [o for o in O if o.type == 'MESH']
all_v = [o.matrix_world @ v.co for o in meshes for v in o.data.vertices]
splitted = {}
me = body.data
me.calc_loop_triangles()
for t in me.loop_triangles:
    n = SLOTS[me.polygons[t.polygon_index].material_index]
    splitted[n] = splitted.get(n, 0) + 1
result = dict(kept=kept, tris={o.name: tris(o.data) for o in meshes}, total=sum(tris(o.data) for o in meshes), kb=os.path.getsize(out) // 1024, split=splitted,
              box=[round(min(v[i] for v in all_v), 3) for i in range(3)] + [round(max(v[i] for v in all_v), 3) for i in range(3)],
              wheels={k: [round(x, 3) for x in w.location] for k, w in wheels.items()})
