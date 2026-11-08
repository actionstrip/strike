# Imports moto_new.glb keeping each mesh's named parent: `Part|material|n`. Shared meshes are made single-user first.
import bpy, re, os, collections
from mathutils import Vector
SRC = r"C:\inetpub\wwwroot\test\race\3d\moto_new.glb"
OUT = os.environ['OUT']
O = bpy.data.objects
for name in ('Cube', 'Camera', 'Light'):
    if O.get(name):
        O.remove(O[name], do_unlink=True)
bpy.ops.import_scene.gltf(filepath=SRC)
ANON = re.compile(r'^(Mesh\d+.*|Group\d+.*|Sketchfab_model.*|RootNode.*|Model.*|.*\.fbx.*|root|GLTF_SceneRootNode)$')
def part(o):
    p = o.parent
    while p:
        if not ANON.match(p.name):
            return re.sub(r'\.\d+$', '', p.name)
        p = p.parent
    return 'unnamed'
meshes = [o for o in O if o.type == 'MESH']
info = []
for i, o in enumerate(meshes):
    mat = o.data.materials[0].name if o.data.materials and o.data.materials[0] else 'none'
    info.append((o, part(o), mat, o.matrix_world.copy()))
for i, (o, p, mat, m) in enumerate(info):
    o.data = o.data.copy()
    o.parent = None
    o.data.transform(m)
    o.matrix_world = m.Identity(4)
    o.name = '%s|%s|%d' % (p, mat, i)
    o['part'] = p
for o in list(O):
    if o.type != 'MESH':
        O.remove(o, do_unlink=True)
for m in bpy.data.materials:
    if m.use_nodes:
        b = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        if b:
            c = b.inputs['Base Color'].default_value
            m.diffuse_color = (c[0], c[1], c[2], 1)
for me in list(bpy.data.meshes):
    if me.users == 0:
        bpy.data.meshes.remove(me)
bpy.ops.wm.save_as_mainfile(filepath=OUT)
g = collections.defaultdict(lambda: [0, [9e9]*3, [-9e9]*3, set(), 0])
for o in O:
    me = o.data
    me.calc_loop_triangles()
    e = g[o['part']]
    e[0] += len(me.loop_triangles); e[4] += 1
    e[3].add(o.name.split('|')[1])
    for v in me.vertices:
        for k in range(3):
            e[1][k] = min(e[1][k], v.co[k]); e[2][k] = max(e[2][k], v.co[k])
result = dict(objs=len(O), parts=sorted([[k, e[0], e[4], [round(x, 2) for x in e[1] + e[2]], sorted(e[3])] for k, e in g.items()], key=lambda r: -r[1]))
