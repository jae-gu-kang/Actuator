"""Optional presentation trolley, sized for the accompanying Banshee model.

Call build_cart(collection, materials) from Blender.  This file does not change
the scene until called, and uses only Blender's bundled Python modules.
"""

import math

import bpy
from mathutils import Vector


def build_cart(collection, materials=None):
    """Create the transport trolley and return every object created.

    Aircraft nose points toward -X, ground is Z=0, and the padded supports
    contact the belly at Z=1.144 forward and Z=1.119 aft.  Existing scene
    objects are left untouched.
    """
    objects = []
    supplied = materials if hasattr(materials, "get") else {}

    def material(keys, name, color, metallic=0.0, roughness=0.45):
        for key in keys:
            candidate = supplied.get(key)
            if isinstance(candidate, bpy.types.Material):
                return candidate
        mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
        mat.diffuse_color = (*color, 1.0)
        mat.use_nodes = True
        shader = mat.node_tree.nodes.get("Principled BSDF")
        shader.inputs["Base Color"].default_value = (*color, 1.0)
        shader.inputs["Metallic"].default_value = metallic
        shader.inputs["Roughness"].default_value = roughness
        return mat

    steel = material(("cart_paint", "trolley_steel"), "Cart | Blue-black powdercoat", (0.018, 0.034, 0.044), 0.52, 0.34)
    rubber = material(("cart_rubber",), "Cart | Tire rubber", (0.011, 0.014, 0.016), 0.0, 0.82)
    tread_mat = material(("cart_tread",), "Cart | Raised tire tread", (0.019, 0.023, 0.025), 0.0, 0.76)
    silver = material(("cart_silver",), "Cart | Satin zinc hardware", (0.40, 0.46, 0.49), 0.83, 0.30)
    hub_dark = material(("cart_hub",), "Cart | Wheel recess", (0.045, 0.057, 0.064), 0.65, 0.45)

    def register(obj, name, mat):
        obj.name = "Cart | " + name
        for old in list(obj.users_collection):
            old.objects.unlink(obj)
        collection.objects.link(obj)
        if mat:
            obj.data.materials.append(mat)
        objects.append(obj)
        return obj

    def bevel(obj, width=0.004, segments=2):
        mod = obj.modifiers.new("Soft manufactured edges", "BEVEL")
        mod.width = width
        mod.segments = segments
        mod.limit_method = "ANGLE"
        return obj

    def box(name, center, dimensions, mat, edge=0.004):
        bpy.ops.mesh.primitive_cube_add(size=1.0, location=center)
        obj = register(bpy.context.object, name, mat)
        obj.dimensions = dimensions
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        if edge:
            bevel(obj, edge, 3)
        return obj

    def rod(name, start, end, radius, mat=steel, vertices=16, edge=0.002):
        a, b = Vector(start), Vector(end)
        delta = b - a
        bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=delta.length, location=(a + b) * 0.5)
        obj = register(bpy.context.object, name, mat)
        obj.rotation_mode = "QUATERNION"
        obj.rotation_quaternion = delta.to_track_quat("Z", "Y")
        for poly in obj.data.polygons:
            poly.use_smooth = len(poly.vertices) == 4
        if edge:
            bevel(obj, edge)
        return obj

    def mesh_object(name, verts, faces, mat, smooth=False):
        mesh = bpy.data.meshes.new("CartMesh | " + name)
        mesh.from_pydata(verts, [], faces)
        mesh.update()
        obj = bpy.data.objects.new("Cart | " + name, mesh)
        collection.objects.link(obj)
        mesh.materials.append(mat)
        for face in mesh.polygons:
            face.use_smooth = smooth
        objects.append(obj)
        return obj

    def tire(name, center, radius, width, segments=48):
        # A closed lathed profile makes rounded sidewalls and a broad tread.
        # Rotation axis is Y, so it matches the transverse wheel axle.
        cx, cy, cz = center
        profile = [
            (-0.50 * width, 0.55 * radius),
            (-0.50 * width, 0.78 * radius),
            (-0.44 * width, 0.90 * radius),
            (-0.29 * width, 0.977 * radius),
            (0.29 * width, 0.977 * radius),
            (0.44 * width, 0.90 * radius),
            (0.50 * width, 0.78 * radius),
            (0.50 * width, 0.55 * radius),
        ]
        verts = []
        for axial, radial in profile:
            for i in range(segments):
                angle = math.tau * i / segments
                verts.append((cx + radial * math.cos(angle), cy + axial, cz + radial * math.sin(angle)))
        faces = []
        for j in range(len(profile)):
            next_j = (j + 1) % len(profile)
            for i in range(segments):
                next_i = (i + 1) % segments
                faces.append((j * segments + i, next_j * segments + i, next_j * segments + next_i, j * segments + next_i))
        return mesh_object(name, verts, faces, rubber, smooth=True)

    def tire_tread(name, center, radius=0.22, width=0.12):
        # Seventy-two modest raised chevrons share one mesh per wheel.
        cx, cy, cz = center
        verts, faces = [], []
        cube_corners = [(-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1), (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1)]
        cube_faces = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
        for i in range(36):
            angle = math.tau * i / 36
            co, si = math.cos(angle), math.sin(angle)
            for side in (-1, 1):
                base = len(verts)
                for axial_sign, tangent_sign, radial_sign in cube_corners:
                    axial_local = axial_sign * width * 0.175
                    axial = side * width * 0.215 + axial_local
                    tangent = tangent_sign * 0.010 + side * axial_local * 0.42
                    radial = radius - 0.004 + radial_sign * 0.003
                    verts.append((cx + radial * co - tangent * si, cy + axial, cz + radial * si + tangent * co))
                faces.extend(tuple(base + idx for idx in face) for face in cube_faces)
        obj = mesh_object(name, verts, faces, tread_mat)
        bevel(obj, 0.0012, 1)
        return obj

    # Narrow welded tubular frame, deliberately lower than the aircraft.
    for side in (-1, 1):
        y = side * 0.40
        rod("Longitudinal rail %s" % side, (-1.10, y, 0.35), (1.12, y, 0.35), 0.026)
    for x, name in [(-1.10, "Front"), (-0.60, "Forward saddle"), (0.35, "Center"), (1.12, "Rear")]:
        rod(name + " frame crossbar", (x, -0.40, 0.35), (x, 0.40, 0.35), 0.025)

    # Two braced saddles; the black pads are the highest trolley surfaces.
    for x, label, contact_z in [(-0.60, "Forward", 1.144), (1.05, "Rear", 1.119)]:
        lift = contact_z - 1.025
        for side in (-1, 1):
            y = side * 0.205
            rod(label + " upright %s" % side, (x, y, 0.35), (x, y, 0.955 + lift), 0.021)
            foot_x = x + 0.40 if x < 0 else x - 0.40
            rod(label + " diagonal brace %s" % side, (foot_x, side * 0.40, 0.35), (x, y, 0.81 + lift), 0.019)
        rod(label + " saddle cross tube", (x, -0.235, 0.965 + lift), (x, 0.235, 0.965 + lift), 0.025)
        box(label + " saddle steel plate", (x, 0, 0.985 + lift), (0.17, 0.44, 0.026), steel, 0.009)
        box(label + " protective rubber saddle", (x, 0, contact_z - 0.015), (0.20, 0.43, 0.030), rubber, 0.012)

    # Rear axle, drop brackets, and the two main pneumatic-looking wheels.
    rod("Rear transverse axle", (0.92, -0.69, 0.22), (0.92, 0.69, 0.22), 0.026, silver)
    for side in (-1, 1):
        y = side * 0.40
        box("Axle drop bracket %s" % side, (0.92, y, 0.287), (0.115, 0.054, 0.16), steel)
        rod("Axle bracket brace %s" % side, (0.66, y, 0.35), (0.92, y, 0.225), 0.018)
        center = (0.92, side * 0.60, 0.22)
        tire("Main tire %s" % side, center, 0.22, 0.12)
        tire_tread("Main tire tread %s" % side, center)
        rod("Main rim core %s" % side, (0.92, center[1] - 0.052, 0.22), (0.92, center[1] + 0.052, 0.22), 0.125, silver, vertices=48)
        outer_y = center[1] + side * 0.055
        rod("Inset wheel face %s" % side, (0.92, outer_y, 0.22), (0.92, outer_y + side * 0.007, 0.22), 0.095, hub_dark, vertices=40, edge=0.001)
        rod("Wheel hub %s" % side, (0.92, outer_y, 0.22), (0.92, outer_y + side * 0.029, 0.22), 0.034, silver, vertices=24)
        for index in range(6):
            angle = math.tau * index / 6
            px, pz = 0.92 + 0.062 * math.cos(angle), 0.22 + 0.062 * math.sin(angle)
            rod("Wheel bolt %s.%s" % (side, index + 1), (px, outer_y + side * 0.006, pz), (px, outer_y + side * 0.014, pz), 0.007, silver, vertices=6, edge=0.0007)

    # A small swiveling caster centered under the forward part of the frame.
    rod("Caster mounting crossbar", (-0.95, -0.40, 0.35), (-0.95, 0.40, 0.35), 0.024)
    box("Caster mounting plate", (-0.95, 0, 0.324), (0.18, 0.15, 0.035), steel)
    rod("Caster swivel stem", (-0.95, 0, 0.217), (-0.95, 0, 0.318), 0.028, silver)
    rod("Caster swivel collar", (-0.95, 0, 0.227), (-0.95, 0, 0.253), 0.048, silver, vertices=32)
    box("Caster fork crown", (-0.95, 0, 0.204), (0.115, 0.115, 0.034), silver)
    for side in (-1, 1):
        box("Caster fork cheek %s" % side, (-0.95, side * 0.049, 0.149), (0.085, 0.018, 0.128), silver, 0.01)
    rod("Caster axle", (-0.95, -0.067, 0.09), (-0.95, 0.067, 0.09), 0.011, silver)
    tire("Front caster tire", (-0.95, 0, 0.09), 0.09 / 0.977, 0.064, segments=36)
    rod("Caster wheel rim", (-0.95, -0.033, 0.09), (-0.95, 0.033, 0.09), 0.052, silver, vertices=32)
    rod("Caster hub", (-0.95, -0.061, 0.09), (-0.95, 0.061, 0.09), 0.018, hub_dark, vertices=20)

    return objects
