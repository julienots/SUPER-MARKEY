"""Kit de personnages BAZAR BAZAR (style figurine, tête légèrement agrandie) — pièces rigides, une par os.

Lancer :  /chemin/vers/python-avec-bpy blender/character_kit.py
Sortie :  public/models/characters.glb

Chaque objet porte un nom « os__piece » (ex. « shoulderL__upperarm ») : le jeu attache la pièce à l'os du même
nom. Les matériaux portent un rôle (skin, top, bottom, shoes, hair, eye, …) que le jeu recolore par habitant.
Repères (personnage de 1,75 m, pieds à z = 0, regard vers -Y) identiques aux os du jeu :
hanches 0.95, colonne 1.07, poitrine 1.27, cou 1.47, tête 1.55, épaules (±0.175, 1.44), coudes 1.15,
mains 0.89, cuisses (±0.09, 0.91), genoux 0.49, pieds 0.07.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from common import capsule, cyl, export_glb, join, mat, rbox, reset, smooth, sphere, subsurf, torus, tri_count, deform  # noqa: E402
from mathutils import Vector  # noqa: E402

OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'models', 'characters.glb')

reset()
M = {
    'skin': mat('skin', (0.9, 0.7, 0.55), 0.55),
    'top': mat('top', (0.2, 0.5, 0.8), 0.85),
    'topdark': mat('topdark', (0.15, 0.35, 0.6), 0.85),
    'bottom': mat('bottom', (0.2, 0.25, 0.35), 0.9),
    'shoes': mat('shoes', (0.1, 0.1, 0.1), 0.5),
    'sole': mat('sole', (0.95, 0.95, 0.95), 0.7),
    'hair': mat('hair', (0.2, 0.12, 0.08), 0.75),
    'brow': mat('brow', (0.18, 0.1, 0.06), 0.8),
    'eyewhite': mat('eyewhite', (0.97, 0.97, 0.95), 0.2),
    'eye': mat('eye', (0.25, 0.15, 0.08), 0.15),
    'pupil': mat('pupil', (0.03, 0.03, 0.03), 0.1),
    'shine': mat('shine', (1, 1, 1), 0.05),
    'mouth': mat('mouth', (0.55, 0.15, 0.18), 0.5),
    'blush': mat('blush', (0.95, 0.55, 0.5), 0.6),
    'hat': mat('hat', (0.8, 0.1, 0.1), 0.8),
    'dark': mat('dark', (0.08, 0.08, 0.08), 0.4),
    'white': mat('white', (0.96, 0.96, 0.96), 0.7),
    'apron': mat('apron', (0.9, 0.2, 0.1), 0.85),
    'yellow': mat('yellow', (0.95, 0.77, 0.06), 0.6),
    'metal': mat('metal', (0.7, 0.7, 0.72), 0.35, 0.8),
}

parts = []


def part(bone, name, objs, levels=0):
    """Fusionne et lisse une pièce, attachée à l'os `bone`."""
    objs = [o for o in (objs if isinstance(objs, list) else [objs]) if o is not None]
    for o in objs:
        smooth(o)
        if levels:
            subsurf(o, levels)
    ob = join(f'{bone}__{name}', objs)
    parts.append(ob)
    return ob


HEAD_Z = 1.72  # centre de la tête (agrandie, style figurine)
HR = 0.165     # rayon de tête

# ---------------------------------------------------------------- tronc
part('hips', 'hips_m', [rbox('a', (0.31, 0.2, 0.21), (0, 0, 0.94), M['bottom'], 0.08, 3)])
part('hips', 'hips_f', [rbox('a', (0.34, 0.21, 0.21), (0, 0, 0.94), M['bottom'], 0.09, 3)])
def torso(w, d, bust=0.0, belly=0.0):
    """Torse d'un seul tenant (épaules larges, taille affinée), lissé."""
    t = rbox('t', (w, d, 0.5), (0, 0, 1.22), M['top'], 0.12, 4)

    def f(v):
        k = (v.z - 0.97) / 0.5  # 0 à la taille, 1 aux épaules
        sx = 0.8 + 0.22 * min(1.0, max(0.0, k)) ** 0.7
        sy = 1.0 + belly * max(0.0, 1 - abs(k - 0.25) * 2.5) * (1 if v.y < 0 else 0.2)
        y = v.y * sy
        if bust > 0 and v.y < 0:
            y -= bust * max(0.0, 1 - abs(v.z - 1.3) / 0.09) * max(0.0, 1 - abs(abs(v.x) - 0.075) / 0.08)
        return Vector((v.x * sx, y, v.z))

    deform(t, f)
    return t


