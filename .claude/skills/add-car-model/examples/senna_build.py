# Rebuilds the Senna for its looks from the outside. Input is sn_ext.blend (see sn_ext.py):
# the source in game space, cut down to the faces that can be seen from outside.
#   1. the whole skin is thinned as ONE mesh, so neighbouring panels share an error budget
#      and material borders and open edges are protected by a vertex group
#   2. a black backing skin sits just under the panels, so any gap shows black, not sky
#   3. the normals of the dense source are copied on, so the thin mesh shades like the dense one
import bpy, bmesh, math, os
from mathutils import Matrix, Vector

SCRATCH = r"C:\Users\striper\AppData\Local\Temp\claude\C--inetpub-wwwroot-test-race\061da792-9090-425d-ad62-7d2d401c06ed\scratchpad"
GAME = r"C:\inetpub\wwwroot\test\race"
SKIN = int(os.environ.get('SKIN', 15000))
BACK = int(os.environ.get('BACK', 1800))
SHARP = math.radians(35)

bpy.ops.wm.open_mainfile(filepath=SCRATCH + r"\sn_ext.blend")
O = bpy.data.objects
coll = bpy.context.scene.collection
for m in list(bpy.data.materials):
    m.name = 'src_' + m.name
with bpy.data.libraries.load(SCRATCH + r"\sn_old_game.blend", link=False) as (src, dst):
    dst.objects = ['Dash', 'Steering', 'Seat', 'Eye', 'Exhaust_L', 'Exhaust_R']
for o in dst.objects:
    coll.objects.link(o)


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
    return m


M = {
    'body': material('body', (0.9, 0.3, 0.01), 0.35, 0.2),
    'Livery Colour 2': material('Livery Colour 2', (0.05, 0.05, 0.055), 0.4, 0.2),
    'rims': material('rims', (0.09, 0.09, 0.1), 0.35, 0.3),
    'tyre': material('tyre', (0.012, 0.012, 0.013), 0.85),
    'black': material('black', (0.025, 0.025, 0.028), 0.45, 0.1),
    'interior': material('interior', (0.04, 0.04, 0.045), 0.7),
    'caliper': material('caliper', (0.75, 0.02, 0.015), 0.4, 0.1),
    'light': material('light', (0.9, 0.9, 0.95), 0.2),
    'taillight': material('taillight', (0.7, 0.01, 0.01), 0.3),
    'glass': material('glass', (0.03, 0.04, 0.05), 0.1, 0, 0.84),
}
SLOTS = list(M)
MAP = {'BodyPaint': 'body', 'OrangeBody': 'body', 'BlackMetallic': 'Livery Colour 2', 'GreyBlack': 'black', 'Crbon': 'black', 'Grey': 'black', 'Top': 'black',
       'Metallic': 'black', 'Windows': 'glass', 'Glass': 'glass', 'Translucent': 'glass', 'Headlight': 'light', 'BackLighs': 'taillight', 'Baclight': 'taillight', 'Red Light': 'taillight'}


def tris(me):
    me.calc_loop_triangles()
    return len(me.loop_triangles)


def use_slots(me):
    me.materials.clear()
    for s in SLOTS:
        me.materials.append(M[s])


def active(ob):
    for o in bpy.context.selected_objects:
        o.select_set(False)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)


def thin(ob, count, group=None, symmetry=False):
    now = tris(ob.data)
    if now <= count:
        return
    active(ob)
    m = ob.modifiers.new('d', 'DECIMATE')
    m.ratio = count / now
    m.use_symmetry = symmetry
    m.symmetry_axis = 'X'
    if group:
        m.vertex_group = group
        m.vertex_group_factor = 10
    bpy.ops.object.modifier_apply(modifier='d')


def smooth(me, angle=SHARP):
    bm = bmesh.new()
    bm.from_mesh(me)
    for f in bm.faces:
        f.smooth = True
    for e in bm.edges:
        e.smooth = len(e.link_faces) == 2 and e.calc_face_angle(0) < angle
    bm.to_mesh(me)
    bm.free()


def loose_small(bm, size):
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
    return gone


# ---- the skin ---------------------------------------------------------------------------
ext = O['ext']
me = ext.data
src_names = [m.name[4:] for m in me.materials]

def wheel_of_source(f):
    # the source's own steering wheel crumples when thinned; the game has a clean one
    c = f.calc_center_median()
    return abs(c.x - 0.29) < 0.26 and -0.9 < c.y < -0.22 and 0.4 < c.z < 1.0


bm = bmesh.new()
bm.from_mesh(me)
bmesh.ops.delete(bm, geom=[f for f in bm.faces if wheel_of_source(f)], context='FACES')
bm.to_mesh(me)
bm.free()

