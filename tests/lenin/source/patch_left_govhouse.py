#!/usr/bin/env python3
"""Ленин: левый край кадра — южная часть Дома правительства №1 (ракурс A, эпоха 1977–1991; решение Нарека 2026-10-03).

Вход (рядом): lenin_916_green.jpg, lenin_916_bg_green.jpg (прошлая версия: зелень бульвара слева, patch_left_green.py),
              gemini_govhouse_1.png — фрагмент здания от Gemini (pro.gemini.one1) на белом фоне, PNG.
Выход:        lenin_916_gov.png, lenin_916_bg_gov.png — одинаковая вставка в кадр и фон (без потерь).
Как: здание вырезается от белого фона (заливка от краёв), масштабируется и ставится основанием на линию горизонта слева
(торцевая башня — справа, ~x=470 из 1536), цвет — к туфу трибуны кадра с воздушной перспективой (дымка к цвету неба),
вставляется ТОЛЬКО туда, где в кадре небо: деревья бульвара остаются впереди здания.
Дальше: tools/build_building_layers.py --src lenin_916_gov.png --bg lenin_916_bg_gov.png --spec tests/lenin/layers.json
        (depth_pin_ground.py НЕ запускать — устарел).
Запуск:  python3 tests/lenin/source/patch_left_govhouse.py
"""
import numpy as np, cv2
from PIL import Image
from pathlib import Path
SRC = Path(__file__).resolve().parent
HY = 1724            # основание здания (строка кадра 1536x2752; горизонт слева ~1722)
X_RIGHT = 470        # правый край торцевой башни
SCALE = 0.52         # масштаб фрагмента
HAZE = 0.12          # воздушная перспектива: доля цвета неба
BASE_CUT = 514       # строка фрагмента, ниже — нарисованная линия земли (не берём)


def cutout(frag):
    a = np.asarray(frag.convert('RGB')).astype(np.uint8)[:BASE_CUT]
    h, w = a.shape[:2]
    white = (a.min(2) > 238).astype(np.uint8)
    ff = white.copy(); mask = np.zeros((h + 2, w + 2), np.uint8)
    for x in range(0, w, 7):
        for y in (0,):
            if ff[y, x] == 1: cv2.floodFill(ff, mask, (x, y), 2)
    for y in range(0, h, 7):
        for x in (0, w - 1):
            if ff[y, x] == 1: cv2.floodFill(ff, mask, (x, y), 2)
    fg = (ff != 2).astype(np.float32)
    fg = cv2.morphologyEx(fg, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    alpha = cv2.GaussianBlur(fg, (3, 3), 0.8)
    ys, xs = np.nonzero(fg > 0.5)
    box = (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)
    return a.astype(np.float32), alpha, box


def to_lab(x): return cv2.cvtColor(np.clip(x, 0, 255).astype(np.uint8), cv2.COLOR_RGB2LAB).astype(np.float32)
def from_lab(x): return cv2.cvtColor(np.clip(x, 0, 255).astype(np.uint8), cv2.COLOR_LAB2RGB).astype(np.float32)


def place(dst_path, out_path, rgb, alpha, box, trib):
    im = np.asarray(Image.open(SRC / dst_path).convert('RGB')).astype(np.float32)
    x0, y0, x1, y1 = box
    rgb = rgb[y0:y1, x0:x1]; al = alpha[y0:y1, x0:x1]
    W = int(round((x1 - x0) * SCALE)); H = int(round((y1 - y0) * SCALE))
    rgb = cv2.resize(rgb, (W, H), interpolation=cv2.INTER_AREA); al = cv2.resize(al, (W, H), interpolation=cv2.INTER_AREA)
    X0 = X_RIGHT - W; Y0 = HY - H
    # цвет: оттенок туфа как у трибуны кадра (a/b Lab), светлее; дымка к цвету неба у горизонта
    lab = to_lab(rgb); m = al > 0.5
    # оттенок — строго как у туфа трибуны (красно-оранжевый): жёлто-оранжевые светлые места движок днём тянет в зелень (GREEN_HUE)
    th = np.arctan2(trib[2] - 128, trib[1] - 128); tc = np.hypot(trib[2] - 128, trib[1] - 128)
    C = np.hypot(lab[..., 1] - 128, lab[..., 2] - 128)
    C2 = np.maximum(C * 0.9, tc * 0.7)
    lab[..., 1] = 128 + C2 * np.cos(th); lab[..., 2] = 128 + C2 * np.sin(th)
    rgb = from_lab(lab)
    sx0, sx1 = max(0, X0), min(im.shape[1], X0 + W)
    reg = im[Y0:HY, sx0:sx1]; fr = rgb[:, sx0 - X0:sx1 - X0]; fa = al[:, sx0 - X0:sx1 - X0]
    skyc = np.median(im[Y0:HY, 20:120].reshape(-1, 3), 0)
    fr = fr * (1 - HAZE) + skyc * HAZE
    # небо в кадре: близко к цвету неба своей строки и светлое; деревья (зелень, штрих) остаются впереди
    rowref = np.median(im[Y0:HY, 20:120], axis=1)
    dist = np.abs(reg - rowref[:, None, :]).sum(2)
    sky = ((dist < 45) & (reg.mean(2) > 185)).astype(np.float32)
    sky = cv2.erode(sky, np.ones((3, 3), np.uint8))
    sky = cv2.GaussianBlur(sky, (5, 5), 1.2)
    a = (fa * sky)[..., None]
    im[Y0:HY, sx0:sx1] = reg * (1 - a) + fr * a
    Image.fromarray(np.clip(im + 0.5, 0, 255).astype(np.uint8)).save(SRC / out_path, optimize=True)
    print(out_path, 'здание x %d..%d, y %d..%d (кадр 1536x2752), вставлено пикселей %d' % (X0, X0 + W, Y0, HY, int((a[..., 0] > 0.5).sum())))


def main():
    rgb, alpha, box = cutout(Image.open(SRC / 'gemini_govhouse_1.png'))
    fr = np.asarray(Image.open(SRC / 'lenin_916_green.jpg').convert('RGB')).astype(np.float32)
    trib = to_lab(fr[1800:1900, 1480:1530]).reshape(-1, 3).mean(0)   # туф трибуны — только из КАДРА (в фоне трибуны нет)
    place('lenin_916_green.jpg', 'lenin_916_gov.png', rgb, alpha, box, trib)
    place('lenin_916_bg_green.jpg', 'lenin_916_bg_gov.png', rgb, alpha, box, trib)


if __name__ == '__main__':
    main()
