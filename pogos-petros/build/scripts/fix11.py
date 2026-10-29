#!/usr/bin/env python3
"""Заход 11 (30.10.2026, e1.46): починка багов iPhone-проверки e1.45 — только код (двигает/режет/смешивает рисунки Gemini).
Из корня репо:  python3 pogos-petros/build/scripts/fix11.py <шаг>   шаги: backup poses snow sway atree night insc all
  backup — исходники (позы, маски снега, поля качания, слои A, ночь E/F) копируются в pogos-petros/build/source/pre11/ один раз;
           все шаги читают только оттуда — скрипт можно запускать повторно, результат тот же.
  poses  — позы A/F: цвет патча сведён к кадру (робастная линейная подгонка по «тем же» пикселям + плавная карта отношения),
           альфа — только там, где поза отличается от рисунка (ΔE), мягкий край; бледного «облака» вокруг фигуры больше нет.
  snow   — маски снега A/B/C/F плавные (размытие 1,2 px), у F снег не лежит на небе (выше силуэта здания).
  sway   — поля качания A/B/C в режиме SWAY_SOFT: R — мягкая маска кроны (без травы), B — высота, A — фаза (движок e1.46).
  atree  — A: дерево у стены — подложка в зоне дерева = сам кадр (стена между ветками больше не «небо»), альфа слоя здания
           в этой зоне без «лесенки» (размыта) — не будет квадратов/«огромных пикселей» при наклоне и ночью.
  night  — ночь E/F холодная, как A–D (Lab: тон к средним A–D), тёплое остаётся только у огней (маска огней с мягким спадом).
  insc   — надпись D по буквам в перспективе люнета (гомография по краю люнета) → атласы show_insc_d_l{dark,fire,glow}.png
           + список клеток (печатает JSON для building.json). Шрифт — только маска (исключение lessons.md).
"""
import sys, json, math, shutil, tempfile
from pathlib import Path
import numpy as np, cv2
from PIL import Image, ImageDraw, ImageFont

FR = Path('tests/pogos-petros/frames'); PRE = Path('pogos-petros/build/source/pre11')
FW, FH = 768, 1365
JR = lambda x: math.floor(x + 0.5)          # Math.round из движка

def rd(p): return np.array(Image.open(p))
def save_webp(arr, p, q=93):
    im = Image.fromarray(arr.astype(np.uint8))
    im.save(p, 'WEBP', quality=q, method=6, **({'alpha_quality': 100, 'exact': True} if im.mode == 'RGBA' else {}))
def gblur(a, s): return cv2.GaussianBlur(a.astype(np.float32), (0, 0), s) if s > 0 else a
def lab(rgb): return cv2.cvtColor(np.clip(rgb, 0, 255).astype(np.uint8), cv2.COLOR_RGB2LAB).astype(np.float32) * np.array([100 / 255, 1, 1], np.float32) - np.array([0, 128, 128], np.float32)
def dE(a, b): return np.sqrt(((lab(a) - lab(b)) ** 2).sum(-1))

POSES = {   # кадр → [(картинка, rect актёра)]; rect — как в building.json
    'a': [(n, [0.34, 0.7, 0.47, 0.785]) for n in ('man1', 'man2')] + [(n, [0.31, 0.787, 0.435, 0.83]) for n in ('pgL1', 'pgL2')]
         + [(n, [0.435, 0.78, 0.483, 0.83]) for n in ('pgM1', 'pgM2')] + [(n, [0.483, 0.775, 0.535, 0.83]) for n in ('pgR1', 'pgR2')],
    'f': [('man1', [0.22, 0.66, 0.4, 0.88]), ('woman1', [0.08, 0.66, 0.25, 0.88])]}

def backup():
    PRE.mkdir(parents=True, exist_ok=True)
    names = [f'show_pose_{k}_{n}.png' for k, L in POSES.items() for n, _ in L]
    names += [f'pogos_{l}_snow.webp' for l in 'abcf'] + [f'pogos_{l}_sway.png' for l in 'abc']
    names += ['pogos_a.webp', 'pogos_a_bg.webp', 'pogos_a_building.webp', 'pogos_e_night.webp', 'pogos_f_night.webp']
    for n in names:
        if not (PRE / n).exists(): shutil.copy2(FR / n, PRE / n); print('backup', n)

