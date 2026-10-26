"""Лист frames/clean_sheet.jpg (заход 4): до | после по пунктам 2–4 + рисунки шоу из gemini/show/."""
import numpy as np
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
B = Path(__file__).resolve().parents[1]; R = B.parent; S = B/'report/s4clean'
FT = None
for fp in ('/System/Library/Fonts/Supplemental/Arial.ttf', '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf'):
    try: FT = ImageFont.truetype(fp, 26); break
    except Exception: pass
FT = FT or ImageFont.load_default()
CW = 360
def fit(im, w=CW):
    im = im.convert('RGB'); return im.resize((w, round(im.size[1]*w/im.size[0])), Image.LANCZOS)
def on_dark(p):
    b = np.asarray(Image.open(p).convert('RGBA')).astype(float); a = b[..., 3:4]/255
    return Image.fromarray((b[..., :3]*a + np.array([18, 26, 60.])*(1-a)).astype(np.uint8))
def night(p): return Image.open(p)
pairs = [
 ('2. A: старик на скамейке', Image.open(R/'frames/_rejected/A_pre4.png'), Image.open(R/'frames/A.png')),
 ('2. C: женщина у двери', Image.open(R/'frames/_rejected/C_pre4.png'), Image.open(R/'frames/C.png')),
 ('2. F: двое у фонтана', Image.open(R/'frames/_rejected/F0_pre4.png'), Image.open(R/'frames/F0.png')),
 ('3. B: слой здания (ночной фон)', on_dark(S/'pogos_b_building_before.webp'), on_dark(B/'frames/pogos_b_building.webp')),
 ('3. C: слой здания (ночной фон)', on_dark(S/'pre/pogos_c_building.webp'), on_dark(B/'frames/pogos_c_building.webp')),
]
if (R/'frames/_rejected/D_pre4.png').exists():
    pairs.append(('4. D: пасмурная зима', Image.open(R/'frames/_rejected/D_pre4.png'), Image.open(R/'frames/D.png')))
    pairs.append(('4. D: ночь', Image.open(S/'pre/pogos_d_night.webp'), Image.open(B/'frames/pogos_d_night.webp')))
show = sorted((R/'gemini/show').glob('*.png'))
eng = S/'engine_sheet.jpg'   # снимки движка 390×844 (облако): день и ночь A–F после чистки
cols = []
for t, a, b in pairs:
    a, b = fit(a), fit(b); h = max(a.size[1], b.size[1])
    c = Image.new('RGB', (CW*2 + 10, h + 44), 'white'); d = ImageDraw.Draw(c)
    d.text((6, 6), t + '   до | после', fill=(0, 0, 0), font=FT); c.paste(a, (0, 44)); c.paste(b, (CW + 10, 44)); cols.append(c)
if show:
    ims = [fit(Image.open(p), 300) for p in show]
    h = max(i.size[1] for i in ims); c = Image.new('RGB', (310*len(ims), h + 44), (235, 235, 235)); d = ImageDraw.Draw(c)
    d.text((6, 6), '5. Gemini для шоу (gemini/show/): ' + ', '.join(p.stem for p in show), fill=(0, 0, 0), font=FT)
    for i, im in enumerate(ims): c.paste(im, (310*i, 44))
    cols.append(c)
if eng.exists():
    e = Image.open(eng).convert('RGB'); e = e.resize((CW*4, round(e.size[1]*CW*4/e.size[0])))
    c = Image.new('RGB', (e.size[0], e.size[1] + 44), 'white'); ImageDraw.Draw(c).text((6, 6), 'Движок после чистки: день / ночь A–F (без людей, голубей, точек, солнца и облаков кодом)', fill=(0, 0, 0), font=FT); c.paste(e, (0, 44)); cols.append(c)
# раскладка: по 4 пары в ряд
rows, row = [], []
for c in cols:
    row.append(c)
    if len(row) == 4: rows.append(row); row = []
if row: rows.append(row)
W = max(sum(c.size[0] + 16 for c in r) for r in rows); H = sum(max(c.size[1] for c in r) + 16 for r in rows)
out = Image.new('RGB', (W, H), 'white'); y = 0
for r in rows:
    x = 0
    for c in r: out.paste(c, (x, y)); x += c.size[0] + 16
    y += max(c.size[1] for c in r) + 16
out.save(R/'frames/clean_sheet.jpg', quality=86); print('clean_sheet', out.size)