# the backing is taken before anything is removed from the opaque skin
back = O.new('back', me.copy())
coll.objects.link(back)
bm = bmesh.new()
bm.from_mesh(back.data)
bmesh.ops.delete(bm, geom=[f for f in bm.faces if MAP.get(src_names[f.material_index]) == 'glass'], context='FACES')
bm.to_mesh(back.data)
bm.free()

bm = bmesh.new()
bm.from_mesh(me)
slot = {i: SLOTS.index(MAP[n]) if n in MAP else -1 for i, n in enumerate(src_names)}
gone = []
for f in bm.faces:
    n = src_names[f.material_index]
    c = f.calc_center_median()
    if n == 'Shining' or slot[f.material_index] < 0:     # badge strip on the nose
        gone.append(f)
    elif n == 'Headlight' and c.y > 0:                   # the rear honeycomb: the backing stands in for it
        gone.append(f)
bmesh.ops.delete(bm, geom=gone, context='FACES')
bm.verts.index_update()
bmesh.ops.delete(bm, geom=loose_small(bm, 0.03), context='VERTS')
for f in bm.faces:
    f.material_index = slot[f.material_index]
    f.smooth = True
bm.to_mesh(me)
bm.free()
wanted = [p.material_index for p in me.polygons]
use_slots(me)      # clearing the slots resets every face's index
me.polygons.foreach_set('material_index', wanted)
while me.uv_layers:
    me.uv_layers.remove(me.uv_layers[0])
# sheets that run on under the paint (the windscreen does) would come through it once thinned
from mathutils.bvhtree import BVHTree
bm = bmesh.new()
bm.from_mesh(me)
bmesh.ops.triangulate(bm, faces=bm.faces)
bm.verts.index_update()
paint = SLOTS.index('body')
tree = BVHTree.FromPolygons([v.co for v in bm.verts], [[v.index for v in f.verts] for f in bm.faces if f.material_index == paint], all_triangles=True)
glass_i = SLOTS.index('glass')
hidden = []
for f in bm.faces:
    if f.material_index in (paint, SLOTS.index('light'), SLOTS.index('taillight')):
        continue
    c = f.calc_center_median()
    n = f.normal
    reach = 0.16 if f.material_index == glass_i else 0.05
    up = tree.ray_cast(c + n * 0.002, n, reach)[0] is not None
    if up or (f.material_index == glass_i and tree.ray_cast(c - n * 0.002, -n, reach)[0] is not None):
        hidden.append(f)
bmesh.ops.delete(bm, geom=hidden, context='FACES')
gone_hidden = len(hidden)
bm.to_mesh(me)
bm.free()
smooth(me)
hi = O.new('hi', me.copy())
coll.objects.link(hi)
start = tris(me)

# thinned as one mesh the budget drains into the fiddly black parts and the paint dents, so
# every colour gets its own share and keeps its open edges
BUDGET = {'body': 8500, 'black': 4600, 'Livery Colour 2': 2100, 'glass': 650, 'light': 350, 'taillight': 200}


def thin_slot(name, count):
    ob = O.new('s_' + name, me.copy())
    coll.objects.link(ob)
    i = SLOTS.index(name)
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index != i], context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bm.verts.index_update()
    edge = {v.index for e in bm.edges if len(e.link_faces) != 2 for v in e.verts}
    bm.to_mesh(ob.data)
    bm.free()
    g = ob.vertex_groups.new(name='keep')
    g.add(list(range(len(ob.data.vertices))), 1.0, 'REPLACE')   # weight 0 would lock a vertex outright
    g.add(list(edge), 0.05, 'REPLACE')
    thin(ob, count, 'keep')
    ob.vertex_groups.clear()
    return ob


shares = [thin_slot(k, v) for k, v in BUDGET.items()]
bm = bmesh.new()
for o in shares:
    bm.from_mesh(o.data)
bm.to_mesh(me)
bm.free()
for o in shares:
    O.remove(o, do_unlink=True)
# collapsing thin strips can throw a vertex far away; every vertex goes back onto the dense surface
hi.data.calc_loop_triangles()
hv = [v.co.copy() for v in hi.data.vertices]
hp = BVHTree.FromPolygons(hv, [list(t.vertices) for t in hi.data.loop_triangles], all_triangles=True)
snapped = 0
for v in me.vertices:
    near = hp.find_nearest(v.co)[0]
    if near is not None and (near - v.co).length > 0.004:
        v.co = near
        snapped += 1
smooth(me)

active(ext)
t = ext.modifiers.new('n', 'DATA_TRANSFER')
t.object = hi
t.use_loop_data = True
t.data_types_loops = {'CUSTOM_NORMAL'}
t.loop_mapping = 'POLYINTERP_NEAREST'
bpy.ops.object.modifier_apply(modifier='n')
O.remove(hi, do_unlink=True)