MAN_BOX, MAN_RECT = (200, 900, 400, 1110), (42, 50, 95, 140)   # A: старик — рамка кадра (px) и рамка фигуры внутри неё (для grabCut)
def nblur(img, w, s):
    w = w.astype(np.float32); return gblur(img * w[..., None], s) / np.maximum(gblur(w, s)[..., None], 1e-4)
def silhouette(C, rect):
    m = np.zeros(C.shape[:2], np.uint8); bgd = np.zeros((1, 65)); fgd = np.zeros((1, 65))
    cv2.grabCut(np.clip(C, 0, 255).astype(np.uint8), m, rect, bgd, fgd, 6, cv2.GC_INIT_WITH_RECT)
    f = ((m == 1) | (m == 3)).astype(np.uint8)
    nc, lb, st, _ = cv2.connectedComponentsWithStats(f)
    if nc > 1: f = (lb == 1 + np.argmax(st[1:, 4])).astype(np.uint8)
    ff = f.copy(); h, w = ff.shape; mk = np.zeros((h + 2, w + 2), np.uint8); cv2.floodFill(ff, mk, (0, 0), 1)
    return f | (1 - ff)
def halo_gain(C, rect):
    """Множитель цвета, который гасит светлый ореол Gemini вокруг фигуры (тон стены рядом, штрих остаётся)."""
    C = C.astype(np.float32); fig = silhouette(C, rect)
    dist = cv2.distanceTransform((1 - fig).astype(np.uint8), cv2.DIST_L2, 5)
    ref = nblur(C, ((dist >= 18) & (dist < 40)).astype(np.float32), 9)
    cur = nblur(C, ((dist > 0) & (dist < 40)).astype(np.float32), 2.5)
    Lr = lab(ref)[..., 0]; Lc = lab(cur)[..., 0]
    w = np.clip((Lc - Lr - 2) / 8, 0, 1) * np.clip((18 - dist) / 6, 0, 1) * (dist > 0.5)
    w = np.clip(gblur(w, 2), 0, 1) * (1 - fig)
    ratio = np.clip(ref / np.maximum(cur, 1), 0.55, 1.1)
    return 1 + (ratio - 1) * w[..., None]

def aman():
    x0, y0, x1, y1 = MAN_BOX
    F0 = rd(PRE / 'pogos_a.webp')[..., :3].astype(np.float32)
    K = halo_gain(F0[y0:y1, x0:x1], MAN_RECT)
    for n, src in (('pogos_a.webp', PRE / 'pogos_a.webp'), ('pogos_a_bg.webp', FR / 'pogos_a_bg.webp'), ('pogos_a_building.webp', FR / 'pogos_a_building.webp')):
        im = rd(src).astype(np.float32)
        im[y0:y1, x0:x1, :3] = np.clip(im[y0:y1, x0:x1, :3] * K, 0, 255)
        save_webp(im, FR / n, 93)
    print('aman: ореол старика, пикселей %.0f, средний множитель %.3f' % (((K < 0.98).any(-1)).sum(), K.mean()))

def aground():
    """A: земля у основания церкви попала в слой здания «блоками» (лесенка вырезки) — днём и ночью видны светлые прямоугольники.
    Землю из слоя здания убираем (альфа → 0, мягко), подложка там = сам кадр: земля едет с глубиной земли, без ступенек тона."""
    F = rd(FR / 'pogos_a.webp')[..., :3].astype(np.float32)
    bg = rd(FR / 'pogos_a_bg.webp')[..., :3].astype(np.float32)
    bl = rd(FR / 'pogos_a_building.webp').astype(np.float32)
    yy, xx = np.mgrid[0:FH, 0:FW]
    ruin = (xx >= 440) & (yy < 1108 + (xx - 445) * (42 / 323.0))          # развалины стены справа — остаются в слое здания
    man = (xx >= 215) & (xx <= 365) & (yy <= 1085)                       # скамья и старик
    G = ((bl[..., 3] > 5) & (yy >= 1050) & ~ruin & ~man).astype(np.float32)
    Ga = np.clip(gblur(G, 2.0), 0, 1)
    Gb = np.clip(gblur(cv2.dilate(G, np.ones((13, 13), np.uint8)), 3.0), 0, 1)[..., None]
    bl[..., 3] *= 1 - Ga
    save_webp(bg * (1 - Gb) + F * Gb, FR / 'pogos_a_bg.webp', 93)
    save_webp(bl, FR / 'pogos_a_building.webp', 93)
    print('aground: земля из слоя здания %.3f кадра' % G.mean())

