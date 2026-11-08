# Builds models/titan.glb from the Type-10 tank. Run it through blrun.py.
import bpy, bmesh, json, math, os
import numpy as np
from mathutils import Matrix, Vector

SCRATCH = r"C:\Users\striper\AppData\Local\Temp\claude\C--inetpub-wwwroot-test-race\061da792-9090-425d-ad62-7d2d401c06ed\scratchpad"
GAME = r"C:\inetpub\wwwroot\test\race"
SCALE = 0.8
ATLAS = 1024
QUALITY = 82
HULL_TRIS = 5600
TURRET_TRIS = 5600
WHEEL_TRIS = 110
TINY = 0.09          # islands smaller than this are bolts the texture already shows

bpy.ops.wm.open_mainfile(filepath=SCRATCH + r"\tank_raw.blend")
O = bpy.data.objects
coll = bpy.context.scene.collection
if O.get('_Cam'):
    O.remove(O['_Cam'], do_unlink=True)

# ground to z=0, hull centered along the car
fix = Matrix.Scale(SCALE, 4) @ Matrix.Translation((0, -0.21, 1.098))


def p(x, y, z):
    """A point read off the original file (Blender import axes) in the new space."""
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
    a[m] += np.random.default_rng(1).normal(0, 0.012, (int(m.sum()), 1))


def shrink(a, w, h):
    fy, fx = a.shape[0] // h, a.shape[1] // w
    return a[:h * fy, :w * fx].reshape(h, fy, w, fx, 3).mean((1, 3))


# source mesh -> image and its place in the atlas (x, y), from the bottom left
CELLS = {'Object_2': 'Image_0', 'Object_3': 'Image_0', 'Object_4': 'Image_1', 'Object_5': 'Image_2', 'Object_6': 'Image_3'}
PLACE = {'Image_0': (0, 0), 'Image_1': (512, 0), 'Image_2': (0, 512), 'Image_3': (512, 512)}
MARKS = {'Image_0': [(88, 240, 124, 276), (16, 666, 52, 702)], 'Image_3': [(896, 860, 944, 900), (900, 930, 944, 966)]}   # the white chevrons
sheet = np.zeros((ATLAS, ATLAS, 3), np.float32)
for name, (x, y) in PLACE.items():
    a = pixels(bpy.data.images[name])
    for box in MARKS.get(name, []):
        inpaint(a, *box)
    sheet[y:y + 512, x:x + 512] = shrink(a, 512, 512)

# a bright copy, the original darkness moved into the material color, so that a paint color shows
lit = np.clip(sheet, 0, 1) ** 2.2
TINT = float(np.percentile(lit, 98))
lit = np.clip(lit / TINT, 0, 1) ** (1 / 2.2)
TINT *= 1.5                       # a little brighter than the file: the game has no environment light


def image(name, a, size):
    made = bpy.data.images.new(name + '_tmp', size, size, alpha=False)
    made.pixels.foreach_set(np.concatenate([a, np.ones((size, size, 1), np.float32)], 2).ravel())
    made.filepath_raw = SCRATCH + '\\' + name + '.png'
    made.file_format = 'PNG'
    made.save()
    im = bpy.data.images.load(made.filepath_raw)
    im.name = name
    im.colorspace_settings.name = 'sRGB'
    im.pack()
    bpy.data.images.remove(made)
    return im


atlas = image('titan', lit, ATLAS)