# ---- the backing ------------------------------------------------------------------------
r = back.modifiers.new('r', 'REMESH')
r.mode = 'VOXEL'
r.voxel_size = 0.03
active(back)
bpy.ops.object.modifier_apply(modifier='r')
thin(back, BACK)
bm = bmesh.new()
bm.from_mesh(back.data)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
bm.normal_update()
for v in bm.verts:
    v.co -= v.normal * 0.012
bm.to_mesh(back.data)
bm.free()
use_slots(back.data)
for p in back.data.polygons:
    p.material_index = SLOTS.index('black')
smooth(back.data, math.radians(60))

# ---- what is seen through the glass -----------------------------------------------------
cab = O['cabin']
cm = cab.data
names = [m.name[4:] for m in cm.materials]
bm = bmesh.new()
bm.from_mesh(cm)
bmesh.ops.delete(bm, geom=[f for f in bm.faces if names[f.material_index] == 'screen' or wheel_of_source(f)], context='FACES')
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.004)
seat = {i for i, n in enumerate(names) if n.startswith('Seat')}
use_slots(cm)
for f in bm.faces:
    f.material_index = SLOTS.index('interior' if f.material_index in seat else 'black')
bm.to_mesh(cm)
bm.free()
while cm.uv_layers:
    cm.uv_layers.remove(cm.uv_layers[0])
thin(cab, 750)
smooth(cm, math.radians(50))

floor_me = bpy.data.meshes.new('floor')
bm = bmesh.new()
c = bmesh.ops.create_cube(bm, size=1)
for v in c['verts']:
    v.co = Vector((v.co.x * 1.5, -0.3 + v.co.y * 2.6, 0.2 + v.co.z * 0.04))
bm.to_mesh(floor_me)
bm.free()
use_slots(floor_me)
for p in floor_me.polygons:
    p.material_index = SLOTS.index('black')
floor = O.new('floor', floor_me)
coll.objects.link(floor)

# ---- wheels: the rim comes from the source, the tyre is turned new so it stays round --------
def centre(n):
    b = [v.co for v in O[n].data.vertices]
    return Vector(((min(v.x for v in b) + max(v.x for v in b)) / 2, (min(v.y for v in b) + max(v.y for v in b)) / 2, 0))


CENTRE = {n: centre(n) for n in ('FL', 'FR', 'RL', 'RR')}
fl = O['FL']
wm = fl.data
vs = [v.co for v in wm.vertices]
lo = Vector([min(v[i] for v in vs) for i in range(3)])
hi_ = Vector([max(v[i] for v in vs) for i in range(3)])
C = (lo + hi_) / 2
RADIUS = (hi_.z - lo.z) / 2
WIDTH = hi_.x - lo.x
wm.transform(Matrix.Translation(-C))
names = [m.name[4:] for m in wm.materials]
hist = {}
for p in wm.polygons:
    k = round(math.hypot(p.center.y, p.center.z), 2)
    if names[p.material_index].startswith('wire_162'):
        hist[k] = hist.get(k, 0) + 1
RIM = float(os.environ.get('RIM', 0.325))

cal = O.new('cal', wm.copy())
coll.objects.link(cal)
bm = bmesh.new()
bm.from_mesh(cal.data)
bmesh.ops.delete(bm, geom=[f for f in bm.faces if not names[f.material_index].startswith('wire_135')], context='FACES')
bm.to_mesh(cal.data)
bm.free()
while cal.data.uv_layers:
    cal.data.uv_layers.remove(cal.data.uv_layers[0])
thin(cal, 70)
use_slots(cal.data)
for p in cal.data.polygons:
    p.material_index = SLOTS.index('caliper')
smooth(cal.data, math.radians(50))

bm = bmesh.new()
bm.from_mesh(wm)
bmesh.ops.delete(bm, geom=[f for f in bm.faces if names[f.material_index].startswith('wire_135') or math.hypot(*f.calc_center_median().yz) > RIM
                           or f.calc_center_median().x < -0.02], context='FACES')
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.001)
bm.to_mesh(wm)
bm.free()
while wm.uv_layers:
    wm.uv_layers.remove(wm.uv_layers[0])
thin(fl, int(os.environ.get('RIMTRIS', 450)))
use_slots(wm)
for p in wm.polygons:
    p.material_index = SLOTS.index('rims')
smooth(wm, math.radians(45))

SIDES = 24


def lathe(bm, profile, material):
    rings = [[bm.verts.new((x, r * math.cos(i * 2 * math.pi / SIDES), r * math.sin(i * 2 * math.pi / SIDES))) for i in range(SIDES)] for x, r in profile]
    for a, b in zip(rings, rings[1:]):
        for i in range(SIDES):
            bm.faces.new((a[i], a[(i + 1) % SIDES], b[(i + 1) % SIDES], b[i])).material_index = material


