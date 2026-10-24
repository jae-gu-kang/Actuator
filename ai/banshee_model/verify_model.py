"""Verify the revised articulated asset after reopening the final Blender file.

This does not save the .blend file. Temporary articulation tests restore zero.
"""
import json
import math
import os
import struct
import sys
import traceback
from collections import Counter, defaultdict

import bpy

OUT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, OUT)
from rig_controls import CONTROL_NAMES, validate_controls

REPORT = {"passed": False, "blend_file": bpy.data.filepath}
BODY_NAME = "AIRFRAME · joined fuselage and wings"
SURFACE_NAMES = ("Port · elevon", "Starboard · elevon", "Rudder · separate control surface")


def bounds(points):
    points = list(points)
    assert points, "Cannot measure an empty set of points"
    minimum = [min(p[axis] for p in points) for axis in range(3)]
    maximum = [max(p[axis] for p in points) for axis in range(3)]
    return {"min": minimum, "max": maximum,
            "size": [maximum[axis] - minimum[axis] for axis in range(3)]}


def verify_connected_airframe(body):
    """Use shared mesh edges, rather than overlap, to prove wing attachment."""
    mesh = body.data
    world_vertices = [body.matrix_world @ vertex.co for vertex in mesh.vertices]
    parent = list(range(len(world_vertices)))
    size = [1] * len(parent)

    def find(index):
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index

    for edge in mesh.edges:
        a, b = (find(index) for index in edge.vertices)
        if a != b:
            if size[a] < size[b]:
                a, b = b, a
            parent[b] = a
            size[a] += size[b]
    groups = defaultdict(list)
    for index in range(len(parent)):
        groups[find(index)].append(index)
    face_counts = Counter(find(polygon.vertices[0]) for polygon in mesh.polygons)
    ordered = sorted(groups, key=lambda root: len(groups[root]), reverse=True)
    diagnostics = [{"vertices": len(groups[root]), "faces": face_counts[root],
                    "bounds": bounds(world_vertices[index] for index in groups[root])}
                   for root in ordered]
    main_component = ordered[0]
    regions = {
        "forward_fuselage": [i for i, p in enumerate(world_vertices) if p.x < -0.7],
        "left_wingtip": [i for i, p in enumerate(world_vertices) if p.y < -1.32],
        "right_wingtip": [i for i, p in enumerate(world_vertices) if p.y > 1.32],
    }
    connectivity = {name: {"vertex_count": len(indices),
                            "all_in_main_component": bool(indices) and all(find(i) == main_component for i in indices)}
                    for name, indices in regions.items()}
    REPORT["airframe"] = {"vertices": len(mesh.vertices), "faces": len(mesh.polygons),
                          "connected_components": len(groups),
                          "component_diagnostics": diagnostics,
                          "regions": connectivity, "bounds": bounds(world_vertices)}
    assert all(result["all_in_main_component"] for result in connectivity.values()), connectivity
    assert len(groups) == 1, ("Airframe has disconnected islands; inspect component_diagnostics", diagnostics)
    return world_vertices


def verify_proportions(body, world_vertices):
    yellow_slots = {index for index, material in enumerate(body.data.materials)
                    if material is not None and "signal yellow" in material.name}
    cap_indices = set()
    for polygon in body.data.polygons:
        if polygon.material_index in yellow_slots and all(world_vertices[i].x < -1.1 for i in polygon.vertices):
            cap_indices.update(polygon.vertices)
    assert cap_indices, "The elongated yellow nose cap is missing"
    cap_bounds = bounds(world_vertices[i] for i in cap_indices)
    cap_length = cap_bounds["size"][0]
    body_section = bounds(p for p in world_vertices if -0.9 < p.x < -0.7)
    body_length = bounds(p for p in world_vertices if abs(p.y) < 0.02)["size"][0]
    fins = [bpy.data.objects[name] for name in
            ("Fin · swept composite stabiliser", "Fin · fixed lower trailing edge", "Rudder · separate control surface")]
    fin_bounds = bounds(obj.matrix_world @ vertex.co for obj in fins for vertex in obj.data.vertices)
    REPORT["proportions"] = {
        "yellow_nose_cap": cap_bounds,
        "fuselage_length_approx": body_length,
        "yellow_nose_fraction": cap_length / body_length,
        "forward_body_section": body_section,
        "vertical_tail": fin_bounds,
        "reference_basis": "Visual reconstruction from photo 1; not measured engineering dimensions",
    }
    assert abs(cap_length - 0.51) < 0.015, ("Nose cap length", cap_length)
    assert 0.15 < cap_length / body_length < 0.18, ("Nose/body proportion", cap_length, body_length)
    assert 0.29 < body_section["size"][1] < 0.34, ("Forward fuselage width", body_section)
    assert abs(fin_bounds["max"][2] - 1.928) < 0.002, ("Reduced fin top height", fin_bounds)
    assert 0.475 < fin_bounds["size"][2] < 0.505, ("Reduced fin total height", fin_bounds)
    assert abs(REPORT["airframe"]["bounds"]["size"][1] - 2.66) < 0.01, "Unexpected wingspan"


