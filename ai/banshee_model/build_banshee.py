import bpy, bmesh, math, os, sys, glob, json
from mathutils import Vector, Matrix, Quaternion

OUT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, OUT)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for c in list(bpy.data.collections):
    if c.name != 'Collection': bpy.data.collections.remove(c)
main = bpy.data.collections.get('Collection')
main.name = '01 · AIRFRAME'
def collection(name):
    c = bpy.data.collections.new(name); bpy.context.scene.collection.children.link(c); return c
wings = collection('02 · WINGS & ELEVONS')
tail = collection('03 · VERTICAL TAIL')
engines = collection('04 · TWIN EXHAUSTS & INTAKES')
details = collection('05 · PANELS & HARDWARE')
graphics = collection('06 · LIVERY & STENCILS')
cart = collection('07 · TRANSPORT TROLLEY (optional)')
studio = collection('08 · STUDIO & CAMERAS')
refs = collection('09 · PHOTO REFERENCES (hidden)')
controls = collection('10 · ARTICULATION CONTROLS')
moving_parts={'Left_Elevon':[],'Right_Elevon':[],'Rudder':[]}

def move(obj, col):
    for c in list(obj.users_collection): c.objects.unlink(obj)
    col.objects.link(obj)
    return obj
def material(name, color, rough=.3, metal=0, coat=0):
    m=bpy.data.materials.new(name); m.diffuse_color=(*color,1); m.use_nodes=True
    bs=m.node_tree.nodes.get('Principled BSDF')
    bs.inputs['Base Color'].default_value=(*color,1)
    bs.inputs['Metallic'].default_value=metal; bs.inputs['Roughness'].default_value=rough
    bs.inputs['Coat Weight'].default_value=coat; bs.inputs['Coat Roughness'].default_value=.2
    return m
red=material('PAINT · vermilion red',(.52,.010,.003),.31,0,.25)
yellow=material('PAINT · signal yellow',(.92,.56,.001),.36,0,.16)
yellow.node_tree.nodes.get('Principled BSDF').inputs['Specular IOR Level'].default_value=.28
darkred=material('GASKET · dark red panel line',(.10,.007,.003),.49)
black=material('PRINT · charcoal black',(.008,.010,.012),.52)
white=material('PRINT · warm white',(.91,.92,.89),.43)
metal=material('METAL · brushed titanium',(.18,.21,.24),.36,.78)
steel=material('METAL · satin fasteners',(.43,.47,.50),.3,.8)
soot=material('EXHAUST · dark interior',(.025,.031,.036),.52,.4)
rubber=material('RUBBER · soft black',(.014,.018,.022),.76)
hingemat=material('PAINT · hinge yellow',(.77,.43,.008),.32,.2)
for m in [red,yellow]:
    nt=m.node_tree; n=nt.nodes.new('ShaderNodeTexNoise'); n.inputs['Scale'].default_value=180
    n.inputs['Detail'].default_value=2
    b=nt.nodes.new('ShaderNodeBump'); b.inputs['Strength'].default_value=.065; b.inputs['Distance'].default_value=.0003
    nt.links.new(n.outputs['Fac'],b.inputs['Height']); nt.links.new(b.outputs['Normal'],nt.nodes.get('Principled BSDF').inputs['Normal'])

def mesh(name, verts, faces, mat, col, smooth=True):
    me=bpy.data.meshes.new(name); me.from_pydata(verts,[],faces); me.update()
    ob=bpy.data.objects.new(name,me); col.objects.link(ob)
    if mat: me.materials.append(mat)
    for p in me.polygons: p.use_smooth=smooth
    return ob
def bevel(obj,width=.003,segments=3):
    mod=obj.modifiers.new('Soft manufactured edges','BEVEL'); mod.width=width; mod.segments=segments
    return obj
def curve(name,pts,r,mat,col=details,closed=False):
    cu=bpy.data.curves.new(name,'CURVE'); cu.dimensions='3D'; cu.resolution_u=1
    cu.bevel_depth=r; cu.bevel_resolution=3
    sp=cu.splines.new('POLY'); sp.points.add(len(pts)-1)
    for p,co in zip(sp.points,pts): p.co=(*co,1)
    sp.use_cyclic_u=closed
    ob=bpy.data.objects.new(name,cu); col.objects.link(ob); ob.data.materials.append(mat); return ob
