#!/usr/bin/env python3
"""Заход 16 (e1.51, только код): python3 pogos-petros/build/scripts/fix16.py <шаг…>
insc   — надпись D «резьба в камне»: атласы ×8 к пикселям кадра (вчетверо подробнее атласов e1.46), шрифт — только маска.
         groove (multiply, белый фон): желобок темнее, нижняя кромка в тени; light (screen, чёрный фон): верхний край светлее (emboss по маске);
         ember1/ember2 (screen): тление в глубине желобка — тёплый шум двух узоров (движок их переливает) + узкое свечение. RGB webp без альфы.
kennel — маска снега B: будка (картинка дождя/снега show_wx_b_kennel.png) вырезана из маски, кроме крыши — снег только на крыше будки.
Исходники до захода — pogos-petros/build/source/pre16/. Повторный запуск даёт тот же результат."""
import sys, json, math, shutil, tempfile
from pathlib import Path
import numpy as np, cv2
from PIL import Image, ImageDraw, ImageFont
sys.path.insert(0, str(Path(__file__).parent))
import fix11 as F11
FR = Path('tests/pogos-petros/frames'); PRE = Path('pogos-petros/build/source/pre16'); PRE.mkdir(parents=True, exist_ok=True)
REP = Path('pogos-petros/build/report/s16'); REP.mkdir(parents=True, exist_ok=True)
FW, FH = 768, 1365
def gb(a, s): return cv2.GaussianBlur(a.astype(np.float32), (0, 0), s) if s > 0 else a.astype(np.float32)
def keep(name):
    p = FR / name
    if p.exists() and not (PRE / name).exists(): shutil.copy2(p, PRE / name)
    return PRE / name if (PRE / name).exists() else p