part('chest', 'chest_m', [torso(0.38, 0.22)], 1)
part('chest', 'chest_f', [torso(0.35, 0.21, bust=0.035)], 1)
part('chest', 'chest_big', [torso(0.4, 0.26, belly=0.35)], 1)
# raccord de taille (presque caché dans le torse)
part('spine', 'belly', [rbox('a', (0.27, 0.18, 0.12), (0, 0, 1.02), M['top'], 0.05, 2)])
# épaules arrondies (raccord bras / tronc)
for side, sx in (('L', 1), ('R', -1)):
    part('chest', f'shoulderpad{side}', [sphere('a', 0.075, (sx * 0.19, 0, 1.4), (1, 1, 0.95), M['top'])])
part('neck', 'neck', [cyl('a', 0.058, 0.052, 1.43, 1.6, material=M['skin'], seg=12)], 0)

# ---------------------------------------------------------------- tête
head = sphere('a', HR, (0, 0, HEAD_Z), (0.93, 0.92, 1.0), M['skin'], 22, 14)
# menton un peu plus étroit, joues pleines
deform(head, lambda v: Vector((v.x * (1 - max(0, (HEAD_Z - 0.04 - v.z)) * 0.9), v.y, v.z)))
nose = sphere('b', 0.026, (0, -HR * 0.93, HEAD_Z - 0.02), (0.9, 0.8, 1.0), M['skin'])
ears = [sphere('e', 0.032, (sx * HR * 0.93, 0, HEAD_Z - 0.005), (0.45, 0.8, 1), M['skin']) for sx in (-1, 1)]
part('head', 'head', [head, nose] + ears)
# yeux (blanc, iris, pupille, reflet) — gros yeux expressifs
eyes = []
for sx in (-1, 1):
    x = sx * 0.06
    y = -HR * 0.88
    z = HEAD_Z + 0.015
    eyes.append(sphere('w', 0.04, (x, y, z), (1, 0.45, 1.15), M['eyewhite'], 14, 10))
    eyes.append(sphere('i', 0.028, (x, y - 0.012, z - 0.004), (1, 0.42, 1.1), M['eye'], 12, 8))
    eyes.append(sphere('p', 0.015, (x, y - 0.019, z - 0.004), (1, 0.42, 1.1), M['pupil'], 10, 6))
    eyes.append(sphere('s', 0.0075, (x - 0.01, y - 0.026, z + 0.012), (1, 0.5, 1), M['shine'], 8, 6))
part('head', 'eyes', eyes, 0)
part('head', 'blush', [sphere('b', 0.026, (sx * 0.085, -HR * 0.8, HEAD_Z - 0.04), (1, 0.3, 0.6), M['blush'], 10, 6) for sx in (-1, 1)], 0)
for side, sx in (('L', 1), ('R', -1)):
    part(f'brow{side}', 'brow', [capsule('b', 0.009, (sx * 0.03, -HR * 0.9, HEAD_Z + 0.07), (sx * 0.08, -HR * 0.85, HEAD_Z + 0.075), M['brow'], 8)], 0)
part('mouth', 'mouth', [torus('m', 0.026, 0.0065, (0, -HR * 0.9, HEAD_Z - 0.065), (math.pi / 2, 0, math.pi), M['mouth'], arc=math.pi, seg=10, sides=6)], 0)

# ---------------------------------------------------------------- cheveux (variantes)
def cap(cover=0.55, thick=1.06, z_off=0.0, mat_=M['hair']):
    """Calotte de cheveux : moitié haute de la tête, débordant un peu derrière."""
    c = sphere('c', HR * thick, (0, 0.006, HEAD_Z + z_off), (0.95, 0.96, 1.0), mat_, 22, 14)
    lim = HEAD_Z + HR * (1 - 2 * cover)
    # ligne de cheveux : plus haute sur le front (dégage sourcils et yeux)
    deform(c, lambda v: Vector((v.x, v.y, max(v.z, lim + max(0.0, min(1.0, (-v.y - 0.02) / 0.1)) * 0.07))))
    return c


