# Builds the Robot driver: robot_rk11 mesh skinned to Bangul's Mixamo armature, every clip kept.
# Each bone keeps Bangul's rest orientation (so each clip turns it by the same angles); only its head moves to the
# robot's joint. The robot stands with its arms down, so its arm parts are turned up into the T pose first.
# Every loose part follows exactly one bone (rigid), so the hard-surface parts don't bend like rubber.
import bpy, bmesh, math, os
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree
from bpy_extras import anim_utils

SRC = r"C:\inetpub\wwwroot\test\race\3d\robot_rk11.glb"
RIG = r"C:\inetpub\wwwroot\test\race\3d\bangul_m_drive.blend"
BLEND_OUT = r"C:\inetpub\wwwroot\test\race\3d\Robot_game.blend"
GLB_OUT = r"C:\inetpub\wwwroot\test\race\models\robot.glb"
TRIS = int(os.environ.get('ROBOT_TRIS', 8000))
TEX = int(os.environ.get('ROBOT_TEX', 1024))
# The game's clips (CARS rides). Bangul is a chibi: big head, short limbs, and the bike clips stretch its arms and legs
# (bone scale up to 3.6) and shrink its head to reach the bars and pegs. The robot gets its own copy of each clip:
# Bangul's hips and spine angles, no stretching, a size that makes it about as tall as Bangul seated, and arms (and on
# bikes legs) solved to reach the same hand and foot points: the wheel, the bars, the pegs, the gun grips.
CLIPS = ['Drive', 'Cruiser', 'Moto', 'Dirt', 'Quad', 'Gunner']  # Cruiser before the bikes that copy its back
# bikes whose bars sit below the head ride with the Cruiser's back, neck and head (the user's pick of a good pose)
UPRIGHT = {'Moto', 'Dirt', 'Quad'}
# Bangul sat sunk into the bikes; the robot's hips go up onto each seat (and on Moto back off the tank onto its seat).
# Blender units, measured in the game: first up to the seat under the robot's lowest hip point, then down again by
# the gap left under the back of the hips (the thighs tilt, so only their front had touched and the robot looked
# perched on the seat's front edge)
HIP_SHIFT = {'Moto': (0, 0.21, 0.38), 'Cruiser': (0, 0, 0.0), 'Dirt': (0, 0, 0.11), 'Quad': (0, 0, 0.02)}
BACK = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head']
# robot head height above the hips as a share of Bangul's in the same clip. Lower on the bikes: the robot is long and
# thin, so at Bangul's height it towers over the bike (Bangul half stands in Dirt)
# robot height above the hips, times Bangul's: about 1.5 times the first robot (0.85 cars and Moto, 0.75 Cruiser and
# Quad, 0.6 Dirt). Drive stops at what the lowest roof allows (Senna: 0.99 above the seat, robot 0.95); Gunner was
# already right. Drive then grew 1.2 times more on request (each car's clip sits lower in its seat). Moto stops at 1.2 times: bigger, its shins come out under the bike to reach the pegs.
HEIGHT = {'Drive': 1.39, 'Moto': 1.02, 'Gunner': 0.85, 'Cruiser': 1.13, 'Quad': 1.13, 'Dirt': 0.9}
# car footwells: the legs go this much lower than Bangul's (nearly level) legs, under the wheel
LEG_DROP = 0.45
MAX_LEAN = 40  # degrees the spine may lean toward bars the arms can't reach
MAX_BACK = 30  # degrees it may sit up to keep its face off the bars
FACE_CLEAR = 1.6  # the head stays this many upper-arm lengths from the hands (not on the gun, where it aims)
# the robot is thin next to Bangul; its parts grow this much across their bones (1.4 is about twice the volume)
BULK = {'Hand': 1.3, 'Foot': 1.3}
BULK_DEFAULT = 1.4
BULK_HEAD = 1.3
# which way elbows and knees point (armature space: -Y is the robot's front, +X its left), before Bangul's limb is
# considered at all. Bangul's arms are nearly straight in most clips, so its bend gives no usable direction
ELBOW_POINTS = Vector((0.5, 0.6, -1))  # out, back and down (x is mirrored for the right arm)
KNEE_POINTS = Vector((0, -1, 0.4))     # forward and a little up
# clips whose feet rest on pegs; elsewhere (car footwells, the turret) the legs reach along Bangul's leg line instead
PEG_FEET = {'Moto', 'Cruiser', 'Dirt', 'Quad'}
# Cars get a Drive clip each (`Drive.<car id>`; the game plays it in that car), fitted to its seat read from the car's
# glb: the back leans like the seatback and rests on it, the hips sit on the cushion, the head looks ahead like the
# Cruiser's, the hands hold the car's wheel. File and driverScale as in CARS.
MODELS = r"C:\inetpub\wwwroot\test\race\models"
DRIVE_CARS = {'f1': ('f1.glb', 0.4), 'racer': ('racer.glb', 0.4), 'corsa': ('stradale.glb', 0.4),
              'barchetta': ('barchetta.glb', 0.4), 'cuneo': ('cuneo.glb', 0.3), 'vortex': ('vortex.glb', 0.3),
              'senna': ('senna.glb', 0.4), 'pony': ('pony.glb', 0.4), 'scout': ('scout.glb', 0.5)}
