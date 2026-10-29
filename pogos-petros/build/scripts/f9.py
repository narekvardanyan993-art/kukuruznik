#!/usr/bin/env python3
"""Заход 9 (29.10.2026): F0 заново (Gemini 3.1 Pro, палитра A/B/Ленин 1) → исходники и слои F.
Кадр — полноразмерное скачивание Gemini (gemini/in/Gemini_Generated_Image_2d4f13…jpeg, 1536×2752; загрузки Chrome идут прямо в gemini/in).
Подложка, ночь, зима — превью 572×1024, перенесены со страницы снимками 1:1 (PNG, сверка 4×8 клеток ≤ 0,3 уровня): gemini/in/*_v9*.png. Из корня репо:
  python3 pogos-petros/build/scripts/f9.py src   → frames/F0.png (= F.png, 1536×2731 апскейл), source/pogos_f/{pogos_f.png, pogos_f_bg.png, layers.json (область вырезки)}
  python3 tools/build_building_layers.py --src …/pogos_f.png --bg …/pogos_f_bg.png --spec …/layers.json --out pogos-petros/build/frames --models <модели>
  python3 pogos-petros/build/scripts/f9.py env   → небо F = всё выше горизонта подложки (v < 0,598): авто-маска неба ищет светлое у верха,
                                                    а новое небо сверху тёмно-синее → было 0 %."""
import sys, json, numpy as np, cv2
from pathlib import Path
from PIL import Image
from scipy import ndimage
R = Path('pogos-petros'); B = R/'build'; G = R/'gemini/in'; fid = 'pogos_f'; fd = B/'source'/fid
def crop916(p):
    im = Image.open(p).convert('RGB'); W, H = im.size; h = round(W * 2731 / 1536)
    return im.crop((0, H - h, W, H)) if H > h else im
def src():
    full = G/'Gemini_Generated_Image_2d4f132d4f132d4f.jpeg'
    f0 = crop916(full if full.exists() else G/'F0_v9.png').resize((1536, 2731), Image.LANCZOS)
    for p in (R/'frames/F0.png', R/'frames/F.png', fd/(fid + '.png')): f0.save(p)
    bg = crop916(G/'F0bg_v9.png').resize((1536, 2731), Image.LANCZOS); bg.save(fd/(fid + '_bg.png'))
    s = json.loads((fd/'layers.json').read_text())
    a = np.asarray(f0.resize((768, 1365), Image.LANCZOS)).astype(np.float32); b = np.asarray(bg.resize((768, 1365), Image.LANCZOS)).astype(np.float32)
    d = ndimage.gaussian_filter(np.abs(a - b).mean(-1), 2)
    m = ndimage.binary_opening(d > 35, iterations=2)
    lab, n = ndimage.label(m)
    if n > 1:
        sz = ndimage.sum(m, lab, range(1, n + 1)); m = np.isin(lab, 1 + np.nonzero(sz > 0.02 * sz.max())[0])
    m = ndimage.binary_dilation(m, iterations=22)
    cs, _ = cv2.findContours(m.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    hull = cv2.convexHull(np.vstack(cs)); s['cutout']['region'] = [[int(min(767, max(0, p[0][0]))), int(min(1365, max(0, p[0][1])))] for p in hull]
    (fd/'layers.json').write_text(json.dumps(s, ensure_ascii=False, indent=1))
    print(fid, 'bg diff outside', round(float(np.abs(a - b).mean(-1)[~m].mean()), 2), 'region pts', len(s['cutout']['region']), 'obj%', round(m.mean() * 100, 1))
def env():
    p = B/'frames'/(fid + '_env.webp'); e = np.asarray(Image.open(p).convert('RGB')).copy()
    sky = np.zeros(e.shape[:2], np.float32); sky[:int(0.598 * e.shape[0])] = 1
    e[..., 0] = (ndimage.gaussian_filter(sky, 1.5) * 255).astype(np.uint8)
    Image.fromarray(e).save(p, lossless=True); print('env sky %.1f%%' % (sky.mean() * 100))
{'src': src, 'env': env}[sys.argv[1]]()
