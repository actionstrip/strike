import bpy, math, os
import numpy as np
SP = r"C:\Users\striper\AppData\Local\Temp\claude\d7d4a6e2d8e5dcbf\0e92613e-d6c6-4ac0-8af0-8e3e0dbdb254\scratchpad"
arm = bpy.data.objects['Armature']; sc = bpy.context.scene
cam = bpy.data.objects['Cam']
W = 300; H = 300
sc.render.resolution_x = W; sc.render.resolution_y = H
cam.data.type = 'ORTHO'; cam.data.ortho_scale = 0.85


def view(kind):
    if kind == 'side':
        cam.location = (2, 0, 0.38); cam.rotation_euler = (math.radians(90), 0, math.radians(90))
    elif kind == 'front':
        cam.location = (0, -2, 0.38); cam.rotation_euler = (math.radians(90), 0, 0)
    elif kind == 'q':
        cam.location = (1.4, -1.4, 0.9); cam.rotation_euler = (math.radians(70), 0, math.radians(45))


def sheet(clip, kind, n=6):
    act = bpy.data.actions[clip]
    arm.animation_data.action = act
    if hasattr(arm.animation_data, 'action_slot') and act.slots:
        arm.animation_data.action_slot = act.slots[0]
    f0, f1 = act.frame_range
    view(kind)
    tiles = []
    for i in range(n):
        f = f0 + (f1 - f0) * i / n
        sc.frame_set(int(f), subframe=f - int(f))
        p = os.path.join(SP, '_tile.png'); sc.render.filepath = p
        bpy.ops.render.render(write_still=True)
        im = bpy.data.images.load(p, check_existing=False)
        a = np.array(im.pixels[:], dtype=np.float32).reshape(H, W, 4)
        bpy.data.images.remove(im)
        # ground line
        a = a.copy()
        tiles.append(a)
    grid = np.concatenate(tiles, axis=1)
    out = bpy.data.images.new('sheet', grid.shape[1], grid.shape[0], alpha=True)
    out.pixels = grid.ravel()
    out.filepath_raw = os.path.join(SP, f'sheet_{clip}_{kind}.png'); out.file_format = 'PNG'; out.save()
    bpy.data.images.remove(out)
