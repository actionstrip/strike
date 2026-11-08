# Builds models/helmet_vintage.glb and 3d/HelmetVintage_game.blend from helmet4_raw.blend.
# The chin straps and buckles hang through the chest, so they go; shell and goggles share one atlas.
# The source is in big units and already faces the character's way (-Y). An open helmet sits on top of the hair.
import bpy, bmesh, math, os
import numpy as np
from mathutils import Matrix

SCRATCH = os.environ['SCRATCH']
ROOT = r'E:/inetpub/wwwroot/test/pixi_ai/race_new'
SCALE = float(os.environ.get('H_SCALE', 0.0046))
Z0 = float(os.environ.get('H_Z', 1.22))
DY = float(os.environ.get('H_Y', 0))
TILT = float(os.environ.get('H_TILT', 0))
W, H = 768, 512
SHELL, GOGGLES, LENS = (0, 0, 512, 512), (512, 256, 256, 256), (512, 0, 256, 256)
PARTS = {  # mesh: (atlas tile, target triangles)
    'defaultMaterial.009': (SHELL, 1800), 'defaultMaterial.008': (SHELL, 500), 'defaultMaterial': (GOGGLES, 500),
    'defaultMaterial.001': (GOGGLES, 500), 'defaultMaterial.002': (GOGGLES, 300), 'defaultMaterial.003': (LENS, 248),
}

bpy.ops.wm.open_mainfile(filepath=SCRATCH + '/helmet4_raw.blend')
O = bpy.data.objects
for o in list(O):
    if o.type == 'MESH' and o.name not in PARTS: O.remove(o, do_unlink=True)
meshes = [o for o in O if o.type == 'MESH']

px = np.ones((H, W, 4), dtype=np.float32)
for o in meshes:
    tile = PARTS[o.name][0]
    x, y, w, h = tile
    tree = o.data.materials[0].node_tree
    p = next(n for n in tree.nodes if n.type == 'BSDF_PRINCIPLED')
    img = p.inputs['Base Color'].links[0].from_node.image.copy()
    img.scale(w, h)
    px[y:y + h, x:x + w, :3] = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)[..., :3]
    for l in o.data.uv_layers[0].data:
        l.uv = ((x + (l.uv.x % 1.0001) * w) / W, (y + (l.uv.y % 1.0001) * h) / H)
tex = bpy.data.images.new('helmet_vintage', W, H, alpha=False)
tex.pixels[:] = px.ravel()
tex.pack()

report = {}
for o in meshes:
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True); bpy.context.view_layer.objects.active = o
    bpy.ops.mesh.customdata_custom_splitnormals_clear()
    bm = bmesh.new(); bm.from_mesh(o.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.01)
    bm.to_mesh(o.data); bm.free()
    o.data.calc_loop_triangles()
    mod = o.modifiers.new('d', 'DECIMATE'); mod.decimate_type = 'COLLAPSE'; mod.use_collapse_triangulate = True
    mod.ratio = min(1, PARTS[o.name][1] / len(o.data.loop_triangles))
    bpy.ops.object.modifier_apply(modifier='d')
    o.data.calc_loop_triangles(); report[o.name] = len(o.data.loop_triangles)
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(40))

mat = bpy.data.materials.new('helmet_vintage'); mat.use_nodes = True
p = mat.node_tree.nodes['Principled BSDF']; p.inputs['Roughness'].default_value = 0.5; p.inputs['Metallic'].default_value = 0
t = mat.node_tree.nodes.new('ShaderNodeTexImage'); t.image = tex
mat.node_tree.links.new(t.outputs['Color'], p.inputs['Base Color'])
for o in meshes: o.data.materials[0] = mat

main = O['defaultMaterial.009']
bpy.ops.object.select_all(action='DESELECT')
for o in meshes: o.select_set(True)
bpy.context.view_layer.objects.active = main
bpy.ops.object.join()
main.name = main.data.name = 'HelmetVintage'
main.matrix_world = Matrix.Translation((0, DY, Z0)) @ Matrix.Rotation(math.radians(TILT), 4, 'X') @ Matrix.Scale(SCALE, 4)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
for m in list(bpy.data.materials):
    if m != mat: bpy.data.materials.remove(m)
for i in list(bpy.data.images):
    if i != tex: bpy.data.images.remove(i)

bpy.ops.wm.save_as_mainfile(filepath=ROOT + '/3d/HelmetVintage_game.blend')
bpy.ops.export_scene.gltf(filepath=ROOT + '/models/helmet_vintage.glb', export_format='GLB', use_selection=False, export_yup=True,
                          export_apply=False, export_animations=False, export_cameras=False, export_lights=False,
                          export_image_format='JPEG', export_jpeg_quality=86)
main.data.calc_loop_triangles()
pts = [v.co for v in main.data.vertices]
result = dict(tris=len(main.data.loop_triangles), parts=report, kb=os.path.getsize(ROOT + '/models/helmet_vintage.glb') // 1024,
              bounds=[[round(min(p[i] for p in pts), 3), round(max(p[i] for p in pts), 3)] for i in range(3)])
