#!/usr/bin/env python3
"""Ленин: «пришить» землю к зданию в карте глубины (правка только файлов Ленина, движок не трогаем).

Зачем. Движок двигает здание (памятник + лестницу) одним жёстким куском со СРЕДНЕЙ глубиной по маске (engine/prep.js: meanD),
а землю — по карте глубины _depth.webp. У Ленина лестница уходит к зрителю, и мостовая у её нижнего края по карте глубины
ближе (0.6–0.7), чем среднее по зданию (0.40): при наклоне лестница едет в одну сторону, мостовая под ней — в другую.

Что делает. Запускать СРАЗУ ПОСЛЕ tools/build_building_layers.py на свежей папке кадров:
    python3 tests/lenin/source/depth_pin_ground.py <папка кадров> lenin_1
У мостовой вокруг вырезки (ниже линии горизонта ~ строка 880 из 1365) глубина у самого контура ставится равной среднему по зданию
и плавно (smoothstep, радиус ~260 px) возвращается к исходной карте — смещение мостовой растёт от контакта с лестницей к зрителю.
Деревья и небо не меняются (глубина вне мостовой — как была; перцентильная нормализация движка сохранена). Сдвиг по-прежнему считается движком (общий размах как у Кукурузника, MAX_SHIFT в building.json).
"""
import sys
from pathlib import Path
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

R_PX = 260.0                 # радиус возврата к исходной карте, px (кадр 768x1365)
GATE = (880.0, 940.0)        # строки, где начинается мостовая: выше (деревья, небо) глубину не трогаем


def smooth(t):
    t = np.clip(t, 0, 1)
    return t * t * (3 - 2 * t)


def main():
    d_dir, name = Path(sys.argv[1]), sys.argv[2]
    dp = d_dir / (name + '_depth.webp')
    raw = np.asarray(Image.open(dp).convert('RGB'))[..., 0].astype(np.float32)
    a = np.asarray(Image.open(d_dir / (name + '_building.webp')).convert('RGBA'))[..., 3]
    H, W = raw.shape
    lab, n = ndi.label(a > 128)
    m = lab == (1 + int(np.argmax(ndi.sum(a > 128, lab, range(1, n + 1)))))
    lo, hi = np.percentile(raw, 2), np.percentile(raw, 98)         # как engine/prep.js prepareDepth
    dn = np.clip((raw - lo) / (hi - lo), 0, 1)
    D = float(ndi.uniform_filter(dn, 3)[m].mean())                 # то, что посчитает движок (meanD)
    m2 = ndi.binary_dilation(m, iterations=4)
    dist, idx = ndi.distance_transform_edt(~m2, return_indices=True)
    ref = ndi.gaussian_filter(dn, 2)[idx[0], idx[1]]               # глубина мостовой у ближайшей точки контура
    yy = np.arange(H, dtype=np.float32)[:, None] * np.ones((1, W), np.float32)
    w = (1 - smooth(dist / R_PX)) * smooth((yy - GATE[0]) / (GATE[1] - GATE[0])) * (~m2)
    new = dn + (D - ref) * w
    new = np.clip(new, 0, 1)
    # движок заново растягивает карту по перцентилям 2%/98% (prepareDepth): после правки нижний край кадра стал чуть темнее -> вернуть
    # 98-й перцентиль к 1, чтобы глубина деревьев, неба и всей остальной карты осталась прежней (мостовая и здание масштабируются вместе)
    p98 = float(np.percentile(new, 98))
    new = np.clip(new / max(p98, 1e-3), 0, 1)
    out = np.clip(np.round(new * (hi - lo) + lo), 0, 255).astype(np.uint8)
    Image.fromarray(np.dstack([out] * 3), 'RGB').save(dp, 'WEBP', lossless=True, method=6)
    print('meanD здания %.3f; мостовая у контура: %.3f..%.3f -> %.3f; изменено %.1f%% кадра' %
          (D, ref[w > 0.5].min() if (w > 0.5).any() else 0, ref[w > 0.5].max() if (w > 0.5).any() else 0, D, (np.abs(new - dn) > 0.01).mean() * 100))


if __name__ == '__main__':
    main()
