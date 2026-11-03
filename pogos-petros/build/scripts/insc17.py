#!/usr/bin/env python3
"""Заход 17 (e1.52): надпись D «ՍՈՒՐԲ ՊՈՂՈՍ ՊԵՏՐՈՍ» — ровно на плоскости камня над дверью и пишется штрихами слева направо, как резьба.
Плоскость — 4 угла поля надписи, сняты вручную по рисунку (QUAD, пиксели кадра D 768×1365: низ — по кромке плиты люнета, наклон 0,092;
верх — наклон 0,10, вертикали — как косяки двери). Текст раскладывается в плоских координатах (строки по центру, верхняя уже — люнет),
переносится гомографией. Атласы ×SC к пикселям кадра, одна картинка на слой (без клеток):
  groove (multiply, белый фон) — желобок темнее, нижняя кромка в тени; light (screen, чёрный фон) — верхний край светлее;
  time (серый) — когда пиксель «вырезан»: 0..254 = доля времени письма (буква за буквой; внутри буквы — по штриху от её левой точки,
  геодезическое расстояние по телу буквы), 255 — вне букв. Движок открывает пиксели по этой карте (details.js fxCarve write).
python3 pogos-petros/build/scripts/insc17.py  → tests/pogos-petros/frames/show_insc_d_w{groove,light,time}.webp + report/s17/insc17.json/_check.jpg"""
import sys, json, math, heapq, tempfile
from pathlib import Path
import numpy as np, cv2
from PIL import Image, ImageDraw, ImageFont
FR = Path('tests/pogos-petros/frames'); REP = Path('pogos-petros/build/report/s17'); REP.mkdir(parents=True, exist_ok=True)
FW, FH = 768, 1365
QUAD = [[166, 525], [409, 549], [409, 605], [166, 583]]   # TL, TR, BR, BL (кадр D, px)
LINES = ['ՍՈՒՐԲ', 'ՊՈՂՈՍ', 'ՊԵՏՐՈՍ']
MAXW = [0.36, 0.42, 0.50]          # доля ширины поля для строки (люнет: вверху уже); буквы разрежены до этой ширины, как в резных надписях
SC = 3                              # атлас: пикселей на пиксель кадра (~ как на iPhone: без «лесенки» при уменьшении)
U = 1200                            # ширина плоскости в единицах текста

def gb(a, s): return cv2.GaussianBlur(a.astype(np.float32), (0, 0), s) if s > 0 else a.astype(np.float32)

def font_ttf():
    ttf = Path(tempfile.gettempdir()) / 'NotoSerifArmenian17.ttf'
    if not ttf.exists():
        from fontTools.ttLib import TTFont
        f = TTFont('engine/fonts/NotoSerifArmenian-armenian.woff2'); f.flavor = None; f.save(ttf)
    return str(ttf)

def geodesic(m):
    """m — маска компоненты (bool). Расстояние по телу от самой левой (затем верхней) точки, 8-связность."""
    ys, xs = np.nonzero(m); i0 = np.lexsort((ys, xs))[0]; h, w = m.shape
    D = np.full((h, w), np.inf, np.float32); D[ys[i0], xs[i0]] = 0; q = [(0.0, ys[i0], xs[i0])]
    nb = [(-1, -1, 1.414), (-1, 0, 1), (-1, 1, 1.414), (0, -1, 1), (0, 1, 1), (1, -1, 1.414), (1, 0, 1), (1, 1, 1.414)]
    while q:
        d, y, x = heapq.heappop(q)
        if d > D[y, x]: continue
        for dy, dx, c in nb:
            yy, xx = y + dy, x + dx
            if 0 <= yy < h and 0 <= xx < w and m[yy, xx] and d + c < D[yy, xx]: D[yy, xx] = d + c; heapq.heappush(q, (d + c, yy, xx))
    return D