RECLINE = (5, 45)  # degrees from upright the back may follow a seatback
# the hands grip each car's Steering rim (see car_seat), not Bangul's hands, which are the same in every car
# how much bigger than the shared size the robot sits in some cars (user's request); Titan gets its own Gunner clip
CAR_SIZE = {'barchetta': 1.2, 'cuneo': 1.4, 'vortex': 1.2, 'titan': 1.4}
GUNNER_CARS = ['titan']
# seats the rays misread: Cuneo's racing tub rises in a long ramp to a short upright top, which is all the rays see.
# These lie back at the given angle and sit down where Bangul sat, without sliding back up the ramp.
RECLINE_FIX = {'cuneo': 45}
OPEN_TOP = {'f1'}  # the head is meant to stand out of the cockpit (above it is only the air intake behind)
ROOF_GAP = 0.04    # head clearance under a roof, in torso lengths; the robot shrinks in that car to keep it

# robot joints in the source model's units (Z up, faces -Y, its left side at +X); right side mirrors x
HIPS = Vector((0, 0, 8.3))
J = {
    'UpLeg': Vector((1.3, -0.2, 8.0)),
    'Leg': Vector((1.28, 0.23, 3.93)),
    'Foot': Vector((1.27, 0.3, 1.1)),
    'Toe': Vector((1.25, -0.9, 0.25)),
    'Shoulder': Vector((0.4, 0.55, 11.95)),
    'Arm': Vector((1.5, 0.65, 11.95)),
    'ForeArm': Vector((2.25, 1.05, 9.25)),
    'Hand': Vector((2.9, 0.15, 6.95)),
    'HandEnd': Vector((2.9, -0.4, 5.6)),
}
SPINE = [('Spine', Vector((0, 0.1, 9.0))), ('Spine1', Vector((0, 0.15, 9.9))), ('Spine2', Vector((0, 0.2, 10.8))),
         ('Neck', Vector((0, 0.45, 12.4))), ('Head', Vector((0, 0.35, 13.1)))]
SCALE = 0.4 / HIPS.z  # Bangul's hips stand 0.4 high, so clip hip moves fit

result = {}

# --- rig: Bangul's armature and actions, no Bangul meshes ---
bpy.ops.wm.open_mainfile(filepath=RIG)
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
scene = bpy.context.scene


def use_action(obj, act):
    obj.animation_data_create()
    obj.animation_data.action = act
    if act is not None:
        obj.animation_data.action_slot = act.slots[0]


# how high Bangul's head reaches above the hips in each clip (its mesh, with the clip's shrunken head)
bangul_meshes = [o for o in bpy.data.objects if o.type == 'MESH']
bangul_top = {}
for name in CLIPS:
    use_action(arm, bpy.data.actions[name])
    scene.frame_set(1)
    dg = bpy.context.evaluated_depsgraph_get()
    top = max((o.matrix_world @ v.co).z for o in bangul_meshes for v in o.evaluated_get(dg).to_mesh().vertices)
    bangul_top[name] = top - (arm.matrix_world @ arm.pose.bones['mixamorig:Hips'].head).z
result['bangul_top'] = {k: round(v, 3) for k, v in bangul_top.items()}

# Bangul's own skeleton stays as the reference the robot's clips are measured from
ref = arm.copy()
ref.data = arm.data.copy()
ref.name = '_BangulRef'
scene.collection.objects.link(ref)
for o in list(bpy.data.objects):
    if o not in (arm, ref):
        bpy.data.objects.remove(o, do_unlink=True)
for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.cameras, bpy.data.lights):
    for d in list(coll):
        if d.users == 0:
            coll.remove(d)
# clips the game doesn't use
for a in list(bpy.data.actions):
    if a.name not in CLIPS:
        bpy.data.actions.remove(a)

# --- robot mesh ---
before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=SRC)
new = [o for o in bpy.data.objects if o not in before]
robot = next(o for o in new if o.type == 'MESH')
mw = robot.matrix_world.copy()
robot.parent = None
robot.matrix_world = mw
for o in new:
    if o != robot:
        bpy.data.objects.remove(o, do_unlink=True)
robot.data.transform(robot.matrix_world)
robot.matrix_world.identity()
robot.name = robot.data.name = 'robot'

bm = bmesh.new()
bm.from_mesh(robot.data)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.002)
bm.verts.ensure_lookup_table()

# loose parts
part_of = [-1] * len(bm.verts)
parts = []
for v in bm.verts:
    if part_of[v.index] >= 0:
        continue
    pid = len(parts)
    ids = [v.index]
    part_of[v.index] = pid
    stack = [v]
    while stack:
        x = stack.pop()
        for e in x.link_edges:
            y = e.other_vert(x)
            if part_of[y.index] < 0:
                part_of[y.index] = pid
                ids.append(y.index)
                stack.append(y)
    parts.append(ids)


def mirror(p, side):
    return Vector((p.x if side == 'Left' else -p.x, p.y, p.z))