def verify_rig():
    controller = bpy.data.objects.get("CONTROLS · select me")
    assert controller is not None and controller.type == "EMPTY", "Missing user-facing controls"
    hinges = {}
    for obj in bpy.data.objects:
        if obj.name.startswith("HINGE · ") and "Control_Property" in obj:
            prop = obj["Control_Property"]
            assert prop not in hinges, ("Duplicate hinge", prop)
            hinges[prop] = obj
    assert set(hinges) == set(CONTROL_NAMES), ("Missing control hinges", list(hinges))
    assert all(abs(float(controller[prop])) < 1e-8 for prop in CONTROL_NAMES), "Saved controls must start at neutral"
    for name, prop in zip(SURFACE_NAMES, CONTROL_NAMES):
        obj = bpy.data.objects.get(name)
        assert obj is not None and obj.type == "MESH", ("Missing control surface", name)
        assert obj.parent == hinges[prop], ("Surface does not follow its hinge", name, prop)
    rig = {"controller": controller, "hinges": hinges}
    try:
        REPORT["control_motion"] = validate_controls(rig, bpy.data.objects.get("BANSHEE · aircraft assembly"))
    finally:
        for prop in CONTROL_NAMES:
            controller[prop] = 0.0
        controller.update_tag(refresh={"OBJECT"})
        bpy.context.view_layer.update()
    assert all(abs(float(controller[prop])) < 1e-8 for prop in CONTROL_NAMES)


def verify_elevon_planform():
    """Measure neutral control-surface chords from the saved geometry itself."""
    controller = bpy.data.objects.get("CONTROLS · select me")
    assert controller is not None, "Missing controls for neutral planform check"
    assert all(abs(float(controller[prop])) < 1e-8 for prop in CONTROL_NAMES), "Planform measurement requires neutral controls"
    measured = {}
    for name in SURFACE_NAMES[:2]:
        obj = bpy.data.objects.get(name)
        assert obj is not None and obj.type == "MESH", ("Missing elevon", name)
        points = [obj.matrix_world @ vertex.co for vertex in obj.data.vertices]
        spans = [abs(point.y) for point in points]
        span_ends = {"inboard": min(spans), "outboard": max(spans)}
        chords = {}
        for end, span in span_ends.items():
            section = [point for point in points if abs(abs(point.y) - span) < 1e-5]
            assert len(section) >= 4, ("Cannot measure elevon end section", name, end)
            chords[end] = max(point.x for point in section) - min(point.x for point in section)
        ratio = chords["inboard"] / chords["outboard"]
        measured[name] = {
            "inboard_x_chord": chords["inboard"],
            "outboard_x_chord": chords["outboard"],
            "inboard_outboard_ratio": ratio,
            "spanwise_length": span_ends["outboard"] - span_ends["inboard"],
        }
        assert all(0.06 < chord < 0.10 for chord in chords.values()), ("Elevon must be a narrow trailing strip", name, chords)
        assert abs(chords["inboard"] - 0.082) < 0.006, ("Unexpected inboard elevon chord", name, chords)
        assert abs(chords["outboard"] - 0.073) < 0.006, ("Unexpected outboard elevon chord", name, chords)
        assert 1.0 <= ratio <= 1.3, ("Elevon inboard/outboard chord difference is too large", name, ratio)
    for key in ("inboard_x_chord", "outboard_x_chord", "spanwise_length"):
        assert abs(measured[SURFACE_NAMES[0]][key] - measured[SURFACE_NAMES[1]][key]) < 1e-5, ("Elevon planforms differ between sides", key, measured)
    REPORT["elevon_planform"] = measured


