"""Render actual rig motion without changing the saved neutral Blender file."""
import bpy, os, math
from mathutils import Vector
out=os.path.join(os.path.dirname(os.path.abspath(__file__)),'previews','control_frames')
os.makedirs(out,exist_ok=True)
scene=bpy.context.scene
ctrl=bpy.data.objects['CONTROLS · select me']
ctrl.animation_data.action=None
bpy.data.collections['07 · TRANSPORT TROLLEY (optional)'].hide_render=True
cam=bpy.data.objects['CAM 01 · rear three-quarter']
cam.location=(5.3,-5.5,5.0)
cam.rotation_euler=(Vector((.42,0,1.34))-cam.location).to_track_quat('-Z','Y').to_euler()
cam.data.ortho_scale=3.65;scene.camera=cam
scene.render.resolution_x=720;scene.render.resolution_y=540;scene.render.resolution_percentage=100
scene.cycles.samples=8
for i in range(20):
    a=math.sin(math.tau*i/20)
    ctrl['Left_Elevon']=22*a;ctrl['Right_Elevon']=-22*a;ctrl['Rudder']=24*a
    ctrl.update_tag(refresh={'OBJECT'});bpy.context.view_layer.update();bpy.context.evaluated_depsgraph_get().update()
    scene.render.filepath=os.path.join(out,f'{i:03d}.png')
    bpy.ops.render.render(write_still=True)
print('CONTROL_PREVIEW_COMPLETE')