# bone segments in the source pose, for picking each part's bone
segs = {'Hips': [(Vector((0, 0, 7.6)), HIPS)]}
chain = [HIPS] + [p for _, p in SPINE] + [Vector((0, 0.3, 14.5))]
for (name, _), a, b in zip(SPINE, chain[1:], chain[2:]):
    segs[name] = [(a, b)]
segs['Spine'] = [(HIPS, SPINE[1][1])]
for side in ('Left', 'Right'):
    m = lambda k: mirror(J[k], side)
    segs[side + 'UpLeg'] = [(m('UpLeg'), m('Leg'))]
    # the shin bends back behind the knee before it comes down to the ankle
    segs[side + 'Leg'] = [(m('Leg'), mirror(Vector((1.2, 1.6, 3.6)), side)), (mirror(Vector((1.2, 1.6, 3.6)), side), m('Foot'))]
    segs[side + 'Foot'] = [(m('Foot'), m('Toe'))]
    segs[side + 'Arm'] = [(m('Arm'), m('ForeArm'))]
    segs[side + 'ForeArm'] = [(m('ForeArm'), m('Hand'))]
    segs[side + 'Hand'] = [(m('Hand'), m('HandEnd'))]


def seg_dist(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))
    return (a + ab * t - p).length


bone_of_part = []
for ids in parts:
    c = sum((bm.verts[i].co for i in ids), Vector()) / len(ids)
    best = min(segs, key=lambda n: min(seg_dist(c, a, b) for a, b in segs[n]))
    bone_of_part.append(best)

# --- bulk: the robot is thin next to Bangul, so each part grows across its bone (not along it, so joints still meet) ---
def line_point(p, a, b):
    ab = b - a
    return a + ab * ((p - a).dot(ab) / ab.length_squared)


for pid, ids in enumerate(parts):
    bone = bone_of_part[pid]
    short = bone.replace('Left', '').replace('Right', '')
    for i in ids:
        v = bm.verts[i].co
        if short == 'Head':
            base = SPINE[-1][1]  # the head grows up from where it sits on the neck
            bm.verts[i].co = base + (v - base) * BULK_HEAD
            continue
        k = BULK.get(short, BULK_DEFAULT)
        a, b = min(segs[bone], key=lambda s: seg_dist(v, *s))
        c = line_point(v, a, b)
        bm.verts[i].co = c + (v - c) * k

# --- T pose the arms: turn upper arm, forearm and hand in turn onto Bangul's bone directions ---
rest = {b.name: (b.head_local.copy(), b.tail_local.copy()) for b in arm.data.bones}
dir_of = lambda n: (rest['mixamorig:' + n][1] - rest['mixamorig:' + n][0]).normalized()
new_joint = {}
for side in ('Left', 'Right'):
    m = lambda k: mirror(J[k], side)
    sh, el, wr, end = m('Arm'), m('ForeArm'), m('Hand'), m('HandEnd')
    r1 = (el - sh).rotation_difference(dir_of(side + 'Arm'))
    el1 = sh + r1 @ (el - sh)
    r2 = (r1 @ (wr - el)).rotation_difference(dir_of(side + 'ForeArm'))
    wr1 = el1 + r2 @ (r1 @ (wr - el))
    r3 = (r2 @ r1 @ (end - wr)).rotation_difference(dir_of(side + 'Hand'))
    new_joint[side + 'ForeArm'] = el1
    new_joint[side + 'Hand'] = wr1
    moves = {
        side + 'Arm': lambda p: sh + r1 @ (p - sh),
        side + 'ForeArm': lambda p: el1 + r2 @ (r1 @ (p - el)),
        side + 'Hand': lambda p: wr1 + r3 @ (r2 @ (r1 @ (p - wr))),
    }
    for pid, ids in enumerate(parts):
        f = moves.get(bone_of_part[pid])
        if f:
            for i in ids:
                bm.verts[i].co = f(bm.verts[i].co)

bm.normal_update()
bm.to_mesh(robot.data)
bm.free()

# vertex groups, one bone per part
groups = {}
for pid, ids in enumerate(parts):
    name = 'mixamorig:' + bone_of_part[pid]
    g = groups.get(name) or robot.vertex_groups.new(name=name)
    groups[name] = g
    g.add(ids, 1.0, 'REPLACE')
result['parts_per_bone'] = {n: sum(1 for b in bone_of_part if 'mixamorig:' + b == n) for n in groups}

# --- move the bone heads to the robot's joints, keeping Bangul's directions and rolls ---
head_src = {'Hips': HIPS, **{n: p for n, p in SPINE}}
for side in ('Left', 'Right'):
    for k in ('UpLeg', 'Leg', 'Foot', 'Shoulder', 'Arm'):
        head_src[side + k] = mirror(J[k], side)
    head_src[side + 'ToeBase'] = mirror(J['Toe'], side)
    head_src[side + 'ForeArm'] = new_joint[side + 'ForeArm']
    head_src[side + 'Hand'] = new_joint[side + 'Hand']
next_of = {'Hips': 'Spine', 'Spine': 'Spine1', 'Spine1': 'Spine2', 'Spine2': 'Neck', 'Neck': 'Head'}
for side in ('Left', 'Right'):
    next_of.update({side + 'UpLeg': side + 'Leg', side + 'Leg': side + 'Foot', side + 'Foot': side + 'ToeBase',
                    side + 'Shoulder': side + 'Arm', side + 'Arm': side + 'ForeArm', side + 'ForeArm': side + 'Hand'})

