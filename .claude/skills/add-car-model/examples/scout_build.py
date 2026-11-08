import bpy, bmesh, math, os
import numpy as np
from mathutils import Matrix, Vector

SCRATCH = r"C:\Users\striper\AppData\Local\Temp\claude\C--inetpub-wwwroot-test-race\f9447570-77d6-4a29-893a-a8ee8e0a4416\scratchpad"
GAME = r"C:\inetpub\wwwroot\test\race"
SCALE = 2.74
BODY_TRIS = 9000
GUN_TRIS = 1300
QUALITY = 86

bpy.ops.wm.open_mainfile(filepath=SCRATCH + r"\uaz_raw.blend")
O = bpy.data.objects
coll = bpy.context.scene.collection
if O.get('_Cam'):
    O.remove(O['_Cam'], do_unlink=True)

fix = Matrix.Scale(SCALE, 4) @ Matrix.Translation((0, 0, 0.492))
back = fix.inverted()


def p(x, y, z):
    return fix @ Vector((x, y, z))


def pixels(im):
    w, h = im.size
    a = np.empty(w * h * 4, dtype=np.float32)
    im.pixels.foreach_get(a)
    return a.reshape(h, w, 4)[:, :, :3].copy()


def inpaint(a, x0, y0, x1, y1):
    """Fills a rectangle, given in image coordinates from the top, from its edges."""
    h = a.shape[0]
    top, bottom = h - y1, h - y0
    m = np.zeros(a.shape[:2], bool)
    m[top:bottom, x0:x1] = True
    edge = a[top - 1:bottom + 1, x0 - 1:x1 + 1]
    rim = np.concatenate([edge[0], edge[-1], edge[:, 0], edge[:, -1]])
    a[m] = rim.mean(0)
    for _ in range(300):
        near = (np.roll(a, 1, 0) + np.roll(a, -1, 0) + np.roll(a, 1, 1) + np.roll(a, -1, 1)) / 4
        a[m] = near[m]


def image(name, a):
    h, w = a.shape[:2]
    made = bpy.data.images.new(name + '_tmp', w, h, alpha=False)
    made.pixels.foreach_set(np.concatenate([a, np.ones((h, w, 1), np.float32)], 2).ravel())
    made.filepath_raw = SCRATCH + "\\" + name + ".png"
    made.file_format = 'PNG'
    made.save()
    im = bpy.data.images.load(made.filepath_raw, check_existing=False)
    im.name = name
    im.colorspace_settings.name = 'sRGB'
    im.pack()
    bpy.data.images.remove(made)
    return im


src = pixels(bpy.data.images['Image_0'])
inpaint(src, 406, 34, 484, 62)     # the number plate
atlas = image('scout', src)

# the panels get a bright copy, so that a paint color shows instead of sinking into the grey camouflage
lit = src ** 2.2
BODY_TINT = float(np.percentile(lit, 97))
lit = np.clip(lit / BODY_TINT, 0, 1)
lit = lit * 0.3 + lit.mean(2, keepdims=True) * 0.7
panels = image('scout_panels', lit ** (1 / 2.2))


def material(name, picture=None, color=(1, 1, 1), rough=0.75, metal=0.0, tint=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    t = m.node_tree
    b = next(n for n in t.nodes if n.type == 'BSDF_PRINCIPLED')
    b.inputs['Metallic'].default_value = metal
    b.inputs['Roughness'].default_value = rough
    b.inputs['Base Color'].default_value = (*color, 1)
    m.diffuse_color = (*color, 1)
    if picture:
        tex = t.nodes.new('ShaderNodeTexImage')
        tex.image = picture
        out = tex.outputs['Color']
        if tint:
            mix = t.nodes.new('ShaderNodeMix')
            mix.data_type = 'RGBA'
            mix.blend_type = 'MULTIPLY'
            mix.inputs['Factor'].default_value = 1
            mix.inputs['B'].default_value = (*tint, 1)
            t.links.new(out, mix.inputs['A'])
            out = mix.outputs['Result']
        t.links.new(out, b.inputs['Base Color'])
        t.nodes.active = tex
    return m


ORDER = ['body', 'scout', 'black']
M = [material('body', panels, tint=(BODY_TINT, BODY_TINT, BODY_TINT)), material('scout', atlas),
     material('black', None, (0.02, 0.02, 0.022), 0.7)]
PAINT, FIXED, BLACK = range(3)


def tris(me):
    me.calc_loop_triangles()
    return len(me.loop_triangles)


def thin(ob, count):
    me = ob.data
    # the file holds the mesh as many unconnected UV pieces: thinning tears those apart unless they are welded first
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.004)
    bm.to_mesh(me)
    bm.free()
    if tris(me) > count:
        bpy.context.view_layer.objects.active = ob
        ob.select_set(True)
        m = ob.modifiers.new('d', 'DECIMATE')
        m.ratio = count / tris(me)
        bpy.ops.object.modifier_apply(modifier='d')
        ob.select_set(False)


