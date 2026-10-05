#!/usr/bin/env python3
"""Ленин П2: лист проверки слоёв → tests/lenin/report/P2-sheet.png.
Строка = кадр: цвет + точки | вырезка (на пурпурном) | подложка | небо (голубое) и деревья (зелёные) | глубина."""
import json
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont
S = Path(__file__).resolve().parent; R = S.parent / 'report'
w, h = 216, 384
try: f = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 15)
except OSError: f = ImageFont.load_default()
heads = ['цвет + точки', 'вырезка', 'подложка', 'небо / деревья', 'глубина']
fr_ids = ['lenin_2', 'lenin_3', 'lenin_4', 'lenin_5', 'lenin_6']
sheet = Image.new('RGB', (110 + 5 * (w + 6), 26 + len(fr_ids) * (h + 6)), 'white'); d = ImageDraw.Draw(sheet)
for i, t in enumerate(heads): d.text((110 + i * (w + 6), 4), t, fill='black', font=f)
for r, fid in enumerate(fr_ids):
    L = S / fid / 'layers'; y = 26 + r * (h + 6)
    d.text((4, y + h // 2), fid + '\n' + 'BCDEG'[r], fill='black', font=f)
    col = Image.open(L / (fid + '.webp')).convert('RGB')
    fr = json.loads((S / fid / 'frame.json').read_text(encoding='utf-8'))
    c2 = col.copy(); dc = ImageDraw.Draw(c2)
    for hs in fr.get('hotspots', []):
        x, yy = hs['u'] * col.width, hs['v'] * col.height
        dc.ellipse([x - 12, yy - 12, x + 12, yy + 12], outline=(255, 0, 0) if hs['layer'] == 'building' else (0, 90, 255), width=5)
    for u, v in (fr.get('closeUp') or {}).get('perch', []):
        dc.ellipse([u * col.width - 5, v * col.height - 5, u * col.width + 5, v * col.height + 5], fill=(255, 200, 0))
    b = Image.open(L / (fid + '_building.webp')).convert('RGBA')
    mag = Image.new('RGBA', b.size, (255, 0, 255, 255)); mag.alpha_composite(b)
    env = np.asarray(Image.open(L / (fid + '_env.webp')).convert('RGB')).astype(np.float32) / 255
    bgc = np.asarray(Image.open(L / (fid + '_bg.webp')).convert('RGB')).astype(np.float32) * 0.45
    sky = env[..., 0:1] > 0.5; tree = env[..., 1:2] > 0.02
    ev = np.where(sky, [120, 190, 255], np.where(tree, [60, 200, 60], bgc)).astype(np.uint8)
    tiles = [c2, mag.convert('RGB'), Image.open(L / (fid + '_bg.webp')).convert('RGB'), Image.fromarray(ev), Image.open(L / (fid + '_depth.webp')).convert('RGB')]
    for i, t in enumerate(tiles): sheet.paste(t.resize((w, h), Image.LANCZOS), (110 + i * (w + 6), y))
sheet.save(R / 'P2-sheet.png', optimize=True); print(R / 'P2-sheet.png', sheet.size)