def main():
    Q = np.array(QUAD, np.float32)
    wq = (np.linalg.norm(Q[1] - Q[0]) + np.linalg.norm(Q[2] - Q[3])) / 2; hq = (np.linalg.norm(Q[3] - Q[0]) + np.linalg.norm(Q[2] - Q[1])) / 2
    V = int(round(U * hq / wq))                                    # высота плоскости в единицах текста
    H = cv2.getPerspectiveTransform(np.array([[0, 0], [U, 0], [U, V], [0, V]], np.float32), Q)
    ttf = font_ttf()
    # строки: одинаковая высота букв, по центру; кегль — чтобы каждая строка влезла в свою долю ширины
    nl = len(LINES); lh = V / nl; cap = lh * 0.60
    size = int(cap / 0.70)
    for _ in range(30):
        f = ImageFont.truetype(ttf, size)
        try: f.set_variation_by_axes([600])
        except Exception: pass
        tr = 0.10 * size; ok = all(sum(f.getlength(ch) for ch in t) + tr * (len(t) - 1) <= MAXW[i] * U for i, t in enumerate(LINES))
        if ok: break
        size = int(size * 0.95)
    letters = []   # (маска в плоскости, номер)
    for li, t in enumerate(LINES):
        wd = [f.getlength(ch) for ch in t]; trl = max(tr * 0.8, (MAXW[li] * U - sum(wd)) / (len(t) - 1)); tw = sum(wd) + trl * (len(t) - 1); x = (U - tw) / 2; yc = (li + 0.5) * lh
        for ch, cw in zip(t, wd):
            im = Image.new('L', (U, V), 0); ImageDraw.Draw(im).text((x, yc), ch, font=f, fill=255, anchor='lm')
            letters.append(np.asarray(im).astype(np.float32) / 255); x += cw + trl
    N = len(letters)
    # карта времени в плоскости: буква i занимает [i, i+1)/N; внутри — по штрихам (компоненты слева направо, по телу от левой точки)
    Tm = np.full((V, U), np.inf, np.float32); ALL = np.zeros((V, U), np.float32)
    for i, L in enumerate(letters):
        ALL = np.maximum(ALL, L); m = L > 0.35
        nc, lb, st, _ = cv2.connectedComponentsWithStats(m.astype(np.uint8), 8)
        comps = sorted([c for c in range(1, nc) if st[c, 4] > 6], key=lambda c: st[c, 0])
        Ds = []; tot = 0
        for c in comps:
            y0, x0, hh, ww = st[c, 1], st[c, 0], st[c, 3], st[c, 2]
            D = geodesic(lb[y0:y0 + hh, x0:x0 + ww] == c); mx = float(D[np.isfinite(D)].max()) + 1
            Ds.append((y0, x0, D, tot, mx)); tot += mx
        for y0, x0, D, off, mx in Ds:
            sl = Tm[y0:y0 + D.shape[0], x0:x0 + D.shape[1]]; ok = np.isfinite(D)
            sl[ok] = np.minimum(sl[ok], (i + (off + D[ok]) / tot) / N)
    # перенос в атлас: рамка поля + запас, ×SC
    pad = 6; bx0, by0 = int(Q[:, 0].min()) - pad, int(Q[:, 1].min()) - pad; bx1, by1 = int(math.ceil(Q[:, 0].max())) + pad, int(math.ceil(Q[:, 1].max())) + pad
    OW, OH = (bx1 - bx0) * SC, (by1 - by0) * SC
    S = np.array([[SC, 0, -SC * bx0], [0, SC, -SC * by0], [0, 0, 1]]); M = S @ H
    G = np.clip(cv2.warpPerspective(ALL, M, (OW, OH), flags=cv2.INTER_AREA), 0, 1)
    Tf = np.where(np.isfinite(Tm), Tm, 2).astype(np.float32)
    Tw = cv2.warpPerspective(Tf, M, (OW, OH), flags=cv2.INTER_NEAREST, borderValue=2)
    inside = Tw <= 1.0
    # время для ореола вокруг букв (размытие желобка шире буквы) — от ближайшего пикселя буквы
    _, lab = cv2.distanceTransformWithLabels((~inside).astype(np.uint8), cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
    iy, ix = np.nonzero(inside); lut = np.zeros(lab.max() + 1, np.float32); lut[lab[iy, ix]] = Tw[iy, ix]
    Tfull = lut[lab]
    # рельеф (как в заходе 16, но на всю надпись разом): желобок, нижняя кромка в тени, верхний край светлее
    stroke = max(2.0, 2 * float(cv2.distanceTransform((G > 0.5).astype(np.uint8), cv2.DIST_L2, 5).max()))
    D = gb(G, stroke * 0.22); gy = np.zeros_like(D); gy[1:-1] = (D[2:] - D[:-2]) * 0.5; gy /= (np.abs(gy).max() + 1e-6)
    upper, lower = np.clip(gy * 1.6, 0, 1), np.clip(-gy * 1.6, 0, 1)
    dark = 1 - np.clip(0.58 * D + 0.40 * lower, 0, 0.85)
    groove = np.dstack([dark, dark * 0.975, dark * 0.95])
    lt = np.clip(upper * 0.75 * (1 - 0.6 * D), 0, 1); light = np.dstack([lt, lt * 0.93, lt * 0.80])
    near = gb((G > 0.02).astype(np.float32), 2) > 0.01            # где вообще есть рельеф
    tq = np.where(near, np.clip(np.round(Tfull * 254), 0, 254), 255).astype(np.uint8)
    for nm, A in (('wgroove', groove), ('wlight', light)):
        Image.fromarray((np.clip(A, 0, 1) * 255 + 0.5).astype(np.uint8), 'RGB').save(FR / f'show_insc_d_{nm}.webp', 'WEBP', quality=92, method=6)
    Image.fromarray(tq, 'L').convert('RGB').save(FR / 'show_insc_d_wtime.webp', 'WEBP', lossless=True, method=6)
    rect = [bx0 / FW, by0 / FH, bx1 / FW, by1 / FH]
    info = {'rect': [round(r, 5) for r in rect], 'size': [OW, OH], 'scale': SC, 'quad': QUAD, 'letters': N, 'font_px': size, 'plane': [U, V]}
    json.dump(info, open(REP / 'insc17.json', 'w'), indent=1)
    # проверка: кадр D с надписью (multiply + screen) на 3 моментах письма + вся, ×3
    Dfr = np.array(Image.open(FR / 'pogos_d.webp').convert('RGB')).astype(np.float32) / 255
    crop = cv2.resize(Dfr[by0:by1, bx0:bx1], (OW, OH), interpolation=cv2.INTER_CUBIC)
    tiles = []
    for p in (0.25, 0.55, 1.01):
        rv = np.clip((p - Tfull) / 0.03, 0, 1)[..., None] * near[..., None]
        g2 = 1 - (1 - groove) * rv; l2 = light * rv
        tiles.append(np.clip(1 - (1 - crop * g2) * (1 - l2), 0, 1))
    S2 = np.concatenate([crop] + tiles, 0)
    Q3 = ((Q - [bx0, by0]) * SC).astype(np.int32); dbg = (crop * 255).astype(np.uint8).copy(); cv2.polylines(dbg, [Q3], True, (255, 0, 0), 2)
    Image.fromarray(np.concatenate([dbg, (S2 * 255).astype(np.uint8)], 0)).save(REP / 'insc17_check.jpg', quality=90)
    print(json.dumps(info))

if __name__ == '__main__':
    main()
