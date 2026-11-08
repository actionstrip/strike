# Builds models/helmet.glb and 3d/Helmet_game.blend from helmet_raw.blend.
# One mesh with two materials: the flat colours become a swatch strip under the texture, and only the
# goggle lens stays apart, because it is see-through. Vertices are in the character's rest-pose space,
# so the game can attach it to the head bone as it stands.
import bpy, bmesh, math, os
import numpy as np
from mathutils import Matrix, Vector

SCRATCH = os.environ['SCRATCH']
ROOT = r'E:/inetpub/wwwroot/test/pixi_ai/race_new'
SCALE = float(os.environ.get('H_SCALE', 1.5))
Z0 = float(os.environ.get('H_Z', 0.72))
DY = float(os.environ.get('H_Y', 0.03))
TILT, FIT_Z, FIT_Y, FIT_SCALE = 16, -0.05, 0, 1.04  # from the fit search: eyes behind the lens, head covered
RATIO = float(os.environ.get('H_RATIO', 0.7))
SIZE, STRIP = 512, 32

bpy.ops.wm.open_mainfile(filepath=SCRATCH + '/helmet_raw.blend')
O = bpy.data.objects
LENS = 'black_gloss'
LENS_ALPHA = float(os.environ.get('H_LENS_ALPHA', 0.5))
FLAT = {  # linear colours; metal reads badly without an environment map, so it goes matte
    'bLACK': (0.012, 0.012, 0.012), 'Metalicc': (0.45, 0.45, 0.45),
    'White': (0.8, 0.8, 0.8), 'material_6': (0.63, 0.006, 0.0),
}
names = list(FLAT)

img = bpy.data.images['Image_0']
img.scale(SIZE, SIZE - STRIP)
src = np.array(img.pixels[:], dtype=np.float32).reshape(SIZE - STRIP, SIZE, 4)
tex = bpy.data.images.new('helmet', SIZE, SIZE, alpha=False)
tex.colorspace_settings.name = 'sRGB'
px = np.ones((SIZE, SIZE, 4), dtype=np.float32)
px[STRIP:] = src
srgb = lambda c: 12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055
w = SIZE // len(names)
for i, n in enumerate(names):
    px[:STRIP, i * w:(i + 1) * w, :3] = [srgb(c) for c in FLAT[n]]
tex.pixels[:] = px.ravel()
tex.pack()

uv_range = [9, -9]
meshes = [o for o in O if o.type == 'MESH']
for o in meshes:
    uv = o.data.uv_layers[0].data
    name = o.data.materials[0].name
    if name in FLAT:
        c = ((names.index(name) + .5) * w / SIZE, .5 * STRIP / SIZE)
        for l in uv: l.uv = c
    else:
        for l in uv:
            uv_range = [min(uv_range[0], l.uv.y), max(uv_range[1], l.uv.y)]
            l.uv.y = l.uv.y * (SIZE - STRIP) / SIZE + STRIP / SIZE

main = O['Object_2']
bm = bmesh.new(); bm.from_mesh(main.data)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
bm.to_mesh(main.data); bm.free()
mod = main.modifiers.new('d', 'DECIMATE'); mod.decimate_type = 'COLLAPSE'; mod.ratio = RATIO; mod.use_collapse_triangulate = True
bpy.context.view_layer.objects.active = main
bpy.ops.object.modifier_apply(modifier='d')

for o in meshes: o.select_set(True)
bpy.context.view_layer.objects.active = main
bpy.ops.object.join()
main.name = main.data.name = 'Helmet'

mat = bpy.data.materials.new('helmet'); mat.use_nodes = True
p = mat.node_tree.nodes['Principled BSDF']; p.inputs['Roughness'].default_value = 0.6; p.inputs['Metallic'].default_value = 0
t = mat.node_tree.nodes.new('ShaderNodeTexImage'); t.image = tex
mat.node_tree.links.new(t.outputs['Color'], p.inputs['Base Color'])
lens = bpy.data.materials.new('lens'); lens.use_nodes = True
lens.surface_render_method = 'BLENDED'
p = lens.node_tree.nodes['Principled BSDF']; p.inputs['Base Color'].default_value = (0.02, 0.02, 0.025, 1)
p.inputs['Roughness'].default_value = 0.2; p.inputs['Metallic'].default_value = 0; p.inputs['Alpha'].default_value = LENS_ALPHA
lens_slot = main.data.materials.find(LENS)
lens_faces = {poly.index for poly in main.data.polygons if poly.material_index == lens_slot}
main.data.materials.clear(); main.data.materials.append(mat); main.data.materials.append(lens)
for poly in main.data.polygons: poly.material_index = 1 if poly.index in lens_faces else 0

# the head pivot: tipping forward brings the eye opening down over the eyes
PIVOT = Vector((0, 0, 1.25))
seat = Matrix.Translation(PIVOT + Vector((0, FIT_Y, FIT_Z))) @ Matrix.Rotation(math.radians(TILT), 4, "X") @ Matrix.Scale(FIT_SCALE, 4) @ Matrix.Translation(-PIVOT)
main.matrix_world = seat @ Matrix.Translation((0, DY, Z0)) @ Matrix.Rotation(math.pi, 4, "Z") @ Matrix.Scale(SCALE, 4)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
for m in list(bpy.data.materials):
    if m not in (mat, lens): bpy.data.materials.remove(m)
for i in list(bpy.data.images):
    if i != tex: bpy.data.images.remove(i)

bpy.ops.wm.save_as_mainfile(filepath=ROOT + '/3d/Helmet_game.blend')
bpy.ops.export_scene.gltf(filepath=ROOT + '/models/helmet.glb', export_format='GLB', use_selection=False, export_yup=True,
                          export_apply=False, export_animations=False, export_cameras=False, export_lights=False,
                          export_image_format='JPEG', export_jpeg_quality=86)
main.data.calc_loop_triangles()
pts = [v.co for v in main.data.vertices]
result = dict(tris=len(main.data.loop_triangles), lens_faces=len(lens_faces), uv_v=uv_range, kb=os.path.getsize(ROOT + '/models/helmet.glb') // 1024,
              bounds=[[round(min(p[i] for p in pts), 3), round(max(p[i] for p in pts), 3)] for i in range(3)])
