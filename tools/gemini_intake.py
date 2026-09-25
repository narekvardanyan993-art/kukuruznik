#!/usr/bin/env python3
"""Приёмка картинок от Nano Banana (Gemini): подложка (кадр без башни) или ночной кадр. Ничего не публикует.

  python3 tools/gemini_intake.py plate 0 путь/к/картинке.jpeg     # -> проверка + test-assets/frames/v_angle_0_plate_candidate.png
  python3 tools/gemini_intake.py night 0 путь/к/картинке.jpeg

Что делает
  1. Приводит картинку к размеру кадра (768×1365), если пропорции те же (иначе сообщает и обрезает по центру).
  2. Подложка: сравнивает с исходным кадром ВНЕ зоны здания (маска башни, расширенная на 24 px): доля отличия
     (средняя |Δ| по яркости после размытия 3 px (тонкие линии от перерисовки не считаются)) — порог 3%. «Новых объектов нет» смотрится глазами по листу наложения
     (docs/_intake/…_overlay.png: красным то, что изменилось).
  3. Ночь: контуры (границы яркости) ночной картинки против дневной: лучший сдвиг и доля совпавших контуров.
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
FR = ROOT / 'test-assets' / 'frames'
OUT = ROOT / 'docs' / '_intake'
W, H = 768, 1365
# Пристройки, которые генератор тоже убирает с подложки (кроме самой башни): рамки u0, v0, u1, v1 в долях кадра.
# Эта зона исключается из сравнения «вне здания».
EXTRA_ZONES = {
    0: [(0.30, 0.59, 0.78, 0.68)],   # подиум под башней
    1: [(0.40, 0.60, 0.78, 0.86)],   # стеклянный зал у основания
    2: [(0.26, 0.60, 0.74, 0.76)],   # террасы и ступени у основания
    3: [(0.40, 0.60, 0.84, 0.73)],   # площадка и лестницы у основания
}


def load_fit(path):
    im = Image.open(path).convert('RGB')
    w, h = im.size
    ar, tar = w / h, W / H
    note = ''
    if abs(ar - tar) > 0.004:
        # обрезка по центру до нужных пропорций
        if ar > tar:
            nw = int(h * tar); x0 = (w - nw) // 2; im = im.crop((x0, 0, x0 + nw, h))
        else:
            nh = int(w / tar); y0 = (h - nh) // 2; im = im.crop((0, y0, w, y0 + nh))
        note = f'пропорции {w}x{h} обрезаны до {W}:{H}'
    return im.resize((W, H), Image.LANCZOS), note


def lum(a):
    return a @ np.array([.299, .587, .114], np.float32)


def main():
    mode, idx, src = sys.argv[1], int(sys.argv[2]), sys.argv[3]
    name = f'v_angle_{idx}'
    day = np.array(Image.open(FR / f'{name}.png').convert('RGB')).astype(np.float32) / 255
    bld = np.array(Image.open(FR / f'{name}_building.png'))[..., 3] > 60
    im, note = load_fit(src)
    arr = np.array(im).astype(np.float32) / 255
    OUT.mkdir(parents=True, exist_ok=True)
    tag = Path(src).stem
    if mode == 'plate':
        zone = ndimage.binary_dilation(bld, iterations=24)
        for u0, v0, u1, v1 in EXTRA_ZONES.get(idx, []):
            zone[int(v0 * H):int(v1 * H), int(u0 * W):int(u1 * W)] = True
        d = np.abs(ndimage.gaussian_filter(lum(day), 3.0) - ndimage.gaussian_filter(lum(arr), 3.0))
        outside = ~zone
        mean_d = float(d[outside].mean())
        frac = float((d[outside] > 0.08).mean())
        print(f'подложка кадр {idx}: вне зоны здания средняя |Δ| = {mean_d*100:.2f}%, пикселей с Δ>8% = {frac*100:.2f}%  {note}')
        ov = day.copy()
        red = (d > 0.08) & outside
        ov[red] = ov[red] * 0.4 + np.array([1, 0, 0]) * 0.6
        ov[zone & ~bld] = ov[zone & ~bld] * 0.7 + np.array([0.2, 0.2, 1]) * 0.3
        Image.fromarray((ov * 255).astype(np.uint8)).save(OUT / f'{name}_plate_overlay.png')
        im.save(FR / f'{name}_plate_candidate.png')
        print('  наложение:', OUT / f'{name}_plate_overlay.png')
        return 0 if mean_d < 0.03 else 1
    else:
        gd = ndimage.gaussian_filter(lum(day), 1.2); gn = ndimage.gaussian_filter(lum(arr), 1.2)
        ed = np.hypot(ndimage.sobel(gd, 0), ndimage.sobel(gd, 1)); en = np.hypot(ndimage.sobel(gn, 0), ndimage.sobel(gn, 1))
        td = ed > np.percentile(ed, 90); tn = en > np.percentile(en, 90)
        best = (-1, 0, 0)
        for dy in range(-6, 7, 2):
            for dx in range(-6, 7, 2):
                sh = np.roll(np.roll(tn, dy, 0), dx, 1)
                iou = (td & ndimage.binary_dilation(sh, iterations=2)).sum() / max(1, td.sum())
                if iou > best[0]: best = (iou, dx, dy)
        print(f'ночь кадр {idx}: совпало контуров дня {best[0]*100:.1f}% (лучший сдвиг dx={best[1]}, dy={best[2]} px) {note}')
        im.save(FR / f'{name}_night_candidate.png')
        return 0


if __name__ == '__main__':
    raise SystemExit(main())
