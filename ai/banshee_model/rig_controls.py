"""Simple visual articulation rig for the Banshee Blender asset.

Controls are angles in degrees, not flight or aerodynamic parameters.  Each
supplied object retains its world transform when the neutral rig is installed.
"""

import json
import math

import bpy
from mathutils import Matrix, Quaternion, Vector


CONTROL_NAMES = ("Left_Elevon", "Right_Elevon", "Rudder")
DESCRIPTIONS = {
    "Left_Elevon": "왼쪽 조종면 각도 (도) / Left elevon angle in degrees",
    "Right_Elevon": "오른쪽 조종면 각도 (도) / Right elevon angle in degrees",
    "Rudder": "러더 각도 (도) / Rudder angle in degrees",
}


def _parent_preserving_world(obj, parent):
    world = obj.matrix_world.copy()
    obj.parent = parent
    obj.matrix_parent_inverse = parent.matrix_world.inverted()
    obj.matrix_world = world


def _refresh(controller):
    # ID properties need an explicit dependency tag for scripted evaluation.
    controller.update_tag()
    bpy.context.view_layer.update()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    depsgraph.update()
    return depsgraph


def build_controls(root, collection, specs):
    """Build degree-driven local-Y hinges from world-space hinge endpoints.

    ``specs`` must contain Left_Elevon, Right_Elevon, and Rudder entries. Each
    entry supplies label, hinge_start, hinge_end, objects, and optionally sign.
    All moving meshes, lettering, and hardware belong in that entry's objects.
    The controller's three custom properties are the user-facing controls.
    """
    missing = set(CONTROL_NAMES) - set(specs)
    if missing:
        raise ValueError("Missing control specifications: " + ", ".join(sorted(missing)))
    used_objects = set()
    for prop in CONTROL_NAMES:
        spec = specs[prop]
        if (Vector(spec["hinge_end"]) - Vector(spec["hinge_start"])).length < 1e-8:
            raise ValueError("Zero-length hinge: " + prop)
        if not spec["objects"]:
            raise ValueError("No moving objects supplied for " + prop)
        for obj in spec["objects"]:
            if obj in used_objects:
                raise ValueError("Object assigned to multiple hinges: " + obj.name)
            if obj == root:
                raise ValueError("The aircraft root cannot be a moving control surface")
            used_objects.add(obj)

    bpy.context.view_layer.update()
    controller = bpy.data.objects.new("CONTROLS · select me", None)
    collection.objects.link(controller)
    points = [Vector(specs[p][endpoint]) for p in CONTROL_NAMES
              for endpoint in ("hinge_start", "hinge_end")]
    center = sum(points, Vector()) / len(points)
    extent = max((p - center).length for p in points)
    controller.empty_display_type = "CIRCLE"
    controller.empty_display_size = max(0.12, extent * 0.18)
    controller.location = (center.x, center.y, max(p.z for p in points) + max(0.2, extent * 0.25))
    controller.show_in_front = True
    controller.hide_render = True
    controller.color = (0.08, 0.75, 1.0, 1.0)
    bpy.context.view_layer.update()
    _parent_preserving_world(controller, root)
    controller.lock_location = (True, True, True)
    controller.lock_rotation = (True, True, True)
    controller.lock_scale = (True, True, True)
    controller["Instructions"] = (
        "Object Properties > Custom Properties: Left_Elevon / Right_Elevon / Rudder. "
        "Angles are degrees; 0 is neutral; range -25 to +25. "
        "오브젝트 속성 > 사용자 정의 속성에서 각도(도)를 변경하세요. 0은 중립입니다."
    )
    controller["Rig_Type"] = "Visual articulation only; independent hinged control surfaces"
    # Install the complete property set before any driver resolves paths into
    # it. Adding further properties after a driver has evaluated can leave its
    # dependency relations incomplete until the .blend is reopened.
    for prop in CONTROL_NAMES:
        controller[prop] = 0.0
        controller.id_properties_ui(prop).update(
            min=-25.0, max=25.0, soft_min=-25.0, soft_max=25.0,
            default=0.0, step=1.0, precision=1, description=DESCRIPTIONS[prop],
        )
    controller.update_tag()
    hinges = {}
    for prop in CONTROL_NAMES:
        spec = specs[prop]
        start, end = Vector(spec["hinge_start"]), Vector(spec["hinge_end"])
        axis = end - start
        sign = float(spec.get("sign", 1.0))
        hinge = bpy.data.objects.new("HINGE · " + spec["label"], None)
        collection.objects.link(hinge)
        hinge.parent = root
        hinge.rotation_mode = "XYZ"
        frame = axis.normalized().to_track_quat("Y", "Z").to_matrix().to_4x4()
        frame.translation = start
        # The fixed mount transform belongs in the parent inverse, leaving a
        # neutral identity basis. Consequently rotation_euler.y always rotates
        # about the exact displayed local Y axis, even for swept/slanted hinges.
        hinge.matrix_parent_inverse = root.matrix_world.inverted() @ frame
        hinge.matrix_basis = Matrix.Identity(4)
        hinge.empty_display_type = "ARROWS"
        hinge.empty_display_size = max(0.04, axis.length * 0.15)
        hinge.show_in_front = True
        hinge.hide_render = True
        hinge.color = (0.08, 0.75, 1.0, 1.0)
        hinge.lock_location = (True, True, True)
        hinge.lock_rotation = (True, False, True)
        hinge.lock_scale = (True, True, True)
        hinge["Control_Property"] = prop
        hinge["Control_Units"] = "degrees"
        hinge["Hinge_Start_World_Neutral"] = list(start)
        hinge["Hinge_End_World_Neutral"] = list(end)
        hinge["Hinge_Length"] = axis.length
        hinge["Control_Sign"] = sign
        hinge["Affected_Objects_JSON"] = json.dumps([obj.name for obj in spec["objects"]], ensure_ascii=False)
        hinge["Instructions"] = "Driven by CONTROLS · select me. Edit its angle property; do not rotate this hinge directly."
        fcurve = hinge.driver_add("rotation_euler", 1)
        driver = fcurve.driver
        driver.type = "SCRIPTED"
        variable = driver.variables.new()
        variable.name = "angle_degrees"
        variable.type = "SINGLE_PROP"
        variable.targets[0].id = controller
        variable.targets[0].data_path = '["' + prop + '"]'
        driver.expression = "angle_degrees * " + repr(sign * math.pi / 180.0)
        bpy.context.view_layer.update()
        for obj in spec["objects"]:
            _parent_preserving_world(obj, hinge)
        hinges[prop] = hinge

    _refresh(controller)
    return {"controller": controller, "hinges": hinges}


