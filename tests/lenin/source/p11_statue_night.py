#!/usr/bin/env python3
"""s14: статуя ночью читаема — мягкая тёплая подсветка снизу, как у памятников в городе ночью (A = lenin_1, C = lenin_3).

  python3 tests/lenin/source/p11_statue_night.py [--report DIR]

Отзыв Нарека (iPhone, бета cea515a): «ночью статуя Ленина почти чёрная». Ночная картинка давала статую тёмной, а движок ещё
темнит тёмное (NIGHT_DIM) — силуэт тонул в небе. Что делает: статуя (слой памятника кадра, без розового туфа постамента) в
ночной картинке = дневной рисунок статуи (штрих и детали те же) × ночной холодный тон + тёплый свет снизу (прожекторы у
подножия): у ног ярче, к голове мягко слабее, голова всё равно читается. Край статуи — 2 px внутрь без изменений (небо у
силуэта то же — ни обводки, ни ореола). Верх постамента под ногами — слабое тёплое пятно (свет прожекторов).
Источник — копия ночи до s14 (source/night/s13/), запуск повторяемый.
"""
import sys
from pathlib import Path
import numpy as np, cv2
from PIL import Image

B = Path(__file__).resolve().parents[1]
FD, BK = B / 'frames', B / 'source/night/s13'
# кадр: (сила подсветки, доля высоты статуи, где свет ещё полный)
CFG = {'lenin_1': (1.45, 0.45), 'lenin_3': (1.45, 0.45)}


def statue_mask(name, day):
    a = np.asarray(Image.open(FD / (name + '_building.webp')))[..., 3].astype(np.float32) / 255
    hsv = cv2.cvtColor(day, cv2.COLOR_RGB2HSV).astype(int)
    h, s = hsv[..., 0], hsv[..., 1]
    pink = ((h <= 12) | (h >= 165)) & (s >= 38)
    st = (a > 0.5) & ~pink
    H = day.shape[0]
    ys = np.where((a > 0.5).any(1))[0]
    top = ys.min()
    # статуя — верхняя связная часть слоя памятника без туфа
    st = cv2.morphologyEx(st.astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    n, lab, stt, _ = cv2.connectedComponentsWithStats(st)
    cand = [i for i in range(1, n) if stt[i][1] <= top + 6 and stt[i][4] > 500]
    m = np.isin(lab, cand)
    m = cv2.morphologyEx(m.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8)).astype(bool) & (a > 0.5)
    ys = np.where(m.any(1))[0]
    return m, a, ys.min(), ys.max()


def main():
    rep = sys.argv[sys.argv.index('--report') + 1] if '--report' in sys.argv else None
    for name, (k, full) in CFG.items():
        day = np.asarray(Image.open(FD / (name + '.webp')).convert('RGB'))
        night = np.asarray(Image.open(BK / (name + '_night.webp')).convert('RGB')).astype(np.float32)
        m, a, y0, y1 = statue_mask(name, day)
        H, W = m.shape
        inner = cv2.erode(m.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(np.float32)
        wgt = cv2.GaussianBlur(inner, (0, 0), 1.2) * cv2.erode(m.astype(np.uint8), np.ones((3, 3), np.uint8))
        lumd = cv2.cvtColor(day, cv2.COLOR_RGB2GRAY).astype(np.float32)
        wgt *= np.clip((215 - lumd) / 40, 0, 1)   # светлая бумажная кайма вырезки не подсвечивается (иначе — обводка)
        yy = (np.arange(H)[:, None] - y0) / max(1, (y1 - y0))          # 0 голова … 1 ноги
        up = np.clip((yy - 0.0) / full, 0, 1) ** 1.3                    # к ногам ярче
        up = 0.32 + 0.68 * up
        d = day.astype(np.float32)
        cool = np.array([0.50, 0.55, 0.68])                             # ночной тон (лунный)
        warm = np.array([1.00, 0.80, 0.56])                             # тёплый свет прожекторов
        g = d.mean(-1, keepdims=True); d = g + (d - g) * 0.7                 # ночью цвета глуше
        lit = d * (cool * 0.42 + warm[None, None, :] * (up[..., None] * 0.36 * k))
        out = night * (1 - wgt[..., None]) + lit * wgt[..., None]
        # верх постамента под ногами — слабое тёплое пятно
        ped = (a > 0.6) & ~m
        yy2 = np.arange(H)[:, None] - y1
        pool = np.exp(-np.clip(yy2, 0, None) / 28.0) * (yy2 > -2) * ped
        xs = np.where(m[y1 - 5:y1].any(0))[0]
        cx, hw = (xs.min() + xs.max()) / 2, (xs.max() - xs.min()) / 2 + 20
        pool *= np.exp(-((np.arange(W)[None, :] - cx) / hw) ** 4)
        pool = cv2.GaussianBlur(pool.astype(np.float32), (0, 0), 3) * 0.55 * k
        out = out * (1 + pool[..., None] * (warm[None, None, :] - 0.35))
        out = np.clip(out, 0, 255).astype(np.uint8)
        Image.fromarray(out).save(FD / (name + '_night.webp'), quality=92, method=6)
        print('%s: статуя %d px (строки %d–%d), подсветка снизу' % (name, int(m.sum()), y0, y1))
        if rep:
            rp = Path(rep); rp.mkdir(parents=True, exist_ok=True)
            ys, xs = np.where(m)
            x0c, x1c, y0c, y1c = max(0, xs.min() - 60), min(W, xs.max() + 60), max(0, y0 - 30), min(H, y1 + 120)
            Image.fromarray(np.hstack([night.astype(np.uint8)[y0c:y1c, x0c:x1c], out[y0c:y1c, x0c:x1c]])).save(rp / ('statue_night_image_%s_before_after.jpg' % name), quality=90)


if __name__ == '__main__':
    main()