def poses():
    for k, L in POSES.items():
        F = rd(FR / f'pogos_{k}.webp')[..., :3].astype(np.float32)
        for n, r in L:
            x0, y0, x1, y1 = JR(r[0] * FW), JR(r[1] * FH), JR(r[2] * FW), JR(r[3] * FH)
            B = F[y0:y1, x0:x1]; h, w = B.shape[:2]
            P = np.array(Image.open(PRE / f'show_pose_{k}_{n}.png').convert('RGBA').resize((w, h), Image.BILINEAR)).astype(np.float32)
            rgb, A0 = P[..., :3], P[..., 3] / 255
            if k == 'a' and n.startswith('man'):   # поза старика несёт тот же ореол — гасим так же, как в кадре
                bx0, by0, bx1, by1 = MAN_BOX; F0 = rd(PRE / 'pogos_a.webp')[..., :3].astype(np.float32)
                Cc = F0[by0:by1, bx0:bx1].copy(); sl = (slice(y0 - by0, y1 - by0), slice(x0 - bx0, x1 - bx0))
                Cc[sl] = rgb * A0[..., None] + Cc[sl] * (1 - A0[..., None])
                Cc = np.clip(Cc * halo_gain(Cc, MAN_RECT), 0, 255); rgb = Cc[sl]; A0 = np.ones_like(A0)
            # 1) робастная линейная подгонка цвета патча к кадру по пикселям, где это та же картинка
            sel = A0 > 0.15
            X = rgb[sel]; Y = B[sel]; keep = np.ones(len(X), bool)
            g = np.ones(3)   # модель «множитель на канал» (у голубей земля патча почти ровная — наклон прямой не определить)
            for _ in range(4):
                for c in range(3):
                    xs, ys = X[keep, c], Y[keep, c]
                    if len(xs) >= 20: g[c] = (xs * ys).sum() / max((xs * xs).sum(), 1)
                res = np.abs(X * g - Y).sum(-1); keep = res < np.percentile(res, 60)
            g = np.clip(g, 0.7, 1.5)
            P1 = np.clip(rgb * g, 0, 255)
            # 2) плавная карта отношения (тон по месту) по «тем же» пикселям
            same = ((dE(P1, B) < 10) & (A0 > 0.05)).astype(np.float32)
            ws = gblur(same, 6)
            ratio = np.ones_like(P1)
            for c in range(3):
                num, den = gblur(B[..., c] * same, 6), gblur(P1[..., c] * same, 6)
                ratio[..., c] = np.where(ws > 0.03, (num + 1) / (den + 1), 1)
            ratio = np.clip(gblur(ratio, 2), 0.75, 1.35)
            P2 = np.clip(P1 * ratio, 0, 255)
            # 3) альфа — только отличие позы от рисунка (фигура + её тень), мягкий край
            d = dE(P2, B) * (A0 > 0.02)
            m = (cv2.medianBlur(np.clip(d * 6, 0, 255).astype(np.uint8), 3) > 6 * 13).astype(np.uint8)
            m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
            nc, lb, st, _ = cv2.connectedComponentsWithStats(m)
            for i in range(1, nc):
                if st[i, 4] < 10: m[lb == i] = 0
            m = cv2.dilate(m, np.ones((3, 3), np.uint8))
            soft = np.clip(gblur(m.astype(np.float32), 1.3) * 1.6, 0, 1)
            yy, xx = np.mgrid[0:h, 0:w]
            edge = np.clip(np.minimum.reduce([xx + 0.5, w - 0.5 - xx, yy + 0.5, h - 0.5 - yy]) / 3.0, 0, 1)   # край рамки — в ноль за 3 px
            A = np.clip(np.minimum(A0, soft) * edge, 0, 1)
            out = np.dstack([P2, A * 255]).astype(np.uint8)
            Image.fromarray(out, 'RGBA').save(FR / f'show_pose_{k}_{n}.png', optimize=True)
            print(f'pose {k}_{n} {w}x{h} gain {np.round(g, 2)} alpha {A0.mean():.3f}->{A.mean():.3f} ΔE in-figure {d[A > 0.5].mean() if (A > 0.5).any() else 0:.1f}')