def uvball(name,loc,scale,mat,col=details):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=24,ring_count=12,location=loc)
    o=move(bpy.context.object,col); o.name=name; o.scale=scale; o.data.materials.append(mat)
    for p in o.data.polygons:p.use_smooth=True
    return o
def cube(name,loc,scale,mat,col=details,edge=.003):
    bpy.ops.mesh.primitive_cube_add(size=1,location=loc)
    o=move(bpy.context.object,col); o.name=name; o.dimensions=scale
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    o.data.materials.append(mat)
    if edge:bevel(o,edge)
    return o
def cylinder(name,p1,p2,r,mat,col=details,vertices=48):
    a,b=Vector(p1),Vector(p2);d=b-a
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=r,depth=d.length,location=(a+b)/2)
    o=move(bpy.context.object,col); o.name=name;o.rotation_mode='QUATERNION';o.rotation_quaternion=d.to_track_quat('Z','Y');o.data.materials.append(mat)
    for f in o.data.polygons:f.use_smooth=len(f.vertices)==4
    bevel(o,min(.0015,r*.15),2);return o

# Smooth loft: longitudinal station, half-width, half-height, centre height.
stations=[(-1.72,.002,.002,1.30),(-1.70,.014,.014,1.30),(-1.65,.033,.031,1.30),(-1.55,.067,.064,1.30),(-1.43,.103,.099,1.30),(-1.31,.130,.125,1.30),(-1.21,.149,.145,1.30),(-1.06,.156,.154,1.30),(-.96,.158,.157,1.30),(-.80,.158,.157,1.30),(-.50,.155,.156,1.30),(-.12,.151,.153,1.30),(.20,.153,.154,1.30),(.43,.159,.159,1.30),(.66,.169,.165,1.30),(.88,.181,.175,1.30),(1.10,.189,.181,1.30),(1.27,.187,.169,1.30),(1.40,.175,.144,1.30),(1.44,.160,.132,1.30)]
body_stations=[p for p in stations if p[0]>=-.96]
def body_slope(i,j):
    if i==0:return 0.0
    if i==len(body_stations)-1:
        return (body_stations[i][j]-body_stations[i-1][j])/(body_stations[i][0]-body_stations[i-1][0])
    h0=body_stations[i][0]-body_stations[i-1][0];h1=body_stations[i+1][0]-body_stations[i][0]
    d0=(body_stations[i][j]-body_stations[i-1][j])/h0;d1=(body_stations[i+1][j]-body_stations[i][j])/h1
    if d0*d1<=0:return 0.0
    w0=2*h1+h0;w1=h1+2*h0
    return (w0+w1)/(w0/d0+w1/d1)
def profile(x):
    if x<=-.96:
        # One continuous curved nose/shoulder across the yellow-red paint boundary.
        # Both first and second derivatives vanish at the cylindrical body join.
        t=max(0,min(1,(x+1.72)/.76))
        f=1.75*t-.5*t**3-t**4+.75*t**5
        return [.002+(.158-.002)*f,.002+(.157-.002)*f,1.30]
    for i in range(len(body_stations)-1):
        if body_stations[i][0]<=x<=body_stations[i+1][0]:break
    h=body_stations[i+1][0]-body_stations[i][0];t=(x-body_stations[i][0])/h; vals=[]
    for j in range(1,4):
        vals.append((2*t**3-3*t*t+1)*body_stations[i][j]+(t**3-2*t*t+t)*h*body_slope(i,j)+(-2*t**3+3*t*t)*body_stations[i+1][j]+(t**3-t*t)*h*body_slope(i+1,j))
    return vals
def bodypt(x,ang,offset=0):
    ry,rz,zc=profile(x);return (x,(ry+offset)*math.sin(ang),zc+(rz+offset)*math.cos(ang))
N=96; xs=[]
for a,b in zip(stations,stations[1:]):xs.extend([a[0]+(b[0]-a[0])*i/10 for i in range(10)])
xs.append(stations[-1][0]); verts=[bodypt(x,2*math.pi*j/N) for x in xs for j in range(N)]
faces=[]
for i in range(len(xs)-1):
    for j in range(N):faces.append((i*N+j,i*N+(j+1)%N,(i+1)*N+(j+1)%N,(i+1)*N+j))
faces.extend([tuple(reversed(range(N))),tuple((len(xs)-1)*N+j for j in range(N))])
body=mesh('Fuselage · smooth composite shell',verts,faces,red,main)
body.data.materials.append(yellow)
for p in body.data.polygons:
    if p.center.x<-1.21:p.material_index=1