bpy.context.view_layer.objects.active = arm
arm.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
eb = arm.data.edit_bones
for b in eb:
    b.use_connect = False
old = {b.name: (b.head.copy(), b.tail.copy(), b.roll) for b in eb}
moved = {}
for short, p in head_src.items():
    name = 'mixamorig:' + short
    h0, t0, roll = old[name]
    d = (t0 - h0).normalized()
    head = p * SCALE
    length = (head_src[next_of[short]] * SCALE - head).length if short in next_of else (t0 - h0).length * 0.6
    eb[name].head = head
    eb[name].tail = head + d * max(length, 0.02)
    eb[name].roll = roll
    moved[name] = head - h0
# bones without a robot joint (fingers, toe and head ends) follow their parent's move
for b in eb:
    if b.name in moved:
        continue
    p = b.parent
    while p and p.name not in moved:
        p = p.parent
    off = moved[p.name] if p else Vector()
    h0, t0, roll = old[b.name]
    b.head, b.tail, b.roll = h0 + off, t0 + off, roll
bpy.ops.object.mode_set(mode='OBJECT')

robot.data.transform(Matrix.Scale(SCALE, 4))
robot.parent = arm
mod = robot.modifiers.new('Armature', 'ARMATURE')
mod.object = arm

# --- fewer triangles (vertex groups survive) ---
dec = robot.modifiers.new('Decimate', 'DECIMATE')
tris0 = sum(len(p.vertices) - 2 for p in robot.data.polygons)
dec.ratio = min(1.0, TRIS / tris0)
bpy.context.view_layer.objects.active = robot
robot.modifiers.move(1, 0)
bpy.ops.object.modifier_apply(modifier='Decimate')
for p in robot.data.polygons:
    p.use_smooth = True
result['tris'] = (tris0, sum(len(p.vertices) - 2 for p in robot.data.polygons))

# --- one plain material: base color only, smaller texture, low metal (no environment map in game) ---
mat = robot.data.materials[0]
mat.name = 'robot'
nt = mat.node_tree
bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
base = next(l.from_node for l in nt.links if l.to_socket == bsdf.inputs['Base Color'])
for n in list(nt.nodes):
    if n not in (bsdf, base) and n.type != 'OUTPUT_MATERIAL':
        nt.nodes.remove(n)
bsdf.inputs['Metallic'].default_value = 0.15
bsdf.inputs['Roughness'].default_value = 0.6
img = base.image
img.scale(TEX, TEX)
img.name = 'robot'
img.file_format = 'JPEG'
for i in list(bpy.data.images):
    if i != img and i.users == 0:
        bpy.data.images.remove(i)

# --- the robot's own clips ---
P = arm.pose.bones
R = ref.pose.bones
B = lambda n: 'mixamorig:' + n
use_action(arm, None)
vl = bpy.context.view_layer


def basis(y, f):
    """Rotation whose Y axis is `y` and whose X axis is `f` made square to it."""
    y = y.normalized()
    x = (f - y * f.dot(y)).normalized()
    return Matrix((x, y, x.cross(y))).transposed()


def set_bone(pb, y, hinge, rest_hinge):
    """Points a posed bone along `y` (armature space) with its rest hinge axis turned onto `hinge`."""
    rest = pb.bone.matrix_local.to_3x3().normalized()
    turn = basis(y, hinge) @ basis(rest.col[1], rest_hinge).transposed()
    loc, _, scale = pb.matrix.decompose()
    pb.matrix = Matrix.LocRotScale(loc, (turn @ rest).to_quaternion(), scale)
    vl.update()


def two_bone(upper, lower, end, target, points, flex):
    """
    Puts the end of upper+lower at `target` like a hinge: the joint points along `points` and the lower bone folds
    toward `flex` (the way the robot's elbow or knee folds from its rest pose). The end keeps its rest angle.
    """
    s = P[B(upper)].head.copy()
    l1 = (P[B(lower)].head - s).length
    l2 = (P[B(end)].head - P[B(lower)].head).length
    to = target - s
    d = min(to.length, (l1 + l2) * 0.999)
    axis = to.normalized()
    bend = points - axis * points.dot(axis)
    if bend.length < 1e-4:
        bend = axis.orthogonal()
    bend.normalize()
    a = (l1 * l1 - l2 * l2 + d * d) / (2 * d)
    h = max(l1 * l1 - a * a, 0) ** 0.5
    joint = s + axis * a + bend * h
    hinge = bend.cross(axis).normalized()
    rest_hinge = P[B(upper)].bone.matrix_local.col[1].xyz.normalized().cross(flex).normalized()
    set_bone(P[B(upper)], joint - s, hinge, rest_hinge)
    set_bone(P[B(lower)], s + axis * d - joint, hinge, rest_hinge)
    P[B(end)].rotation_quaternion = (1, 0, 0, 0)
    vl.update()


def chain_length(names):
    return sum((P[B(b)].head - P[B(a)].head).length for a, b in zip(names, names[1:]))


