"""Mobilier BAZAR BAZAR modélisé avec Blender, aux dimensions exactes du jeu (blender/spec.json).

Lancer :  python-avec-bpy blender/equipment_kit.py
Sortie :  public/models/equipment.glb — un objet « equip__<id> » par équipement.

Repère local : largeur W sur X, profondeur D sur Y (l'avant du meuble regarde vers -Y), hauteur sur Z,
centre de l'emprise à l'origine. Les tablettes sont à la hauteur exacte des niveaux du jeu (les produits du
jeu se posent dessus). Rôles de matériaux recolorés par le jeu : frame (couleur des rayons du magasin),
accent (couleur d'enseigne) ; les autres sont fixes.
"""
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import bpy  # noqa: E402
from common import capsule, cyl, export_glb, join, mat, rbox, reset, smooth, sphere, torus, tri_count  # noqa: E402

HERE = os.path.dirname(__file__)
OUT = os.path.join(HERE, '..', 'public', 'models', 'equipment.glb')
SPEC = json.load(open(os.path.join(HERE, 'spec.json')))
WALL_H = 4.2

reset()
M = {
    'frame': mat('frame', (0.85, 0.87, 0.9), 0.5, 0.3),
    'board': mat('board', (0.93, 0.94, 0.96), 0.45, 0.2),
    'plinth': mat('plinth', (0.25, 0.27, 0.3), 0.6),
    'rail': mat('rail', (0.98, 0.98, 0.98), 0.5),
    'accent': mat('accent', (0.91, 0.25, 0.09), 0.5),
    'wood': mat('wood', (0.62, 0.42, 0.24), 0.8),
    'woodlight': mat('woodlight', (0.82, 0.64, 0.42), 0.8),
    'wicker': mat('wicker', (0.78, 0.6, 0.36), 0.9),
    'white': mat('white', (0.95, 0.95, 0.96), 0.4),
    'interior': mat('interior', (0.82, 0.88, 0.94), 0.5),
    'dark': mat('dark', (0.13, 0.14, 0.16), 0.5),
    'metal': mat('metal', (0.72, 0.74, 0.77), 0.3, 0.8),
    'rubber': mat('rubber', (0.08, 0.08, 0.09), 0.9),
    'glass': mat('glass', (0.75, 0.88, 1.0), 0.05, 0.0, 0.25),
    'light': mat('light', (1.0, 0.97, 0.88), 0.4, 0.0, 1.0, 3.0),
    'screen': mat('screen', (0.2, 0.75, 0.85), 0.2, 0.0, 1.0, 1.5),
    'blue': mat('blue', (0.04, 0.45, 0.85), 0.5),
    'rack_blue': mat('rack_blue', (0.12, 0.38, 0.8), 0.5, 0.3),
    'rack_orange': mat('rack_orange', (0.95, 0.5, 0.1), 0.5, 0.2),
    'red': mat('red', (0.85, 0.15, 0.15), 0.5),
    'yellow': mat('yellow', (1.0, 0.82, 0.15), 0.5),
    'green': mat('green', (0.18, 0.55, 0.3), 0.8),
    'leaf': mat('leaf', (0.25, 0.62, 0.3), 0.7),
    'pot': mat('pot', (0.72, 0.42, 0.3), 0.8),
    'pink': mat('pink', (1.0, 0.31, 0.85), 0.3, 0.0, 1.0, 2.5),
    'paper': mat('paper', (1.0, 0.85, 0.2), 0.8),
}

models = []


def model(eid, objs):
    objs = [o for o in objs if o is not None]
    ob = join(f'equip__{eid}', objs)
    models.append(ob)
    return ob


def text(t, size, loc, material, rot=(math.pi / 2, 0, 0), extrude=0.008, align='CENTER'):
    """Texte 3D (police intégrée de Blender), converti en maillage."""
    cu = bpy.data.curves.new('txt', 'FONT')
    cu.body = t
    cu.size = size
    cu.extrude = extrude
    cu.align_x = align
    cu.align_y = 'CENTER'
    ob = bpy.data.objects.new('txt', cu)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = loc
    ob.rotation_euler = rot
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.ops.object.convert(target='MESH')
    ob = bpy.context.view_layer.objects.active
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    ob.data.materials.clear()
    ob.data.materials.append(material)
    return ob


def box(size, center, m, bevel=0.01, seg=1):
    return rbox('b', size, center, m, bevel, seg)


