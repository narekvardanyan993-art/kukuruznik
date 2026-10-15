#!/usr/bin/env python3
"""s26: из образцов открыток (postcards.mjs) — листы-обзоры, разметка безопасных зон и замер «что нарисовано поверх кадра».
  python3 tests/lenin/report/s26/sheets.py RUN_DIR OUT_DIR
Зоны (px открытки 1080×1920): TikTok — сверху 130, снизу 484, справа 140, слева 44 (подпись, звук, ник, столбик кнопок);
Instagram Stories — сверху 250, снизу 250 (полоса и имя, поле ответа). Наша зона = их пересечение с запасом: слева 64, сверху 250,
справа 150, снизу 500 (engine/postcard.js, SAFE). Замер: открытка без зерна и плёнки (PNG) минус тот же кадр без открытки —
отличие > 16 по любому каналу = нарисовано поверх; считаем такие пиксели вне нашей зоны."""
import json
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFont

RUN, OUT = Path(sys.argv[1]), Path(sys.argv[2])
OUT.mkdir(parents=True, exist_ok=True)
W, H = 1080, 1920
SAFE = (64, 250, W - 150, H - 500)   # x0, y0, x1, y1
TT = dict(t=130, b=484, r=140, l=44)
IG = dict(t=250, b=250)
FONT = None
for f in ('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'):
    if Path(f).exists():
        FONT = f
        break
def font(px):
    return ImageFont.truetype(FONT, px) if FONT else ImageFont.load_default()

res = {}
# --- замер зон ---
for zf in sorted(RUN.glob('_zone-*-*.png')):
    if zf.name.endswith('-src.png'):
        continue
    key = zf.stem[len('_zone-'):]
    a = Image.open(zf).convert('RGB')
    b = Image.open(zf.with_name(zf.stem + '-src.png')).convert('RGB')
    d = ImageChops.difference(a, b).point(lambda v: 255 if v > 16 else 0).convert('L')
    bbox = d.getbbox()
    inside = d.crop(SAFE)
    n_all = sum(d.histogram()[1:])   # отличие > 16 хотя бы в одном канале
    n_in = sum(inside.histogram()[1:])
    res[key] = dict(drawn_px=n_all, outside_safe_px=n_all - n_in, bbox=bbox)
(OUT / 'zones.json').write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding='utf-8')

# --- картинка разметки зон поверх образца ---
def zones_image(sample, zone_png, out):
    im = Image.open(sample).convert('RGB')
    ov = Image.new('RGBA', im.size, (0, 0, 0, 0))
    dr = ImageDraw.Draw(ov)
    red, blue = (220, 40, 40, 90), (40, 90, 220, 90)
    dr.rectangle((0, 0, W, TT['t']), fill=red); dr.rectangle((0, H - TT['b'], W, H), fill=red)
    dr.rectangle((W - TT['r'], 0, W, H), fill=red); dr.rectangle((0, 0, TT['l'], H), fill=red)
    dr.rectangle((0, 0, W, IG['t']), fill=blue); dr.rectangle((0, H - IG['b'], W, H), fill=blue)
    im = Image.alpha_composite(im.convert('RGBA'), ov)
    dr = ImageDraw.Draw(im)
    dr.rectangle(SAFE, outline=(40, 170, 60, 255), width=6)
    if zone_png:   # контур того, что нарисовано поверх (жёлтым)
        a = Image.open(zone_png).convert('RGB'); b = Image.open(zone_png.with_name(zone_png.stem + '-src.png')).convert('RGB')
        m = ImageChops.difference(a, b).convert('L').point(lambda v: 255 if v > 16 else 0)
        edge = ImageChops.difference(m, m.resize((W // 4, H // 4)).resize((W, H)).point(lambda v: 255 if v > 127 else 0))
        bb = m.getbbox()
        yellow = Image.new('RGBA', im.size, (255, 210, 0, 255))
        im.paste(yellow, (0, 0), edge.point(lambda v: 200 if v > 127 else 0))
    f = font(30)
    dr.text((16, 40), 'TikTok: сверху 130, снизу 484, справа 140, слева 44', fill=(255, 255, 255, 255), font=f, stroke_width=3, stroke_fill=(150, 20, 20))
    dr.text((16, 84), 'Instagram Stories: сверху 250, снизу 250', fill=(255, 255, 255, 255), font=f, stroke_width=3, stroke_fill=(20, 50, 150))
    dr.text((SAFE[0] + 10, SAFE[3] + 14), 'зона открытки (зелёная): 64 / 250 / 150 / 500', fill=(255, 255, 255, 255), font=font(28), stroke_width=3, stroke_fill=(20, 110, 40))
    im.convert('RGB').save(out, quality=88)

# --- листы-обзоры ---
def sheet(bid):
    states, langs = ['day', 'night', 'snow'], ['hy', 'ru', 'en']
    tw, th = 270, 480
    cols = [(st, film) for film in (False, True) for st in states]
    sh = Image.new('RGB', (tw * len(cols) + 10 * (len(cols) + 1), (th + 40) * len(langs) + 60), (245, 236, 218))
    dr = ImageDraw.Draw(sh)
    dr.text((10, 12), '%s — открытки «в сторис» (настоящий рендер Chrome, 390×844 @2x): день / ночь / снег, без плёнки | с плёнкой; строки hy / ru / en' % bid, fill=(47, 42, 37), font=font(22))
    for ci, (st, film) in enumerate(cols):
        for li, l in enumerate(langs):
            f = RUN / ('%s-%s-%s%s.jpg' % (bid, st, l, '-film' if film else ''))
            x0, y0 = 10 + ci * (tw + 10), 60 + li * (th + 40)
            if f.exists():
                sh.paste(Image.open(f).convert('RGB').resize((tw, th), Image.LANCZOS), (x0, y0))
            dr.text((x0, y0 + th + 6), '%s · %s%s' % (st, l, ' · плёнка' if film else ''), fill=(47, 42, 37), font=font(18))
    sh.save(OUT / ('sheet-%s.jpg' % bid), quality=86)

for bid in ('lenin', 'kukuruznik'):
    if list(RUN.glob(bid + '-*.jpg')):
        sheet(bid)
for bid, st in (('lenin', 'day'), ('kukuruznik', 'day')):
    smp = RUN / ('%s-%s-hy.jpg' % (bid, st))
    zp = RUN / ('_zone-%s-%s.png' % (bid, st))
    if smp.exists():
        zones_image(smp, zp if zp.exists() else None, OUT / ('zones-%s.jpg' % bid))
print(json.dumps(res, ensure_ascii=False, indent=1))