def robot_top():
    dg = bpy.context.evaluated_depsgraph_get()
    return max(v.co.z for v in robot.evaluated_get(dg).to_mesh().vertices) - P[B('Hips')].head.z


hand_goal = {}  # a car's wheel rim, where each hand grips it (armature space); empty: Bangul's hands


def hand_target(side):
    """Where the wrist goes: Bangul's, or a little short of the car's rim toward the shoulder (the hand holds it)."""
    if side not in hand_goal:
        return R[B(side + 'Hand')].head.copy()
    grip = hand_goal[side]
    forearm = (P[B(side + 'Hand')].head - P[B(side + 'ForeArm')].head).length
    return grip + (P[B(side + 'Arm')].head - grip).normalized() * 0.3 * forearm


def reach_gap():
    """How far the farther hand target lies beyond the robot's arm (negative when both are in reach)."""
    gap = -1e9
    for side in ('Left', 'Right'):
        arm_len = chain_length([side + 'Arm', side + 'ForeArm', side + 'Hand']) * 0.97
        gap = max(gap, (hand_target(side) - P[B(side + 'Arm')].head).length - arm_len)
    return gap


leaned = {}
clearance = {}


def face_clear():
    """
    Distance from the base of the head to the middle of the hand targets, in upper-arm lengths. (The head bone's
    tail is no help: it keeps Bangul's long head bone.)
    """
    hands = (R[B('LeftHand')].head + R[B('RightHand')].head) / 2
    return (P[B('Head')].head - hands).length / (P[B('LeftForeArm')].head - P[B('LeftArm')].head).length


def lean(name):
    """
    Tilts the spine from Bangul's angle as little as it can so the hands reach the bars (Bangul stretched its arms
    instead) and the face stays off them: forward up to MAX_LEAN, back up to MAX_BACK.
    """
    pb = P[B('Spine')]
    base = pb.matrix.copy()
    pivot = base.translation.copy()
    # the gunner aims down the gun; the upright bikes keep the Cruiser's back, which already clears the bars
    need_clear = 0 if name == 'Gunner' or name in UPRIGHT else FACE_CLEAR

    def tilt(deg):
        pb.matrix = Matrix.Translation(pivot) @ Matrix.Rotation(math.radians(deg), 4, 'X') @ Matrix.Translation(-pivot) @ base
        vl.update()
        return reach_gap(), face_clear()

    forward = 1 if tilt(3)[1] < tilt(-3)[1] else -1
    best = None
    for deg in sorted(range(-MAX_BACK, MAX_LEAN + 1, 2), key=abs):
        gap, clear = tilt(deg * forward)
        score = min(-gap * 10, clear - need_clear)
        if score >= 0:
            best = (score, deg)
            break
        if best is None or score > best[0]:
            best = (score, deg)
    gap, clear = tilt(best[1] * forward)
    lo, hi = leaned.get(name, (0, 0))
    leaned[name] = (min(lo, best[1]), max(hi, best[1]))
    clearance[name] = round(min(clearance.get(name, 99), clear), 2)


cruiser_back = {}


def look_ahead():
    """Neck and head as the robot stands in its rest pose: straight up, looking ahead."""
    for n in ('Neck', 'Head'):
        pb = P[B(n)]
        loc, _, scale = pb.matrix.decompose()
        pb.matrix = Matrix.LocRotScale(loc, pb.bone.matrix_local.to_quaternion(), scale)
        vl.update()


def upright(bones=BACK):
    """Turns the back, neck and head to the Cruiser's first frame, keeping where each bone sits."""
    for n in bones:
        pb = P[B(n)]
        loc, _, scale = pb.matrix.decompose()
        pb.matrix = Matrix.LocRotScale(loc, cruiser_back[n], scale)
        vl.update()


# --- each car's seat, in the robot's frame (Seat-local, divided by the car's driverScale; Blender axes) ---
def car_seat(file, scale):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(MODELS, file))
    new = [o for o in bpy.data.objects if o not in before]
    seat = next(o for o in new if o.name.split('.')[0] == 'Seat')
    to_robot = (seat.matrix_world @ Matrix.Scale(scale, 4)).inverted()
    dg = bpy.context.evaluated_depsgraph_get()
    verts, polys = [], []
    for o in new:
        if o.type != 'MESH':
            continue
        m = o.evaluated_get(dg).to_mesh()
        mw = to_robot @ o.matrix_world
        base = len(verts)
        verts += [mw @ v.co for v in m.vertices]
        polys += [[base + i for i in p.vertices] for p in m.polygons]
    # the wheel rim at a quarter to three: its outer thirds on each side, around the middle height
    wheel = next(o for o in new if o.name.split('.')[0] == 'Steering')
    rim = [to_robot @ o.matrix_world @ v.co for o in [wheel] + list(wheel.children_recursive) if o.type == 'MESH'
           for v in o.data.vertices]
    lo = Vector([min(p[i] for p in rim) for i in range(3)])
    hi = Vector([max(p[i] for p in rim) for i in range(3)])
    mid, half = (lo + hi) / 2, (hi - lo) / 2
    grips = {}
    for side, out in (('Left', 1), ('Right', -1)):
        part = [p for p in rim if (p.x - mid.x) * out > 0.6 * half.x and mid.z < p.z < mid.z + 0.5 * half.z]
        grips[side] = sum(part, Vector()) / len(part)
    for o in new:
        bpy.data.objects.remove(o, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.armatures, bpy.data.actions):
        for d in list(coll):
            if d.users == 0:
                coll.remove(d)
    return BVHTree.FromPolygons(verts, polys), grips