def snow():
    for l in 'abcf':
        m = rd(PRE / f'pogos_{l}_snow.webp').astype(np.float32)
        if m.ndim == 3: m = m[..., 0]
        m = gblur(m, 1.2)
        if l == 'f':   # небо F: выше верхнего края слоя здания и подложки-«неба» снега нет
            al = rd(FR / 'pogos_f_building.webp')[..., 3] > 128
            top = np.where(al.any(0), al.argmax(0), FH).astype(np.float32)
            top = cv2.GaussianBlur(top[None], (0, 0), 6)[0]
            yy = np.arange(FH, dtype=np.float32)[:, None]
            m *= np.clip((yy - (top[None] - 6)) / 6, 0, 1)
        g = np.clip(m, 0, 255).astype(np.uint8)
        save_webp(np.dstack([g, g, g]), FR / f'pogos_{l}_snow.webp', 95)
        print('snow', l, 'cover %.3f' % (g > 128).mean())

def sway():
    for l in 'abc':
        s = rd(PRE / f'pogos_{l}_sway.png')[..., :3].astype(np.float32)
        eh = s.shape[0] // 2; top, bot = s[:eh], s[eh:]
        T = np.clip(2 - (top[..., 0] + top[..., 1]) / 255, 0, 1)
        m = (T > 0.5).astype(np.uint8)
        m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))
        nc, lb, st, _ = cv2.connectedComponentsWithStats(m)
        keep = np.zeros_like(m)
        for i in range(1, nc):
            if st[i, 3] >= 60 and st[i, 4] >= 1500: keep[lb == i] = 1   # только кроны (высокие); трава и кусты у земли не качаются
        ff = keep.copy(); h, w = ff.shape; mask = np.zeros((h + 2, w + 2), np.uint8)
        cv2.floodFill(ff, mask, (0, 0), 1); keep = keep | (1 - ff)               # дыры внутри кроны — тоже крона
        soft = np.clip(gblur(cv2.erode(keep, np.ones((3, 3), np.uint8)).astype(np.float32), 2.5) * 1.15, 0, 1)
        hgt = top[..., 2] * (soft > 0.004)
        out = np.zeros_like(s)
        out[:eh, ..., 0] = soft * 255; out[:eh, ..., 2] = hgt
        out[eh:] = bot
        Image.fromarray(out.astype(np.uint8), 'RGB').save(FR / f'pogos_{l}_sway.png', optimize=True)
        print('sway', l, 'crown %.3f' % (soft > 0.5).mean())

def atree():
    F = rd(PRE / 'pogos_a.webp')[..., :3].astype(np.float32)
    bg = rd(PRE / 'pogos_a_bg.webp')[..., :3].astype(np.float32)
    bl = rd(PRE / 'pogos_a_building.webp').astype(np.float32)
    s = rd(PRE / 'pogos_a_sway.png')[..., :3].astype(np.float32); eh = s.shape[0] // 2
    T = (np.clip(2 - (s[:eh, ..., 0] + s[:eh, ..., 1]) / 255, 0, 1) > 0.5).astype(np.uint8)
    nc, lb, st, _ = cv2.connectedComponentsWithStats(T)
    big = np.argmax(st[1:, 4]) + 1; crown = (lb == big).astype(np.uint8)
    crown = cv2.resize(crown, (FW, FH), interpolation=cv2.INTER_NEAREST)
    zone = cv2.morphologyEx(crown, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (31, 31)))
    zone = cv2.dilate(zone, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (21, 21)))
    z = np.clip(gblur(zone.astype(np.float32), 3), 0, 1)[..., None]
    bg2 = bg * (1 - z) + F * z
    a = bl[..., 3] / 255
    a2 = np.clip(gblur(a, 1.1), 0, 1)
    a3 = a * (1 - z[..., 0]) + a2 * z[..., 0]
    rgb = bl[..., :3] * (1 - z) + F * z
    save_webp(bg2, FR / 'pogos_a_bg.webp', 93)
    save_webp(np.dstack([rgb, a3 * 255]), FR / 'pogos_a_building.webp', 93)
    print('atree zone %.3f' % (zone > 0).mean())

