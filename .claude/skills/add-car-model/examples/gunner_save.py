import bpy, os

HERE = r"C:\Users\striper\AppData\Local\Temp\claude\C--inetpub-wwwroot-test-race\f9447570-77d6-4a29-893a-a8ee8e0a4416\scratchpad"
bpy.ops.wm.open_mainfile(filepath=r"C:\inetpub\wwwroot\test\race\3d\bangul_m_drive.blend")
exec(open(HERE + r"\gunner_pose.py", encoding='utf8').read(), globals())
drive = bpy.data.actions['Drive']
a.animation_data.action = drive
a.animation_data.action_slot = drive.slots[0]
bpy.context.scene.frame_set(1)
bpy.ops.wm.save_mainfile()
out = r"C:\inetpub\wwwroot\test\race\models\bangul_m.glb"
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=False, export_yup=True, export_apply=False, export_animations=True,
                          export_animation_mode='ACTIONS', export_cameras=False, export_lights=False, export_skins=True, export_morph=False)
result = dict(size=os.path.getsize(out) // 1024, actions=[x.name for x in bpy.data.actions])