part('head', 'hair_court', [cap(0.42)])
part('head', 'hair_meche', [cap(0.4), sphere('f', 0.07, (0.03, -HR * 0.7, HEAD_Z + 0.1), (1.4, 0.5, 0.5), M['hair'])])
part('head', 'hair_long', [cap(0.5), rbox('l', (0.3, 0.11, 0.34), (0, 0.08, HEAD_Z - 0.12), M['hair'], 0.05, 3)])
part('head', 'hair_chignon', [cap(0.45), sphere('b', 0.065, (0, 0.06, HEAD_Z + 0.15), (1, 1, 0.9), M['hair'])])
part('head', 'hair_queue', [cap(0.45), capsule('q', 0.035, (0, HR * 0.95, HEAD_Z + 0.02), (0, HR * 1.25, HEAD_Z - 0.18), M['hair'])])
part('head', 'hair_tresses', [cap(0.44)] + [capsule('t', 0.016, (x, HR * 0.8, HEAD_Z), (x * 1.2, HR * 1.05, HEAD_Z - 0.26), M['hair'], 8) for x in (-0.08, -0.04, 0, 0.04, 0.08)])
part('head', 'hair_afro', [sphere('a', HR * 1.42, (0, 0.03, HEAD_Z + 0.05), (1, 0.95, 0.92), M['hair'], 20, 14)])
part('head', 'beard', [sphere('b', HR * 0.82, (0, -0.035, HEAD_Z - 0.05), (1.0, 0.85, 0.75), M['hair'], 16, 10)], 0)

# ---------------------------------------------------------------- couvre-chefs
cp = sphere('c', HR * 1.1, (0, 0.004, HEAD_Z + 0.015), (0.96, 0.98, 0.92), M['hat'], 20, 12)
deform(cp, lambda v: Vector((v.x, v.y, max(v.z, HEAD_Z + 0.02))))
brim = cyl('b', 0.1, 0.1, HEAD_Z + 0.03, HEAD_Z + 0.042, (0, -0.12), M['hat'], 16)
deform(brim, lambda v: Vector((v.x, min(v.y, -0.03), v.z)))
part('head', 'hat_casquette', [cp, brim])
bo = sphere('c', HR * 1.12, (0, 0.004, HEAD_Z + 0.03), (0.96, 0.98, 1.05), M['hat'], 20, 12)
deform(bo, lambda v: Vector((v.x, v.y, max(v.z, HEAD_Z + 0.01))))
part('head', 'hat_bonnet', [bo, torus('r', HR * 0.98, 0.025, (0, 0.004, HEAD_Z + 0.02), material=M['hat'], seg=20), sphere('p', 0.04, (0, 0, HEAD_Z + HR * 1.15 + 0.03), material=M['hat'])])
fo = sphere('f', HR * 1.16, (0, 0.01, HEAD_Z), (0.98, 1.0, 1.04), M['hat'], 22, 14)
# visage ouvert à l'avant
deform(fo, lambda v: Vector((v.x, max(v.y, -HR * 0.72) if abs(v.z - HEAD_Z + 0.01) < HR * 0.62 and abs(v.x) < HR * 0.62 else v.y, v.z)))
part('head', 'hat_foulard', [fo, cyl('n', 0.1, 0.17, 1.42, 1.6, material=M['hat'], seg=18)])
part('head', 'hat_beret', [cyl('b', 0.15, 0.14, HEAD_Z + HR * 0.75, HEAD_Z + HR * 0.75 + 0.035, (0.02, 0.01), M['dark'], 18)])
hc = sphere('c', HR * 1.15, (0, 0.004, HEAD_Z + 0.02), (1, 1, 0.95), M['yellow'], 20, 12)
deform(hc, lambda v: Vector((v.x, v.y, max(v.z, HEAD_Z + 0.02))))
part('head', 'hat_casque', [hc, torus('r', HR * 1.12, 0.012, (0, 0.004, HEAD_Z + 0.025), material=M['yellow'], seg=20)])
glasses = [torus('g', 0.03, 0.004, (sx * 0.055, -HR * 0.98, HEAD_Z + 0.015), (math.pi / 2, 0, 0), M['dark'], seg=16, sides=5) for sx in (-1, 1)]
glasses.append(capsule('b', 0.003, (-0.025, -HR * 0.99, HEAD_Z + 0.02), (0.025, -HR * 0.99, HEAD_Z + 0.02), M['dark'], 6))
for sx in (-1, 1):
    glasses.append(capsule('t', 0.003, (sx * 0.085, -HR * 0.95, HEAD_Z + 0.02), (sx * 0.14, -0.02, HEAD_Z + 0.02), M['dark'], 6))