seats, wheel_grips = {}, {}
for car, spec in DRIVE_CARS.items():
    seats[car], wheel_grips[car] = car_seat(*spec)
A3 = arm.matrix_world.to_3x3()
UP, BACKWARD = Vector((0, 0, 1)), Vector((0, 1, 0))  # the robot faces -Y


def wpos(name):
    return arm.matrix_world @ P[B(name)].head


def group_verts(names):
    dg = bpy.context.evaluated_depsgraph_get()
    m = robot.evaluated_get(dg).to_mesh()
    idx = {robot.vertex_groups[B(n)].index for n in names}
    mw = robot.matrix_world
    return [mw @ v.co for v in m.vertices if any(g.group in idx and g.weight > 0.5 for g in v.groups)]


def torso():
    return (wpos('Neck') - wpos('Hips')).length


def seatback_dir(bvh):
    """Upward direction of the seatback behind the robot, from rays cast back at several heights."""
    hip, t = wpos('Hips'), torso()
    pts = []
    for k in range(3, 12):
        hit = bvh.ray_cast(Vector((0, hip.y - 0.35 * t, hip.z + t * k / 12)), BACKWARD, 2 * t)[0]
        if hit:
            pts.append(hit)
    if len(pts) < 3:
        return None, len(pts)
    mz = sum(p.z for p in pts) / len(pts)
    my = sum(p.y for p in pts) / len(pts)
    slope = sum((p.z - mz) * (p.y - my) for p in pts) / max(sum((p.z - mz) ** 2 for p in pts), 1e-9)
    deg = max(RECLINE[0], min(RECLINE[1], math.degrees(math.atan(slope))))
    return Vector((0, math.sin(math.radians(deg)), math.cos(math.radians(deg)))), len(pts)


def tilt_spine(angle):
    """Turns the spine (and all above it) about the robot's left-right axis by `angle` radians."""
    pb = P[B('Spine')]
    base = pb.matrix.copy()
    pivot = base.translation.copy()
    axis = (A3.inverted() @ Vector((1, 0, 0))).normalized()
    pb.matrix = Matrix.Translation(pivot) @ Matrix.Rotation(angle, 4, axis) @ Matrix.Translation(-pivot) @ base
    vl.update()


def back_angle_to(direction):
    v = wpos('Neck') - wpos('Spine')
    v.x = 0
    return math.atan2(v.cross(direction).x, v.dot(direction))


def shift_hips(move):
    hips = P[B('Hips')]
    hips.matrix = Matrix.Translation(arm.matrix_world.inverted().to_3x3() @ move) @ hips.matrix
    vl.update()


