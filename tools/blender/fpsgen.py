import bpy, math
from mathutils import Vector, Matrix, Quaternion
arm=bpy.data.objects['Armature']
P='mixamorig:'
rest={b.name:b.matrix_local.copy() for b in arm.data.bones}
def B(n): return rest[P+n].to_quaternion()
def head(n): return rest[P+n].translation.copy()
def basis(d,n):
    d=d.normalized(); n=(n-d*d.dot(n)).normalized(); s=d.cross(n)
    return Matrix((d,n,s)).transposed().to_quaternion()
def local_q(n,Rd,Rp):
    b=B(n); return b.inverted()@(Rp.inverted()@Rd)@b
L=dict(hip0={'L':head('LeftUpLeg'),'R':head('RightUpLeg')},knee0={'L':head('LeftLeg'),'R':head('RightLeg')},ank0={'L':head('LeftFoot'),'R':head('RightFoot')})
hips0=head('Hips')
FWD=Vector((0,-1,0)); UP=Vector((0,0,1)); LEFT=Vector((1,0,0))
def solve_leg(side,Hj,A,pole):
    h0=L['hip0'][side];k0=L['knee0'][side];a0=L['ank0'][side]
    l1=(k0-h0).length; l2=(a0-k0).length
    v=A-Hj; d=min(v.length,(l1+l2)*0.9995); u=v.normalized()
    ca=max(-1,min(1,(l1*l1+d*d-l2*l2)/(2*l1*d))); a=math.acos(ca)
    p=(pole-u*u.dot(pole)).normalized()
    td=u*math.cos(a)+p*math.sin(a); K=Hj+td*l1; sd=(Hj+u*d-K).normalized()
    nside=u.cross(p)
    t0=(k0-h0).normalized(); s0=(a0-k0).normalized(); n0=Vector((0,0,-1)).cross(FWD)
    Rt=basis(td,nside)@basis(t0,n0).inverted()
    Rs=basis(sd,nside)@basis(s0,n0).inverted()
    return Rt,Rs
def pose(hipT,Rh,feet,Rspine,footRot={'L':Quaternion(),'R':Quaternion()},fingers=True):
    pbs=arm.pose.bones
    for pb in pbs: pb.rotation_mode='QUATERNION'
    hb=pbs[P+'Hips']
    hb.location=B('Hips').inverted()@hipT
    hb.rotation_quaternion=local_q('Hips',Rh,Quaternion())
    hh=hips0+hipT
    for side,nm in (('L','Left'),('R','Right')):
        Hj=hh+Rh@(L['hip0'][side]-hips0)
        A=feet[side]
        pole=Rh@FWD+ (LEFT if side=='L' else -LEFT)*0.15
        Rt,Rs=solve_leg(side,Hj,A,pole)
        pbs[P+nm+'UpLeg'].rotation_quaternion=local_q(nm+'UpLeg',Rt,Rh)
        pbs[P+nm+'Leg'].rotation_quaternion=local_q(nm+'Leg',Rs,Rt)
        pbs[P+nm+'Foot'].rotation_quaternion=local_q(nm+'Foot',footRot[side],Rs)
    pbs[P+'Spine'].rotation_quaternion=local_q('Spine',Rspine,Rh)
    pbs[P+'Spine1'].rotation_quaternion=Quaternion(); pbs[P+'Spine2'].rotation_quaternion=Quaternion()
def key(f,fingers_q):
    pbs=arm.pose.bones
    names=['Hips','LeftUpLeg','LeftLeg','LeftFoot','RightUpLeg','RightLeg','RightFoot','Spine','Spine1','Spine2']
    pbs[P+'Hips'].keyframe_insert('location',frame=f)
    for n in names: pbs[P+n].keyframe_insert('rotation_quaternion',frame=f)
    for n,q in fingers_q.items():
        pbs[n].rotation_quaternion=q; pbs[n].keyframe_insert('rotation_quaternion',frame=f)
bpy.app.driver_namespace['fpsgen']=dict(pose=pose,key=key,L=L,hips0=hips0,FWD=FWD,UP=UP,LEFT=LEFT,solve_leg=solve_leg,basis=basis,local_q=local_q,B=B)
result={'hip0':list(L['hip0']['L']),'ank0':list(L['ank0']['L']),'hips0':list(hips0)}