# Renders $BLEND from the sides into $PREFIX_*.png. Run it through blrun.py.
# $VIEW_SCALE is the width of a side view in scene units, $VIEW_MODE is TEXTURE (flat, shows the texture)
# or MATERIAL (lit, shows the shape and, with the colors below, which material each face has).
# $VIEW_Z is the height the camera looks at.
import bpy, math, os
from mathutils import Vector

bpy.ops.wm.open_mainfile(filepath=os.environ['BLEND'])
PREFIX = os.environ['PREFIX']
SCALE = float(os.environ.get('VIEW_SCALE', 6.2))
MODE = os.environ.get('VIEW_MODE', 'TEXTURE')
Z = float(os.environ.get('VIEW_Z', 1.2))

O = bpy.data.objects
scene = bpy.context.scene
cam = O.new('_Cam', bpy.data.cameras.new('_Cam'))
scene.collection.objects.link(cam)

SLOT_COLORS = {'body': (0.8, 0.1, 0.1), 'Livery Colour 2': (0.1, 0.6, 0.9), 'rims': (0.9, 0.8, 0.1), 'tyre type colour': (0.2, 0.8, 0.3), 'glass': (0.6, 0.2, 0.9)}
if MODE == 'MATERIAL':
    for m in bpy.data.materials:
        m.diffuse_color = (*SLOT_COLORS.get(m.name, (0.5, 0.5, 0.5)), 1)
else:
    # the workbench shows the active image node
    for m in bpy.data.materials:
        if not m.node_tree:
            continue
        for n in m.node_tree.nodes:
            if n.type != 'TEX_IMAGE':
                continue
            for l in n.outputs['Color'].links:
                if l.to_socket.name == 'Base Color':
                    m.node_tree.nodes.active = n


def shot(name, loc, rot, scale):
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = scale
    cam.location = Vector((0, 0, Z)) + Vector(loc) * SCALE
    cam.rotation_euler = rot
    scene.camera = cam
    scene.render.engine = 'BLENDER_WORKBENCH'
    s = scene.display.shading
    s.light = 'FLAT' if MODE == 'TEXTURE' else 'STUDIO'
    s.color_type = MODE
    s.show_shadows = False
    s.show_cavity = False
    s.show_object_outline = False
    scene.render.resolution_x, scene.render.resolution_y = (1000, 620)
    scene.render.filepath = PREFIX + '_' + name + '.png'
    bpy.ops.render.render(write_still=True)


deg = math.radians
shot('left', (2, 0, 0), (deg(90), 0, deg(90)), SCALE)
shot('right', (-2, 0, 0), (deg(90), 0, deg(-90)), SCALE)
shot('front', (0, -2, 0), (deg(90), 0, 0), SCALE * 0.55)
shot('back', (0, 2, 0), (deg(90), 0, deg(180)), SCALE * 0.55)
shot('top', (0, 0, 2), (0, 0, 0), SCALE)
shot('front_q', (1.3, -1.3, 1), (deg(62), 0, deg(45)), SCALE * 1.05)
shot('back_q', (-1.3, 1.3, 1), (deg(62), 0, deg(225)), SCALE * 1.05)
result = dict(written=PREFIX + '_*.png')
