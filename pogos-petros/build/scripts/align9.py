#!/usr/bin/env python3
"""Заход 9: Gemini в правках «ночь»/«зима» F0 сдвинул и перемасштабировал композицию (здание выше и мельче, до ~15 %) —
tools/gemini_road_mask.align ищет только ±6 % и ±30 px, ECC в snowmask22 не сходится. Здесь — широкий поиск по контурам:
для каждого масштаба 0,80–1,25 (отдельно по x и y) — сдвиг через cv2.matchTemplate (1/4 размера), потом точнее на 1/2;
картинка Gemini переводится в координаты рисунка (края — повтором крайних пикселей).
  python3 pogos-petros/build/scripts/align9.py <рисунок 768×1365> <картинка Gemini> <выход.png>"""
import sys, numpy as np, cv2
from PIL import Image
day = np.asarray(Image.open(sys.argv[1]).convert('RGB')); H, W = day.shape[:2]
gem = np.asarray(Image.open(sys.argv[2]).convert('RGB').resize((W, H), Image.LANCZOS))
def edges(a, k):
    g = cv2.resize(cv2.cvtColor(a, cv2.COLOR_RGB2GRAY).astype(np.float32), None, fx=k, fy=k, interpolation=cv2.INTER_AREA)
    g = cv2.GaussianBlur(g, (0, 0), 1.2); gx = cv2.Sobel(g, cv2.CV_32F, 1, 0); gy = cv2.Sobel(g, cv2.CV_32F, 0, 1)
    return np.sqrt(gx * gx + gy * gy)
def best_for(k, sx_list, sy_list, pad):
    ed = edges(day, k); h, w = ed.shape; eg0 = edges(gem, k); best = (-2, None)
    big = cv2.copyMakeBorder(ed, pad, pad, pad, pad, cv2.BORDER_CONSTANT, value=0)
    for sx in sx_list:
        for sy in sy_list:
            eg = cv2.resize(eg0, (int(round(w * sx)), int(round(h * sy))))
            # центральная часть картинки Gemini (без краёв) как шаблон
            mh, mw = int(eg.shape[0] * 0.12), int(eg.shape[1] * 0.08)
            t = eg[mh:-mh, mw:-mw]
            if t.shape[0] >= big.shape[0] or t.shape[1] >= big.shape[1]: continue
            r = cv2.matchTemplate(big, t, cv2.TM_CCOEFF_NORMED); _, mv, _, ml = cv2.minMaxLoc(r)
            if mv > best[0]:
                # положение левого верхнего угла масштабированной картинки Gemini в координатах рисунка (px при k)
                best = (mv, (sx, sy, (ml[0] - pad - mw) / k, (ml[1] - pad - mh) / k))
    return best
b1 = best_for(0.25, np.arange(0.80, 1.26, 0.025), np.arange(0.80, 1.26, 0.025), 90)
s0 = b1[1]
b2 = best_for(0.5, np.arange(s0[0] - 0.024, s0[0] + 0.025, 0.006), np.arange(s0[1] - 0.024, s0[1] + 0.025, 0.006), 180)
sx, sy, ox, oy = b2[1]
M = np.float32([[sx, 0, ox], [0, sy, oy]])
out = cv2.warpAffine(gem, M, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
Image.fromarray(out).save(sys.argv[3])
print('align: coarse %.3f fine %.3f, scale %.3f/%.3f, offset %.0f,%.0f px' % (b1[0], b2[0], sx, sy, ox, oy))