def night():
    ref = []
    for l in 'abcd':
        L = lab(rd(FR / f'pogos_{l}_night.webp')[..., :3].astype(np.float32))
        warm = (L[..., 2] > 12) & (L[..., 0] > 45)
        ref.append(L[~warm])
    R = np.concatenate(ref); rL, ra, rb = np.median(R[:, 0]), np.median(R[:, 1]), np.median(R[:, 2])
    print('ref night L %.1f a %.1f b %.1f' % (rL, ra, rb))
    for l in 'ef':
        im = rd(PRE / f'pogos_{l}_night.webp')[..., :3].astype(np.float32)
        L = lab(im)
        src = (L[..., 2] > 25) & (L[..., 0] > 55)                       # огни: ярко и тепло
        src = cv2.morphologyEx(src.astype(np.uint8), cv2.MORPH_OPEN, np.ones((2, 2), np.uint8)).astype(np.float32)
        W = np.clip(gblur(src, 4) * 3 + gblur(src, 22) * 6, 0, 1)        # тепло у огня, мягкий спад
        nw = ~(src > 0)
        mL, ma, mb = np.median(L[..., 0][nw]), np.median(L[..., 1][nw]), np.median(L[..., 2][nw])
        C = L.copy()
        C[..., 0] = np.clip(L[..., 0] * min(1.0, (rL + 3) / max(mL, 1)), 0, 100)
        C[..., 1] = (L[..., 1] - ma) * 0.45 + ra
        C[..., 2] = (L[..., 2] - mb) * 0.40 + rb
        O = L * W[..., None] + C * (1 - W[..., None])
        lab8 = np.dstack([O[..., 0] * 255 / 100, O[..., 1] + 128, O[..., 2] + 128])
        rgb = cv2.cvtColor(np.clip(lab8, 0, 255).astype(np.uint8), cv2.COLOR_LAB2RGB)
        save_webp(rgb, FR / f'pogos_{l}_night.webp', 93)
        L2 = lab(rgb.astype(np.float32))
        print('night', l, 'before L %.1f a %.1f b %.1f' % (mL, ma, mb), 'after b(non-light) %.1f warm-zone %.3f' % (np.median(L2[..., 2][W < 0.2]), (W > 0.2).mean()))

