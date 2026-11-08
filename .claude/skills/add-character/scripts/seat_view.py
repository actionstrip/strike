# Side render of a character in a vehicle, in the character's frame: the vehicle's glb is placed so its Seat sits at
# the origin at 1/driverScale, which is how the game puts the driver (Seat child, scaled by driverScale).
#   BLEND   character blend (default 3d/Robot_game.blend)
#   CARS    comma list of car ids from cars.py
#   CLIP    action to pose (default: the car's own `<clip>.<car>` if the blend has it, else the car's clip)
#   SOLO=1  hide the vehicle (the pose alone)   OPAQUE=1  solid vehicle (what pokes out)   OTHER=1  from the right
#   SCALE   ortho width (default 4.5)            OUT       output folder (default: next to this script)
# Writes seat_<car>[_solo][_op][_r].png.
import bpy, math, os
from mathutils import Matrix, Vector

HERE = r"C:\inetpub\wwwroot\test\race\.claude\skills\add-character\scripts"
exec(open(os.path.join(HERE, 'cars.py'), encoding='utf8').read())
BLEND = os.environ.get('BLEND', r"C:\inetpub\wwwroot\test\race\3d\Robot_game.blend")
OUT = os.environ.get('OUT') or os.path.dirname(os.path.abspath(BLEND))
solo, opaque, other = (os.environ.get(k) == '1' for k in ('SOLO', 'OPAQUE', 'OTHER'))
result = {}
for car in os.environ.get('CARS', 'racer').split(','):
    file, scale, clip = CARS[car]
    bpy.ops.wm.open_mainfile(filepath=BLEND)
    arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
    name = os.environ.get('CLIP') or (f'{clip}.{car}' if f'{clip}.{car}' in bpy.data.actions else clip)
    arm.animation_data.action = bpy.data.actions[name]
    arm.animation_data.action_slot = arm.animation_data.action.slots[0]
    bpy.context.scene.frame_set(1)
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(MODELS, file))
    new = [o for o in bpy.data.objects if o not in before]
    seat = next(o for o in new if o.name.split('.')[0] == 'Seat')
    to_char = (seat.matrix_world @ Matrix.Scale(scale, 4)).inverted()
    for o in new:
        if o.parent is None:
            o.matrix_world = to_char @ o.matrix_world
    for o in new:
        if o.type != 'MESH':
            continue
        o.hide_render = solo
        for slot in o.material_slots:
            if slot.material:
                slot.material.diffuse_color = (0.6, 0.7, 0.9, 1 if opaque else 0.25)
    scene = bpy.context.scene
    cam = bpy.data.objects.new('_Cam', bpy.data.cameras.new('_Cam'))
    scene.collection.objects.link(cam)
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = float(os.environ.get('SCALE', '4.5'))
    scene.camera = cam
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.display.shading.light = 'STUDIO'
    scene.display.shading.color_type = 'MATERIAL'
    scene.display.shading.show_xray = not (solo or opaque)
    scene.display.shading.xray_alpha = 0.6
    scene.display.shading.show_object_outline = True
    scene.render.resolution_x, scene.render.resolution_y = 900, 700
    # the character faces -Y; from +X it faces left in the picture
    side = -1 if other else 1
    cam.location = Vector((10 * side, -0.3, 1.0))
    cam.rotation_euler = (math.pi / 2, 0, math.pi / 2 * side)
    tag = ('_solo' if solo else '') + ('_op' if opaque else '') + ('_r' if other else '')
    scene.render.filepath = os.path.join(OUT, f'seat_{car}{tag}.png')
    bpy.ops.render.render(write_still=True)
    result[car] = {'clip': name, 'png': scene.render.filepath}