# Correct outward normals before cuts.
bpy.context.view_layer.objects.active=body;body.select_set(True)
bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.mesh.normals_make_consistent(inside=False);bpy.ops.object.mode_set(mode='OBJECT');body.select_set(False)
def boolean_cut(target,tool):
    bpy.context.view_layer.objects.active=target
    m=target.modifiers.new('Recessed opening','BOOLEAN');m.operation='DIFFERENCE';m.object=tool
    bpy.ops.object.modifier_apply(modifier=m.name);bpy.data.objects.remove(tool,do_unlink=True)
for side in [-1,1]:
    poly=[(.35,1.31),(.97,1.375),(.98,1.255)]
    vv=[(x,side*y,z) for y in [.08,.43] for x,z in poly]
    ff=[(0,2,1),(3,4,5),(0,1,4,3),(1,2,5,4),(2,0,3,5)]
    cut=mesh('temporary intake cutter',vv,ff,None,engines,False)
    bpy.context.view_layer.objects.active=cut;cut.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.mesh.normals_make_consistent(inside=False);bpy.ops.object.mode_set(mode='OBJECT');cut.select_set(False)
    boolean_cut(body,cut)
    mesh(('Port' if side<0 else 'Starboard')+' · intake shadow',[(x,side*.081,z) for x,z in poly],[(0,1,2)],soot,engines,False)
    pts=[]
    for (ax,az),(bx,bz) in zip(poly,poly[1:]+poly[:1]):
        for i in range(20):
            t=i/20;x=ax+(bx-ax)*t;z=az+(bz-az)*t;ry,rz,zc=profile(x)
            y=side*(ry*math.sqrt(max(.01,1-((z-zc)/rz)**2))+.002)
            pts.append((x,y,z))
    curve(('Port' if side<0 else 'Starboard')+' · red intake lip',pts,.004,red,engines,True)
    # Exhaust hole and a visually modelled hollow nozzle.
    y=side*.081;zc=1.315
    cut=cylinder('temporary exhaust cutter',(1.11,y,zc),(1.77,y,zc),.066,black,engines,64)
    boolean_cut(body,cut)
    rings=[(1.33,.069),(1.43,.075),(1.51,.072),(1.555,.065),(1.555,.0545),(1.50,.055),(1.32,.0505)]
    vs=[(x,y+r*math.sin(2*math.pi*j/64),zc+r*math.cos(2*math.pi*j/64)) for x,r in rings for j in range(64)]
    fs=[]
    for i in range(len(rings)-1):
        for j in range(64):fs.append(((i+1)*64+j,(i+1)*64+(j+1)%64,i*64+(j+1)%64,i*64+j))
    o=mesh(('Port' if side<0 else 'Starboard')+' · hollow titanium exhaust',vs,fs,metal,engines)
    o.data.materials.append(soot)
    for p in o.data.polygons:
        if p.index>=4*64:p.material_index=1
    cylinder('Deep exhaust shadow',(1.313,y,zc),(1.317,y,zc),.0505,soot,engines)
    uvball('Exhaust centre',(1.342,y,zc),(.026,.012,.012),soot,engines)
    for j in range(12):
        a=j*math.tau/12
        vs=[(1.326,y+.017*math.sin(a),zc+.017*math.cos(a)),(1.325,y+.046*math.sin(a+.10),zc+.046*math.cos(a+.10)),(1.331,y+.046*math.sin(a+.24),zc+.046*math.cos(a+.24)),(1.338,y+.017*math.sin(a+.30),zc+.017*math.cos(a+.30))]
        mesh('Recessed radial exhaust detail',vs,[(0,1,2,3)],metal,engines)

# Truncated swept wings; independent trailing control surfaces.
def wing_chord(s):return 1.50-1.13*s
def elevon_chord(s):return .085-.010*s
def hinge_u(s):return 1-elevon_chord(s)/wing_chord(s)
def fixed_end_u(s):return hinge_u(s)-.002/wing_chord(s)
def moving_start_u(s):return hinge_u(s)+.002/wing_chord(s)
def control_u(s,f):return hinge_u(s)+(1-hinge_u(s))*f
def wingpt(s,u,side,upper=True,extra=0):
    y=.025+1.305*s;le=-.16+1.25*s;te=1.34+.12*s
    x=le+(te-le)*u
    thick=(.075*(1-s)+.035*s)*5*(.2969*math.sqrt(max(u,0))-.126*u-.3516*u*u+.2843*u**3-.1015*u**4)
    z=1.195+.018*s+(thick if upper else -thick)+extra
    return (x,side*y,z)
