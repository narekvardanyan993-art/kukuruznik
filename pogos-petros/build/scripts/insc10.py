#!/usr/bin/env python3
"""Заход 10 (30.10.2026): надпись «ՍՈՒՐԲ ՊՈՂՈՍ ՊԵՏՐՈՍ» в люнете над дверью (шоу D).
Исключение из правила «всё видимое — Gemini» (lessons.md): настоящий армянский шрифт (Noto Serif Armenian, engine/fonts, вес 600)
только как МАСКА. Код ничего не рисует поверх — две маски-картинки, которыми движок (details.js, image + blend) затемняет и
высветляет пиксели камня рисунка: _dark — «умножение» (желобок букв темнее), _lit — «экран» (верхняя грань желобка ловит свет свечи
снизу, тёплый). Цвет у масок — множитель/добавка, не краска: на белом/чёрном фоне маски ничего не меняют.
Три строки по форме люнета (полуэллипс: центр u 0,385, v 0,437, полуоси 0,189 × 0,0857 кадра), края букв мягко гаснут у арки.
  python3 pogos-petros/build/scripts/insc10.py   (из корня репо)
  → tests/pogos-petros/frames/show_insc_d_dark.png, show_insc_d_lit.png; печатает rect для building.json"""
import numpy as np
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage
from fontTools.ttLib import TTFont

import tempfile
OUT = Path('tests/pogos-petros/frames'); TMP = Path(tempfile.gettempdir())   # ttf из woff2 — во временной папке, в репо не кладём
ttf = TMP / 'NotoSerifArmenian.ttf'
if not ttf.exists():
    f = TTFont('engine/fonts/NotoSerifArmenian-armenian.woff2'); f.flavor = None; f.save(ttf)
FW, FH = 768, 1365
R = (0.19, 0.345, 0.58, 0.445)                 # рамка масок в долях кадра
SS = 8                                          # суперсэмплинг: маска рисуется в 8× пикселях кадра, потом ×2 итог (≈ 2× кадра)
X0, Y0 = R[0] * FW * SS, R[1] * FH * SS
w, h = round((R[2] - R[0]) * FW * SS), round((R[3] - R[1]) * FH * SS)
cx, cy, ax, ay = 0.385 * FW * SS - X0, 0.437 * FH * SS - Y0, 0.189 * FW * SS, 0.0857 * FH * SS
lines = [('ՍՈՒՐԲ', 0.372, 25), ('ՊՈՂՈՍ', 0.397, 25), ('ՊԵՏՐՈՍ', 0.422, 25)]   # строка, v центра, высота прописной (px кадра)
m = Image.new('L', (w, h), 0); d = ImageDraw.Draw(m)
for txt, v, cap in lines:
    size = int(cap * SS / 0.72)                 # кегль: высота прописных Noto Serif Armenian ≈ 0,72 кегля
    font = ImageFont.truetype(str(ttf), size)
    try: font.set_variation_by_axes([600])
    except Exception: pass
    track = 0.10 * size; widths = [font.getlength(ch) for ch in txt]; tw = sum(widths) + track * (len(txt) - 1)
    x = cx - tw / 2; y = v * FH * SS - Y0
    for ch, cw in zip(txt, widths):
        d.text((x, y), ch, font=font, fill=255, anchor='ls' if False else 'lm'); x += cw + track
M = np.asarray(m).astype(np.float32) / 255
yy, xx = np.mgrid[0:h, 0:w]
ell = ((xx - cx) / ax) ** 2 + ((yy - cy) / ay) ** 2
M *= np.clip((0.86 - ell) / 0.12, 0, 1)        # у арки буквы мягко уходят в камень
k = 4                                           # итог — 2× кадра
def down(a): return np.asarray(Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8)).resize((w // k, h // k), Image.LANCZOS)).astype(np.float32) / 255
sh = int(1.6 * SS)                              # ширина грани ≈ 1,6 px кадра
up = np.roll(M, sh, axis=0); up[:sh] = 0       # что над точкой
dn = np.roll(M, -sh, axis=0); dn[-sh:] = 0
lit_e = np.clip(M - up, 0, 1)                   # верхняя грань желобка — свет свечи снизу
shad = np.clip(M - dn, 0, 1)                    # нижняя грань — в тени
core = ndimage.gaussian_filter(M, SS * 0.5)
Md, Ld, Sd, Cd = down(M), down(lit_e), down(shad), down(core)
dark = 1 - (0.48 * Md + 0.25 * Sd)              # множитель: желобок темнее, нижняя грань ещё темнее
rgb = np.stack([dark, dark * 0.97, dark * 0.95], -1)
alpha = np.clip(Md * 1.4 + Sd, 0, 1)
Image.fromarray((np.dstack([rgb, alpha]) * 255).astype(np.uint8), 'RGBA').save(OUT / 'show_insc_d_dark.png', optimize=True)
lit = np.clip(0.95 * Ld + 0.32 * Cd, 0, 1)      # добавка «экраном»: грань ярко, сам желобок — слабое тёплое свечение
lrgb = np.stack([lit * 1.0, lit * 0.72, lit * 0.40], -1)
Image.fromarray((np.dstack([lrgb, np.clip(lit * 2, 0, 1)]) * 255).astype(np.uint8), 'RGBA').save(OUT / 'show_insc_d_lit.png', optimize=True)
print('rect', list(R), 'size', (w // k, h // k), 'ink %.1f%%' % (Md.mean() * 100))
