import bpy, math
from mathutils import Vector, Quaternion
g = bpy.app.driver_namespace['fpsgen']
arm = bpy.data.objects['Armature']; sc = bpy.context.scene
sc.render.fps = 30
L = g['L']; FWD = g['FWD']; UP = g['UP']; LEFT = g['LEFT']
fingers = {}
for pb in arm.pose.bones:
    n = pb.name
    if 'Hand' in n and any(k in n for k in ['Index', 'Middle', 'Ring', 'Pinky']) and not n.endswith('4'):
        a = {'1': 55, '2': 70, '3': 50}[n[-1]]
        fingers[n] = Quaternion((1, 0, 0), math.radians(a))
lenL = (L['knee0']['L'] - L['hip0']['L']).length + (L['ank0']['L'] - L['knee0']['L']).length
ANK = 0.053
SCALE = 1.8 / 0.768


def smooth(t):
    return t * t * (3 - 2 * t)


def fcurves(act):
    out = []
    for layer in getattr(act, 'layers', []):
        for strip in layer.strips:
            for cb in strip.channelbags:
                out += list(cb.fcurves)
    return out


def new_action(name):
    if name in bpy.data.actions:
        bpy.data.actions.remove(bpy.data.actions[name])
    act = bpy.data.actions.new(name); act.use_fake_user = True
    arm.animation_data_create(); arm.animation_data.action = act
    return act


def make_cycle(name, frames, move, speed_u, sf, lift, bob, run=False, cross=0.0, lean=0.0, base_w=0.065):
    T = frames / 30.0
    s = speed_u * sf * T / 2
    reach = lenL * 0.985
    H0 = ANK + math.sqrt(max(reach * reach - s * s, 0.01)) + 0.014 - abs(bob) - 0.004
    act = new_action(name)
    md = move.normalized()
    forwardish = abs(md.dot(FWD)) > 0.5
    for f in range(frames + 1):
        ph = (f / frames) % 1.0
        feet = {}; frot = {}
        for side, off in (('L', 0.0), ('R', 0.5)):
            p = (ph + off) % 1.0
            sign = 1 if side == 'L' else -1
            base = Vector((sign * base_w, L['ank0'][side].y - 0.01, ANK))
            if p < sf:
                x = s * (1 - 2 * p / sf); z = 0; w = 0; swing = False
            else:
                w = (p - sf) / (1 - sf); x = -s + 2 * s * smooth(w); z = lift * math.sin(math.pi * w); swing = True
            pos = base + md * x + UP * z
            if cross and swing:
                pos += FWD * cross * math.sin(math.pi * w)
            feet[side] = pos
            pitch = 0.0
            if swing:
                pitch = (-0.6 if run else -0.3) * math.sin(math.pi * w) * (1 if md.dot(FWD) > 0.5 else -0.6 if md.dot(FWD) < -0.5 else 0.3)
            frot[side] = Quaternion(LEFT, pitch)
        if run:
            hz = -bob * math.cos(4 * math.pi * (ph - sf / 2))
        else:
            hz = bob * math.cos(4 * math.pi * (ph - sf / 2))
        lat = 0.006 * math.cos(2 * math.pi * (ph - sf / 2)) * (0 if run else 1)
        hipT = Vector((lat, 0, H0 - 0.386 + hz))
        yaw = math.radians(7 if run else 4) * math.cos(2 * math.pi * ph) * (1 if forwardish else 0.3)
        Rh = Quaternion(UP, yaw) @ Quaternion(LEFT, -math.radians(lean))
        Rsp = Quaternion(UP, -yaw * 0.9) @ Quaternion(LEFT, math.radians(lean * 0.4))
        g['pose'](hipT, Rh, feet, Rh @ Rsp, frot)
        g['key'](f + 1, fingers)
    for fc in fcurves(act):
        for k in fc.keyframe_points:
            k.interpolation = 'LINEAR'
    return {'name': name, 'T': round(T, 3), 's': round(s, 3), 'H0': round(H0, 3), 'speed_m': round(speed_u * SCALE, 2)}


walk_u = 2.6 / SCALE; run_u = 5.6 / SCALE
res = []
res.append(make_cycle('WalkF', 18, FWD, walk_u, 0.42, 0.05, 0.006))
res.append(make_cycle('WalkB', 18, -FWD, walk_u, 0.42, 0.045, 0.006))
res.append(make_cycle('StrafeL', 18, LEFT, walk_u, 0.3, 0.05, 0.005, cross=0.035, base_w=0.1))
res.append(make_cycle('StrafeR', 18, -LEFT, walk_u, 0.3, 0.05, 0.005, cross=0.035, base_w=0.1))
res.append(make_cycle('Run', 16, FWD, run_u, 0.25, 0.10, 0.012, run=True, lean=10))

act = new_action('Idle')
for f in range(91):
    ph = f / 90
    feet = {'L': Vector((0.075, -0.05, ANK)), 'R': Vector((-0.07, 0.04, ANK))}
    hipT = Vector((0.004 * math.sin(2 * math.pi * ph), 0, -0.022 + 0.003 * math.sin(2 * math.pi * ph * 2)))
    Rh = Quaternion(UP, math.radians(-6))
    g['pose'](hipT, Rh, feet, Rh @ Quaternion(UP, math.radians(6)) @ Quaternion(LEFT, math.radians(1.5 * math.sin(2 * math.pi * ph * 2))))
    g['key'](f + 1, fingers)

act = new_action('Air')
for f in range(2):
    feet = {'L': Vector((0.07, -0.06, ANK + 0.09)), 'R': Vector((-0.07, 0.05, ANK + 0.05))}
    g['pose'](Vector((0, 0, -0.01)), Quaternion(), feet, Quaternion(), {'L': Quaternion(LEFT, -0.3), 'R': Quaternion(LEFT, -0.2)})
    g['key'](f + 1, fingers)
RESULT = res
