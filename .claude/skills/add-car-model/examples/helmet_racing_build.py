# Builds models/helmet_racing.glb and 3d/HelmetRacing_game.blend from helmet2_raw.blend.
# 135k triangles of separate parts: each part gets its own target, the liner goes, the flat colours and the
# visor strip join the shell in one atlas, and only the visor stays apart because it is see-through.
# Vertices are in the character's rest-pose space, so the game can attach it to the head bone as it stands.
import bpy, bmesh, math, os
import numpy as np
from mathutils import Matrix, Vector

SCRATCH = os.environ['SCRATCH']
ROOT = r'E:/inetpub/wwwroot/test/pixi_ai/race_new'
SCALE = float(os.environ.get('H_SCALE', 2.75))
Z0 = float(os.environ.get('H_Z', 0.62))
DY = float(os.environ.get('H_Y', 0.13))
TILT, FIT_Z, FIT_Y, FIT_SCALE = 8, -0.1, 0.15, 1.12  # from the fit search: eyes behind the visor, head covered
VISOR_ALPHA = float(os.environ.get('H_VISOR_ALPHA', 0.5))
W, SHELL, STRIP, SWATCH = 512, 512, 256, 16
H = SHELL + STRIP + SWATCH

TARGET = {'Object_4': 3000, 'Object_14': 900, 'Object_8': 400, 'Object_15': 200, 'Object_23': 150, 'Object_21': 250,
          'Object_19': 200, 'Object_12': 150, 'Object_10': 120, 'Object_17': 120, 'Object_25': 40, 'Object_27': 40}
DROP = ['Object_6']  # liner, behind the head
VISOR, LOGO, SHELL_MESH = 'Object_8', 'Object_29', 'Object_4'
FLAT = {'Black_Plastic': (0.012, 0.012, 0.012), 'Brushed_aluminium': (0.5, 0.5, 0.5), 'Procedural_Felt': (0.033, 0.026, 0.026),
        'Procedural_Felt.002': (0.533, 0, 0)}  # linear colours
names = list(FLAT)

bpy.ops.wm.open_mainfile(filepath=SCRATCH + '/helmet2_raw.blend')
O = bpy.data.objects
for n in DROP: O.remove(O[n], do_unlink=True)
meshes = [o for o in O if o.type == 'MESH']


def base_image(o):
    tree = o.data.materials[0].node_tree
    p = next(n for n in tree.nodes if n.type == 'BSDF_PRINCIPLED')
    return p.inputs['Base Color'].links[0].from_node.image


def pixels(img, w, h):
    img = img.copy(); img.scale(w, h)
    a = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
    rgb = a[..., :3] * a[..., 3:]  # whatever is see-through in a strip sits on black
    bpy.data.images.remove(img)
    return rgb


px = np.ones((H, W, 4), dtype=np.float32)
px[SWATCH + STRIP:, :, :3] = pixels(base_image(O[SHELL_MESH]), W, SHELL)
px[SWATCH:SWATCH + STRIP, :, :3] = pixels(base_image(O[LOGO]), W, STRIP)
srgb = lambda c: 12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055
sw = W // len(names)
for i, n in enumerate(names):
    px[:SWATCH, i * sw:(i + 1) * sw, :3] = [srgb(c) for c in FLAT[n]]
tex = bpy.data.images.new('helmet_racing', W, H, alpha=False)
tex.pixels[:] = px.ravel()
tex.pack()

for o in meshes:
    layers = o.data.uv_layers
    keep = layers[0].name
    for l in [l.name for l in layers if l.name != keep]: layers.remove(layers[l])
    layers[0].name = 'UVMap'
    uv = layers[0].data
    name = o.data.materials[0].name
    if o.name == SHELL_MESH:
        for l in uv: l.uv.y = l.uv.y * SHELL / H + (SWATCH + STRIP) / H
    elif o.name == LOGO:
        for l in uv: l.uv.y = l.uv.y * STRIP / H + SWATCH / H
    else:
        c = ((names.index(name if name in FLAT else 'Black_Plastic') + .5) * sw / W, .5 * SWATCH / H)
        for l in uv: l.uv = c

report = {}
for o in meshes:
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True); bpy.context.view_layer.objects.active = o
    bpy.ops.mesh.customdata_custom_splitnormals_clear()
    bm = bmesh.new(); bm.from_mesh(o.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bm.to_mesh(o.data); bm.free()
    if o.name in TARGET:
        o.data.calc_loop_triangles()
        ratio = min(1, TARGET[o.name] / len(o.data.loop_triangles))
        mod = o.modifiers.new('d', 'DECIMATE'); mod.decimate_type = 'COLLAPSE'; mod.ratio = ratio; mod.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier='d')
    o.data.calc_loop_triangles(); report[o.name] = len(o.data.loop_triangles)
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(40))

mat = bpy.data.materials.new('helmet_racing'); mat.use_nodes = True
p = mat.node_tree.nodes['Principled BSDF']; p.inputs['Roughness'].default_value = 0.45; p.inputs['Metallic'].default_value = 0
t = mat.node_tree.nodes.new('ShaderNodeTexImage'); t.image = tex
mat.node_tree.links.new(t.outputs['Color'], p.inputs['Base Color'])
visor = bpy.data.materials.new('visor'); visor.use_nodes = True
visor.surface_render_method = 'BLENDED'
p = visor.node_tree.nodes['Principled BSDF']; p.inputs['Base Color'].default_value = (0.02, 0.02, 0.025, 1)
p.inputs['Roughness'].default_value = 0.2; p.inputs['Metallic'].default_value = 0; p.inputs['Alpha'].default_value = VISOR_ALPHA
for o in meshes:
    o.data.materials[0] = visor if o.name == VISOR else mat

main = O[SHELL_MESH]
bpy.ops.object.select_all(action='DESELECT')
for o in meshes: o.select_set(True)
bpy.context.view_layer.objects.active = main
bpy.ops.object.join()
main.name = main.data.name = 'HelmetRacing'

# the head pivot: tipping forward brings the eye opening down over the eyes
PIVOT = Vector((0, 0, 1.25))
seat = Matrix.Translation(PIVOT + Vector((0, FIT_Y, FIT_Z))) @ Matrix.Rotation(math.radians(TILT), 4, "X") @ Matrix.Scale(FIT_SCALE, 4) @ Matrix.Translation(-PIVOT)
main.matrix_world = seat @ Matrix.Translation((0, DY, Z0)) @ Matrix.Rotation(math.pi, 4, "Z") @ Matrix.Scale(SCALE, 4)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
for m in list(bpy.data.materials):
    if m not in (mat, visor): bpy.data.materials.remove(m)
for i in list(bpy.data.images):
    if i != tex: bpy.data.images.remove(i)

bpy.ops.wm.save_as_mainfile(filepath=ROOT + '/3d/HelmetRacing_game.blend')
bpy.ops.export_scene.gltf(filepath=ROOT + '/models/helmet_racing.glb', export_format='GLB', use_selection=False, export_yup=True,
                          export_apply=False, export_animations=False, export_cameras=False, export_lights=False,
                          export_image_format='JPEG', export_jpeg_quality=86)
main.data.calc_loop_triangles()
pts = [v.co for v in main.data.vertices]
result = dict(tris=len(main.data.loop_triangles), parts=report, mats=[m.name for m in main.data.materials], kb=os.path.getsize(ROOT + '/models/helmet_racing.glb') // 1024,
              bounds=[[round(min(p[i] for p in pts), 3), round(max(p[i] for p in pts), 3)] for i in range(3)])