def slots(ob, slot=None):
    me = ob.data
    me.materials.clear()
    for m in M:
        me.materials.append(m)
    if slot is not None:
        for f in me.polygons:
            f.material_index = slot


def new_mesh(name, bm):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = O.new(name, me)
    coll.objects.link(ob)
    return ob


def smooth(ob, angle=50):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    for f in bm.faces:
        f.smooth = True
    for e in bm.edges:
        e.smooth = len(e.link_faces) == 2 and e.calc_face_angle(0) < math.radians(angle)
    bm.to_mesh(ob.data)
    bm.free()


def islands(bm):
    seen, out = set(), []
    for f0 in bm.faces:
        if f0.index in seen:
            continue
        st, fs = [f0], []
        seen.add(f0.index)
        while st:
            f = st.pop()
            fs.append(f)
            for v in f.verts:
                for g in v.link_faces:
                    if g.index not in seen:
                        seen.add(g.index)
                        st.append(g)
        out.append(fs)
    return out


def bounds(fs):
    vs = [v.co for f in fs for v in f.verts]
    return [Vector([min(v[i] for v in vs) for i in range(3)]), Vector([max(v[i] for v in vs) for i in range(3)])]


def take(bm, faces, name):
    """Moves `faces` of bm into a new object."""
    keep = set(f.index for f in faces)
    out = bm.copy()
    out.faces.ensure_lookup_table()
    bmesh.ops.delete(out, geom=[f for f in out.faces if f.index not in keep], context='FACES')
    return new_mesh(name, out)


# ---- the loose parts: the wheels, the spare and the seats ----
lo = O['Object_3']
lo.data.transform(Matrix.Identity(4))
bm = bmesh.new()
bm.from_mesh(lo.data)
bm.faces.ensure_lookup_table()
wheel_faces, centers, other = {}, {}, []
for f in bm.faces:
    c = f.calc_center_median()
    if abs(c.x) > 0.29 and c.z < -0.14 and (-0.84 < c.y < -0.47 or 0.32 < c.y < 0.69):
        wheel_faces.setdefault(('F' if c.y < 0 else 'R') + ('L' if c.x > 0 else 'R'), []).append(f)
    elif not (c.z < -0.25 and (abs(c.y + 0.35) < 0.04 or abs(c.y - 0.75) < 0.04)):   # two stray spikes under the sills
        other.append(f)
for k, fs in wheel_faces.items():
    a, b = bounds(fs)
    centers[k] = (a + b) / 2
loose = take(bm, other, 'loose')
wheel_obs = {k: take(bm, fs, 'Wheel_' + k) for k, fs in wheel_faces.items()}
bm.free()
O.remove(lo, do_unlink=True)

# ---- the shell ----
shell = O['Object_2']
bm = bmesh.new()
bm.from_mesh(shell.data)
gone, gun_faces, hubs = [], [], {k: [] for k in centers}
for f in bm.faces:
    c = f.calc_center_median()
    if c.z > 0.19:          # the gun and the top of its post
        gun_faces.append(f)
        continue
    if c.z < -0.232 and (abs(c.y + 0.35) < 0.04 or abs(c.y - 0.75) < 0.04) and abs(c.x) > 0.2:
        gone.append(f)      # two stray spikes under the sills
        continue
    for k, w in centers.items():
        if abs(c.x) > 0.3 and c.x * w.x > 0 and math.hypot(c.y - w.y, c.z - w.z) < 0.15:
            hubs[k].append(f)