# one shoe of the track: v runs along the track. Blocks with a dark gap, and a pale band that shows the rolling on the side faces.
N = 64
tile = np.zeros((N, N, 3), np.float32)
tile[:] = (0.15, 0.13, 0.115)
tile[:, N // 2 - 5:N // 2 + 5] = (0.2, 0.18, 0.16)     # the guide teeth
tile[:12] = tile[N - 12:] = (0.018, 0.017, 0.016)      # the gap between shoes
tile[12:20] = (0.2, 0.18, 0.16)                        # worn front edge of the shoe
tile = tile ** (1 / 2.2)
track_image = image('titan_track', tile, N)


def material(name, img=None, color=(1, 1, 1), rough=0.8, metal=0.0, tint=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    t = m.node_tree
    b = next(n for n in t.nodes if n.type == 'BSDF_PRINCIPLED')
    b.inputs['Metallic'].default_value = metal
    b.inputs['Roughness'].default_value = rough
    b.inputs['Base Color'].default_value = (*color, 1)
    m.diffuse_color = (*color, 1)
    if img:
        tex = t.nodes.new('ShaderNodeTexImage')
        tex.image = img
        out = tex.outputs['Color']
        if tint:
            mix = t.nodes.new('ShaderNodeMix')
            mix.data_type = 'RGBA'
            mix.blend_type = 'MULTIPLY'
            mix.inputs['Factor'].default_value = 1
            mix.inputs['B'].default_value = (tint, tint, tint, 1)
            t.links.new(out, mix.inputs['A'])
            out = mix.outputs['Result']
        t.links.new(out, b.inputs['Base Color'])
        t.nodes.active = tex
    return m


BODY, TANK, TRACK = 0, 1, 2
M = [material('body', atlas, tint=TINT), material('titan', atlas, tint=TINT), material('track', track_image)]


class Bin:
    """Faces collected for one output mesh."""

    def __init__(self):
        self.points, self.faces, self.uvs, self.mats = [], [], [], []

    def add(self, pts, uvs, mat):
        n = len(self.points)
        self.points += pts
        self.faces.append(list(range(n, n + len(pts))))
        self.uvs += uvs
        self.mats.append(mat)

    def mesh(self, name):
        me = bpy.data.meshes.new(name)
        me.from_pydata(self.points, [], self.faces)
        layer = me.uv_layers.new(name='UVMap')
        layer.data.foreach_set('uv', [c for q in self.uvs for c in q])
        for m in M:
            me.materials.append(m)
        me.polygons.foreach_set('material_index', self.mats)
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0004)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(me)
        bm.free()
        ob = O.new(name, me)
        coll.objects.link(ob)
        return ob


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
            for e in f.edges:
                for g in e.link_faces:
                    if g.index not in seen:
                        seen.add(g.index)
                        st.append(g)
        vs = {v for f in fs for v in f.verts}
        co = np.array([v.co[:] for v in vs])
        out.append((fs, co.min(0), co.max(0)))
    return out


def face_data(bm, f, uv, key):
    """The face in the new space, with its UVs moved into the atlas."""
    x, y = PLACE[CELLS[key]]
    pts = [l[uv].uv.copy() for l in f.loops]
    c = sum(pts, Vector((0, 0))) / len(pts)
    shift = Vector((math.floor(c.x), math.floor(c.y)))
    uvs = []
    for q in pts:
        q = q - shift
        uvs.append(((x + (0.01 + 0.98 * min(max(q.x, 0), 1)) * 512) / ATLAS, (y + (0.01 + 0.98 * min(max(q.y, 0), 1)) * 512) / ATLAS))
    return [(fix @ v.co)[:] for v in f.verts], uvs


hull, turret = Bin(), Bin()
# name, y, z, radius, x from, x to of each wheel on the left side, front to back
ROAD = [(-1.795, -0.725), (-0.865, -0.735), (0.075, -0.745), (1.005, -0.75), (1.935, -0.76)]
WHEELS = [('Wheel_F', *ROAD[0], 0.3, 0.95, 1.29), ('Roller_1', *ROAD[1], 0.3, 0.95, 1.29), ('Roller_2', *ROAD[2], 0.3, 0.95, 1.29),
          ('Roller_3', *ROAD[3], 0.3, 0.95, 1.29), ('Wheel_R', *ROAD[4], 0.3, 0.95, 1.29),
          ('Roller_I', -2.595, -0.385, 0.3, 0.95, 1.29), ('Roller_S', 2.73, -0.435, 0.29, 0.85, 1.345)]
wheel_bins = {}


def wheel_of(lo, hi):
    side = 'L' if lo[0] + hi[0] > 0 else 'R'
    a, b = min(abs(lo[0]), abs(hi[0])), max(abs(lo[0]), abs(hi[0]))
    for name, y, z, r, x0, x1 in WHEELS:
        if a < x0 or b > x1:
            continue
        if all(math.hypot(py - y, pz - z) <= r for py in (lo[1], hi[1]) for pz in (lo[2], hi[2])):
            return name, side, y, z
    return None


def is_lid(key, lo, hi):
    return key == 'Object_6' and lo[0] > -0.78 and hi[0] < -0.17 and lo[1] > -0.32 and hi[1] < 0.3 and lo[2] > 0.86 and np.linalg.norm(hi - lo) > 0.3


counts = {}
for key in ('Object_3', 'Object_4', 'Object_5', 'Object_6'):
    ob = next(o for o in O if o.type == 'MESH' and o.name.endswith(key))
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0005)
    bm.faces.ensure_lookup_table()
    uv = bm.loops.layers.uv[0]
    for fs, lo, hi in islands(bm):
        mid = (lo + hi) / 2
        size = float(np.linalg.norm(hi - lo))
        if hi[2] > 1.2 and mid[1] > 1.7:
            continue                                  # antennas
        if is_lid(key, lo, hi):
            counts['lid'] = counts.get('lid', 0) + 1
            continue
        w = wheel_of(lo, hi) if key == 'Object_3' else None
        if w:
            wheel_bins.setdefault(w, Bin())
            for f in fs:
                wheel_bins[w].add(*face_data(bm, f, uv, key), TANK)
            continue
        if size < TINY:
            continue
        on_turret = key == 'Object_6' or (key == 'Object_5' and lo[2] >= 0.28 and mid[1] > -2.05)
        gun = on_turret and ((lo[2] > 1.1 and -0.5 < mid[0] < 0.15 and mid[1] < 0.15) or (abs(mid[0]) < 0.17 and hi[1] < -1.5 and hi[0] - lo[0] < 0.34))
        skirt = key != 'Object_3' or max(abs(lo[0]), abs(hi[0])) > 1.33
        mat = TANK if gun or not skirt else BODY
        target = turret if on_turret else hull
        for f in fs:
            target.add(*face_data(bm, f, uv, key), mat)
    bm.free()