def wingpart(side,name,umin,umax,smin=0,smax=1):
    ns,nu=25,42;vs=[]
    for up in [True,False]:
        for i in range(ns+1):
            s=smin+(smax-smin)*i/ns;ua=umin(s) if callable(umin) else umin;ub=umax(s) if callable(umax) else umax
            for j in range(nu+1):vs.append(wingpt(s,ua+(ub-ua)*j/nu,side,up))
    k=(ns+1)*(nu+1);fs=[]
    for i in range(ns):
        for j in range(nu):
            a=i*(nu+1)+j;b=a+1;c=b+nu+1;d=a+nu+1
            fs.extend([(a,b,c,d),(k+d,k+c,k+b,k+a)])
    for i in range(ns):
        a=i*(nu+1);b=(i+1)*(nu+1);fs.append((a,b,k+b,k+a))
        a+=nu;b+=nu;fs.append((b,a,k+a,k+b))
    for j in range(nu):
        fs.append((j,k+j,k+j+1,j+1));a=ns*(nu+1)+j;fs.append((a,a+1,k+a+1,k+a))
    o=mesh(name,vs,fs,yellow,wings)
    bm=bmesh.new();bm.from_mesh(o.data);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.0000001);bm.to_mesh(o.data);bm.free()
    bpy.context.view_layer.objects.active=o;o.select_set(True);bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.mesh.normals_make_consistent(inside=False);bpy.ops.object.mode_set(mode='OBJECT');o.select_set(False)
    return o
fixed_wing_parts=[]
for side,label in [(-1,'Port'),(1,'Starboard')]:
    key='Left_Elevon' if side<0 else 'Right_Elevon'
    fixed_wing_parts.append(wingpart(side,label+' · swept wing',0,fixed_end_u))
    fixed_wing_parts.append(wingpart(side,label+' · fixed inboard trailing edge',lambda s:hinge_u(s)-.004/wing_chord(s),1,0,.130))
    moving_parts[key].append(wingpart(side,label+' · elevon',moving_start_u,1,.136,1))
    # Flush cover panel and fasteners near the wing root.
    for s in [.12,.66]:
        pts=[wingpt(s+ds,u,side,True,.001) for ds,u in [(0,.39),(.14,.43),(.14,.66),(0,.64),(0,.39)]]
        curve(label+' · flush wing service panel',pts,.00065,hingemat)
    for s in [.24,.72]:
        p=Vector(wingpt(s,hinge_u(s),side,True,.005));q=Vector(wingpt(s,control_u(s,.38),side,True,.009))
        cylinder(label+' · hinge pin',Vector(wingpt(s-.015,hinge_u(s-.015),side,True,.005)),Vector(wingpt(s+.015,hinge_u(s+.015),side,True,.005)),.003,steel)
        moving_parts[key].append(uvball(label+' · control horn',(q.x,q.y,q.z),(.015,.008,.011),yellow))
    # Short upturned tip skid.
    pp=wingpt(1,.58,side,True)
    curve(label+' · wingtip marker',[(pp[0],pp[1],pp[2]),(pp[0]+.012,pp[1]+side*.009,pp[2]+.038)],.0022,steel)

# Fuse every fixed wing piece into the fuselage; the root is one continuous mesh.
for fixed in fixed_wing_parts:
    bpy.context.view_layer.objects.active=body
    mod=body.modifiers.new('Permanent wing-root union','BOOLEAN');mod.operation='UNION';mod.solver='EXACT';mod.object=fixed
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(fixed,do_unlink=True)
body.name='AIRFRAME · joined fuselage and wings'
body['Wing_Attachment']='Fixed wing roots are boolean-unioned to the fuselage, not separate floating objects.'

# Swept vertical stabiliser and separately editable rudder.
def finpt(s,u,side):
    z=1.438+.49*s;le=.62+.50*s;te=1.40+.16*s;hinge=1.245+.205*s
    if s>.92:le+=.035*(1-math.sqrt(max(0,1-((s-.92)/.08)**2)))
    x=le+(hinge-le)*u/.80 if u<=.80 else hinge+(te-hinge)*(u-.80)/.20
    th=(.049*(1-s)+.022*s)*math.sin(math.pi*u)**.65
    return (x,side*th/2,z)
