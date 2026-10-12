#!/usr/bin/env python3
"""s14: листы отчёта из снимков report.mjs: python3 compose.py BEFORE_DIR AFTER_DIR (до = бета cea515a, после = s14)."""
import sys
from pathlib import Path
from PIL import Image, ImageDraw
B, A = sys.argv[1], sys.argv[2]; O = Path(__file__).resolve().parent
def lab(im, t):
    d = ImageDraw.Draw(im); d.rectangle((0, 0, 8 * len(t) + 16, 26), fill=(0, 0, 0)); d.text((8, 6), t, fill=(255, 255, 0)); return im
for t in ('day', 'night'):
    ims = []
    for n in 'ABCDG':
        im = Image.open(f'{A}/{t}_{n}.png').convert('RGB'); im.save(O / f'{t}_{n}.jpg', quality=86); ims.append(im.resize((390, 844)))
    W = Image.new('RGB', (400 * 5 - 10, 844), 'white')
    for i, im in enumerate(ims): W.paste(im, (i * 400, 0))
    W.save(O / f'{t}_all.jpg', quality=85)
for n, box in (('A', (500, 250, 780, 720)), ('C', (220, 260, 560, 760))):
    a = lab(Image.open(f'{B}/night_{n}.png').convert('RGB').crop(box), 'before'); b = lab(Image.open(f'{A}/night_{n}.png').convert('RGB').crop(box), 'after s14')
    W = Image.new('RGB', (a.width * 2 + 10, a.height), 'white'); W.paste(a, (0, 0)); W.paste(b, (a.width + 10, 0)); W.save(O / f'statue_night_{n}_before_after.jpg', quality=88)
for n, f in (('B', 'lenin_2'), ('G', 'lenin_6')):
    a = lab(Image.open(f'{B}/night_{n}.png').convert('RGB').resize((390, 844)), 'before'); b = lab(Image.open(f'{A}/night_{n}.png').convert('RGB').resize((390, 844)), 'after s14')
    ov = Image.open(O / f'windows/windows_{f}.jpg'); w = ov.width // 2; o = lab(ov.crop((0, 0, w, ov.height)).resize((474, 844)), 'windows found on drawing')
    W = Image.new('RGB', (390 * 2 + 474 + 20, 844), 'white'); W.paste(a, (0, 0)); W.paste(b, (400, 0)); W.paste(o, (800, 0)); W.save(O / f'windows_night_{n}_before_after.jpg', quality=86)
rows = []
for t in ('day', 'night'):
    rows += [lab(Image.open(f'{B}/{t}_G.png').convert('RGB').crop((0, 0, 780, 420)), f'{t} before'), lab(Image.open(f'{A}/{t}_G.png').convert('RGB').crop((0, 0, 780, 420)), f'{t} after s14')]
W = Image.new('RGB', (780, 430 * 4), 'white')
for i, r in enumerate(rows): W.paste(r, (0, i * 430))
W.save(O / 'G_sky_top_before_after.jpg', quality=86)
print('ok')