def verify_glb(body_vertices):
    path = os.path.join(OUT, "Banshee_TwinJet.glb")
    with open(path, "rb") as source:
        raw = source.read()
    assert len(raw) >= 28, "GLB is truncated"
    magic, version, length = struct.unpack_from("<4sII", raw, 0)
    assert magic == b"glTF" and version == 2 and length == len(raw), "Invalid GLB header"
    cursor, chunks = 12, {}
    while cursor < len(raw):
        chunk_length, chunk_type = struct.unpack_from("<I4s", raw, cursor)
        cursor += 8
        assert chunk_length % 4 == 0 and cursor + chunk_length <= len(raw), "Invalid GLB chunk size"
        assert chunk_type not in chunks, "Duplicate GLB chunk"
        chunks[chunk_type] = raw[cursor:cursor + chunk_length]
        cursor += chunk_length
    assert cursor == len(raw) and b"JSON" in chunks and b"BIN\x00" in chunks, "Missing GLB chunks"
    document = json.loads(chunks[b"JSON"])
    binary = chunks[b"BIN\x00"]
    assert document["asset"]["version"] == "2.0"
    assert len(binary) >= document["buffers"][0]["byteLength"]
    for view in document["bufferViews"]:
        assert view.get("buffer", 0) == 0
        assert view.get("byteOffset", 0) + view["byteLength"] <= len(binary), "GLB buffer view exceeds binary data"
    positions = {}
    mesh_names = set()
    airframe_accessor_ids = set()
    for exported_mesh in document["meshes"]:
        mesh_names.add(exported_mesh.get("name"))
        for primitive in exported_mesh["primitives"]:
            accessor_id = primitive["attributes"]["POSITION"]
            if exported_mesh.get("name") == BODY_NAME:
                airframe_accessor_ids.add(accessor_id)
            if accessor_id in positions:
                continue
            accessor = document["accessors"][accessor_id]
            assert accessor["componentType"] == 5126 and accessor["type"] == "VEC3"
            view = document["bufferViews"][accessor["bufferView"]]
            stride = view.get("byteStride", 12)
            offset = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
            count = accessor["count"]
            assert count > 0 and stride >= 12
            assert offset + (count - 1) * stride + 12 <= view.get("byteOffset", 0) + view["byteLength"]
            values = [struct.unpack_from("<3f", binary, offset + index * stride) for index in range(count)]
            assert all(math.isfinite(value) for point in values for value in point), "Non-finite exported position"
            measured = bounds(values)
            for key in ("min", "max"):
                assert max(abs(measured[key][axis] - accessor[key][axis]) for axis in range(3)) < 2e-5, ("Incorrect accessor bounds", accessor_id)
            positions[accessor_id] = measured
    assert {BODY_NAME, *SURFACE_NAMES}.issubset(mesh_names), "GLB is missing airframe or control surface geometry"
    assert airframe_accessor_ids, "No exported airframe POSITION data"
    exported_airframe = bounds(point for accessor_id in airframe_accessor_ids
                               for point in (positions[accessor_id]["min"], positions[accessor_id]["max"]))
    expected_airframe = bounds((p.x, p.z, -p.y) for p in body_vertices)
    for key in ("min", "max"):
        assert max(abs(exported_airframe[key][axis] - expected_airframe[key][axis]) for axis in range(3)) < 2e-5, ("GLB differs from saved airframe", exported_airframe, expected_airframe)
    REPORT["glb"] = {"bytes": length, "meshes": len(document["meshes"]),
                     "checked_position_accessors": len(positions), "airframe_bounds_y_up": exported_airframe,
                     "geometry_matches_blend": True}


def verify_assets():
    scene = bpy.context.scene
    cameras = [obj.name for obj in bpy.data.objects if obj.type == "CAMERA"]
    packed = [image.name for image in bpy.data.images if image.packed_file]
    assert len(cameras) == 5, cameras
    assert len(packed) == 3, packed
    assert len([obj for obj in bpy.data.objects if "hollow titanium exhaust" in obj.name]) == 2
    assert len([obj for obj in bpy.data.objects if obj.type == "FONT"]) >= 16
    assert scene.render.resolution_percentage == 100
    REPORT["scene_assets"] = {"cameras": cameras, "packed_reference_images": packed}
    previews = []
    for name in ("banshee_hero.png", "banshee_front.png", "banshee_top.png", "banshee_side.png"):
        path = os.path.join(OUT, "previews", name)
        with open(path, "rb") as source:
            header = source.read(24)
        assert header[:8] == b"\x89PNG\r\n\x1a\n" and header[12:16] == b"IHDR", ("Invalid preview", name)
        width, height = struct.unpack(">II", header[16:24])
        assert width >= 640 and height >= 480, ("Unexpected preview resolution", name, width, height)
        image_size = os.path.getsize(path)
        assert image_size > 100000, ("Preview appears incomplete", name, image_size)
        previews.append({"name": name, "width": width, "height": height, "bytes": image_size})
    REPORT["previews"] = previews


try:
    body = bpy.data.objects.get(BODY_NAME)
    assert body is not None and body.type == "MESH", "Missing joined airframe mesh"
    bpy.context.view_layer.update()
    body_vertices = verify_connected_airframe(body)
    verify_proportions(body, body_vertices)
    verify_rig()
    verify_elevon_planform()
    verify_glb(body_vertices)
    verify_assets()
    REPORT["passed"] = True
except Exception as error:
    REPORT["error"] = str(error)
    REPORT["traceback"] = traceback.format_exc()
    raise
finally:
    with open(os.path.join(OUT, "verification_report.json"), "w", encoding="utf-8") as destination:
        json.dump(REPORT, destination, ensure_ascii=False, indent=2)
    print("VERIFICATION", json.dumps(REPORT, ensure_ascii=False))
