"""Small, dependency-free GLB 2.0 exporter for Blender presentation assets.

The public entry point is export_glb(filepath, objects).  Geometry is evaluated
with modifiers, object transforms are baked, and Blender Z-up is rotated to
glTF Y-up.  Meshes, curves, and text export as triangles with split normals.
Materials use flat Principled BSDF parameters; textures are not exported.
"""

import json
import math
import os
import struct

import bpy
from mathutils import Vector


def export_glb(filepath, objects):
    """Write a GLB containing the supplied objects without changing originals.

    Returns a compact export report.  Temporary evaluated meshes are always
    cleared, including on error.  All output nodes have identity transforms;
    this preserves final geometry and placement without parenting concerns.
    """
    filepath = os.path.abspath(os.fspath(filepath))
    depsgraph = bpy.context.evaluated_depsgraph_get()
    document = {
        "asset": {"version": "2.0", "generator": "Banshee presentation / pure Python GLB exporter"},
        "scene": 0,
        "scenes": [{"name": "Banshee presentation", "nodes": []}],
        "nodes": [],
        "meshes": [],
        "materials": [],
        "accessors": [],
        "bufferViews": [],
        "buffers": [],
    }
    binary = bytearray()
    material_cache = {}
    triangle_count = 0
    vertex_count = 0

    def clamp(value, lower=0.0, upper=1.0):
        number = float(value)
        if not math.isfinite(number):
            return lower
        return max(lower, min(upper, number))

    def socket_value(shader, name, fallback):
        socket = shader.inputs.get(name) if shader is not None else None
        return socket.default_value if socket is not None else fallback

    def export_material(source):
        # Blender materials are unique datablocks and hashable by identity.
        if source in material_cache:
            return material_cache[source]
        shader = None
        if source is not None and source.use_nodes and source.node_tree:
            shader = next((node for node in source.node_tree.nodes if node.type == "BSDF_PRINCIPLED"), None)
        fallback_color = tuple(source.diffuse_color) if source is not None else (0.65, 0.65, 0.65, 1.0)
        color = socket_value(shader, "Base Color", fallback_color)
        alpha = clamp(socket_value(shader, "Alpha", fallback_color[3]))
        metallic_default = source.metallic if source is not None else 0.0
        roughness_default = source.roughness if source is not None else 0.5
        result = {
            "name": source.name if source is not None else "Default material",
            "pbrMetallicRoughness": {
                "baseColorFactor": [clamp(color[0]), clamp(color[1]), clamp(color[2]), alpha],
                "metallicFactor": clamp(socket_value(shader, "Metallic", metallic_default)),
                "roughnessFactor": clamp(socket_value(shader, "Roughness", roughness_default)),
            },
            "doubleSided": not bool(getattr(source, "use_backface_culling", False)),
        }
        if alpha < 0.999:
            result["alphaMode"] = "BLEND"
        index = len(document["materials"])
        document["materials"].append(result)
        material_cache[source] = index
        return index

    def append_buffer(payload, target):
        while len(binary) % 4:
            binary.append(0)
        offset = len(binary)
        binary.extend(payload)
        index = len(document["bufferViews"])
        document["bufferViews"].append({
            "buffer": 0,
            "byteOffset": offset,
            "byteLength": len(payload),
            "target": target,
        })
        return index

    def vector_accessor(values):
        packed = struct.pack("<%df" % len(values), *values)
        view_index = append_buffer(packed, 34962)  # ARRAY_BUFFER
        index = len(document["accessors"])
        document["accessors"].append({
            "bufferView": view_index,
            "byteOffset": 0,
            "componentType": 5126,  # FLOAT
            "count": len(values) // 3,
            "type": "VEC3",
            "min": [min(values[axis::3]) for axis in range(3)],
            "max": [max(values[axis::3]) for axis in range(3)],
        })
        return index

    def index_accessor(indices):
        packed = struct.pack("<%dI" % len(indices), *indices)
        view_index = append_buffer(packed, 34963)  # ELEMENT_ARRAY_BUFFER
        index = len(document["accessors"])
        document["accessors"].append({
            "bufferView": view_index,
            "byteOffset": 0,
            "componentType": 5125,  # UNSIGNED_INT
            "count": len(indices),
            "type": "SCALAR",
            "min": [min(indices)],
            "max": [max(indices)],
        })
        return index

    def converted(vector):
        # A proper -90-degree X rotation, with determinant +1.
        return (float(vector.x), float(vector.z), float(-vector.y))

    for source_obj in objects:
        if source_obj.type not in {"MESH", "CURVE", "FONT", "SURFACE", "META"}:
            continue
        evaluated_obj = source_obj.evaluated_get(depsgraph)
        mesh = None
        try:
            try:
                mesh = evaluated_obj.to_mesh(preserve_all_data_layers=True, depsgraph=depsgraph)
            except TypeError:
                # Compatibility with Blender releases with a smaller signature.
                mesh = evaluated_obj.to_mesh()
            if mesh is None:
                continue
            mesh.calc_loop_triangles()
            if not mesh.loop_triangles:
                continue
            calculate_split = getattr(mesh, "calc_normals_split", None)
            if calculate_split is not None:
                calculate_split()

            world = evaluated_obj.matrix_world.copy()
            linear = world.to_3x3()
            normals_transform = linear.inverted_safe().transposed()
            reverse_winding = linear.determinant() < 0.0
            corner_normals = getattr(mesh, "corner_normals", None)
            has_corner_normals = corner_normals is not None and len(corner_normals) == len(mesh.loops)

            positions, normals = [], []
            vertex_map = {}
            grouped_indices = {}
            for triangle in mesh.loop_triangles:
                slot = triangle.material_index
                source_material = mesh.materials[slot] if 0 <= slot < len(mesh.materials) else None
                material_index = export_material(source_material)
                primitive_indices = grouped_indices.setdefault(material_index, [])
                loops = tuple(triangle.loops)
                if reverse_winding:
                    loops = (loops[0], loops[2], loops[1])
                for loop_index in loops:
                    loop = mesh.loops[loop_index]
                    vertex = mesh.vertices[loop.vertex_index]
                    position = converted(world @ vertex.co)
                    if has_corner_normals:
                        local_normal = corner_normals[loop_index].vector
                    else:
                        local_normal = getattr(loop, "normal", vertex.normal)
                    normal = normals_transform @ local_normal
                    if normal.length_squared < 1e-20:
                        normal = normals_transform @ triangle.normal
                    if normal.length_squared < 1e-20:
                        normal = Vector((0.0, 0.0, 1.0))
                    normal.normalize()
                    normal_values = converted(normal)
                    key = position + normal_values
                    if not all(math.isfinite(value) for value in key):
                        raise ValueError("Non-finite geometry in %r" % source_obj.name)
                    vertex_index = vertex_map.get(key)
                    if vertex_index is None:
                        vertex_index = len(positions) // 3
                        vertex_map[key] = vertex_index
                        positions.extend(position)
                        normals.extend(normal_values)
                    primitive_indices.append(vertex_index)

            if not positions:
                continue
            position_accessor = vector_accessor(positions)
            normal_accessor = vector_accessor(normals)
            primitives = []
            for material_index, indices in grouped_indices.items():
                if not indices:
                    continue
                primitives.append({
                    "attributes": {"POSITION": position_accessor, "NORMAL": normal_accessor},
                    "indices": index_accessor(indices),
                    "material": material_index,
                    "mode": 4,  # TRIANGLES
                })
                triangle_count += len(indices) // 3
            mesh_index = len(document["meshes"])
            document["meshes"].append({"name": source_obj.name, "primitives": primitives})
            node_index = len(document["nodes"])
            document["nodes"].append({"name": source_obj.name, "mesh": mesh_index})
            document["scenes"][0]["nodes"].append(node_index)
            vertex_count += len(positions) // 3
        finally:
            if mesh is not None:
                evaluated_obj.to_mesh_clear()

    if not document["meshes"]:
        raise ValueError("No triangulated mesh, curve, or text geometry was supplied")

    while len(binary) % 4:
        binary.append(0)
    document["buffers"] = [{"byteLength": len(binary)}]
    json_bytes = json.dumps(document, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")
    json_bytes += b" " * ((-len(json_bytes)) % 4)
    total_length = 12 + 8 + len(json_bytes) + 8 + len(binary)
    if total_length >= 2**32:
        raise ValueError("GLB exceeds the format's 32-bit file length limit")
    parent = os.path.dirname(filepath)
    if parent:
        os.makedirs(parent, exist_ok=True)
    with open(filepath, "wb") as destination:
        destination.write(struct.pack("<4sII", b"glTF", 2, total_length))
        destination.write(struct.pack("<I4s", len(json_bytes), b"JSON"))
        destination.write(json_bytes)
        destination.write(struct.pack("<I4s", len(binary), b"BIN\x00"))
        destination.write(binary)
    return {
        "filepath": filepath,
        "objects": len(document["nodes"]),
        "materials": len(document["materials"]),
        "vertices": vertex_count,
        "triangles": triangle_count,
        "bytes": total_length,
    }
