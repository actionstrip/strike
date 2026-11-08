# Step 1 of the Senna rebuild: keep only the faces that can be seen from outside.
import bpy, bmesh, math, os, time, json
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
SCR = os.path.dirname(os.environ['OUT'])
bpy.ops.wm.open_mainfile(filepath=os.path.join(SCR, 'sn_raw.blend'))
O = bpy.data.objects
t0 = time.time()
FIX = Matrix.Scale(0.8, 4) @ Matrix.Translation((0, 0, 0.045))
ob = O['senna']
me = ob.data
GLASS = {'Windows', 'Glass', 'Translucent'}
CABIN = {'Seat', 'Seat lining', 'Dashboard', 'screen', 'Interior', 'Material'}
DROP = {'Back Plate'}
names = [m.name for m in me.materials]

bm = bmesh.new()
bm.from_mesh(me)
bmesh.ops.transform(bm, matrix=FIX @ ob.matrix_world, verts=bm.verts)
bmesh.ops.delete(bm, geom=[f for f in bm.faces if names[f.material_index] in DROP], context='FACES')
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.00015)
bmesh.ops.triangulate(bm, faces=bm.faces)
bm.faces.ensure_lookup_table()
bm.verts.index_update()
bm.faces.index_update()
print('tris', len(bm.faces), time.time() - t0, flush=True)

verts = [v.co.copy() for v in bm.verts]
polys = [[v.index for v in f.verts] for f in bm.faces]
ids_all = list(range(len(polys)))
kind = [names[f.material_index] for f in bm.faces]
opaque_ids = [i for i in ids_all if kind[i] not in GLASS and kind[i] not in CABIN]
full_ids = [i for i in ids_all if kind[i] not in CABIN]
tree_full = BVHTree.FromPolygons(verts, [polys[i] for i in full_ids], all_triangles=True)
tree_op = BVHTree.FromPolygons(verts, [polys[i] for i in opaque_ids], all_triangles=True)

lo = Vector([min(v[i] for v in verts) for i in range(3)])
hi = Vector([max(v[i] for v in verts) for i in range(3)])
mid = (lo + hi) / 2
R = (hi - lo).length / 2 + 0.2
dirs = []
for x in (-1, 0, 1):
    for y in (-1, 0, 1):
        for z in (-1, 0, 1):
            if (x, y, z) != (0, 0, 0):
                dirs.append(Vector((x, y, z * 0.8)).normalized())
for a in range(0, 360, 30):
    dirs.append(Vector((math.cos(math.radians(a)), math.sin(math.radians(a)), 0.25)).normalized())
STEP = 0.022
hit = bytearray(len(polys))
rays = 0
for n, d in enumerate(dirs):
    u = d.orthogonal().normalized()
    v = d.cross(u).normalized()
    # span of the car on this view plane
    cs = [Vector((x, y, z)) for x in (lo.x, hi.x) for y in (lo.y, hi.y) for z in (lo.z, hi.z)]
    us = [(c - mid).dot(u) for c in cs]
    vs = [(c - mid).dot(v) for c in cs]
    a = min(us)
    while a < max(us):
        b = min(vs)
        while b < max(vs):
            o = mid + u * a + v * b - d * R
            r = tree_full.ray_cast(o, d, R * 2)
            if r[0] is not None:
                hit[full_ids[r[2]]] = 1
                rays += 1
                if kind[full_ids[r[2]]] in GLASS:
                    r2 = tree_op.ray_cast(o, d, R * 2)
                    if r2[0] is not None:
                        hit[opaque_ids[r2[2]]] = 1
            b += STEP
        a += STEP
    if n % 6 == 0:
        print('dir', n, rays, time.time() - t0, flush=True)
print('rays', rays, 'hit', sum(hit), time.time() - t0, flush=True)

# grow from what was hit over smooth surface, but never round onto the back of a panel
faces = bm.faces
normal = [f.normal.copy() for f in faces]
seed = [None] * len(polys)
stack = []
for i in ids_all:
    if hit[i]:
        seed[i] = normal[i]
        stack.append(i)
while stack:
    i = stack.pop()
    f = faces[i]
    s = seed[i]
    for e in f.edges:
        for g in e.link_faces:
            j = g.index
            if seed[j] is None and kind[j] not in CABIN and normal[i].dot(normal[j]) > 0.6 and normal[j].dot(s) > -0.1:
                seed[j] = s
                stack.append(j)
kept = sum(1 for s in seed if s is not None)
print('kept', kept, time.time() - t0, flush=True)

cab = bm.copy()
cab.faces.ensure_lookup_table()
bmesh.ops.delete(cab, geom=[cab.faces[i] for i in ids_all if kind[i] not in CABIN], context='FACES')
me_cab = bpy.data.meshes.new('cabin')
for m in me.materials:
    me_cab.materials.append(m)
cab.to_mesh(me_cab)
cab.free()
c_ob = O.new('cabin', me_cab)
bpy.context.scene.collection.objects.link(c_ob)

bmesh.ops.delete(bm, geom=[faces[i] for i in ids_all if seed[i] is None], context='FACES')
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
me_ext = bpy.data.meshes.new('ext')
for m in me.materials:
    me_ext.materials.append(m)
bm.to_mesh(me_ext)
bm.free()
e_ob = O.new('ext', me_ext)
bpy.context.scene.collection.objects.link(e_ob)

for n in ('FL', 'FR', 'RL', 'RR'):
    w = O[n]
    mw = FIX @ w.matrix_world
    w.parent = None
    w.data.transform(mw)
    w.matrix_world = Matrix()
O.remove(ob)
stats = {}
for p in me_ext.polygons:
    k = me_ext.materials[p.material_index].name
    stats[k] = stats.get(k, 0) + 1
bpy.ops.wm.save_as_mainfile(filepath=os.environ['OUT'])
result = dict(rays=rays, kept=kept, stats=stats, sec=time.time() - t0)
