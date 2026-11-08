import bpy, math
from mathutils import Matrix, Vector, Quaternion

S = 0.98                       # driver scale on the bike
SEAT = Vector((0, 0.34, 0.88))    # the bike's Seat node, in the bike
GRIP = (0.46, -0.21, 1.72)       # wrist on the grip, bike space, x mirrored
PEG = (0.30, 0.25, 0.66)         # ankle above the peg, bike space, x mirrored
HIPS = Vector((0, 0.42, 1.38))    # sitting on the seat, bike space
KNEE = (0.5, -1, 0.35)            # knees go ahead and out, gripping the tank
ELBOW = (1, 0.25, 0.25)           # elbows up and out, as on a dirt bike
LEAN = 9 
HEAD = 0.76                    # the head would dwarf the bike at full size
                      # degrees per spine bone
BOB = 0.008                    # breathing, in armature units
a = bpy.data.objects['Armature']
P = a.pose.bones
n = lambda s: P['mixamorig:' + s]


def to_arm(v):
    return (Vector(v) - SEAT) / S


def sync():
    bpy.context.view_layer.update()


def rotate(pb, axis, deg):
    h = pb.matrix.translation.copy()
    pb.matrix = Matrix.Translation(h) @ Matrix.Rotation(math.radians(deg), 4, axis) @ Matrix.Translation(-h) @ pb.matrix
    sync()


def aim(pb, target):
    h = pb.matrix.translation.copy()
    cur = pb.matrix.to_3x3() @ Vector((0, 1, 0))
    q = cur.normalized().rotation_difference((Vector(target) - h).normalized())
    pb.matrix = Matrix.Translation(h) @ q.to_matrix().to_4x4() @ Matrix.Translation(-h) @ pb.matrix
    sync()


def limb(upper, lower, end, target, bend, slack=1.04):
    """Stretches the limb to reach and places the middle joint toward `bend`."""
    s = upper.matrix.translation.copy()
    target = Vector(target)
    l1 = (lower.matrix.translation - s).length
    l2 = (end.matrix.translation - lower.matrix.translation).length
    d = (target - s).length
    k = max(1.0, d * slack / (l1 + l2))
    upper.scale = (k, k, k)
    end.scale = (1 / k, 1 / k, 1 / k)
    sync()
    l1 *= k
    l2 *= k
    x = (l1 * l1 - l2 * l2 + d * d) / (2 * d)
    h = math.sqrt(max(0.0, l1 * l1 - x * x))
    axis = (target - s).normalized()
    side = (Vector(bend) - axis * Vector(bend).dot(axis)).normalized()
    mid = s + axis * x + side * h
    aim(upper, mid)
    aim(lower, target)
    return round(k, 2)


drive = bpy.data.actions['Drive']
moto = bpy.data.actions.get('Dirt')
a.animation_data.action = drive
a.animation_data.action_slot = drive.slots[0]
if moto:
    bpy.data.actions.remove(moto)
for pb in P:
    pb.location = (0, 0, 0)
    pb.rotation_quaternion = (1, 0, 0, 0)
    pb.scale = (1, 1, 1)
bpy.context.scene.frame_set(2)
bpy.context.scene.frame_set(1)
sync()

hips = n('Hips')
hips_to = to_arm(HIPS)
hips.matrix = Matrix.Translation(hips_to - hips.matrix.translation) @ hips.matrix
sync()
rotate(hips, 'X', 2)
for b in ('Spine', 'Spine1', 'Spine2'):
    rotate(n(b), 'X', LEAN)
rotate(n('Neck'), 'X', -LEAN * 1.5)
rotate(n('Head'), 'X', -LEAN * 2.1)
n('Head').scale = (HEAD, HEAD, HEAD)
sync()
sync()

ks = {}
for side, sgn in (('Left', 1), ('Right', -1)):
    ks[side + 'Arm'] = limb(n(side + 'Arm'), n(side + 'ForeArm'), n(side + 'Hand'), to_arm((GRIP[0] * sgn, GRIP[1], GRIP[2])), (ELBOW[0] * sgn, ELBOW[1], ELBOW[2]))
    ks[side + 'Leg'] = limb(n(side + 'UpLeg'), n(side + 'Leg'), n(side + 'Foot'), to_arm((PEG[0] * sgn, PEG[1], PEG[2])), (KNEE[0] * sgn, KNEE[1], KNEE[2]), 1.16)
    hand = n(side + 'Hand')
    aim(hand, hand.matrix.translation + Vector((sgn * 0.5, -1, -0.25)))

# the feet lie flat on the pegs and point ahead
for side, sgn in (('Left', 1), ('Right', -1)):
    foot = n(side + 'Foot')
    aim(foot, foot.matrix.translation + Vector((sgn * 0.15, -1, -0.3)))

pose = {}
for pb in P:
    pose[pb.name] = (pb.location.copy(), pb.rotation_quaternion.copy(), pb.scale.copy())

moto = bpy.data.actions.new('Dirt')
moto.use_fake_user = True
slot_type = drive.slots[0] if len(drive.slots) else None
a.animation_data.action = moto
if len(moto.slots) == 0:
    moto.slots.new(id_type='OBJECT', name=a.name)
    a.animation_data.action_slot = moto.slots[0]
for frame, bob in ((1, 0), (25, BOB), (49, 0)):
    for pb in P:
        loc, rot, sc = pose[pb.name]
        pb.location = loc
        pb.rotation_quaternion = rot
        pb.scale = sc
        if pb.name == 'mixamorig:Hips':
            pb.location = loc + pb.bone.matrix_local.to_3x3().inverted() @ Vector((0, 0, bob)) / max(pb.scale)
        for prop in ('location', 'rotation_quaternion', 'scale'):
            pb.keyframe_insert(prop, frame=frame, group=pb.name)
bpy.context.scene.frame_set(1)
sync()
joints = {}
for name in ('Hips', 'Spine2', 'Head', 'LeftHand', 'RightHand', 'LeftFoot', 'RightFoot', 'LeftLeg', 'LeftForeArm'):
    pos = n(name).matrix.translation
    joints[name] = [round(x, 3) for x in (SEAT + pos * S)]
result = dict(k=ks, joints=joints, actions=[x.name for x in bpy.data.actions], slot=a.animation_data.action_slot.identifier if a.animation_data.action_slot else None,
              rest_scale=[round(x, 3) for x in n('LeftArm').scale])