part('head', 'glasses', glasses, 0)

# ---------------------------------------------------------------- vêtements (ajouts)
part('chest', 'hood', [torus('h', 0.1, 0.045, (0, 0.05, 1.47), (0.25, 0, 0), M['top'], seg=18)])
part('chest', 'collar', [torus('c', 0.075, 0.016, (0, -0.01, 1.46), (0.2, 0, 0), M['white'], seg=18, arc=math.pi * 1.4)], 0)
part('chest', 'buttons', [sphere('b', 0.009, (0, -0.117, 1.38 - i * 0.07), material=M['white']) for i in range(4)], 0)
part('chest', 'zip', [rbox('z', (0.014, 0.01, 0.34), (0, -0.118, 1.28), M['dark'], 0.004, 1)], 0)
part('spine', 'zip_low', [rbox('z', (0.014, 0.01, 0.16), (0, -0.112, 1.08), M['dark'], 0.004, 1)], 0)
part('chest', 'puffer', [rbox('p', (0.41, 0.25, 0.04), (0, 0, z), M['topdark'], 0.018, 2) for z in (1.22, 1.36)])
part('spine', 'apron', [rbox('a', (0.3, 0.02, 0.48), (0, -0.13, 1.06), M['apron'], 0.01, 1)], 0)
part('chest', 'apron_bib', [rbox('a', (0.24, 0.02, 0.18), (0, -0.125, 1.3), M['apron'], 0.01, 1), rbox('b', (0.06, 0.012, 0.03), (0.06, -0.137, 1.33), M['white'], 0.004, 1)], 0)
part('chest', 'vest_band', [torus('v', 0.2, 0.02, (0, 0, 1.24), (0, 0, 0), M['yellow'], seg=20, scale=(1.03, 0.64, 1))], 0)
skirt = cyl('s', 0.18, 0.27, 0.5, 0.95, material=M['bottom'], seg=20, cap=False)
deform(skirt, lambda v: Vector((v.x, v.y * 0.75, v.z)))
part('hips', 'skirt', [skirt], 0)

# ---------------------------------------------------------------- membres
for side, sx in (('L', 1), ('R', -1)):
    x = sx * 0.21
    part(f'shoulder{side}', 'upperarm', [capsule('u', 0.058, (x, 0, 1.4), (x * 1.02, 0, 1.17), M['top'])])
    part(f'elbow{side}', 'forearm', [capsule('f', 0.05, (x * 1.02, 0, 1.15), (x * 1.03, -0.01, 0.92), M['top'])])
    part(f'elbow{side}', 'cuff', [cyl('c', 0.054, 0.054, 0.93, 0.97, (x * 1.03, -0.01), M['topdark'], 12)], 0)
    hand = sphere('h', 0.052, (x * 1.03, -0.012, 0.87), (0.85, 0.7, 1.15), M['skin'])
    thumb = sphere('t', 0.022, (x * 1.03 - sx * 0.02, -0.04, 0.89), (1, 1, 1.4), M['skin'])
    part(f'hand{side}', 'hand', [hand, thumb])
    tx = sx * 0.095
    part(f'thigh{side}', 'thigh', [capsule('t', 0.078, (tx, 0, 0.9), (tx, 0, 0.5), M['bottom'])])
    part(f'knee{side}', 'shin', [capsule('s', 0.064, (tx, 0, 0.5), (tx, 0.005, 0.12), M['bottom'])])
    shoe = rbox('s', (0.115, 0.27, 0.095), (tx, -0.05, 0.065), M['shoes'], 0.04, 3)
    sole = rbox('o', (0.12, 0.275, 0.03), (tx, -0.05, 0.015), M['sole'], 0.012, 2)
    part(f'foot{side}', 'shoe', [shoe, sole], 0)

export_glb(OUT, parts)
print(f'personnages : {len(parts)} pièces, {tri_count(parts)} triangles → {os.path.abspath(OUT)} ({os.path.getsize(OUT) // 1024} Ko)')