bm.faces.ensure_lookup_table()
gun = take(bm, gun_faces, 'Gun')
hub_obs = {k: take(bm, fs, 'hub_' + k) for k, fs in hubs.items() if fs}
bmesh.ops.delete(bm, geom=gone + gun_faces + [f for fs in hubs.values() for f in fs], context='FACES')
bm.to_mesh(shell.data)
bm.free()
hub_tris = {k: tris(o.data) for k, o in hub_obs.items()}

for ob in [shell, gun, loose, *wheel_obs.values(), *hub_obs.values()]:
    ob.data.transform(fix)

thin(gun, GUN_TRIS)
thin(shell, BODY_TRIS)
thin(loose, 900)

# the driver has a backrest only: the cushions are new
cushions = bmesh.new()
for sign in (1, -1):
    r = bmesh.ops.create_cube(cushions, size=1)
    lo_, hi_ = p(sign * 0.035, -0.07, -0.105), p(sign * 0.23, 0.08, -0.055)
    for v in r['verts']:
        v.co = Vector([(lo_[i] + hi_[i]) / 2 + v.co[i] * abs(hi_[i] - lo_[i]) for i in range(3)])
cushions_ob = new_mesh('cushions', cushions)
slots(cushions_ob, BLACK)
slots(loose, FIXED)

# the steering is new as well, and its column reaches back to the dash
STEER = p(0.13, -0.135, 0.08)
WHEEL_R = 0.2
TUBE = 0.03


def column():
    bm = bmesh.new()
    sides = 8
    a0, a1 = STEER + Vector((0, 0.0, 0)), p(0.13, -0.3, 0.08)
    rings = []
    for c in (a0, a1):
        rings.append([bm.verts.new(c + Vector((0.035 * math.cos(i * 2 * math.pi / sides), 0, 0.035 * math.sin(i * 2 * math.pi / sides)))) for i in range(sides)])
    for i in range(sides):
        bm.faces.new((rings[0][i], rings[0][(i + 1) % sides], rings[1][(i + 1) % sides], rings[1][i]))
    return new_mesh('column', bm)


col = column()
slots(col, BLACK)


def steering():
    bm = bmesh.new()
    n, m = 18, 6
    rings = []
    for i in range(n):
        a = i * 2 * math.pi / n
        rings.append([bm.verts.new(((WHEEL_R + TUBE * math.cos(k * 2 * math.pi / m)) * math.cos(a), TUBE * math.sin(k * 2 * math.pi / m), (WHEEL_R + TUBE * math.cos(k * 2 * math.pi / m)) * math.sin(a))) for k in range(m)])
    for i in range(n):
        for k in range(m):
            bm.faces.new((rings[i][k], rings[(i + 1) % n][k], rings[(i + 1) % n][(k + 1) % m], rings[i][(k + 1) % m]))
    # three spokes and a hub
    for a in (math.radians(0), math.radians(180), math.radians(270)):
        d = Vector((math.cos(a), 0, math.sin(a)))
        u = Vector((-d.z, 0, d.x)) * 0.022
        t = Vector((0, 0.015, 0))
        o, e = d * 0.03, d * WHEEL_R
        vs = [bm.verts.new(q) for q in (o - u - t, o + u - t, o + u + t, o - u + t, e - u - t, e + u - t, e + u + t, e - u + t)]
        for i in range(4):
            bm.faces.new((vs[i], vs[(i + 1) % 4], vs[(i + 1) % 4 + 4], vs[i + 4]))
    r = bmesh.ops.create_cube(bm, size=1)
    for v in r['verts']:
        v.co = Vector((v.co.x * 0.08, v.co.y * 0.05, v.co.z * 0.08))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return new_mesh('Steering', bm)


steer = steering()
slots(steer, BLACK)
smooth(steer, 60)
steer.location = STEER