def finpart(name,ua,ub,smin=0,smax=1):
    ns,nu=36,36;vs=[finpt(smin+(smax-smin)*i/ns,ua+(ub-ua)*j/nu,side) for side in [-1,1] for i in range(ns+1) for j in range(nu+1)]
    k=(ns+1)*(nu+1);fs=[]
    for i in range(ns):
        for j in range(nu):
            a=i*(nu+1)+j;fs.extend([(a,a+1,a+nu+2,a+nu+1),(k+a+nu+1,k+a+nu+2,k+a+1,k+a)])
    for i in range(ns):
        for j in [0,nu]:
            a=i*(nu+1)+j;b=a+nu+1;fs.append((a,b,k+b,k+a))
    for j in range(nu):
        for i in [0,ns]:
            a=i*(nu+1)+j;fs.append((a,a+1,k+a+1,k+a))
    ob=mesh(name,vs,fs,red,tail)
    bpy.context.view_layer.objects.active=ob;ob.select_set(True);bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.mesh.normals_make_consistent(inside=False);bpy.ops.object.mode_set(mode='OBJECT');ob.select_set(False)
    return ob
finpart('Fin · swept composite stabiliser',0,.786)
finpart('Fin · fixed lower trailing edge',.780,1,0,.119)
moving_parts['Rudder'].append(finpart('Rudder · separate control surface',.814,1,.127,1))
moving_parts['Rudder'].append(cylinder('Rudder · cylindrical hinge nose',finpt(.127,.80,0),finpt(1,.80,0),.009,red,tail,vertices=48))
# A smooth fairing blends the fin into the body.
uvball('Fin root · blended fillet',(1.04,0,1.461),(.32,.054,.035),red,tail)

# Fine recessed-looking seams and sparse flush fasteners.
for x in [-1.21,-.96,.19,1.19]:
    curve('Fuselage circumferential panel seam',[bodypt(x,j*math.tau/192,.0002 if x==-1.21 else .0007) for j in range(192)],.00045 if x==-1.21 else .00085,darkred,details,True)
for side in [-1,1]:
    for ang in [side*math.pi/2,side*2.23]:
        curve('Longitudinal shell join',[bodypt(-1.21+i*2.38/130,ang,.0009) for i in range(131)],.00065,darkred)
    # A rectangular forward avionics hatch, following the curved surface.
    pts=[]
    for x,a in [(-.93,side*.42),(-.42,side*.42),(-.42,side*1.20),(-.93,side*1.20),(-.93,side*.42)]:
        pts.append((x,a))
    hp=[]
    for (x1,a1),(x2,a2) in zip(pts,pts[1:]):
        hp.extend(bodypt(x1+(x2-x1)*i/25,a1+(a2-a1)*i/25,.0012) for i in range(25))
    curve('Forward removable access hatch',hp,.0007,darkred,details,True)
    for x in [-1.18,-.92,-.69,-.45,-.10,.17,1.17]:
        for ang in [side*1.52,side*.48]:
            p=Vector(bodypt(x,ang,.002));normal=Vector((0,math.sin(ang),math.cos(ang)))
            cylinder('Flush quarter-turn fastener',p,p+normal*.0013,.0034,steel,vertices=16)
            vec=Vector((.0023,0,0));curve('Fastener slot',[p+normal*.0018-vec,p+normal*.0018+vec],.00032,black)
    for x in [-.89,-.47]:
        p=bodypt(x,side*1.11,.004)
        uvball('Hatch latch',p,(.014,.0028,.006),steel)

# Raised text is shallow enough to read as paint, but remains editable in Blender.
font=bpy.data.fonts.load('/System/Library/Fonts/Supplemental/Arial Bold.ttf')
font_narrow=bpy.data.fonts.load('/System/Library/Fonts/Supplemental/DIN Condensed Bold.ttf')
def textobj(name,body,loc,size,mat,axes=None,font_used=None,align='CENTER'):
    cu=bpy.data.curves.new(name,'FONT');cu.body=body;cu.size=size;cu.align_x=align;cu.align_y='CENTER';cu.font=font_used or font
    cu.space_character=1.04;cu.extrude=.00008;cu.resolution_u=6
    o=bpy.data.objects.new(name,cu);graphics.objects.link(o);o.location=loc;cu.materials.append(mat)
    if axes:o.rotation_euler=Matrix(axes).transposed().to_4x4().to_euler()
    return o
