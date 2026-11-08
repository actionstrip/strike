import bpy, bmesh, math, os
import numpy as np
from mathutils import Matrix, Vector

SCRATCH = r"C:\Users\striper\AppData\Local\Temp\claude\C--inetpub-wwwroot-test-race\f9447570-77d6-4a29-893a-a8ee8e0a4416\scratchpad"
GAME = r"C:\inetpub\wwwroot\test\race"
SCALE = 1.34
ATLAS = 1024
QUALITY = 88

bpy.ops.wm.open_mainfile(filepath=SCRATCH + r"\humvee_raw.blend")
O = bpy.data.objects
coll = bpy.context.scene.collection
if O.get('_Cam'):
    O.remove(O['_Cam'], do_unlink=True)

fix = Matrix.Scale(SCALE, 4) @ Matrix.Translation((-0.04, -0.06, 0.06))


def p(x, y, z):
    """A point read off the original file (Blender import axes) in the new space."""
    return fix @ Vector((x, y, z))


def base_image(mat):
    for link in mat.node_tree.links:
        if link.to_socket.name == 'Base Color' and link.from_node.type == 'TEX_IMAGE':
            return link.from_node.image
    return next(n.image for n in mat.node_tree.nodes if n.type == 'TEX_IMAGE')


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
    for _ in range(500):
        near = (np.roll(a, 1, 0) + np.roll(a, -1, 0) + np.roll(a, 1, 1) + np.roll(a, -1, 1)) / 4
        a[m] = near[m]
    # the camouflage has a grain; give the patch the same
    rng = np.random.default_rng(1)
    a[m] += rng.normal(0, 0.012, (int(m.sum()), 1))


def shrink(a, w, h):
    fy, fx = a.shape[0] // h, a.shape[1] // w
    return a[:h * fy, :w * fx].reshape(h, fy, w, fx, 3).mean((1, 3))


# material -> image and its place in the atlas (x, y, w, h), from the bottom left
ms = {o.name.split('|')[0]: o.data.materials[0] for o in O if o.type == 'MESH'}
CELLS = {
    'hmmwv_hood_ukr': (0, 512, 512, 512),
    'hmmwv_body_ukr': (512, 512, 512, 512),
    '1mmwv_regular_1_co': (0, 0, 512, 512),
    'us_hmmwv_detail': (512, 256, 512, 256),
    'material': (512, 0, 256, 256),
    '1mmwv_regular_2_co': (768, 128, 128, 128),
    'us_hmmwv_light': (896, 128, 128, 128),
    'kord': (768, 0, 128, 128),
    'brdm2_01_co': (896, 0, 128, 128),
}
CELLS['hua_2_co_ua'] = CELLS['1mmwv_regular_2_co']   # both read the same image
sheet = np.zeros((ATLAS, ATLAS, 3), np.float32)
done = {}
for name, cell in CELLS.items():
    im = base_image(ms[name])
    a = done.get(im.name)
    if a is None:
        a = pixels(im)
        if name == '1mmwv_regular_1_co':     # the national crest on both doors
            inpaint(a, 52, 722, 98, 774)
            inpaint(a, 52, 884, 98, 940)
        if name == 'hmmwv_body_ukr':     # the flags
            inpaint(a, 122, 102, 160, 130)
            inpaint(a, 122, 166, 160, 196)
        done[im.name] = a
    x, y, w, h = cell
    sheet[y:y + h, x:x + w] = shrink(a, w, h)
made = bpy.data.images.new('humvee_tmp', ATLAS, ATLAS, alpha=False)
made.pixels.foreach_set(np.concatenate([sheet, np.ones((ATLAS, ATLAS, 1), np.float32)], 2).ravel())
made.filepath_raw = SCRATCH + r"\humvee_atlas.png"
made.file_format = 'PNG'
made.save()
atlas = bpy.data.images.load(made.filepath_raw)
atlas.name = 'humvee'
atlas.colorspace_settings.name = 'sRGB'
atlas.pack()
bpy.data.images.remove(made)

