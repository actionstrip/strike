# Builds models/helmet_m1.glb and 3d/HelmetM1_game.blend from helmet3_raw.blend.
# Light already; the size is in the textures, so the six maps become one atlas and the normal maps go.
# The original already faces the character's way (-Y). An open helmet sits on top of the hair.
import bpy, bmesh, math, os
import numpy as np
from mathutils import Matrix, Vector

SCRATCH = os.environ['SCRATCH']
ROOT = r'E:/inetpub/wwwroot/test/pixi_ai/race_new'
SCALE = float(os.environ.get('H_SCALE', 5.9))
Z0 = float(os.environ.get('H_Z', 1.53))
DY = float(os.environ.get('H_Y', 0.08))
TILT = float(os.environ.get('H_TILT', 0))
CENTER_X = 0.0135  # the shell is off the origin in the source
W, H = 768, 512
TILES = {  # mesh: (x, y, w, h) in atlas pixels, y from the bottom
    'Object_4': (0, 0, 512, 512), 'Object_5': (512, 256, 256, 256), 'Object_7': (512, 128, 128, 128),
    'Object_2': (640, 128, 128, 128), 'Object_3': (512, 0, 128, 128), 'Object_6': (640, 0, 128, 128),
}
TARGET = {'Object_7': 240, 'Object_5': 400}

bpy.ops.wm.open_mainfile(filepath=SCRATCH + '/helmet3_raw.blend')
O = bpy.data.objects
meshes = [o for o in O if o.type == 'MESH']
px = np.ones((H, W, 4), dtype=np.float32)
report = {}
for o in meshes:
    tree = o.data.materials[0].node_tree
    p = next(n for n in tree.nodes if n.type == 'BSDF_PRINCIPLED')
    img = p.inputs['Base Color'].links[0].from_node.image.copy()
    x, y, w, h = TILES[o.name]
    img.scale(w, h)
    px[y:y + h, x:x + w, :3] = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)[..., :3]
    uv = o.data.uv_layers[0].data
    vs = [l.uv.y for l in uv]; us = [l.uv.x for l in uv]
    report[o.name] = dict(u=[round(min(us), 2), round(max(us), 2)], v=[round(min(vs), 2), round(max(vs), 2)], mean=[round(float(c), 2) for c in px[y:y + h, x:x + w, :3].mean((0, 1))])
    for l in uv:
        l.uv = ((x + (l.uv.x % 1.0001) * w) / W, (y + (l.uv.y % 1.0001) * h) / H)
x, y, w, h = TILES['Object_7']
px[y:y + h, x:x + w, :3] = (0.62, 0.48, 0.24)  # the source cartridge map is black
tex = bpy.data.images.new('helmet_m1', W, H, alpha=False)
tex.pixels[:] = px.ravel()
tex.pack()

for o in meshes:
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True); bpy.context.view_layer.objects.active = o
    bm = bmesh.new(); bm.from_mesh(o.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bm.to_mesh(o.data); bm.free()
    if o.name in TARGET:
        o.data.calc_loop_triangles()
        mod = o.modifiers.new('d', 'DECIMATE'); mod.decimate_type = 'COLLAPSE'; mod.ratio = min(1, TARGET[o.name] / len(o.data.loop_triangles)); mod.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier='d')

mat = bpy.data.materials.new('helmet_m1'); mat.use_nodes = True
p = mat.node_tree.nodes['Principled BSDF']; p.inputs['Roughness'].default_value = 0.8; p.inputs['Metallic'].default_value = 0
t = mat.node_tree.nodes.new('ShaderNodeTexImage'); t.image = tex
mat.node_tree.links.new(t.outputs['Color'], p.inputs['Base Color'])
for o in meshes: o.data.materials[0] = mat

main = O['Object_4']
bpy.ops.object.select_all(action='DESELECT')
for o in meshes: o.select_set(True)
bpy.context.view_layer.objects.active = main
bpy.ops.object.join()
main.name = main.data.name = 'HelmetM1'
main.matrix_world = Matrix.Translation((0, DY, Z0)) @ Matrix.Rotation(math.radians(TILT), 4, 'X') @ Matrix.Scale(SCALE, 4) @ Matrix.Translation((-CENTER_X, 0, 0))
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
for m in list(bpy.data.materials):
    if m != mat: bpy.data.materials.remove(m)
for i in list(bpy.data.images):
    if i != tex: bpy.data.images.remove(i)

bpy.ops.wm.save_as_mainfile(filepath=ROOT + '/3d/HelmetM1_game.blend')
bpy.ops.export_scene.gltf(filepath=ROOT + '/models/helmet_m1.glb', export_format='GLB', use_selection=False, export_yup=True,
                          export_apply=False, export_animations=False, export_cameras=False, export_lights=False,
                          export_image_format='JPEG', export_jpeg_quality=86)
main.data.calc_loop_triangles()
pts = [v.co for v in main.data.vertices]
result = dict(tris=len(main.data.loop_triangles), tiles=report, kb=os.path.getsize(ROOT + '/models/helmet_m1.glb') // 1024,
              bounds=[[round(min(p[i] for p in pts), 3), round(max(p[i] for p in pts), 3)] for i in range(3)])