# Wing labels share the orientation seen in the rear-view photograph.
for side,label in [(-1,'BANSHEE'),(1,'TARGET')]:
    p=wingpt(.58,.49,side,True,.0025)
    axes=((0,-1,0),(1,0,0),(0,0,1))
    o=textobj('Wing marking · '+label,label,p,.142,black,axes,font)
    for s in [.30,.76]:
        p=wingpt(s,control_u(s,.64),side,True,.0015)
        moving_parts['Left_Elevon' if side<0 else 'Right_Elevon'].append(textobj('Elevon warning · NO HAND','NO HAND',p,.026,black,axes))
    p=wingpt(.20,.54,side,True,.002)
    textobj('Wing inspection stencil','LIFT HERE',p,.020,black,axes)
    # Opposite faces of the fin have readable lettering.
    u=.44;s=.62;x,y,z=finpt(s,u,side)
    axes=((1,0,0),(0,0,1),(0,-1,0)) if side<0 else ((-1,0,0),(0,0,1),(0,1,0))
    textobj('Fin identity · BANSHEE','BANSHEE',(x,side*(abs(y)+.003),z),.060,white,axes,font_narrow)
    x,y,z=finpt(.53,.44,side)
    textobj('Fin identity · TWIN JET','TWIN JET',(x,side*(abs(y)+.003),z),.024,white,axes,font_narrow)
    x,y,z=finpt(.83,.59,side)
    textobj('Fin serial','8712',(x,side*(abs(y)+.0025),z),.029,black,axes,font_narrow)
    # Tangent lettering around the front side of the body.
    textobj('Fuselage logotype','BANSHEE',(-.61,side*.161,1.282),.067,black,axes,font_narrow)
    textobj('Fuselage subline','TWIN JET  /  TARGET',(-.61,side*.150,1.245),.021,black,axes,font_narrow)
    textobj('Service stencil','ACCESS',(-.68,side*.155,1.337),.018,white,axes,font_narrow)

# Conform painted wing text to the actual curved wing instead of a flat plane.
for o in graphics.objects:
    if not o.name.startswith(('Wing marking','Wing inspection','Elevon warning')):continue
    side_label='Port' if o.location.y<0 else 'Starboard'
    part='elevon' if o.name.startswith('Elevon warning') else 'swept wing'
    o.location.z+=.08
    m=o.modifiers.new('Paint follows wing surface','SHRINKWRAP')
    m.target=bpy.data.objects[side_label+' · elevon'] if part=='elevon' else body
    m.wrap_method='PROJECT';m.use_project_z=True;m.use_negative_direction=True;m.use_positive_direction=False;m.offset=.0009

# Two lifting eyes and small inspection dots.
for x in [-.82,.48]:
    ry,rz,zc=profile(x)
    bpy.ops.mesh.primitive_torus_add(major_radius=.010,minor_radius=.0025,major_segments=24,minor_segments=8,location=(x,0,zc+rz+.008),rotation=(math.pi/2,0,0))
    o=move(bpy.context.object,details);o.name='Dorsal lifting eye';o.data.materials.append(steel)

# Optional ground handling dolly is a separate collection.
try:
    from build_cart import build_cart
    build_cart(cart,{'rubber':rubber,'steel':steel})
except ImportError:
    pass
paint=bpy.data.materials.get('Cart | Blue-black powdercoat')
if paint:
    paint.node_tree.nodes.get('Principled BSDF').inputs['Metallic'].default_value=.15
    paint.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value=.46

root=bpy.data.objects.new('BANSHEE · aircraft assembly',None);main.objects.link(root)
root.empty_display_type='PLAIN_AXES';root.empty_display_size=.35
root['Reference']='Revised silhouette and elongated nose follow photo 1; twin-exhaust presentation retained.'
root['Editing']='Components, lettering, trolley and studio are separated into collections.'
root['Scale']='Illustrative proportions, not a measured engineering model.'
for col in [main,wings,tail,engines,details,graphics]:
    for o in list(col.objects):
        if o!=root:o.parent=root

