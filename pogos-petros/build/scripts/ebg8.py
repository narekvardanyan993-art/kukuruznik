#!/usr/bin/env python3
"""Заход 8: E — «бледный белый кусок из другой картинки» справа при повороте. Причина: подложка под слоем здания (стол со свечами)
залита cv2.inpaint, а он тянул светлую бумажную кайму кадра (правый/нижний край) — при сдвиге стола открывалось бледное пятно.
Теперь под столом — тон самого рисунка: размытый (σ 6 px) кадр E в области стола (+12 px), край растушёван; кайма бумаги не участвует.
python3 pogos-petros/build/scripts/ebg8.py   (из корня репо; исходник — report/s8/pre/pogos_e_bg.webp)"""
import os, shutil, numpy as np
from pathlib import Path
from PIL import Image
from scipy import ndimage
F = Path('pogos-petros/build/frames'); T = Path('tests/pogos-petros/frames'); P = Path('pogos-petros/build/report/s8/pre'); P.mkdir(parents=True, exist_ok=True)
n = 'pogos_e_bg.webp'
if not (P/n).exists(): shutil.copyfile(F/n, P/n)
bg = np.asarray(Image.open(P/n).convert('RGB')).astype(np.float32)
fr = np.asarray(Image.open(F/'pogos_e.webp').convert('RGB')).astype(np.float32)
a = np.asarray(Image.open(F/'pogos_e_building.webp').convert('RGBA'))[..., 3] > 20
H, W = a.shape
m = ndimage.binary_dilation(a, iterations=12)
# тон рисунка: нормированное размытие кадра только по пикселям вне светлой каймы бумаги (крайние 10 px справа и снизу)
ok = np.ones((H, W), np.float32); ok[:, W-10:] = 0; ok[H-10:, :] = 0
num = np.stack([ndimage.gaussian_filter(fr[..., c]*ok, 6) for c in range(3)], -1); den = ndimage.gaussian_filter(ok, 6)[..., None]
tone = num / np.maximum(den, 1e-3)
w = ndimage.gaussian_filter(m.astype(np.float32), 3)[..., None]
out = bg*(1-w) + tone*w
Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).save(F/n, quality=92); shutil.copyfile(F/n, T/n)
print('E bg ok', int(m.sum()))