def shelf_unit(e, low=False):
    W, D, H = e['w'], e['d'], e['h']
    s = e['shelf']
    objs = [box((W, D - 0.02, 0.1), (0, 0, 0.05), M['plinth'], 0.015)]
    if s['sides'] == 2:
        objs.append(box((W - 0.04, 0.04, H - 0.1), (0, 0, 0.1 + (H - 0.1) / 2), M['frame'], 0.008))
        for sd in (1, -1):
            for lv in s['levels']:
                yc = -sd * (D / 2 - 0.02) / 2
                objs.append(box((W - 0.08, D / 2 - 0.04, 0.03), (0, yc, lv - 0.015), M['board'], 0.006))
                objs.append(box((W - 0.08, 0.012, 0.045), (0, -sd * (D / 2 - 0.03), lv - 0.02), M['rail'], 0.004))
    else:
        back = D / 2 - 0.04
        objs.append(box((W - 0.04, 0.04, H - 0.1), (0, back + 0.02, 0.1 + (H - 0.1) / 2), M['frame'], 0.008))
        depth = s['depth']
        for lv in s['levels']:
            objs.append(box((W - 0.08, depth, 0.03), (0, back - depth / 2, lv - 0.015), M['board'], 0.006))
            objs.append(box((W - 0.08, 0.012, 0.045), (0, back - depth - 0.004, lv - 0.02), M['rail'], 0.004))
    for sx in (-1, 1):
        objs.append(box((0.04, D, H), (sx * (W / 2 - 0.02), 0, H / 2), M['frame'], 0.01))
    # fronton (bandeau d'enseigne)
    objs.append(box((W, 0.08 if s['sides'] == 2 else 0.06, 0.16), (0, 0 if s['sides'] == 2 else D / 2 - 0.05, H + 0.08), M['accent'], 0.02, 2))
    return objs


def fridge(e, glass_doors):
    W, D, H = e['w'], e['d'], e['h']
    s = e['shelf']
    back = -D / 2
    objs = [
        box((W, D, 0.12), (0, 0, 0.06), M['dark'], 0.02),  # socle
        box((W, 0.06, H), (0, D / 2 - 0.03, H / 2), M['white'], 0.02),  # dos
        box((0.06, D, H), (-W / 2 + 0.03, 0, H / 2), M['white'], 0.02),
        box((0.06, D, H), (W / 2 - 0.03, 0, H / 2), M['white'], 0.02),
        box((W, D, 0.18), (0, 0, H - 0.09), M['white'], 0.03, 2),  # chapeau
        box((W - 0.12, 0.02, 0.1), (0, -D / 2 - 0.005, H - 0.1), M['blue'], 0.01),  # bandeau bleu
        box((W - 0.16, 0.02, 0.025), (0, -D / 2 + 0.06, H - 0.2), M['light'], 0.005),  # rampe LED
        box((W - 0.12, 0.02, H - 0.35), (0, D / 2 - 0.07, (H - 0.35) / 2 + 0.12), M['interior'], 0.005),
    ]
    depth = s['depth']
    for lv in s['levels']:
        objs.append(box((W - 0.14, depth, 0.02), (0, D / 2 - 0.08 - depth / 2, lv - 0.01), M['metal'], 0.004))
        objs.append(box((W - 0.14, 0.01, 0.04), (0, D / 2 - 0.08 - depth - 0.005, lv - 0.01), M['rail'], 0.003))
    if glass_doors:
        n = 2
        for i in range(n):
            x0 = -W / 2 + 0.06 + i * (W - 0.12) / n
            x1 = x0 + (W - 0.12) / n
            objs.append(box((x1 - x0 - 0.02, 0.02, H - 0.34), ((x0 + x1) / 2, -D / 2 + 0.02, 0.12 + (H - 0.34) / 2), M['glass'], 0.004))
            objs.append(box((0.03, 0.03, H - 0.34), (x1 - 0.015, -D / 2 + 0.01, 0.12 + (H - 0.34) / 2), M['dark'], 0.006))
            objs.append(box((0.02, 0.05, 0.5), (x1 - 0.06 if i == 0 else x0 + 0.06, -D / 2 - 0.02, 1.05), M['metal'], 0.008))
    else:
        objs.append(box((W - 0.12, 0.06, 0.2), (0, -D / 2 + 0.03, 0.22), M['white'], 0.02))
    return objs


