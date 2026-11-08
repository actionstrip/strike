"""
방울이M(bangul_m): Mixamo로 리깅된 방울이 FBX를 게임용으로 정리한 모델에 Idle / Walk / Ride 액션을 넣음.
원본: E:\\project\\+캐릭터들\\fbx\\bangul.blend (bangul_M.fbx) → 작업 파일 blender\\bangul_m_motion.blend

lowpoly_lib.make_actions와 같은 리듬(Idle 48f / Walk 24f / Ride 48f, 24fps, 모든 뼈에 키)이지만,
Mixamo 뼈(65개, 팔꿈치·무릎·발목 있음)에 맞게 회전을 '월드 축 기준'으로 정해 각 뼈의 로컬 회전으로 바꿔 넣음.
  월드 축: 정면 -Y, 캐릭터 왼쪽 +X, 위 +Z (모델은 키 2.0, 발바닥 z=0으로 정리된 상태여야 함)
  X축 +각도: 위를 향한 뼈(척추·머리)는 앞으로 숙임, 아래를 향한 뼈(다리)는 뒤로 감
"""
import bpy, math
from mathutils import Quaternion, Vector

P = "mixamorig:"
SIDES = ((1, "Left"), (-1, "Right"))
X, Y, Z = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))

# 다리가 짧아서(고관절 0.36) 허벅지를 더 크게 흔들어 다른 캐릭터와 같은 보폭(게임 walkStride 0.8)을 맞춤
LEG_SWING = 0.69
ARM_DOWN = math.radians(62)     # T자에 가까운 기본 자세에서 팔을 몸 옆으로 내림
RIDE_FORWARD = math.radians(83)  # Ride: 팔을 앞으로 (손 x ≈ ±0.20)


def S(t, k=1, ph=0):
    return math.sin(2 * math.pi * (k * t + ph))


def C(t, k=1, ph=0):
    return math.cos(2 * math.pi * (k * t + ph))


class Pose:
    """뼈마다 월드 축 회전을 쌓았다가 로컬 회전(quaternion)으로 바꿔 넣음"""

    def __init__(self, arm):
        self.arm = arm
        self.rest = {b.name: b.matrix_local.to_quaternion() for b in arm.data.bones}
        self.rot = {}
        self.loc = {}

    def rotate(self, bone, axis, angle):
        """bone을 월드 축 axis로 angle만큼 (이미 쌓인 회전 다음에) 돌림"""
        q = Quaternion(axis, angle)
        self.rot[P + bone] = q @ self.rot.get(P + bone, Quaternion())

    def move(self, bone, v):
        self.loc[P + bone] = Vector(v)

    def apply(self):
        for pb in self.arm.pose.bones:
            r = self.rest[pb.name]
            pb.rotation_mode = 'QUATERNION'
            pb.rotation_quaternion = r.inverted() @ self.rot.get(pb.name, Quaternion()) @ r
            pb.location = r.inverted() @ self.loc.get(pb.name, Vector())


def arms_down(p, swing_l=0.0, swing_r=0.0, elbow=0.2):
    for s, sd in SIDES:
        p.rotate(f"{sd}Arm", Y, s * ARM_DOWN)
        p.rotate(f"{sd}Arm", X, swing_l if s > 0 else swing_r)
        # 팔꿈치: 아래팔을 앞으로 살짝 굽힘 (팔이 내려온 뒤의 월드 X축)
        p.rotate(f"{sd}ForeArm", X, -elbow)


def walk(t, p):
    s = S(t)
    for side, sd in SIDES:
        ph = 0 if side > 0 else 0.5
        leg = -LEG_SWING * S(t, 1, ph)                 # 음수 = 앞으로 (t=0.25에서 왼발 앞 최대)
        knee = 0.1 + 0.75 * max(0.0, C(t, 1, ph))      # 다리가 앞으로 지나갈 때 무릎을 굽혀 발이 바닥에 끌리지 않게
        p.rotate(f"{sd}UpLeg", X, leg)
        p.rotate(f"{sd}Leg", X, knee)
        p.rotate(f"{sd}Foot", X, -(leg + knee) * 0.6)  # 발바닥을 바닥과 비슷하게
    arms_down(p, swing_l=0.45 * s, swing_r=-0.45 * s, elbow=0.25)
    # 두 다리가 벌어질 때 엉덩이를 낮춰 발이 뜨지 않게, 지나갈 때 살짝 올라감
    p.move("Hips", (0, 0, -0.055 * (1 - abs(C(t))) + 0.008))
    p.rotate("Hips", Z, -0.12 * s)
    p.rotate("Hips", Y, 0.04 * s)
    p.rotate("Spine", Z, 0.14 * s)
    p.rotate("Spine", X, 0.06)
    p.rotate("Head", X, -0.04 + 0.02 * S(t, 2))
    p.rotate("Head", Y, -0.04 * s)


def idle(t, p):
    arms_down(p, swing_l=0.03 * S(t, 1, -0.1), swing_r=0.03 * S(t, 1, -0.1), elbow=0.15)
    p.rotate("Spine", X, 0.015 + 0.015 * S(t))
    p.move("Hips", (0, 0, 0.004 * S(t)))
    p.rotate("Head", X, 0.03 * S(t, 1, -0.15))
    p.rotate("Head", Z, 0.025 * S(t, 1, 0.3))