# ---- paint: everything outside except the fittings, which keep their colors ----
slots(shell)


def is_fitting(q):
    if q.y > 0.76 and abs(abs(q.x) - 0.33) < 0.08 and abs(q.z + 0.102) < 0.04:
        return True        # the tail lamps
    if q.y > 0.78 and 0.05 < q.x < 0.3 and -0.2 < q.z < 0.03:
        return True        # the jerry cans and the plate
    return False


split = {}
for f in shell.data.polygons:
    q = back @ f.center
    floor = abs(q.x) < 0.345 and -0.31 < q.y < 0.83 and q.z < -0.07
    post = abs(q.x) < 0.12 and 0.25 < q.y < 0.47 and q.z > -0.09
    f.material_index = FIXED if floor or post or is_fitting(q) else PAINT
    split[ORDER[f.material_index]] = split.get(ORDER[f.material_index], 0) + 1

# ---- join ----
bm = bmesh.new()
for o in (shell, loose, cushions_ob, col):
    bm.from_mesh(o.data)
body = new_mesh('Body', bm)
for o in (shell, loose, cushions_ob, col):
    O.remove(o, do_unlink=True)
for m in M:
    body.data.materials.append(m)
smooth(body)

wheels = {}
for k, ob in wheel_obs.items():
    if k in hub_obs:
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        bm.from_mesh(hub_obs[k].data)
        bm.to_mesh(ob.data)
        bm.free()
        O.remove(hub_obs[k], do_unlink=True)
    thin(ob, 700)
    c = fix @ centers[k]
    ob.data.transform(Matrix.Translation(-c))
    slots(ob, FIXED)
    smooth(ob)
    ob.location = c
    wheels[ob.name] = ob

slots(gun, FIXED)
smooth(gun)


def empty(name, loc, parent=None):
    e = O.new(name, None)
    coll.objects.link(e)
    e.empty_display_size = 0.1
    e.location = Vector(loc) - (parent.location if parent else Vector())
    e.parent = parent
    return e


NECK = p(-0.0015, 0.3525, 0.19)
turret = empty('Turret', NECK)
gun.data.transform(Matrix.Translation(-NECK))
gun.parent = turret
empty('Muzzle', p(-0.001, -0.37, 0.428), turret)
SEAT = p(0.13, 0.02, -0.055)
empty('Seat', SEAT)
empty('Eye', SEAT + Vector((0, 0.3, 0.86)))     # behind the head, or the wheel falls out of the view
for name, side in (('Exhaust_L', 1), ('Exhaust_R', -1)):
    empty(name, p(side * 0.22, 0.88, -0.25))

for d in list(bpy.data.meshes):
    if d.users == 0:
        bpy.data.meshes.remove(d)
for m in list(bpy.data.materials):
    if m.users == 0:
        bpy.data.materials.remove(m)
for i in list(bpy.data.images):
    if i.users == 0 or i.name.startswith('Image_'):
        bpy.data.images.remove(i)
bpy.context.view_layer.update()

bpy.ops.wm.save_as_mainfile(filepath=GAME + r"\3d\Scout_game.blend")
out = GAME + r"\models\scout.glb"
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=False, export_yup=True, export_apply=True, export_animations=False,
                          export_cameras=False, export_lights=False, export_extras=False, export_image_format='JPEG', export_jpeg_quality=QUALITY)

meshes = [o for o in O if o.type == 'MESH']
vals = [ob.matrix_world @ Vector(c) for ob in meshes for c in ob.bound_box]
result = dict(tris={o.name: tris(o.data) for o in meshes}, total=sum(tris(o.data) for o in meshes), kb=os.path.getsize(out) // 1024, split=split, hubs=hub_tris,
              tint=round(BODY_TINT, 3), box=[round(min(v[i] for v in vals), 3) for i in range(3)] + [round(max(v[i] for v in vals), 3) for i in range(3)],
              wheels={k: [round(x, 3) for x in w.location] for k, w in wheels.items()}, seat=[round(x, 3) for x in SEAT], steer=[round(x, 3) for x in STEER], neck=[round(x, 3) for x in NECK])