def freezer(e):
    W, D, H = e['w'], e['d'], e['h']
    return [
        box((W, D, H - 0.04), (0, 0, (H - 0.04) / 2), M['white'], 0.05, 2),
        box((W + 0.01, D + 0.01, 0.12), (0, 0, 0.3), M['blue'], 0.03),
        box((W - 0.14, D - 0.14, 0.01), (0, 0, H - 0.06), M['interior'], 0.0),
        box((W / 2 - 0.08, D - 0.1, 0.02), (-W / 4 + 0.01, 0, H - 0.01), M['glass'], 0.005),
        box((W / 2 - 0.08, D - 0.1, 0.02), (W / 4 - 0.01, 0, H + 0.01), M['glass'], 0.005),
        box((W, 0.04, 0.03), (0, -D / 2, H), M['metal'], 0.01),
        box((W, 0.04, 0.03), (0, D / 2, H), M['metal'], 0.01),
    ]


def produce(e):
    W, D, H = e['w'], e['d'], e['h']
    s = e['shelf']
    objs = [box((W, D, s['levels'][0] - 0.12), (0, 0, (s['levels'][0] - 0.12) / 2), M['wood'], 0.03, 2)]
    F = s['facings']
    fw = W / F
    for sd in range(s['sides']):
        sign = -1 if sd == 0 else 1
        for li, lv in enumerate(s['levels']):
            for f in range(F):
                x = -W / 2 + (f + 0.5) * fw
                y = sign * (D / 4 if s['sides'] == 2 else 0)
                dep = s['depth']
                objs.append(box((fw - 0.06, dep, 0.11), (x, y, lv - 0.055), M['woodlight'], 0.012))
            if li > 0:
                objs.append(box((W - 0.04, 0.05, lv - s['levels'][0]), (0, 0, (lv + s['levels'][0]) / 2 - 0.12), M['wood'], 0.01))
    # petit auvent rayé
    for sx in (-1, 1):
        objs.append(cyl('p', 0.025, 0.025, 0, H + 0.6, (sx * (W / 2 - 0.05), 0), M['wood'], 8))
    for i in range(6):
        x0 = -W / 2 + i * W / 6
        objs.append(box((W / 6, D * 0.7, 0.04), (x0 + W / 12, 0, H + 0.62), M['accent'] if i % 2 == 0 else M['white'], 0.01))
    return objs


def bread(e):
    W, D, H = e['w'], e['d'], e['h']
    s = e['shelf']
    objs = [box((W, D, s['levels'][0] - 0.1), (0, 0, (s['levels'][0] - 0.1) / 2), M['wood'], 0.03, 2)]
    objs.append(box((W, 0.08, H), (0, D / 2 - 0.04, H / 2), M['wood'], 0.02))
    F = s['facings']
    fw = W / F
    for li, lv in enumerate(s['levels']):
        y = D / 2 - 0.08 - s['depth'] / 2 + li * 0.15
        objs.append(box((W - 0.04, s['depth'] - li * 0.3, 0.04), (0, y + li * 0.15, lv - 0.12), M['wood'], 0.01))
        for f in range(F):
            x = -W / 2 + (f + 0.5) * fw
            b = cyl('b', fw * 0.42, fw * 0.36, lv - 0.12, lv - 0.02, (x, y + li * 0.15), M['wicker'], 16)
            objs.append(b)
    objs.append(text('BOULANGERIE', 0.12, (0, D / 2 - 0.09, H - 0.12), M['white']))
    return objs


def pyramid(e):
    W, D = e['w'], e['d']
    return [box((W, D, 0.3), (0, 0, 0.15), M['accent'], 0.05, 2), box((W * 0.96, D * 0.96, 0.05), (0, 0, 0.325), M['yellow'], 0.02), text('PROMO', 0.14, (0, -D / 2 - 0.006, 0.17), M['white'])]


def checkout(e):
    W, D = e['w'], e['d']
    objs = [
        box((W - 0.3, 0.7, 0.85), (0.05, 0.08, 0.425), M['white'], 0.04, 2),
        box((W - 0.3, 0.02, 0.2), (0.05, -0.28, 0.55), M['accent'], 0.01),
        box((1.45, 0.42, 0.04), (0.65, 0.05, 0.87), M['rubber'], 0.01),
        box((1.5, 0.04, 0.06), (0.65, -0.18, 0.89), M['metal'], 0.01),
        box((1.5, 0.04, 0.06), (0.65, 0.28, 0.89), M['metal'], 0.01),
        box((0.42, 0.36, 0.12), (-0.45, 0.2, 0.92), M['dark'], 0.02),
        box((0.32, 0.04, 0.24), (-0.45, 0.33, 1.08), M['dark'], 0.01),
        box((0.28, 0.01, 0.18), (-0.45, 0.31, 1.08), M['screen'], 0.0),
        box((0.08, 0.1, 0.06), (-0.12, -0.15, 0.9), M['dark'], 0.01),  # terminal CB
        box((0.5, 0.42, 0.04), (-1.15, 0.05, 0.82), M['metal'], 0.01),  # zone d'emballage
        cyl('p', 0.025, 0.025, 0.85, 2.15, (-1.1, -0.25), M['metal'], 10),
        cyl('l', 0.09, 0.09, 2.15, 2.3, (-1.1, -0.25), M['light'], 16),
    ]
    return objs


