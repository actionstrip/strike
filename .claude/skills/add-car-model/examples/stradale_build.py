import bpy, bmesh, math, os
from mathutils import Matrix, Vector

SCRATCH = r"C:\Users\striper\AppData\Local\Temp\claude\C--inetpub-wwwroot-test-race\f9447570-77d6-4a29-893a-a8ee8e0a4416\scratchpad"
GAME = r"C:\inetpub\wwwroot\test\race"
SCALE = 16
SHARP = math.radians(38)

bpy.ops.wm.open_mainfile(filepath=SCRATCH + r"\stradale_raw.blend")
O = bpy.data.objects
coll = bpy.context.scene.collection
fix = Matrix.Scale(SCALE, 4) @ Matrix.Translation((0, 0, -0.0131))


def p(x, y, z):
    return fix @ Vector((x, y, z))


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
    'body': material('body', (0.72, 0.012, 0.012), 0.35),
    'trim': material('Livery Colour 2', (0.62, 0.62, 0.62), 0.35, 0.1),
    'rims': material('rims', (0.55, 0.55, 0.57), 0.4, 0.2),
    'tyre': material('tyre', (0.018, 0.018, 0.02), 0.9),
    'black': material('black', (0.012, 0.012, 0.014), 0.7),
    'seat': material('interior', (0.5, 0.15, 0.03), 0.7),
    'metal': material('metal', (0.2, 0.2, 0.21), 0.4, 0.8),
    'light': material('light', (0.9, 0.88, 0.75), 0.2),
    'tail': material('taillight', (0.9, 0.04, 0.02), 0.3),
    'glass': material('glass', (0.04, 0.05, 0.06), 0.1, 0, 0.45),
}
SLOTS = list(M)

# name start -> faces to keep, material; anything not listed is left out
PARTS = {
    'polySurface322_forMayaAO:lambert17': (5800, 'body'),
    'polySurface327_forMayaAO:lambert17': (120, 'body'),
    'polySurface324_Chrome': (900, 'trim'),
    'polySurface221_Chrome': (120, 'trim'),
    'polySurface292_Chrome': (200, 'trim'),
    'polySurface83_Chrome_2': (200, 'metal'),
    'polySurface320_forMayaAO:lambert16': (600, 'black'),
    'polySurface322_forMayaAO:lambert16': (300, 'black'),
    'polySurface5_forMayaAO:lambert16': (120, 'black'),
    'polySurface326_forMayaAO:lambert16': (None, 'black'),
    'pCube9_forMayaAO:lambert16': (None, 'metal'),
    'pCube4_forMayaAO:lambert16': (None, 'black'),
    'pCube5_forMayaAO:lambert16': (None, 'black'),
    'polySurface322_forMayaAO:blinn6': (250, 'coarse'),
    'polySurface5_forMayaAO:blinn6': (100, 'black'),
    'polySurface322_forMayaAO:blinn9': (350, 'seat'),
    'polySurface266_forMayaAO:blinn9': (350, 'seat'),
    'polySurface5_forMayaAO:blinn9': (150, 'coarse'),
    'polySurface318_mafina2hdri:lambert9': (800, 'glass'),
    'polySurface200_Chrome': (120, 'metal'),
    'polySurface200_forMayaAO:Grill2': (100, 'coarse'),
    'faraz2_forMayaAO:frontLights': (180, 'light'),
    'pSphere2_forMayaAO:frontLights': (60, 'light'),
    'faraz1_forMayaAO:rear_lights': (150, 'tail'),
    'polySurface148_forMayaAO:blinn11': (60, 'black'),
    'polySurface149_forMayaAO:blinn11': (60, 'black'),
    'polySurface150_forMayaAO:blinn11': (60, 'black'),
    'polySurface151_forMayaAO:blinn11': (60, 'black'),
    'truba_Chrome': (160, 'metal'),
    'truba_forMayaAO:lambert15': (60, 'black'),
}


