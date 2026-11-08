# Imports the model in $MODEL, bakes its transforms and saves $OUT (a .blend). Every later script starts from that file.
# Run it through blrun.py with both variables set. `result` lists the meshes, their bounds and the images.
import bpy, os
from mathutils import Vector

SRC = os.environ['MODEL']
OUT = os.environ['OUT']

O = bpy.data.objects
for name in ('Cube', 'Camera', 'Light'):     # --factory-startup leaves these, and the cube would fill every render
    if O.get(name):
        O.remove(O[name], do_unlink=True)

bpy.ops.import_scene.gltf(filepath=SRC)
for o in list(O):
    if o.type != 'MESH':
        continue
    m = o.matrix_world.copy()
    o.parent = None
    o.matrix_world = m
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    o.select_set(False)
for o in list(O):
    if o.type != 'MESH':
        O.remove(o, do_unlink=True)
bpy.ops.wm.save_as_mainfile(filepath=OUT)


def bounds(o):
    pts = [o.matrix_world @ Vector(c) for c in o.bound_box]
    return [[round(min(p[i] for p in pts), 3), round(max(p[i] for p in pts), 3)] for i in range(3)]


def tris(o):
    o.data.calc_loop_triangles()
    return len(o.data.loop_triangles)


meshes = list(O)
result = dict(
    total_tris=sum(tris(o) for o in meshes),
    meshes=[dict(name=o.name, tris=tris(o), bounds=bounds(o), materials=[m.name for m in o.data.materials if m]) for o in meshes],
    images=[(i.name, list(i.size)) for i in bpy.data.images if i.size[0]],
)