def tyre_into(bm):
    w, r = WIDTH / 2, RADIUS
    rim = RIM / r
    lathe(bm, [(-w, rim * r), (-w * 1.02, 0.9 * r), (-w * 0.84, 0.985 * r), (0, r), (w * 0.84, 0.985 * r), (w * 1.02, 0.9 * r), (w, (rim + 0.015) * r)], SLOTS.index('tyre'))
    lathe(bm, [(w * 0.98, (rim + 0.015) * r), (w * 0.9, (rim - 0.02) * r), (-w * 0.5, (rim - 0.03) * r)], SLOTS.index('rims'))
    c = bmesh.ops.create_circle(bm, cap_ends=True, segments=SIDES, radius=(rim - 0.02) * r)['verts']
    bmesh.ops.rotate(bm, verts=c, cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(90), 3, 'Y'))
    bmesh.ops.translate(bm, verts=c, vec=(-w * 0.5, 0, 0))
    for f in {f for v in c for f in v.link_faces}:
        f.material_index = SLOTS.index('black')
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)


rims_me = wm
wheels = {}
for nm, x, k in (('Wheel_FL', 1, 'FL'), ('Wheel_FR', -1, 'FR'), ('Wheel_RL', 1, 'RL'), ('Wheel_RR', -1, 'RR')):
    bm = bmesh.new()
    tyre_into(bm)
    tme = bpy.data.meshes.new(nm)
    use_slots(tme)
    bm.to_mesh(tme)
    bm.free()
    smooth(tme, math.radians(50))
    bm = bmesh.new()
    bm.from_mesh(tme)
    bm.from_mesh(rims_me)
    if x < 0:
        bmesh.ops.scale(bm, vec=(-1, 1, 1), verts=bm.verts)
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
    bm.to_mesh(tme)
    bm.free()
    ob = O.new(nm, tme)
    coll.objects.link(ob)
    ob.location = (CENTRE[k].x, CENTRE[k].y, RADIUS)
    wheels[nm] = ob

# calipers sit still inside the wheels
cparts = []
for nm, x in (('Wheel_FL', 1), ('Wheel_FR', -1), ('Wheel_RL', 1), ('Wheel_RR', -1)):
    c2 = O.new('c' + nm, cal.data.copy())
    coll.objects.link(c2)
    c2.data.transform(Matrix.Translation(wheels[nm].location) @ Matrix.Scale(x, 4, (1, 0, 0)))
    if x < 0:
        c2.data.flip_normals() if hasattr(c2.data, 'flip_normals') else None
    cparts.append(c2)

# ---- join; the skin stays the active object so its custom normals survive ------------------
active(ext)
for o in (back, cab, floor, *cparts):
    o.select_set(True)
bpy.ops.object.join()
ext.name = 'Body'
ext.data.name = 'Body'

# Dash is shown by the game in the driver's view only
keep = {'Body', 'Dash', 'Steering', 'Seat', 'Eye', 'Exhaust_L', 'Exhaust_R', *wheels}
for o in list(O):
    if o.name not in keep:
        O.remove(o, do_unlink=True)
for data in (bpy.data.meshes, bpy.data.materials, bpy.data.images):
    for d in list(data):
        if d.users == 0:
            data.remove(d)
bpy.context.view_layer.update()

bpy.ops.wm.save_as_mainfile(filepath=os.environ.get('SAVE', GAME + r"\3d\Senna_game.blend"))
out = os.environ.get('GLB', GAME + r"\models\senna.glb")
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=False, export_yup=True, export_apply=True, export_animations=False,
                          export_cameras=False, export_lights=False, export_extras=False)

meshes = [o for o in O if o.type == 'MESH']
all_v = [o.matrix_world @ v.co for o in meshes for v in o.data.vertices]
split = {}
me = O['Body'].data
me.calc_loop_triangles()
for t in me.loop_triangles:
    n = me.materials[me.polygons[t.polygon_index].material_index].name
    split[n] = split.get(n, 0) + 1
result = dict(snapped=snapped, start=start, hidden=gone_hidden, tris={o.name: tris(o.data) for o in meshes}, total=sum(tris(o.data) for o in meshes), kb=os.path.getsize(out) // 1024, split=split,
              box=[round(min(v[i] for v in all_v), 3) for i in range(3)] + [round(max(v[i] for v in all_v), 3) for i in range(3)],
              wheels={k: [round(x, 3) for x in w.location] for k, w in wheels.items()}, wheel=[RADIUS, WIDTH], hist={k: hist[k] for k in sorted(hist)})
