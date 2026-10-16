#!/usr/bin/env python3
"""s27: до/после размещения штемпеля и таблички относительно здания.
  python3 tests/lenin/report/s27/analyze27.py RUN_DIR OUT_DIR
Для каждого образца (cards27.mjs): src — кадр с экрана; nobld — тот же кадр со слоем здания, заменённым прозрачной текстурой (разность = силуэт,
который нарисован на самом деле); before/after — открытка без зерна (PNG). «Нарисовано поверх» = отличие открытки от кадра > 16 по любому
каналу. Замер: пикселей поверх, которые лежат НА силуэте здания (и на силуэте + 12 px запаса), до и после; пикселей вне безопасной зоны.
Картинка: слева до, справа после; красный контур — силуэт здания, зелёная рамка — безопасная зона."""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

RUN, OUT = Path(sys.argv[1]), Path(sys.argv[2])
OUT.mkdir(parents=True, exist_ok=True)
W, H = 1080, 1920
SAFE = (64, 250, W - 150, H - 500)
res = {}

def arr(p):
    return np.asarray(Image.open(p).convert('RGB')).astype(np.int16)

for fa in sorted(RUN.glob('*-after.png')):
    tag = fa.name[:-len('-after.png')]
    src, nb, bef, aft = arr(RUN / f'{tag}-src.png'), arr(RUN / f'{tag}-nobld.png'), arr(RUN / f'{tag}-before.png'), arr(fa)
    D = np.abs(src - nb).max(axis=2) > 14                      # где слой здания что-то меняет в кадре
    S = ndi.binary_closing(D, structure=np.ones((3, 3)), iterations=14)   # ночью тёмное тело здания почти не отличается от подложки — видны только окна и край: склеиваем
    S = ndi.binary_fill_holes(S)
    S = ndi.binary_opening(S, structure=np.ones((3, 3)), iterations=6)
    S12 = ndi.binary_dilation(S, structure=np.ones((3, 3)), iterations=12)
    r = dict(building_px=int(S.sum()), building_pct=round(float(S.mean()) * 100, 1))
    for name, img in (('before', bef), ('after', aft)):
        O = np.abs(img - src).max(axis=2) > 16
        out_safe = O.copy(); out_safe[SAFE[1]:SAFE[3], SAFE[0]:SAFE[2]] = False
        r[name] = dict(overlay_px=int(O.sum()), on_building_px=int((O & S).sum()), within12_px=int((O & S12).sum()), outside_safe_px=int(out_safe.sum()))
    res[tag] = r
    # картинка
    def panel(img, title):
        im = Image.fromarray(img.astype(np.uint8)).convert('RGBA')
        edge = S ^ ndi.binary_erosion(S, iterations=3)
        ov = np.zeros((H, W, 4), np.uint8); ov[edge] = (255, 30, 30, 230)
        im = Image.alpha_composite(im, Image.fromarray(ov))
        d = ImageDraw.Draw(im); d.rectangle(SAFE, outline=(40, 190, 70, 255), width=5)
        return im.convert('RGB').resize((W // 2, H // 2), Image.LANCZOS)
    sheet = Image.new('RGB', (W + 12, H // 2), (30, 30, 30))
    sheet.paste(panel(bef, 'before'), (0, 0)); sheet.paste(panel(aft, 'after'), (W // 2 + 12, 0))
    sheet.save(OUT / f'cmp-{tag}.jpg', quality=88)
(OUT / 'overlap.json').write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding='utf-8')
tot_b = sum(v['before']['on_building_px'] for v in res.values()); tot_a = sum(v['after']['on_building_px'] for v in res.values())
print(f'образцов {len(res)}; поверх здания: до {tot_b} px, после {tot_a} px; вне зоны после: {sum(v["after"]["outside_safe_px"] for v in res.values())}')
for k, v in res.items():
    print(k, 'здание', v['building_pct'], '% | до', v['before']['on_building_px'], '(+12px', v['before']['within12_px'], ') | после', v['after']['on_building_px'], '(+12px', v['after']['within12_px'], ') | вне зоны', v['after']['outside_safe_px'])