def checkout_auto(e):
    return [
        box((0.6, 0.5, 0.9), (0, 0.1, 0.45), M['dark'], 0.04, 2),
        box((0.5, 0.08, 0.5), (0, 0.24, 1.15), M['dark'], 0.03, 2),
        box((0.42, 0.01, 0.34), (0, 0.195, 1.16), M['screen'], 0.0),
        box((0.4, 0.4, 0.04), (0.25, -0.2, 0.92), M['metal'], 0.01),
        box((0.2, 0.12, 0.05), (-0.12, -0.08, 0.93), M['red'], 0.01),
    ]


def rack(e):
    W, D, H = e['w'], e['d'], e['h']
    objs = []
    for sx in (-1, 1):
        for sy in (-1, 1):
            objs.append(box((0.07, 0.07, H), (sx * (W / 2 - 0.035), sy * (D / 2 - 0.035), H / 2), M['rack_blue'], 0.01))
    for z in (0.14, 0.89, 1.64):
        for sy in (-1, 1):
            objs.append(box((W, 0.06, 0.09), (0, sy * (D / 2 - 0.03), z - 0.05), M['rack_orange'], 0.01))
        objs.append(box((W - 0.1, D - 0.1, 0.02), (0, 0, z - 0.02), M['woodlight'], 0.004))
    return objs


def cold_room(e):
    W, D, H = e['w'], e['d'], e['h']
    return [
        box((W, D, H), (0, 0, H / 2), M['white'], 0.04, 2),
        box((W * 0.5, 0.05, H * 0.85), (0, -D / 2 - 0.01, H * 0.85 / 2 + 0.02), M['metal'], 0.02),
        box((0.06, 0.08, 0.4), (W * 0.18, -D / 2 - 0.05, 1.1), M['dark'], 0.01),
        box((W + 0.02, D + 0.02, 0.12), (0, 0, H - 0.2), M['blue'], 0.02),
        text('FROID', 0.22, (0, -D / 2 - 0.04, H - 0.5), M['blue']),
    ]