from rig_controls import build_controls, validate_controls
def wing_hinge(s,side):return (Vector(wingpt(s,hinge_u(s),side,True))+Vector(wingpt(s,hinge_u(s),side,False)))*.5
def fin_hinge(s):return (Vector(finpt(s,.8,1))+Vector(finpt(s,.8,-1)))*.5
rig=build_controls(root,controls,{
    'Left_Elevon':{'label':'Left elevon','hinge_start':wing_hinge(.136,-1),'hinge_end':wing_hinge(1,-1),'objects':moving_parts['Left_Elevon'],'sign':1},
    'Right_Elevon':{'label':'Right elevon','hinge_start':wing_hinge(.136,1),'hinge_end':wing_hinge(1,1),'objects':moving_parts['Right_Elevon'],'sign':-1},
    'Rudder':{'label':'Rudder','hinge_start':fin_hinge(.127),'hinge_end':fin_hinge(1),'objects':moving_parts['Rudder'],'sign':1},
})
rig_report=validate_controls(rig,root)
with open(os.path.join(OUT,'rig_validation.json'),'w') as f:json.dump(rig_report,f,indent=2)
# Keep a reusable demonstration action without overriding manual angle editing.
ctrl=rig['controller']
for frame,angles in [(1,(0,0,0)),(25,(20,20,0)),(50,(-20,20,18)),(75,(20,-20,-18)),(100,(0,0,0))]:
    for prop,value in zip(('Left_Elevon','Right_Elevon','Rudder'),angles):
        ctrl[prop]=float(value);ctrl.keyframe_insert(data_path='["'+prop+'"]',frame=frame)
demo_action=ctrl.animation_data.action;demo_action.name='DEMO · elevons and rudder';demo_action.use_fake_user=True
ctrl.animation_data.action=None
for prop in ('Left_Elevon','Right_Elevon','Rudder'):ctrl[prop]=0.0
ctrl.update_tag();bpy.context.view_layer.update()
bpy.context.scene.frame_start=1;bpy.context.scene.frame_end=100;bpy.context.scene.frame_set(1)

# Pack the source photographs into the blend, without placing them in the scene.
for pattern in ['*12.49.33.png','*12.49.56.png','*12.50.34.png']:
    files=glob.glob('/Users/wlsekffo/Desktop/'+pattern)
    if files:
        im=bpy.data.images.load(files[0]);im.pack()
        o=bpy.data.objects.new('Reference · '+os.path.basename(files[0]),None);refs.objects.link(o)
        o.empty_display_type='IMAGE';o.data=im;o.empty_display_size=3
        o.hide_render=True;o.hide_viewport=True
refs.hide_render=True;refs.hide_viewport=True

floor=material('STUDIO · warm porcelain',(.54,.56,.58),.72)
cube('Studio floor',(0,0,-.035),(200,200,.06),floor,studio,.005)
scene=bpy.context.scene
scene.world.color=(.22,.22,.22);scene.world.use_nodes=True
scene.world.node_tree.nodes.get('Background').inputs[0].default_value=(.65,.72,.83,1)
scene.world.node_tree.nodes.get('Background').inputs[1].default_value=.36
def area(name,loc,power,size,color,shape='DISK',size_y=None):
    data=bpy.data.lights.new(name,'AREA');data.energy=power;data.shape=shape;data.size=size;data.color=color
    if size_y:data.size_y=size_y
    o=bpy.data.objects.new(name,data);studio.objects.link(o);o.location=loc;o.rotation_euler=(Vector((0,0,1))-o.location).to_track_quat('-Z','Y').to_euler()
area('Key · large softbox',(-2.0,-4.0,6.8),1150,5,(1,.92,.83))
area('Fill · cool softbox',(0,4.0,4.5),1000,4,(.79,.87,1))
area('Rim · long strip',(4.2,1,5),1400,3,(1,.95,.88),'RECTANGLE',1.2)
area('Nose reflection',(-4,1.5,3),500,2.5,(1,.98,.92))
def camera(name,loc,target,scale):
    d=bpy.data.cameras.new(name);o=bpy.data.objects.new(name,d);studio.objects.link(o);o.location=loc
    o.rotation_euler=(Vector(target)-o.location).to_track_quat('-Z','Y').to_euler();d.type='ORTHO';d.ortho_scale=scale;d.lens=50;return o
