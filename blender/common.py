"""Outils communs des scripts Blender de BAZAR BAZAR (bpy, mode script sans interface).

Convention : Blender est en Z vers le haut ; l'avant des modèles regarde vers -Y (devient +Z dans le jeu,
l'exportateur glTF convertit Y-up). Unités : mètres. Chaque matériau porte un « rôle » (nom) que le jeu
recolore à l'exécution (peau, haut, bas, cadre du rayon…).
"""
import math
import bpy
import bmesh
from mathutils import Matrix, Vector

_mats = {}


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _mats.clear()


def mat(role, color=(0.8, 0.8, 0.8), rough=0.6, metal=0.0, alpha=1.0, emit=0.0):
    """Matériau nommé par son rôle (le jeu s'en sert pour recolorer)."""
    if role in _mats:
        return _mats[role]
    m = bpy.data.materials.new(role)
    m.use_nodes = True
    b = m.node_tree.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if alpha < 1:
        b.inputs['Alpha'].default_value = alpha
        m.blend_method = 'BLEND' if hasattr(m, 'blend_method') else None
    if emit > 0:
        b.inputs['Emission Color'].default_value = (*color, 1)
        b.inputs['Emission Strength'].default_value = emit
    _mats[role] = m
    return m


def _obj_from_bm(name, bm, material):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    if material is not None:
        me.materials.append(material)
    return ob


def sphere(name, r, loc, scale=(1, 1, 1), material=None, seg=14, rings=9):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=r)
    bmesh.ops.scale(bm, vec=Vector(scale), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector(loc), verts=bm.verts)
    return _obj_from_bm(name, bm, material)


def cyl(name, r1, r2, z0, z1, loc_xy=(0, 0), material=None, seg=14, cap=True):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=cap, cap_tris=False, segments=seg, radius1=r1, radius2=r2, depth=z1 - z0)
    bmesh.ops.translate(bm, vec=Vector((loc_xy[0], loc_xy[1], (z0 + z1) / 2)), verts=bm.verts)
    return _obj_from_bm(name, bm, material)


def capsule(name, r, a, b, material=None, seg=10):
    """Capsule entre deux points a et b (rayon r)."""
    a = Vector(a)
    b = Vector(b)
    d = b - a
    L = d.length
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=8, radius=r)
    # étirer la sphère en capsule le long de Z
    for v in bm.verts:
        if v.co.z > 0:
            v.co.z += L / 2
        else:
            v.co.z -= L / 2
    rot = d.to_track_quat('Z', 'Y').to_matrix().to_4x4()
    bmesh.ops.transform(bm, matrix=rot, verts=bm.verts)
    bmesh.ops.translate(bm, vec=(a + b) / 2, verts=bm.verts)
    return _obj_from_bm(name, bm, material)


def rbox(name, size, loc, material=None, bevel=0.02, segments=2):
    """Boîte aux arêtes arrondies (biseau)."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=bm.edges[:] + bm.verts[:], offset=min(bevel, min(size) * 0.45), segments=segments, affect='EDGES', profile=0.5)
    bmesh.ops.translate(bm, vec=Vector(loc), verts=bm.verts)
    return _obj_from_bm(name, bm, material)


def torus(name, R, r, loc, rot=(0, 0, 0), material=None, arc=2 * math.pi, seg=24, sides=8, scale=(1, 1, 1)):
    bm = bmesh.new()
    verts = []
    n = seg if arc >= 2 * math.pi - 1e-6 else seg + 1
    for i in range(n):
        t = arc * i / seg
        ring = []
        for j in range(sides):
            p = 2 * math.pi * j / sides
            x = (R + r * math.cos(p)) * math.cos(t)
            y = (R + r * math.cos(p)) * math.sin(t)
            z = r * math.sin(p)
            ring.append(bm.verts.new((x, y, z)))
        verts.append(ring)
    closed = arc >= 2 * math.pi - 1e-6
    for i in range(seg if closed else seg):
        a = verts[i]
        b = verts[(i + 1) % n] if closed else verts[i + 1]
        for j in range(sides):
            bm.faces.new((a[j], a[(j + 1) % sides], b[(j + 1) % sides], b[j]))
    if not closed:
        for ring in (verts[0], verts[-1]):
            bm.faces.new(ring if ring is verts[-1] else list(reversed(ring)))
    bmesh.ops.scale(bm, vec=Vector(scale), verts=bm.verts)
    m = Matrix.Rotation(rot[0], 4, 'X') @ Matrix.Rotation(rot[1], 4, 'Y') @ Matrix.Rotation(rot[2], 4, 'Z')
    bmesh.ops.transform(bm, matrix=m, verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector(loc), verts=bm.verts)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _obj_from_bm(name, bm, material)


def subsurf(ob, levels=1):
    m = ob.modifiers.new('subd', 'SUBSURF')
    m.levels = levels
    m.render_levels = levels
    return ob


def smooth(ob):
    for p in ob.data.polygons:
        p.use_smooth = True
    return ob


def apply_all(ob):
    bpy.context.view_layer.objects.active = ob
    for m in list(ob.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)
    return ob


def join(name, objs):
    """Fusionne plusieurs objets (les matériaux sont conservés par face)."""
    objs = [o for o in objs if o is not None]
    for o in objs:
        apply_all(o)
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    ob.data.name = name
    return ob


def deform(ob, fn):
    """Applique une fonction de déformation (Vector → Vector) aux sommets."""
    apply_all(ob)
    for v in ob.data.vertices:
        v.co = fn(v.co.copy())
    ob.data.update()
    return ob


def export_glb(path, objects=None):
    bpy.ops.object.select_all(action='DESELECT')
    objs = objects if objects is not None else [o for o in bpy.context.scene.objects]
    for o in objs:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_yup=True, export_normals=True, export_materials='EXPORT', export_texcoords=False)


def tri_count(objs):
    n = 0
    for o in objs:
        for p in o.data.polygons:
            n += len(p.vertices) - 2
    return n