def props(e):
    eid, W, D, H = e['id'], e['w'], e['d'], e['h']
    if eid == 'camera':
        return [box((0.18, 0.18, 0.04), (0, 0, WALL_H - 0.04), M['white'], 0.01), sphere('d', 0.09, (0, 0, WALL_H - 0.06), (1, 1, 0.8), M['dark'], 14, 8), sphere('r', 0.015, (0.06, -0.06, WALL_H - 0.08), material=M['red'])]
    if eid == 'detecteur':
        return [box((0.12, 0.12, 0.08), (0, 0, WALL_H - 0.06), M['white'], 0.02), sphere('l', 0.015, (0, -0.06, WALL_H - 0.08), material=M['red'])]
    if eid == 'panneau_rayon':
        return [box((0.95, 0.04, 0.26), (0, 0, 2.7), M['accent'], 0.02, 2), text('RAYONS ➜' if False else 'RAYONS', 0.14, (0, -0.025, 2.7), M['white'])] + [cyl('c', 0.004, 0.004, 2.83, WALL_H, (sx, 0), M['dark'], 4) for sx in (-0.35, 0.35)]
    if eid == 'spot':
        return [cyl('c', 0.006, 0.006, WALL_H - 0.8, WALL_H, (0, 0), M['dark'], 4), cyl('s', 0.05, 0.16, WALL_H - 0.97, WALL_H - 0.8, (0, 0), M['dark'], 16), sphere('b', 0.07, (0, 0, WALL_H - 0.98), material=M['light'])]
    if eid == 'neon':
        return [box((W * 0.92, 0.04, 0.5), (0, D / 2 - 0.03, 2.4), M['dark'], 0.02), text('OUVERT', 0.2, (0, D / 2 - 0.06, 2.4), M['pink'])]
    if eid == 'affiche':
        return [box((W * 0.92, 0.03, 1.2), (0, D / 2 - 0.02, 1.6), M['paper'], 0.01), text('PROMO', 0.2, (0, D / 2 - 0.04, 1.85), M['red']), text('DU SIÈCLE', 0.13, (0, D / 2 - 0.04, 1.5), M['red'])]
    if eid == 'plante':
        objs = [cyl('p', 0.17, 0.13, 0, 0.38, (0, 0), M['pot'], 16)]
        for (x, y, z, r) in ((0, 0, 0.75, 0.24), (-0.1, 0.05, 0.95, 0.2), (0.1, -0.05, 1.0, 0.19), (0, 0, 1.2, 0.17)):
            objs.append(sphere('f', r, (x, y, z), (1, 1, 1.1), M['leaf'], 12, 8))
        objs.append(cyl('t', 0.02, 0.02, 0.35, 0.8, (0, 0), M['wood'], 6))
        return objs
    if eid == 'poubelle':
        return [cyl('b', 0.19, 0.17, 0, 0.8, (0, 0), M['dark'], 16), cyl('c', 0.2, 0.2, 0.8, 0.86, (0, 0), M['metal'], 16)]
    if eid == 'extincteur':
        return [cyl('b', 0.08, 0.08, 0, 0.5, (0, 0), M['red'], 14), sphere('t', 0.08, (0, 0, 0.5), (1, 1, 0.7), M['red']), cyl('v', 0.02, 0.02, 0.5, 0.62, (0, 0), M['dark'], 8), box((0.12, 0.03, 0.02), (0.04, 0, 0.63), M['dark'], 0.005)]
    if eid == 'paniers':
        return [box((0.42, 0.32, 0.09), (0, 0, 0.05 + i * 0.07), M['red'], 0.02) for i in range(6)] + [torus('a', 0.13, 0.008, (0, 0, 0.47), (math.pi / 2, 0, math.pi / 2), M['dark'], arc=math.pi, seg=10, sides=5)]
    if eid == 'caddies':
        objs = [box((W, D, 0.04), (0, 0, 0.02), M['dark'], 0.01)]
        for i in range(3):
            x = -W / 2 + 0.35 + i * 0.62
            objs += [box((0.5, 0.8, 0.45), (x, 0, 0.7), M['metal'], 0.02), box((0.5, 0.04, 0.04), (x, 0.42, 0.95), M['red'], 0.01)]
            objs += [sphere('w', 0.05, (x + sx * 0.2, sy * 0.3, 0.06), material=M['dark']) for sx in (-1, 1) for sy in (-1, 1)]
        return objs
    if eid == 'tapis':
        return [box((W, D, 0.02), (0, 0, 0.01), M['dark'], 0.008), text('BIENVENUE', 0.14, (0, 0, 0.021), M['yellow'], rot=(0, 0, 0), extrude=0.002)]
    if eid == 'portique':
        return [box((0.1, 0.35, 1.6), (sx * (W / 2 - 0.05), 0, 0.8), M['white'], 0.04, 2) for sx in (-1, 1)] + [box((0.11, 0.36, 0.06), (sx * (W / 2 - 0.05), 0, 1.45), M['blue'], 0.01) for sx in (-1, 1)]
    if eid == 'coffre':
        return [box((W - 0.04, D - 0.04, H), (0, 0, H / 2), M['dark'], 0.03, 2), cyl('m', 0.07, 0.07, -0.01, 0.02, (0, 0), M['metal'], 16)]
    if eid == 'vitrine_secu':
        return [box((W, D, 0.8), (0, 0, 0.4), M['wood'], 0.02), box((W - 0.04, D - 0.04, 0.6), (0, 0, 1.1), M['glass'], 0.01), box((W, D, 0.04), (0, 0, 1.42), M['wood'], 0.01)]
    if eid == 'ecran_secu':
        objs = [box((W, D * 0.7, 0.75), (0, 0.1, 0.375), M['wood'], 0.02)]
        for i in range(4):
            x = -0.36 + (i % 2) * 0.72
            z = 0.98 + (i // 2) * 0.34
            objs += [box((0.66, 0.05, 0.3), (x, 0.3, z), M['dark'], 0.01), box((0.6, 0.01, 0.25), (x, 0.274, z), M['screen'], 0.0)]
        return objs
    if eid == 'bureau':
        return [box((W, D * 0.8, 0.05), (0, 0, 0.75), M['wood'], 0.01)] + [box((0.05, D * 0.75, 0.73), (sx * (W / 2 - 0.05), 0, 0.37), M['dark'], 0.01) for sx in (-1, 1)] + [box((0.4, 0.05, 0.28), (0, 0.15, 0.95), M['dark'], 0.01), box((0.36, 0.01, 0.22), (0, 0.124, 0.95), M['screen'], 0.0), box((0.45, 0.45, 0.06), (0, -0.55, 0.45), M['dark'], 0.03)]
    if eid == 'casiers':
        return [box((W / 3 - 0.02, D, H), (-W / 2 + (i + 0.5) * W / 3, 0, H / 2), M['blue'], 0.01) for i in range(3)] + [box((0.04, 0.01, 0.12), (-W / 2 + (i + 0.5) * W / 3 + 0.12, -D / 2 - 0.005, 1.1), M['metal'], 0.003) for i in range(3)]
    if eid == 'salle_pause':
        return [cyl('t', 0.45, 0.45, 0.72, 0.76, (0.2, 0.1), M['white'], 20), cyl('p', 0.04, 0.04, 0, 0.72, (0.2, 0.1), M['metal'], 8), box((0.45, 0.4, 1.55), (-0.5, 0.5, 0.775), M['dark'], 0.03), box((0.2, 0.01, 0.15), (-0.5, 0.295, 1.2), M['screen'], 0.0)] + [box((0.38, 0.38, 0.45), (0.2 + dx, 0.1 + dy, 0.225), M['red'], 0.04) for dx, dy in ((0.6, 0), (-0.55, -0.3))]
    if eid == 'toilettes':
        return [box((W, D, H), (0, 0, H / 2), M['white'], 0.04, 2), box((0.7, 0.04, 1.95), (0, -D / 2 - 0.01, 1.0), M['blue'], 0.02), text('WC', 0.25, (0, -D / 2 - 0.035, 1.6), M['white'])]
    if eid == 'cafe_client':
        return [box((W - 0.06, D - 0.1, H), (0, 0.04, H / 2), M['dark'], 0.03, 2), box((0.3, 0.01, 0.25), (0, -D / 2 + 0.085, 1.3), M['screen'], 0.0), cyl('c', 0.04, 0.035, 0.75, 0.85, (0, -0.1), M['white'], 12), box((W - 0.1, 0.05, 0.08), (0, -D / 2 + 0.07, 1.6), M['red'], 0.01)]
    if eid == 'ballons':
        objs = [cyl('w', 0.08, 0.1, 0, 0.12, (0, 0), M['dark'], 12)]
        for (x, y, z, m) in ((0, 0, 2.0, 'red'), (-0.18, 0.06, 1.85, 'yellow'), (0.17, -0.05, 1.9, 'blue'), (0.02, 0.15, 2.15, 'pink')):
            objs.append(sphere('b', 0.17, (x, y, z), (1, 1, 1.18), M[m], 14, 10))
            objs.append(capsule('s', 0.004, (0, 0, 0.12), (x, y, z - 0.18), M['dark'], 4))
        return objs
    # par défaut : boîte simple
    return [box((W - 0.04, D - 0.04, H), (0, 0, H / 2), M['white'], 0.03)]


for e in SPEC['equipment']:
    eid = e['id']
    if eid in ('gondole_simple', 'gondole_double', 'gondole_basse'):
        objs = shelf_unit(e)
    elif eid == 'frigo_vitre':
        objs = fridge(e, True)
    elif eid == 'frigo_mural':
        objs = fridge(e, False)
    elif eid == 'congelateur':
        objs = freezer(e)
    elif eid == 'etal_fruits':
        objs = produce(e)
    elif eid == 'bac_pain':
        objs = bread(e)
    elif eid == 'tete_gondole':
        objs = pyramid(e)
    elif eid == 'caisse':
        objs = checkout(e)
    elif eid == 'caisse_auto':
        objs = checkout_auto(e)
    elif eid == 'rack_reserve':
        objs = rack(e)
    elif eid == 'chambre_froide':
        objs = cold_room(e)
    else:
        objs = props(e)
    for o in objs:
        smooth(o)
    model(eid, objs)

export_glb(OUT, models)
print(f'mobilier : {len(models)} modèles, {tri_count(models)} triangles → {os.path.abspath(OUT)} ({os.path.getsize(OUT) // 1024} Ko)')