def insc(SC=8):
    ttf = Path(tempfile.gettempdir()) / 'NotoSerifArmenian11.ttf'
    if not ttf.exists():
        from fontTools.ttLib import TTFont
        f = TTFont('engine/fonts/NotoSerifArmenian-armenian.woff2'); f.flavor = None; f.save(ttf)
    src = np.array([[-1, 0], [1, 0], [0, 1], [-0.7071, 0.7071], [0.7071, 0.7071]], np.float32)
    H, _ = cv2.findHomography(src, np.array(F11.LUN_DST, np.float32), 0)
    U = 1600
    Cm = np.array([[1 / U, 0, -1], [0, -1 / U, 1], [0, 0, 1]])
    R = F11.INSC_R; X0, Y0 = R[0] * FW, R[1] * FH
    OW, OH = F11.JR((R[2] - R[0]) * FW * SC), F11.JR((R[3] - R[1]) * FH * SC)
    S = np.array([[SC, 0, -SC * X0], [0, SC, -SC * Y0], [0, 0, 1]]); M = S @ H @ Cm
    rng = np.random.default_rng(16)
    def noise(h, w, seed):   # плавный шум 0..1 из трёх октав (крупные пятна углей + мелкие искры)
        r = np.random.default_rng(seed); n = np.zeros((h, w), np.float32)
        for s, k in ((22, 0.55), (9, 0.3), (3.5, 0.15)):
            q = gb(r.random((h, w)).astype(np.float32), s); q = (q - q.mean()) / (q.std() + 1e-6); n += k * q
        return np.clip(0.5 + 0.28 * n, 0, 1)
    letters = []
    for txt, yc in F11.LINES:
        cap = 0.15
        for _ in range(12):
            size = int(cap * U / 0.72); font = ImageFont.truetype(str(ttf), size)
            try: font.set_variation_by_axes([600])
            except Exception: pass
            track = 0.12 * size; wd = [font.getlength(ch) for ch in txt]; tw = (sum(wd) + track * (len(txt) - 1)) / U
            ytop = yc + cap / 2; avail = 2 * math.sqrt(max(0.80 ** 2 - ytop ** 2, 0)) * 0.94
            if tw <= avail: break
            cap *= 0.94
        x = -tw / 2
        for ch, cw in zip(txt, wd):
            cvs = Image.new('L', (2 * U, U), 0); ImageDraw.Draw(cvs).text(((x + 1) * U, (1 - yc) * U), ch, font=font, fill=255, anchor='lm')
            G = cv2.warpPerspective(np.asarray(cvs).astype(np.float32) / 255, M, (OW, OH), flags=cv2.INTER_AREA)
            letters.append(np.clip(G, 0, 1)); x += (cw + track) / U
    print('letters', len(letters), 'rect', OW, OH)
    cells, tiles = [], []
    for k, G in enumerate(letters):
        nz = np.argwhere(G > 0.02)
        if not len(nz): continue
        mg = 6 * SC; (ya, xa), (yb, xb) = np.maximum(nz.min(0) - mg, 0), np.minimum(nz.max(0) + 1 + mg, [OH, OW])
        g = G[ya:yb, xa:xb]; h, w = g.shape
        stroke = max(2.0, 2 * float(cv2.distanceTransform((g > 0.5).astype(np.uint8), cv2.DIST_L2, 5).max()))   # ширина штриха, px атласа
        D = gb(g, stroke * 0.22)                                  # глубина желобка: максимум по оси штриха
        gy = np.zeros_like(D); gy[1:-1] = (D[2:] - D[:-2]) * 0.5
        gy /= (np.abs(gy).max() + 1e-6)
        # на верхней кромке буквы D возрастает вниз (gy > 0), на нижней — убывает (gy < 0)
        upper, lower = np.clip(gy * 1.6, 0, 1), np.clip(-gy * 1.6, 0, 1)
        dark = 1 - np.clip(0.55 * D + 0.40 * lower, 0, 0.85)             # желобок темнее, нижняя кромка в тени
        groove = np.dstack([dark, dark * 0.975, dark * 0.95])
        lt = np.clip(upper * 0.75 * (1 - 0.6 * D), 0, 1)                  # верхний край светлее (тёплый белый)
        light = np.dstack([lt, lt * 0.93, lt * 0.80])
        core = np.clip((D / (D.max() + 1e-6) - 0.35) / 0.5, 0, 1)        # глубина штриха — там тлеет
        gl = np.clip(gb(core, stroke * 0.6) * 0.6, 0, 1)                  # узкое тёплое свечение вокруг
        ems = []
        for sd in (1, 2):
            n = noise(h, w, 100 * k + sd)
            sp = np.clip((n - 0.42) / 0.30, 0, 1) ** 1.5                    # угли: тёплые пятна и искры, между ними — тёмная глубина
            e = np.clip(core * (0.10 + 0.95 * sp) + gl * (0.15 + 0.45 * sp), 0, 1)
            ems.append(np.dstack([e, e * (0.38 + 0.25 * n), e * (0.10 + 0.08 * n)]))
        tiles.append([groove, light, ems[0], ems[1]]); cells.append([int(xa), int(ya), int(w), int(h)])
    AW, pad = 4096, 4; x = y = rowh = 0; place = []
    for c in cells:
        if x + c[2] > AW: x = 0; y += rowh + pad; rowh = 0
        place.append((x, y)); x += c[2] + pad; rowh = max(rowh, c[3])
    AH = y + rowh
    names = ('cgroove', 'clight', 'cember1', 'cember2'); bgv = (1, 0, 0, 0)
    for k, nm in enumerate(names):
        A = np.full((AH, AW, 3), bgv[k], np.float32)
        for (px, py), c, t in zip(place, cells, tiles): A[py:py + c[3], px:px + c[2]] = t[k]
        Image.fromarray((np.clip(A, 0, 1) * 255 + 0.5).astype(np.uint8), 'RGB').save(FR / f'show_insc_d_{nm}.webp', 'WEBP', quality=92, method=6)
    out = [[px, py, c[2], c[3], c[0], c[1]] for (px, py), c in zip(place, cells)]
    json.dump({'rect': R, 'size': [OW, OH], 'scale': SC, 'atlas': [AW, AH], 'cells': out}, open(REP / 'insc16.json', 'w'))
    # проверка: надпись целиком на кадре D (как её смешает движок: multiply + screen), ×3 к кадру
    d = np.array(Image.open(FR / 'pogos_d.webp').convert('RGB')).astype(np.float32) / 255
    xa, ya, xb, yb = F11.JR(R[0] * FW), F11.JR(R[1] * FH), F11.JR(R[2] * FW), F11.JR(R[3] * FH)
    base = cv2.resize(d[ya:yb, xa:xb], (OW, OH), interpolation=cv2.INTER_CUBIC)
    mul = np.ones((OH, OW, 3), np.float32); add = np.zeros((OH, OW, 3), np.float32)
    for (px, py), c, t in zip(place, cells, tiles):
        sl = (slice(c[1], c[1] + c[3]), slice(c[0], c[0] + c[2]))
        mul[sl] *= t[0]; add[sl] += t[1]
    add2 = add.copy()
    for (px, py), c, t in zip(place, cells, tiles): add2[c[1]:c[1] + c[3], c[0]:c[0] + c[2]] += 0.8 * t[2]
    cA = 1 - (1 - base * mul) * (1 - np.clip(add, 0, 1)); cB = 1 - (1 - base * mul) * (1 - np.clip(add2, 0, 1))   # резьба; резьба + угли
    Image.fromarray((np.concatenate([base, cA, cB], 0) * 255).astype(np.uint8)).resize((OW // 2, OH * 3 // 2)).save(REP / 'insc16_check.jpg', quality=88)
    print('atlas', AW, AH, 'cells', len(out), json.dumps(out))

def kennel():
    sn = np.array(Image.open(keep('pogos_b_snow.webp')).convert('RGB')).astype(np.float32)
    k = np.array(Image.open(FR / 'show_wx_b_kennel.png').convert('RGBA')).astype(np.float32) / 255
    x0, y0 = F11.JR(0.40 * FW), F11.JR(0.66 * FH); h, w = k.shape[:2]
    a = k[..., 3]
    # будка: альфа картинки, но без травы/земли вокруг (широкая нижняя «юбка» альфы) — только строки выше пола будки
    # контур будки (пиксели картинки 246×246, по самому рисунку Gemini: скаты 96…132, стены до 189) ∩ альфа — без травы и земли вокруг
    poly = np.array([[100, 133], [136, 94], [192, 95], [221, 133], [219, 191], [106, 189]], np.int32)
    pm = np.zeros((h, w), np.uint8); cv2.fillPoly(pm, [poly], 1)
    body = ((a > 0.35).astype(np.uint8) | cv2.erode(pm, np.ones((5, 5), np.uint8))) & pm
    body = cv2.morphologyEx(body, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    # крыша: скаты до карниза — там снег остаётся и чуть плотнее
    ytop = int(np.where(body.any(1))[0].min()); yeave = 133
    roof = body.copy(); roof[yeave:] = 0
    cut = gb(body.astype(np.float32), 1.2); rf = gb(roof.astype(np.float32), 1.0)
    reg = sn[y0:y0 + h, x0:x0 + w].copy()
    m = reg.mean(-1)
    new = m * (1 - cut) + np.maximum(m, 235) * rf
    sn2 = sn.copy(); sn2[y0:y0 + h, x0:x0 + w] = np.repeat(np.clip(new, 0, 255)[..., None], 3, -1)
    Image.fromarray(sn2.astype(np.uint8)).save(FR / 'pogos_b_snow.webp', 'WEBP', quality=95, method=6)
    vis = np.concatenate([reg.astype(np.uint8), np.repeat(np.clip(new, 0, 255)[..., None], 3, -1).astype(np.uint8), (np.dstack([body, roof, roof]) * 255).astype(np.uint8)], 1)
    Image.fromarray(vis).resize((vis.shape[1] * 2, vis.shape[0] * 2)).save(REP / 'kennel16_check.png')
    print('kennel', x0, y0, w, h, 'top', ytop, 'eave', yeave, 'body px', int(body.sum()), 'roof px', int(roof.sum()))

if __name__ == '__main__':
    for s in sys.argv[1:]: globals()[s]()