def clean(name):
    return name.replace('forMayaAO:', '')


def find(key):
    return next(o for o in O if o.type == 'MESH' and clean(o.name).startswith(clean(key)))


def tris(me):
    me.calc_loop_triangles()
    return len(me.loop_triangles)


def prune(me, size):
    """Drops loose pieces smaller than `size`, such as seat stitching, which no amount of thinning can remove."""
    bm = bmesh.new()
    bm.from_mesh(me)
    seen, gone = set(), []
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
        if max(max(v.co[i] for v in vs) - min(v.co[i] for v in vs) for i in range(3)) < size:
            gone += vs
    bmesh.ops.delete(bm, geom=gone, context='VERTS')
    bm.to_mesh(me)
    bm.free()


def reduce(ob, count, slot=None):
    """Welds the seams, thins the mesh out to about `count` triangles and takes it to game space."""
    me = ob.data
    while me.uv_layers:
        me.uv_layers.remove(me.uv_layers[0])
    me.transform(fix)
    bm = bmesh.new()
    bm.from_mesh(me)
    # the quilted seats are made of many strips: a wide weld lets them thin out as one
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.03 if slot in ('seat', 'coarse') else 0.0015)
    bm.to_mesh(me)
    bm.free()
    if slot in ('seat', 'black', 'coarse'):
        prune(me, 0.3)
    if count and tris(me) > count:
        bpy.context.view_layer.objects.active = ob
        ob.select_set(True)
        m = ob.modifiers.new('d', 'DECIMATE')
        m.ratio = count / tris(me)
        bpy.ops.object.modifier_apply(modifier='d')
        ob.select_set(False)


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


def slot_all(ob, slot):
    me = ob.data
    me.materials.clear()
    for s in SLOTS:
        me.materials.append(M[s])
    for f in me.polygons:
        f.material_index = SLOTS.index(slot)


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


parts = []
kept = {}
for key, (count, slot) in PARTS.items():
    ob = find(key)
    was = tris(ob.data)
    reduce(ob, count, slot)
    kept[clean(key)] = [was, count, tris(ob.data)]
    slot_all(ob, 'black' if slot == 'coarse' else slot)
    parts.append(ob)
# the engine is gone, so the hole in the deck under the rear window gets a lid
parts.append(box_mesh('lid', p(-0.02, 0.048, 0.06), p(0.02, 0.095, 0.0615), 'black'))
body = join(parts, 'Body')
smooth(body)

# the wheels are made new: thinning the originals breaks their round shape
SIDES = 20
HOLES = 10
FACE = -1   # where the outer face of a left wheel looks, before it is turned to the side


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


def wheel_mesh(name, radius, width, side):
    """A tyre and a dished rim with a ring of vents, the outer face on `side`."""
    w, r = width / 2 * side, radius
    bm = bmesh.new()
    tyre, rims, black = SLOTS.index('tyre'), SLOTS.index('rims'), SLOTS.index('black')
    lathe(bm, [(-w, 0.6 * r), (-w * 1.04, 0.84 * r), (-w * 0.82, 0.98 * r), (0, r), (w * 0.82, 0.98 * r), (w * 1.04, 0.84 * r), (w, 0.6 * r)], tyre)
    lathe(bm, [(w, 0.6 * r), (w * 0.78, 0.56 * r), (w * 0.62, 0.3 * r), (w * 0.72, 0.14 * r), (w * 0.72, 0)], rims)
    lathe(bm, [(-w, 0.6 * r), (-w * 0.5, 0)], black)
    for i in range(HOLES):
        a = i * 2 * math.pi / HOLES
        y0, z0 = 0.42 * r * math.cos(a), 0.42 * r * math.sin(a)
        ring = [bm.verts.new((w * 0.7, y0 + 0.07 * r * math.cos(k * math.pi / 3), z0 + 0.07 * r * math.sin(k * math.pi / 3))) for k in range(6)]
        f = bm.faces.new(ring)
        f.material_index = black
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.normal_update()
    # the vents sit on top of the dish and always look out
    for f in bm.faces:
        if f.material_index == black and len(f.verts) == 6 and f.normal.x * side < 0:
            f.normal_flip()
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for s in SLOTS:
        me.materials.append(M[s])
    ob = O.new(name, me)
    coll.objects.link(ob)
    return ob