# ---- надпись D ----
LUN_DST = [[140, 586], [430, 603], [285, 475], [180, 506], [400, 508]]   # край люнета на кадре D: низ слева, низ справа, вершина, 45° слева/справа
INSC_R = [0.1758, 0.3407, 0.5729, 0.4469]
LINES = [('ՍՈՒՐԲ', 0.64), ('ՊՈՂՈՍ', 0.42), ('ՊԵՏՐՈՍ', 0.20)]          # строка, центр по высоте люнета (0 — низ, 1 — вершина)
def insc():
    ttf = Path(tempfile.gettempdir()) / 'NotoSerifArmenian11.ttf'
    if not ttf.exists():
        from fontTools.ttLib import TTFont
        f = TTFont('engine/fonts/NotoSerifArmenian-armenian.woff2'); f.flavor = None; f.save(ttf)
    src = np.array([[-1, 0], [1, 0], [0, 1], [-0.7071, 0.7071], [0.7071, 0.7071]], np.float32)
    H, _ = cv2.findHomography(src, np.array(LUN_DST, np.float32), 0)
    U = 1000                                                            # канон: 1 радиус люнета = 1000 px
    Cm = np.array([[1 / U, 0, -1], [0, -1 / U, 1], [0, 0, 1]])
    X0, Y0 = INSC_R[0] * FW, INSC_R[1] * FH
    OW, OH = JR((INSC_R[2] - INSC_R[0]) * FW * 2), JR((INSC_R[3] - INSC_R[1]) * FH * 2)
    S = np.array([[2, 0, -2 * X0], [0, 2, -2 * Y0], [0, 0, 1]])
    M = S @ H @ Cm
    RMAX = 0.80
    letters = []
    for txt, yc in LINES:
        cap = 0.15
        for _ in range(12):
            size = int(cap * U / 0.72); font = ImageFont.truetype(str(ttf), size)
            try: font.set_variation_by_axes([600])
            except Exception: pass
            track = 0.12 * size; wd = [font.getlength(ch) for ch in txt]; tw = (sum(wd) + track * (len(txt) - 1)) / U
            ytop = yc + cap / 2; avail = 2 * math.sqrt(max(RMAX ** 2 - ytop ** 2, 0)) * 0.94
            if tw <= avail: break
            cap *= 0.94
        x = -tw / 2
        for ch, cw in zip(txt, wd):
            cvs = Image.new('L', (2 * U, U), 0); dr = ImageDraw.Draw(cvs)
            dr.text(((x + 1) * U, (1 - yc) * U), ch, font=font, fill=255, anchor='lm')
            letters.append(np.asarray(cvs).astype(np.float32) / 255); x += (cw + track) / U
    print('letters', len(letters), 'out', OW, OH)
    yy, xx = np.mgrid[0:OH, 0:OW]
    cells, tiles = [], []
    for G0 in letters:
        G = cv2.warpPerspective(G0, M, (OW, OH), flags=cv2.INTER_AREA)
        G = np.clip(G, 0, 1)
        sh = np.clip(G - np.roll(G, 3, axis=0), 0, 1)                  # нижняя грань желобка (в тени)
        dark = 1 - (0.50 * G + 0.25 * sh)
        drgb = np.stack([dark, dark * 0.97, dark * 0.95], -1); da = np.clip(G * 1.4 + sh, 0, 1)
        core = np.clip(gblur(G, 0.8) * 1.15, 0, 1)                      # раскалённая середина буквы
        frgb = np.stack([core, core * 0.80, core * 0.46], -1); fa = core
        halo = np.clip(gblur(G, 5) * 1.6 + gblur(G, 14) * 1.2, 0, 1)   # свечение камня вокруг
        grgb = np.stack([halo, halo * 0.50, halo * 0.16], -1); ga = np.clip(halo * 1.4, 0, 1)
        nz = np.argwhere(ga > 0.01)
        if not len(nz): continue
        (ya, xa), (yb, xb) = nz.min(0), nz.max(0) + 1
        sl = (slice(ya, yb), slice(xa, xb))
        tiles.append([np.dstack([drgb[sl], da[sl]]), np.dstack([frgb[sl], fa[sl]]), np.dstack([grgb[sl], ga[sl]])])
        cells.append([int(xa), int(ya), int(xb - xa), int(yb - ya)])
    AW, pad = 1024, 2; x = y = rowh = 0; place = []
    for c in cells:
        if x + c[2] > AW: x = 0; y += rowh + pad; rowh = 0
        place.append((x, y)); x += c[2] + pad; rowh = max(rowh, c[3])
    AH = y + rowh
    atl = [np.zeros((AH, AW, 4), np.float32) for _ in range(3)]
    for (px, py), c, t in zip(place, cells, tiles):
        for k in range(3): atl[k][py:py + c[3], px:px + c[2]] = t[k]
    for k, nm in enumerate(('ldark', 'lfire', 'lglow')):
        Image.fromarray((np.clip(atl[k], 0, 1) * 255).astype(np.uint8), 'RGBA').save(FR / f'show_insc_d_{nm}.png', optimize=True)
    out = [[px, py, c[2], c[3], c[0], c[1]] for (px, py), c in zip(place, cells)]
    json.dump({'rect': INSC_R, 'size': [OW, OH], 'cells': out}, open(PRE / 'insc11.json', 'w'))
    print('atlas', AW, AH, 'cells', json.dumps(out))

if __name__ == '__main__':
    steps = sys.argv[1:] or ['all']
    if 'all' in steps: steps = ['backup', 'atree', 'aman', 'aground', 'poses', 'snow', 'sway', 'night', 'insc']
    if 'backup' not in steps: backup()
    for s in steps: globals()[s]()
