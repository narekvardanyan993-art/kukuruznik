"""Заход 4 (27.10.2026): срезать ореолы слоя здания (B, C).
Слой здания оставляем только там, где рисунок кадра честно отличается от подложки (Gemini без церкви):
куски крон, неба и земли, одинаковые в кадре и подложке, из слоя убираются (их и так показывает подложка),
край сужается на 1 px и растушёвывается — светлая бумажная кайма не светится ночью.
Запуск из корня репо: python3 pogos-petros/build/scripts/clean4.py b c
"""
import sys, shutil, numpy as np
from pathlib import Path
from PIL import Image
from scipy import ndimage
B = Path(__file__).resolve().parents[1]; R = B.parents[1]
T = 20.0   # порог разницы кадр − подложка (из 255)
for k in sys.argv[1:]:
    fid = 'pogos_' + k
    fr = np.asarray(Image.open(B/'frames'/(fid+'.webp')).convert('RGB')).astype(np.float32)
    bg = np.asarray(Image.open(B/'frames'/(fid+'_bg.webp')).convert('RGB')).astype(np.float32)
    bl = np.asarray(Image.open(B/'frames'/(fid+'_building.webp')).convert('RGBA')).astype(np.float32)
    a0 = bl[..., 3] / 255
    d = ndimage.gaussian_filter(np.abs(fr - bg).mean(-1), 1.5)
    obj = (d > T) & (a0 > 0.02)
    obj = ndimage.binary_opening(obj, iterations=1)
    lab, n = ndimage.label(obj)
    if n:
        sz = ndimage.sum(obj, lab, range(1, n + 1))
        obj = np.isin(lab, 1 + np.nonzero(sz > 0.01 * sz.max())[0])   # мелкие отрезки (крона, блики земли) — прочь
    obj = ndimage.binary_fill_holes(obj)
    obj = ndimage.binary_erosion(obj, iterations=1)   # сужение края
    soft = ndimage.gaussian_filter(obj.astype(np.float32), 1.1)   # растушёвка
    a1 = np.minimum(a0, soft)
    out = bl.copy(); out[..., 3] = np.clip(a1 * 255, 0, 255)
    out[..., :3] = np.where(a1[..., None] > 0, fr, bl[..., :3])   # цвет края — из кадра, без бумажной каймы
    keep = B/'report/s4clean'/(fid+'_building_before.webp')
    if not keep.exists(): shutil.copyfile(B/'frames'/(fid+'_building.webp'), keep)
    Image.fromarray(out.astype(np.uint8), 'RGBA').save(B/'frames'/(fid+'_building.webp'), lossless=False, quality=92)
    shutil.copyfile(B/'frames'/(fid+'_building.webp'), R/'tests/pogos-petros/frames'/(fid+'_building.webp'))
    print(fid, 'alpha px before %.0f after %.0f' % (a0.sum(), a1.sum()))