# the cover gets its own bright copy, so that the accent color shows instead of sinking into the dark camouflage
lit = shrink(pixels(base_image(ms['hua_2_co_ua'])), 256, 256) ** 2.2
COVER_TINT = float(np.percentile(lit, 98))
lit = np.clip(lit / COVER_TINT, 0, 1) ** (1 / 2.2)
made = bpy.data.images.new('cover_tmp', 256, 256, alpha=False)
made.pixels.foreach_set(np.concatenate([lit, np.ones((256, 256, 1), np.float32)], 2).ravel())
made.filepath_raw = SCRATCH + r"humvee_cover.png"
made.file_format = 'PNG'
made.save()
cover = bpy.data.images.load(made.filepath_raw)
cover.name = 'humvee_cover'
cover.colorspace_settings.name = 'sRGB'
cover.pack()
bpy.data.images.remove(made)


def material(name, image=None, color=(1, 1, 1), rough=0.75, metal=0.0, tint=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    t = m.node_tree
    b = next(n for n in t.nodes if n.type == 'BSDF_PRINCIPLED')
    b.inputs['Metallic'].default_value = metal
    b.inputs['Roughness'].default_value = rough
    b.inputs['Base Color'].default_value = (*color, 1)
    m.diffuse_color = (*color, 1)
    if image:
        tex = t.nodes.new('ShaderNodeTexImage')
        tex.image = image
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


ORDER = ['body', 'Livery Colour 2', 'humvee', 'glass_dark']
M = [material('body', atlas), material('Livery Colour 2', cover, tint=COVER_TINT), material('humvee', atlas),
     material('glass_dark', None, (0.012, 0.014, 0.018), 0.08)]


def in_rects(u, y, rects):
    return any(a <= u <= c and b <= y <= d for a, b, c, d in rects)


NOT_PAINT = [(0, .34, .14, .6), (.26, .62, .46, .84), (.16, .85, .29, 1), (.42, .85, .56, 1), (.68, .48, 1, .73), (.5, .16, .87, .48), (.33, .33, .52, .5)]


COVER = ('hua_2_co_ua', '1mmwv_regular_2_co')   # the roof and the rear cover take the accent color


def is_camo(src, u, v):
    y = 1 - v
    if src == 'hmmwv_hood_ukr':
        return u < .43 and y < .42
    if src == 'hmmwv_body_ukr':
        return u < .69 and y < .35
    if src == '1mmwv_regular_1_co':
        return not in_rects(u, y, NOT_PAINT)
    return False


def prepare(ob, count=None, kill_tall=False, on_body=False):
    src = ob.name.split('|')[0]
    me = ob.data
    while len(me.uv_layers) > 1:
        me.uv_layers.remove(me.uv_layers[-1])
    me.transform(fix)
    if kill_tall:
        bm = bmesh.new()
        bm.from_mesh(me)
        seen, gone = set(), []
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
            if max(v.co.z for f in fs for v in f.verts) > 3.2:
                gone += fs
        bmesh.ops.delete(bm, geom=gone, context='FACES')
        bm.to_mesh(me)
        bm.free()
    if count:
        me.calc_loop_triangles()
        n = len(me.loop_triangles)
        if n > count:
            bpy.context.view_layer.objects.active = ob
            m = ob.modifiers.new('d', 'DECIMATE')
            m.ratio = count / n
            bpy.ops.object.modifier_apply(modifier='d')
    bm = bmesh.new()
    bm.from_mesh(me)
    uv = bm.loops.layers.uv[0]
    is_cover = on_body and src in COVER
    cell = (0, 0, ATLAS, ATLAS) if is_cover else CELLS.get(src)
    for f in bm.faces:
        if not cell:
            f.material_index = 3
            continue
        pts = [l[uv].uv.copy() for l in f.loops]
        c = sum(pts, Vector((0, 0))) / len(pts)
        shift = Vector((math.floor(c.x), math.floor(c.y)))
        f.material_index = 1 if is_cover else 0 if is_camo(src, c.x - shift.x, c.y - shift.y) else 2
        x, y, w, h = cell
        for l in f.loops:
            q = l[uv].uv - shift
            # a small inset so that mip levels do not bleed in from the next cell
            l[uv].uv = ((x + (0.01 + 0.98 * min(max(q.x, 0), 1)) * w) / ATLAS, (y + (0.01 + 0.98 * min(max(q.y, 0), 1)) * h) / ATLAS)
    bm.to_mesh(me)
    bm.free()


def join(objs, name):
    bm = bmesh.new()
    for o in objs:
        bm.from_mesh(o.data)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in M:
        me.materials.append(m)
    for o in objs:
        O.remove(o, do_unlink=True)
    ob = O.new(name, me)
    coll.objects.link(ob)
    return ob


def find(key):
    return next(o for o in O if o.type == 'MESH' and o.name.endswith(key))


O.remove(find('Object_14'), do_unlink=True)   # the number plates

parts = []
for key, count, tall in (('Object_15', None, False), ('Object_17', None, False), ('Object_22', None, True), ('Object_21', None, False),
                         ('Object_18', 1300, False), ('Object_16', None, False), ('Object_19', None, False), ('Object_23', None, False), ('Object_20', None, False)):
    ob = find(key)
    prepare(ob, count, tall, True)
    parts.append(ob)
body = join(parts, 'Body')

parts = []
for key, count in (('Object_25', 1400), ('Object_26', None), ('Object_28', None), ('Object_29', None), ('Object_30', None)):
    ob = find(key)
    prepare(ob, count)
    parts.append(ob)
gun = join(parts, 'Gun')
for f in gun.data.polygons:      # the gun keeps its own colors under any paint
    if f.material_index < 2:
        f.material_index = 2

wheels = {}
for key, name in (('hmmwv_detail_0', None), ('hmmwv_detail_0.001', None), ('hmmwv_detail_0.002', None), ('hmmwv_detail_0.003', None)):
    ob = find(key)
    prepare(ob)
    vs = [v.co for v in ob.data.vertices]
    c = Vector([(min(v[i] for v in vs) + max(v[i] for v in vs)) / 2 for i in range(3)])
    r = (max(v.z for v in vs) - min(v.z for v in vs)) / 2
    side = 'L' if c.x > 0 else 'R'
    end = 'F' if c.y < 0 else 'R'
    me = ob.data
    me.transform(Matrix.Translation(-c))
    me.materials.clear()
    for m in M:
        me.materials.append(m)
    for f in me.polygons:
        f.material_index = 2
    ob.location = c
    ob.name = me.name = 'Wheel_' + end + side
    wheels[ob.name] = ob


def empty(name, loc, parent=None):
    e = O.new(name, None)
    coll.objects.link(e)
    e.empty_display_size = 0.1
    e.location = Vector(loc) - (parent.location if parent else Vector())
    e.parent = parent
    return e


RING = p(0.01, 0.58, 1.46)
turret = empty('Turret', RING)
gun.data.transform(Matrix.Translation(-RING))
gun.parent = turret
empty('Seat', p(0.03, 0.71, 1.0), turret)
empty('Eye', p(0.03, 0.72, 2.3), turret)
empty('Muzzle', p(0.02, -0.75, 1.92), turret)
for name, side in (('Exhaust_L', 1), ('Exhaust_R', -1)):
    empty(name, (side * 0.5, 2.56, 0.6))

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

bpy.ops.wm.save_as_mainfile(filepath=GAME + r"\3d\Humvee_game.blend")
out = GAME + r"\models\humvee.glb"
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=False, export_yup=True, export_apply=True, export_animations=False,
                          export_cameras=False, export_lights=False, export_extras=False, export_image_format='JPEG', export_jpeg_quality=QUALITY)


def tris(ob):
    ob.data.calc_loop_triangles()
    return len(ob.data.loop_triangles)


meshes = [o for o in O if o.type == 'MESH']
vals = [ob.matrix_world @ Vector(c) for ob in meshes for c in ob.bound_box]
split = {}
for f in body.data.polygons:
    split[ORDER[f.material_index]] = split.get(ORDER[f.material_index], 0) + 1
result = dict(tris={o.name: tris(o) for o in meshes}, total=sum(tris(o) for o in meshes), kb=os.path.getsize(out) // 1024, split=split,
              box=[round(min(v[i] for v in vals), 3) for i in range(3)] + [round(max(v[i] for v in vals), 3) for i in range(3)],
              wheels={k: [round(x, 3) for x in w.location] for k, w in wheels.items()}, ring=[round(x, 3) for x in RING],
              grips=[[round(x, 3) for x in p(*q)] for q in ((0.03, 0.6, 1.89), (0.03, 0.467, 1.82))])