for ob in [o for o in O if o.type == 'MESH']:
    O.remove(ob, do_unlink=True)


def decimate(ob, count):
    me = ob.data
    me.calc_loop_triangles()
    n = len(me.loop_triangles)
    if n > count:
        bpy.context.view_layer.objects.active = ob
        m = ob.modifiers.new('d', 'DECIMATE')
        m.ratio = count / n
        bpy.ops.object.modifier_apply(modifier='d')


body = hull.mesh('Body')
decimate(body, HULL_TRIS)
top = turret.mesh('Gun')
decimate(top, TURRET_TRIS)
wheels = {}
for (name, side, y, z), b in wheel_bins.items():
    ob = b.mesh(name + side if name.startswith('Roller') else name + side)
    c = p(1.12 if side == 'L' else -1.12, y, z)
    ob.data.transform(Matrix.Translation(-c))
    ob.location = c
    decimate(ob, WHEEL_TRIS)
    wheels[ob.name] = ob

# the track: a closed belt through the middle of the original shoes
loop = json.load(open(SCRATCH + r"\tank_probe.py.json"))['loop']
SHOES = len(loop)
pts = np.array(loop)
seg = np.linalg.norm(np.roll(pts, -1, 0) - pts, axis=1)
arc = np.concatenate([[0], np.cumsum(seg)])
LENGTH = float(arc[-1])
# fewer points on the straights, every point on the bends
keep = [0]
for i in range(1, SHOES):
    a = pts[i] - pts[keep[-1]]
    b = pts[(i + 1) % SHOES] - pts[i]
    turn = abs(math.atan2(a[0] * b[1] - a[1] * b[0], a @ b))
    if turn > 0.1 or arc[i] - arc[keep[-1]] > 1.0:
        keep.append(i)
