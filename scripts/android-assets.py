"""Génère les icônes et écrans de démarrage Android à partir du logo officiel (public/brand)."""
import glob
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RES = os.path.join(ROOT, 'android/app/src/main/res')
logo = Image.open(os.path.join(ROOT, 'public/brand/bazar-bazar-logo-officiel.png')).convert('RGBA')
BG = (18, 4, 2, 255)


def rounded(im, radius):
    mask = Image.new('L', im.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, im.size[0] - 1, im.size[1] - 1), radius, fill=255)
    out = im.copy()
    out.putalpha(mask)
    return out


for f in glob.glob(os.path.join(RES, 'mipmap-*/ic_launcher*.png')):
    w = Image.open(f).size[0]
    name = os.path.basename(f)
    if name == 'ic_launcher_foreground.png':
        # icône adaptative : le lanceur rogne ~18 % de chaque côté, le logo occupe la zone sûre
        canvas = Image.new('RGBA', (w, w), (0, 0, 0, 0))
        s = round(w * 0.74)
        canvas.alpha_composite(rounded(logo.resize((s, s), Image.LANCZOS), s // 6), ((w - s) // 2, (w - s) // 2))
        canvas.save(f)
    elif name == 'ic_launcher_round.png':
        im = logo.resize((w, w), Image.LANCZOS)
        mask = Image.new('L', (w, w), 0)
        ImageDraw.Draw(mask).ellipse((0, 0, w - 1, w - 1), fill=255)
        im.putalpha(mask)
        im.save(f)
    else:
        rounded(logo.resize((w, w), Image.LANCZOS), w // 6).save(f)

for f in glob.glob(os.path.join(RES, 'drawable*/splash.png')):
    w, h = Image.open(f).size
    canvas = Image.new('RGBA', (w, h), BG)
    s = round(min(w, h) * 0.62)
    canvas.alpha_composite(rounded(logo.resize((s, s), Image.LANCZOS), s // 6), ((w - s) // 2, (h - s) // 2))
    canvas.convert('RGB').save(f)

print('icônes et écrans de démarrage Android générés')