def low_end(values):
    """A near-minimum that ignores the odd stray ray."""
    values = sorted(values)
    return values[len(values) // 20] if values else None


def settle(bvh, lean_back=True):
    """
    Moves the robot down onto the cushion and back onto the seatback; returns the move (world). Rays start inside the
    robot (the hip joints' height, a little in front of the back), never from where the wheel or dash could be.
    """
    total = Vector()
    for _ in range(4):
        t = torso()
        thigh = (wpos('LeftLeg') - wpos('LeftUpLeg')).length
        joints = (wpos('LeftUpLeg'), wpos('RightUpLeg'))
        top = wpos('Hips').z + 0.05 * t
        down = []
        for p in group_verts(['Hips', 'LeftUpLeg', 'RightUpLeg']):
            if min((p - j).length for j in joints) > 0.45 * thigh:
                continue
            start = Vector((p.x, p.y, max(p.z, top)))
            hit, normal = bvh.ray_cast(start, -UP, t)[:2]
            # only the cushion: a hip vertex below the sloping seatback is for the back rays to sort out
            if hit and abs(normal.z) > 0.7:
                down.append(p.z - hit.z)
        back = []
        for p in group_verts(['Spine', 'Spine1', 'Spine2']):
            hit = bvh.ray_cast(p - BACKWARD * 0.15 * t, BACKWARD, t)[0]
            if hit:
                back.append(hit.y - p.y)
        dz = -max(-0.3 * t, min(0.3 * t, low_end(down))) if down else 0
        dy = max(-0.3 * t, min(0.3 * t, low_end(back))) if back and lean_back else 0
        move = Vector((0, dy, dz))
        shift_hips(move)
        total += move
        if move.length < 0.005 * t:
            break
    return total


def pelvis_gap(bvh):
    """Gap behind the pelvis to the seatback, in torso lengths (None when nothing is behind it)."""
    t = torso()
    gaps = []
    # the upper back of the pelvis: lower down, a bucket seat curves into the cushion and always touches
    for p in group_verts(['Hips']):
        if p.z < wpos('Hips').z:
            continue
        hit = bvh.ray_cast(p - BACKWARD * 0.15 * t, BACKWARD, t)[0]
        if hit:
            gaps.append(hit.y - p.y)
    return low_end(gaps) / t if gaps else None


def sit_back(bvh, car):
    """Sits up a little at a time while the pelvis is off the seatback, so the hips go back into the seat instead of
    the robot lying back with its hips slid forward. Returns the added (forward) tilt."""
    added = 0.0
    for _ in range(8):
        gap = pelvis_gap(bvh)
        if gap is None or gap < 0.05:
            break
        tilt_spine(math.radians(3))
        look_ahead()
        added += math.radians(3)
        settle(bvh, car not in RECLINE_FIX)
    return added


def head_top():
    zs = sorted(group_verts(['Head']), key=lambda p: p.z)
    return zs[int(len(zs) * 0.97)]  # not the thin antenna


def head_room(bvh, car):
    """Gap from the top of the head up to the roof, in torso lengths: negative when the head is through it, None
    in an open car."""
    top = head_top()
    hit = bvh.ray_cast(top + UP * 5, -UP, 10)[0]
    if car in OPEN_TOP or not hit or hit.z < wpos('Neck').z:
        return None
    return round((hit.z - top.z) / torso(), 3)


def fit_roof(bvh, car):
    """Shrinks the robot (its hips scale) until its head clears the roof, settling it into the seat again each time."""
    for _ in range(4):
        room = head_room(bvh, car)
        if room is None or room >= ROOF_GAP * 0.8:
            return
        top = head_top().z
        hips = wpos('Hips').z
        want = top + (room - ROOF_GAP) * torso()
        k = max(0.6, (want - hips) / (top - hips))
        P[B('Hips')].scale = P[B('Hips')].scale * k
        vl.update()
        settle(seats[car], car not in RECLINE_FIX)


def reach_wheel():
    """Leans forward a little, then slides forward, until the hands reach Bangul's wheel. Returns (angle, move)."""
    angle, move = 0.0, Vector()
    for _ in range(15):
        if reach_gap() <= 0:
            return angle, move
        tilt_spine(math.radians(1))
        look_ahead()
        angle += math.radians(1)
    for _ in range(10):
        gap = reach_gap()
        if gap <= 0:
            break
        step = Vector((0, -gap, 0))
        shift_hips(step)
        move += step
    return angle, move


foot_lock = {}


def place_limbs(name, bvh=None):
    for side in ('Left', 'Right'):
        out = 1 if side == 'Left' else -1
        elbow = Vector((ELBOW_POINTS.x * out, ELBOW_POINTS.y, ELBOW_POINTS.z))
        # elbows fold forward, knees backward
        two_bone(side + 'Arm', side + 'ForeArm', side + 'Hand', hand_target(side), elbow, Vector((0, -1, 0)))
        hip = P[B(side + 'UpLeg')].head.copy()
        foot = R[B(side + 'Foot')].head.copy()
        if name not in PEG_FEET:
            # the same line from the hip as Bangul's leg, as far as the robot's leg reaches with the knee a little bent
            reach = chain_length([side + 'UpLeg', side + 'Leg', side + 'Foot']) * 0.93
            line = (foot - R[B(side + 'UpLeg')].head).normalized()
            foot = hip + (line + Vector((0, 0, -LEG_DROP))).normalized() * reach
            if bvh:
                # stand the foot on the footwell floor rather than through it; the ray starts at hip height, below
                # the dash and cowl, so it finds the floor and not the bodywork above the feet
                w = arm.matrix_world @ foot
                top = (arm.matrix_world @ hip).z
                floor = bvh.ray_cast(Vector((w.x, w.y, max(w.z, top))), -UP, 3 * reach)[0]
                ankle = 0.08 * reach
                if floor and w.z < floor.z + ankle:
                    w.z = floor.z + ankle
                    foot = arm.matrix_world.inverted() @ w
        if bvh:
            # the feet stay where the first frame put them: Bangul's dangling legs swing, a driver's feet rest
            foot = foot_lock.setdefault(side, foot)
        two_bone(side + 'UpLeg', side + 'Leg', side + 'Foot', foot, KNEE_POINTS, Vector((0, 1, 0)))
        P[B(side + 'ToeBase')].rotation_quaternion = (1, 0, 0, 0)


# the shared clips, then a Drive clip per car (after Cruiser, whose head the cars copy)
jobs = ([(name, name, None) for name in CLIPS] + [('Gunner.' + car, 'Gunner', None) for car in GUNNER_CARS]
        + [('Drive.' + car, 'Drive', car) for car in DRIVE_CARS])
fit = {}
fitted = {}
made = {}
for out_name, name, car in jobs:
    act = bpy.data.actions[name]
    use_action(ref, act)
    hand_goal.clear()
    foot_lock.clear()
    grow = CAR_SIZE.get(car or out_name.split('.')[-1], 1)
    if car:
        hand_goal.update({side: arm.matrix_world.inverted() @ g for side, g in wheel_grips[car].items()})
    first, last = (int(f) for f in act.frame_range)
    frames = {}
    for f in range(first, last + 1):
        scene.frame_set(f)
        # Bangul's angles, without its stretched limbs and shrunken head
        for pb in P:
            r = R[pb.name]
            pb.rotation_mode = 'QUATERNION'
            pb.rotation_quaternion = r.rotation_quaternion
            pb.location = r.location
            pb.scale = (1, 1, 1)
        vl.update()
        if name not in fit:
            # size from the first frame: as tall above the hips as Bangul, times HEIGHT
            fit[name] = HEIGHT[name] * bangul_top[name] / robot_top()
        P[B('Hips')].scale = (fit[name] * grow,) * 3
        vl.update()
        if car:
            bvh = seats[car]
            if car not in fitted:
                hips_rest = P[B('Hips')].matrix.translation.copy()
                upright()  # the Cruiser's straight back, not Bangul's hunch over the wheel
                direction, hits = seatback_dir(bvh)
                if car in RECLINE_FIX:
                    deg = math.radians(RECLINE_FIX[car])
                    direction = Vector((0, math.sin(deg), math.cos(deg)))
                angle = back_angle_to(direction) if direction else 0
                tilt_spine(angle)
                look_ahead()
                move = settle(bvh, car not in RECLINE_FIX)
                gap_before = pelvis_gap(bvh)
                if car not in RECLINE_FIX:  # Cuneo lies back in its racing tub on purpose
                    angle += sit_back(bvh, car)
                fit_roof(bvh, car)
                move = arm.matrix_world.to_3x3() @ (P[B('Hips')].matrix.translation - hips_rest)
                lean_in, slide = reach_wheel()
                angle += lean_in
                move += slide
                fitted[car] = (angle, move, P[B('Hips')].scale.x)
                made.setdefault(car, {})['pelvis_gap'] = [gap_before and round(gap_before, 3), pelvis_gap(bvh) and round(pelvis_gap(bvh), 3)]
                place_limbs(name, bvh)
                made[car] = made.get(car, {}) | {'back_hits': hits,
                             'recline': round(math.degrees(math.atan2(direction.y, direction.z)), 1) if direction else None,
                             'tilt': round(math.degrees(angle), 1), 'lean_in': round(math.degrees(lean_in)),
                             'slide': round(slide.length / torso(), 3), 'move': [round(c / torso(), 3) for c in move],
                             'reach': round(reach_gap() / torso(), 3), 'head_room': head_room(bvh, car),
                             'size': round(P[B('Hips')].scale.x / fit[name], 2),
                             'hips_yz': [round(wpos('Hips').y, 2), round(wpos('Hips').z, 2)], 'torso': round(torso(), 2)}
            else:
                angle, move, size = fitted[car]
                P[B('Hips')].scale = (size,) * 3
                vl.update()
                upright()
                tilt_spine(angle)
                look_ahead()
                shift_hips(move)
                place_limbs(name, bvh)
        else:
            if name in UPRIGHT:
                upright()
            if name in HIP_SHIFT:
                shift_hips(Vector(HIP_SHIFT[name]))
            lean(name)
            if name in UPRIGHT:
                upright(['Neck', 'Head'])  # the head stays level if the spine had to lean to reach
            place_limbs(name)
        if name == 'Cruiser' and not cruiser_back:
            cruiser_back.update({n: P[B(n)].matrix.to_quaternion() for n in BACK})
        frames[f] = {pb.name: (pb.location.copy(), pb.rotation_quaternion.copy(), pb.scale.copy()) for pb in P}
    # the robot's clip, keyed every frame; it takes Bangul's name once every job that reads Bangul's is done
    new = bpy.data.actions.new('_robot_' + out_name)
    arm.animation_data.action = new
    for f, pose in frames.items():
        for pb in P:
            pb.location, pb.rotation_quaternion, pb.scale = pose[pb.name]
            for prop in ('location', 'rotation_quaternion', 'scale'):
                pb.keyframe_insert(prop, frame=f, group=pb.name)
    arm.animation_data.action = None
    new.use_fake_user = True
for name in CLIPS:
    bpy.data.actions.remove(bpy.data.actions[name])
for a in list(bpy.data.actions):
    if a.name.startswith('_robot_'):
        a.name = a.name[len('_robot_'):]
result['fit'] = {k: round(v, 2) for k, v in fit.items()}
result['lean'] = leaned
result['clear'] = clearance
result['cars'] = made
bpy.data.objects.remove(ref, do_unlink=True)

# rest the armature on the Drive clip like Bangul's file
use_action(arm, bpy.data.actions['Drive'])
scene.frame_set(1)
img.pack()
bpy.context.preferences.filepaths.save_version = 0  # no .blend1 (it is never committed)
bpy.ops.wm.save_as_mainfile(filepath=BLEND_OUT)
bpy.ops.export_scene.gltf(filepath=GLB_OUT, export_format='GLB', use_selection=False, export_yup=True, export_apply=False,
                          export_animations=True, export_animation_mode='ACTIONS', export_cameras=False, export_lights=False,
                          export_skins=True, export_morph=False, export_image_format='JPEG', export_jpeg_quality=85)
result['size_kb'] = os.path.getsize(GLB_OUT) // 1024
result['actions'] = [a.name for a in bpy.data.actions]
result['bones_moved'] = len(moved)