HALF_W, HALF_T = 0.13, 0.05
for side, sx in (('L', 1), ('R', -1)):
    b = Bin()
    rings = []
    for i in keep + [SHOES]:
        at = pts[i % SHOES]
        d = pts[(i + 1) % SHOES] - pts[(i - 1) % SHOES]
        d = d / np.linalg.norm(d)
        n = np.array([d[1], -d[0]])                  # outward: the loop runs along the bottom toward the rear
        v = arc[i] / LENGTH * SHOES
        rings.append((at + n * HALF_T, at - n * HALF_T, v))
    x0, x1 = sx * (1.1213 - HALF_W), sx * (1.1213 + HALF_W)
    q = lambda x, c: (fix @ Vector((x, c[0], c[1])))[:]
    for (o0, i0, v0), (o1, i1, v1) in zip(rings, rings[1:]):
        b.add([q(x0, o0), q(x1, o0), q(x1, o1), q(x0, o1)], [(0, v0), (1, v0), (1, v1), (0, v1)], TRACK)       # tread
        b.add([q(x0, i1), q(x1, i1), q(x1, i0), q(x0, i0)], [(0, v1), (1, v1), (1, v0), (0, v0)], TRACK)       # inside
        b.add([q(x1, o0), q(x1, i0), q(x1, i1), q(x1, o1)], [(.1, v0), (.3, v0), (.3, v1), (.1, v1)], TRACK)   # the two edges
        b.add([q(x0, i0), q(x0, o0), q(x0, o1), q(x0, i1)], [(.3, v0), (.1, v0), (.1, v1), (.3, v1)], TRACK)
    b.mesh('Track_' + side)


def empty(name, loc, parent=None):
    e = O.new(name, None)
    coll.objects.link(e)
    e.empty_display_size = 0.1
    e.location = Vector(loc) - (parent.location if parent else Vector())
    e.parent = parent
    return e


RING = p(0, 0.045, 0.2)
tur = empty('Turret', RING)
top.data.transform(Matrix.Translation(-RING))
top.parent = tur
empty('Cannon', p(0, -4.75, 0.525), tur)
empty('Muzzle', p(-0.2, -1.4, 1.44), tur)   # the machine gun on the roof
empty('Seat', p(-0.47, -0.02, 0.4), tur)
empty('Eye', p(0, -2.55, 0.8))
for name, side in (('Exhaust_L', 1), ('Exhaust_R', -1)):
    empty(name, p(side * 0.75, 3.3, 0.05))

for ob in [o for o in O if o.type == 'MESH']:
    for f in ob.data.polygons:
        f.use_smooth = True
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(40))

for d in list(bpy.data.meshes):
    if d.users == 0:
        bpy.data.meshes.remove(d)
for m in list(bpy.data.materials):
    if m.users == 0:
        bpy.data.materials.remove(m)
for i in list(bpy.data.images):
    if i.users == 0:
        bpy.data.images.remove(i)
bpy.context.view_layer.update()

bpy.ops.wm.save_as_mainfile(filepath=GAME + r"\3d\Titan_game.blend")
out = GAME + r"\models\titan.glb"
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=False, export_yup=True, export_apply=True, export_animations=False,
                          export_cameras=False, export_lights=False, export_extras=False, export_image_format='JPEG', export_jpeg_quality=QUALITY)


def tris(ob):
    ob.data.calc_loop_triangles()
    return len(ob.data.loop_triangles)


meshes = [o for o in O if o.type == 'MESH']
vals = [ob.matrix_world @ Vector(c) for ob in meshes for c in ob.bound_box]
result = dict(tris={o.name: tris(o) for o in meshes}, total=sum(tris(o) for o in meshes), kb=os.path.getsize(out) // 1024, tint=TINT, counts=counts,
              box=[round(min(v[i] for v in vals), 3) for i in range(3)] + [round(max(v[i] for v in vals), 3) for i in range(3)],
              wheels={k: [round(x, 3) for x in w.location] for k, w in wheels.items()}, shoes=SHOES, length=round(LENGTH, 3), points=len(keep))