def ride(t, p):
    # 세그웨이 손잡이: 두 팔을 앞으로 뻗고 살짝 내림
    for s, sd in SIDES:
        p.rotate(f"{sd}Arm", Z, -s * RIDE_FORWARD)
        p.rotate(f"{sd}Arm", X, 0.12 + 0.02 * S(t))
        p.rotate(f"{sd}ForeArm", Z, -s * 0.15)
    p.rotate("Spine", X, 0.06 + 0.01 * S(t))
    p.rotate("Head", X, -0.06)
    p.move("Hips", (0, 0, 0.004 * S(t)))


JUMP_HEIGHT = 0.9    # 공중 최고 높이 (모델 단위, 키 2.0 기준)
JUMP_FRAMES = 16     # 약 0.67초
JUMP_UP, JUMP_DOWN = 0.24, 0.8    # 발이 떨어지고 닿는 시점 (액션 전체 0~1)


def _bump(t, center, width):
    """center 근처에서 1, width 밖에서 0인 부드러운 혹"""
    u = (t - center) / width
    return math.cos(u * math.pi / 2) ** 2 if abs(u) < 1 else 0.0


def jump(t, p):
    """
    깊이 웅크림 → 팔을 머리 위로 휘두르며 도약 → 공중(무릎 접고 상체 젖힘) → 다리 펴며 내려옴 → 착지 웅크림 → 서기.
    한 번만 재생 (루프 아님)
    """
    air = (t - JUMP_UP) / (JUMP_DOWN - JUMP_UP)
    height = JUMP_HEIGHT * 4 * air * (1 - air) if 0 < air < 1 else 0.0
    crouch = 0.14 * _bump(t, 0.12, 0.12) + 0.13 * _bump(t, 0.9, 0.1)    # 도약 전·착지 후 엉덩이를 깊이 낮춤
    lift = _bump(t, 0.47, 0.22)                                          # 공중 한가운데에서 1
    tuck = 1.0 * lift                                                    # 공중에서 무릎을 크게 접음
    # 허벅지 각도: 고관절~발목 0.308을 엉덩이를 낮춘 만큼 접어 발이 바닥을 뚫지 않게 (허벅지·정강이 같은 각도로 굽힘)
    bend = math.acos(max(-1.0, 1 - crouch / 0.308)) + tuck
    for s, sd in SIDES:
        p.rotate(f"{sd}UpLeg", X, -bend)
        p.rotate(f"{sd}UpLeg", Y, s * 0.15 * lift)                       # 공중에서 무릎을 살짝 벌림
        p.rotate(f"{sd}Leg", X, bend * 2)
        p.rotate(f"{sd}Foot", X, -bend + 0.5 * tuck)
    # 팔: 웅크릴 때 뒤로 크게 젖혔다가, 뛰어오르며 양옆 위로 크게 벌림 (팔이 짧고 머리가 커서 머리 위로 올리면 머리에 묻힘)
    swing = 0.9 * _bump(t, 0.12, 0.12) - 0.45 * lift + 0.4 * _bump(t, 0.9, 0.1)
    arms_down(p, swing_l=swing, swing_r=swing, elbow=0.2 + 0.2 * lift)
    for s, sd in SIDES:
        p.rotate(f"{sd}Arm", Y, -s * 1.45 * lift)
    p.move("Hips", (0, 0, height - crouch))
    # 웅크릴 땐 앞으로 숙이고, 공중에선 뒤로 젖힘 (머리가 커서 많이 숙이면 인사하는 것처럼 보여 숙임은 적당히)
    p.rotate("Spine", X, 0.12 * crouch / 0.14 - 0.18 * lift + 0.03)
    p.rotate("Spine2", X, -0.1 * lift)
    p.rotate("Head", X, -0.15 * lift + 0.08 * crouch / 0.14)


def make_actions(arm):
    sc = bpy.context.scene
    sc.render.fps = 24
    arm.animation_data_create()

    def make(name, length, step, pose_fn, cyclic=True):
        old = bpy.data.actions.get(name)
        if old:
            bpy.data.actions.remove(old)
        act = bpy.data.actions.new(name)
        act.use_fake_user = True
        arm.animation_data.action = act
        for f in range(1, length + 2, step):
            p = Pose(arm)
            pose_fn((f - 1) / length, p)   # 마지막 키 = 첫 키 (이음새 없는 루프)
            p.apply()
            for pb in arm.pose.bones:
                pb.keyframe_insert("rotation_quaternion", frame=f)
                pb.keyframe_insert("location", frame=f)
        act.frame_range = (1, length + 1)
        act.use_frame_range = True
        act.use_cyclic = cyclic

    make("Walk", 24, 2, walk)
    make("Ride", 48, 4, ride)
    make("Jump", JUMP_FRAMES, 1, jump, cyclic=False)   # 매 프레임 키 (빠른 동작이라 촘촘하게)
    make("Idle", 48, 4, idle)
    sc.frame_start, sc.frame_end = 1, 48
    arm.animation_data.action = bpy.data.actions["Idle"]
    sc.frame_set(1)
