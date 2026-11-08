import bpy, math
from mathutils import Vector

OUT = r"C:\Users\striper\AppData\Local\Temp\claude\C--inetpub-wwwroot-test-race\f9447570-77d6-4a29-893a-a8ee8e0a4416\scratchpad"


def view(name, loc, rot, scale=4.0, target=(0, 0, 0.5), res=(900, 600)):
    scene = bpy.context.scene
    cam = bpy.data.objects.get('_Cam')
    if not cam:
        cam = bpy.data.objects.new('_Cam', bpy.data.cameras.new('_Cam'))
        scene.collection.objects.link(cam)
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = scale
    cam.location = Vector(target) + Vector(loc)
    cam.rotation_euler = rot
    scene.camera = cam
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.display.shading.light = 'STUDIO'
    scene.display.shading.color_type = 'MATERIAL'
    scene.display.shading.show_shadows = False
    scene.display.shading.show_cavity = True
    scene.display.shading.show_object_outline = True
    scene.render.resolution_x, scene.render.resolution_y = res
    scene.render.film_transparent = False
    scene.render.filepath = f"{OUT}\\{name}.png"
    bpy.ops.render.render(write_still=True)


def side(name, scale=4.0, target=(0, 0, 0.5)):
    view(name, (10, 0, 0), (math.pi / 2, 0, math.pi / 2), scale, target)


def front(name, scale=2.0, target=(0, 0, 0.5)):
    view(name, (0, -10, 0), (math.pi / 2, 0, 0), scale, target)


def top(name, scale=4.0, target=(0, 0, 0.5)):
    view(name, (0, 0, 10), (0, 0, 0), scale, target)