hero=camera('CAM 01 · rear three-quarter',(5.1,-6.7,4.25),(0,0,1.12),4.30)
front=camera('CAM 02 · nose three-quarter',(-5.2,-6.2,3.9),(0,0,1.12),4.38)
top=camera('CAM 03 · top',(.0,0,7),(0,0,1.2),3.72)
top.rotation_euler=(0,0,-math.pi/2)
sidecam=camera('CAM 04 · side',(0,-8,1.07),(0,0,1.07),3.72)
rear=camera('CAM 05 · rear',(8,0,2.65),(.15,0,1.25),3.40)
scene.camera=hero
scene.render.engine='CYCLES';scene.cycles.samples=48;scene.cycles.use_denoising=True
scene.render.resolution_x=1680;scene.render.resolution_y=1260;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';scene.render.film_transparent=False
scene.render.image_settings.color_mode='RGB';scene.render.fps=24
scene.view_settings.view_transform='AgX'
scene.view_settings.look='AgX - Medium High Contrast'
scene.view_settings.exposure=-1.45
scene.render.filepath=os.path.join(OUT,'previews','banshee_hero.png')
scene.unit_settings.system='METRIC';scene.unit_settings.scale_length=1
# Open with the angle controller selected so the articulation controls are easy to find.
bpy.ops.object.select_all(action='DESELECT');ctrl.select_set(True);bpy.context.view_layer.objects.active=ctrl
for screen in bpy.data.screens:
    for area_ in screen.areas:
        if area_.type=='VIEW_3D':
            sp=area_.spaces.active;sp.region_3d.view_distance=5.1;sp.region_3d.view_location=(0,0,1.15)
            sp.region_3d.view_rotation=hero.rotation_euler.to_quaternion();sp.shading.type='MATERIAL'
            sp.overlay.show_floor=False;sp.clip_end=500
        elif area_.type=='PROPERTIES':area_.spaces.active.context='OBJECT'
for o in studio.objects:o.hide_set(True)
notes=bpy.data.texts.new('READ ME · Banshee model')
notes.write('BANSHEE — revised proportions / articulated model\n\n첫 번째 사진을 기준으로 긴 기수, 가는 동체, 작은 수직미익으로 수정했습니다. 고정 주익은 동체와 Boolean union한 단일 연결 메시입니다. 후방 쌍제트 표시는 유지했습니다.\n\n조종면 조작: CONTROLS · select me를 선택하고 오브젝트 속성 > 사용자 정의 속성의 Left_Elevon, Right_Elevon, Rudder 값을 -25 ~ +25도로 변경하세요. 양쪽 조종면은 양수가 위쪽입니다. 0으로 초기화합니다. 표기와 돌출 부품도 함께 움직입니다.\n\nDEMO · elevons and rudder Action을 저장해 두었습니다. 기본 상태는 Action을 연결하지 않아 수동 각도 편집이 가능합니다.\n\n07: optional trolley. 08: studio and five cameras. 09: three packed original photos. 10: articulation controls.\n\nProportions are reconstructed visually from the photographs.\n')
for f in [font,font_narrow]:f.pack()
blend_path=os.path.join(OUT,'Banshee_TwinJet.blend')
bpy.ops.wm.save_as_mainfile(filepath=blend_path)
if '--quick' in sys.argv:
    scene.render.resolution_percentage=55;scene.cycles.samples=24
bpy.ops.render.render(write_still=True)
if '--quick' not in sys.argv:
    scene.camera=front;scene.render.filepath=os.path.join(OUT,'previews','banshee_front.png');bpy.ops.render.render(write_still=True)
    scene.camera=top;scene.render.resolution_x=1400;scene.render.resolution_y=1400;scene.cycles.samples=32
    scene.render.filepath=os.path.join(OUT,'previews','banshee_top.png');bpy.ops.render.render(write_still=True)
    scene.camera=sidecam;scene.render.resolution_x=1680;scene.render.resolution_y=1000
    scene.render.filepath=os.path.join(OUT,'previews','banshee_side.png');bpy.ops.render.render(write_still=True)
scene.camera=hero;scene.render.filepath=os.path.join(OUT,'previews','banshee_hero.png')
scene.render.resolution_x=1680;scene.render.resolution_y=1260;scene.render.resolution_percentage=100;scene.cycles.samples=48
bpy.ops.wm.save_as_mainfile(filepath=blend_path)
stats={'objects':len(bpy.data.objects),'mesh_objects':len([o for o in bpy.data.objects if o.type=='MESH']),'vertices':sum(len(m.vertices) for m in bpy.data.meshes),'polygons':sum(len(m.polygons) for m in bpy.data.meshes),'blend':blend_path}
with open(os.path.join(OUT,'model_info.json'),'w') as f:json.dump(stats,f,indent=2)
if '--quick' not in sys.argv:
    from export_glb import export_glb
    export_glb(os.path.join(OUT,'Banshee_TwinJet.glb'),[o for c in [main,wings,tail,engines,details,graphics] for o in c.objects if o.type in {'MESH','CURVE','FONT'}])
print('BANSHEE_BUILD_COMPLETE',json.dumps(stats))