CENTER = {'F': (0.0549, -0.0917, 0.0381), 'R': (0.0584, 0.1016, 0.0391)}
WIDTH = {'F': 0.016 * SCALE, 'R': 0.0205 * SCALE}
wheels = {}
for end, side in (('F', 'L'), ('F', 'R'), ('R', 'L'), ('R', 'R')):
    x, y, z = CENTER[end]
    sign = 1 if side == 'L' else -1
    c = p(x * sign, y, z)
    ob = wheel_mesh('Wheel_' + end + side, c.z, WIDTH[end], sign)
    smooth(ob, math.radians(50))
    ob.location = c
    wheels[ob.name] = ob

STEER = p(0.0225, -0.0235, 0.065)
BACK = Vector((0, 0.16, -0.17))     # the driver is small for this cabin, so the wheel comes to the driver
wheel = []
for key, count in (('polySurface133_forMayaAO:blinn6', 90), ('polySurface197_forMayaAO:phong5', 60)):
    ob = find(key)
    reduce(ob, count, 'seat')
    slot_all(ob, 'black')
    wheel.append(ob)
steer = join(wheel, 'Steering')
smooth(steer)
steer.data.transform(Matrix.Scale(0.75, 4) @ Matrix.Translation(-STEER))
steer.location = STEER + BACK


def empty(name, loc):
    e = O.new(name, None)
    coll.objects.link(e)
    e.empty_display_size = 0.1
    e.location = loc


seat = steer.location + Vector((0, 0.21, -0.2))
seat.z = 0.42
empty('Seat', seat)
empty('Eye', seat + Vector((0, -0.02, 0.72)))
for name, side in (('Exhaust_L', 1), ('Exhaust_R', -1)):
    empty(name, p(side * 0.022, 0.16, 0.0305))

keep = {'Body', 'Steering', 'Seat', 'Eye', 'Exhaust_L', 'Exhaust_R', *wheels}
for o in list(O):
    if o.name not in keep:
        O.remove(o, do_unlink=True)
for m in list(bpy.data.meshes):
    if m.users == 0:
        bpy.data.meshes.remove(m)
for m in list(bpy.data.materials):
    if m.users == 0:
        bpy.data.materials.remove(m)
for i in list(bpy.data.images):
    if i.users == 0:
        bpy.data.images.remove(i)
bpy.context.view_layer.update()

bpy.ops.wm.save_as_mainfile(filepath=GAME + r"\3d\Stradale_game.blend")
out = GAME + r"\models\stradale.glb"
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=False, export_yup=True, export_apply=True, export_animations=False,
                          export_cameras=False, export_lights=False, export_extras=False)

meshes = [o for o in O if o.type == 'MESH']
all_v = [o.matrix_world @ v.co for o in meshes for v in o.data.vertices]
split = {}
me = body.data
me.calc_loop_triangles()
for t in me.loop_triangles:
    n = SLOTS[me.polygons[t.polygon_index].material_index]
    split[n] = split.get(n, 0) + 1
result = dict(kept=kept, tris={o.name: tris(o.data) for o in meshes}, total=sum(tris(o.data) for o in meshes), kb=os.path.getsize(out) // 1024, split=split,
              box=[round(min(v[i] for v in all_v), 3) for i in range(3)] + [round(max(v[i] for v in all_v), 3) for i in range(3)],
              wheels={k: [round(x, 3) for x in w.location] for k, w in wheels.items()}, seat=[round(x, 3) for x in seat], steer=[round(x, 3) for x in steer.location])