def validate_controls(rig, root=None):
    """Test independent +/-15-degree poses and restore the original values.

    Reports actual dependency-graph movement of a mesh vertex, hinge-axis
    invariance, correct rotation, unaffected other hinges, and restored pose.
    Raises AssertionError on an invalid rig. This creates no animation data.
    """
    controller, hinges = rig["controller"], rig["hinges"]
    original = {prop: float(controller[prop]) for prop in CONTROL_NAMES}
    report = {"passed": False, "controls": {}, "restored_values": original}

    def sample_for(hinge, depsgraph):
        hmat = hinge.evaluated_get(depsgraph).matrix_world
        start = hmat.translation
        axis = (hmat.to_3x3() @ Vector((0, 1, 0))).normalized()
        chosen, max_radius = None, -1.0
        for name in json.loads(hinge["Affected_Objects_JSON"]):
            obj = bpy.data.objects[name]
            if obj.type != "MESH":
                continue
            world = obj.evaluated_get(depsgraph).matrix_world
            for vertex in obj.data.vertices:
                offset = world @ vertex.co - start
                radius = (offset - axis * offset.dot(axis)).length
                if radius > max_radius:
                    max_radius = radius
                    chosen = (obj, vertex.co.copy(), world @ vertex.co)
        if chosen is None or max_radius < 1e-6:
            raise AssertionError("No mesh vertex offset from hinge " + hinge.name)
        return chosen

    try:
        for prop in CONTROL_NAMES:
            controller[prop] = 0.0
        depsgraph = _refresh(controller)
        neutral_matrices = {prop: hinge.evaluated_get(depsgraph).matrix_world.copy()
                            for prop, hinge in hinges.items()}
        samples = {prop: sample_for(hinge, depsgraph) for prop, hinge in hinges.items()}
        tolerance = max(1e-6, max(float(h["Hinge_Length"]) for h in hinges.values()) * 1e-5)
        for prop in CONTROL_NAMES:
            hinge = hinges[prop]
            neutral = neutral_matrices[prop]
            start = neutral.translation
            end = neutral @ Vector((0, float(hinge["Hinge_Length"]), 0))
            axis = (end - start).normalized()
            obj, local_vertex, neutral_vertex = samples[prop]
            poses = []
            for degrees in (-15.0, 15.0):
                controller[prop] = degrees
                depsgraph = _refresh(controller)
                evaluated = hinge.evaluated_get(depsgraph)
                matrix = evaluated.matrix_world
                current_vertex = obj.evaluated_get(depsgraph).matrix_world @ local_vertex
                expected_angle = math.radians(degrees) * float(hinge["Control_Sign"])
                expected_vertex = start + Quaternion(axis, expected_angle) @ (neutral_vertex - start)
                start_error = (matrix.translation - start).length
                end_error = (matrix @ Vector((0, float(hinge["Hinge_Length"]), 0)) - end).length
                pose_error = (current_vertex - expected_vertex).length
                moved = (current_vertex - neutral_vertex).length
                assert max(start_error, end_error, pose_error) < tolerance, (prop, degrees, start_error, end_error, pose_error)
                assert moved > tolerance, (prop, "surface did not move")
                assert abs(evaluated.rotation_euler.y - expected_angle) < 1e-6, (prop, "driver did not evaluate")
                for other_prop, other in hinges.items():
                    if other_prop == prop:
                        continue
                    current_other = other.evaluated_get(depsgraph).matrix_world
                    error = max(abs(current_other[i][j] - neutral_matrices[other_prop][i][j]) for i in range(4) for j in range(4))
                    assert error < tolerance, (prop, "moved another hinge", other_prop)
                poses.append({"degrees": degrees, "vertex_movement": moved,
                              "axis_error": max(start_error, end_error), "rotation_error": pose_error})
                controller[prop] = 0.0
                _refresh(controller)
            report["controls"][prop] = {"affected_objects": len(json.loads(hinge["Affected_Objects_JSON"])), "poses": poses}
        report["passed"] = True
    finally:
        for prop, value in original.items():
            controller[prop] = value
        _refresh(controller)
    return report
