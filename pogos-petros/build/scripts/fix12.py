#!/usr/bin/env python3
"""Заход 12 (30.10.2026, e1.47): рисунки Gemini → файлы движка. Из корня репо: python3 pogos-petros/build/scripts/fix12.py <шаг> [...]
  storm  — C: грозовой рисунок (p0g34y) и вспышка молнии (9znfht) совмещены с кадром C (ECC по контурам ниже неба) →
           show_storm_c.webp, show_flash_c.webp; «окно» ручья (show_storm_c_hole.png — маска, где в грозу видна живая сцена с быстрым ручьём).
  sheet  — лист Gemini на однотонном фоне → отдельные картинки (cut6.py): листья → show_leaf_*.png, струи дождя → show_rain_*.png.
  poses  — позы старика/собаки из правок Gemini вырезки: совмещение с кадром, цвет и альфа как в fix11 (poses).
Вход — pogos-petros/gemini/in/Gemini_Generated_Image_<id>.jpeg (полный размер, кнопка «Скачать»)."""
import sys, json, math, subprocess
from pathlib import Path
import numpy as np, cv2
from PIL import Image

FR = Path('tests/pogos-petros/frames'); GIN = Path('pogos-petros/gemini/in')
FW, FH = 768, 1365
def gid(i): return GIN / ('Gemini_Generated_Image_%s.jpeg' % (i * 3)[:16])
def save_webp(arr, p, q=92):
    Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8)).save(p, 'WEBP', quality=q, method=6)

def align(src_rgb, ref_rgb, y0=0.30, mode=cv2.MOTION_AFFINE):
    """Картинку Gemini → в пиксели кадра: масштаб к ширине кадра, потом ECC по размытым контурам (ниже y0 — небо у Gemini своё)."""
    h, w = ref_rgb.shape[:2]
    s = cv2.resize(src_rgb, (w, round(src_rgb.shape[0] * w / src_rgb.shape[1])), interpolation=cv2.INTER_AREA)
    s = s[:h] if s.shape[0] >= h else np.pad(s, ((0, h - s.shape[0]), (0, 0), (0, 0)), mode='edge')
    def ed(a): return cv2.GaussianBlur(cv2.Canny(cv2.cvtColor(a, cv2.COLOR_RGB2GRAY), 50, 130).astype(np.float32), (0, 0), 3)
    E1, E2 = ed(ref_rgb), ed(s); r0 = int(h * y0)
    W = np.eye(2, 3, dtype=np.float32)
    try:
        cc, W = cv2.findTransformECC(E1[r0:], E2[r0:], W, mode, (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 300, 1e-6), None, 5)
    except cv2.error as e:
        cc = -1
    W = W.astype(np.float64); W[0, 2] -= W[0, 1] * r0; W[1, 2] += r0 * (1 - W[1, 1])   # ECC считал в полосе от r0 — перевод в координаты всего кадра
    out = cv2.warpAffine(s, W, (w, h), flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP, borderMode=cv2.BORDER_REPLICATE)
    return out, cc, W

def storm():
    C = np.array(Image.open(FR / 'pogos_c.webp').convert('RGB'))
    for name, i in (('show_storm_c.webp', 'p0g34y'), ('show_flash_c.webp', '9znfht')):
        g = np.array(Image.open(gid(i)).convert('RGB'))
        out, cc, W = align(g, C)
        save_webp(out, FR / name, 90)
        print(name, i, 'ECC %.3f' % cc, np.round(W, 3).tolist())
    poly = np.array([[0.3, 0.8], [0.345, 0.8], [0.645, 0.975], [0.575, 0.995]]) * [FW, FH]   # вода арыка (как refl луны)
    m = np.zeros((FH, FW), np.float32); cv2.fillPoly(m, [poly.astype(np.int32)], 1.0)
    m = np.clip(cv2.GaussianBlur(m, (0, 0), 3) * 1.3, 0, 1)
    Image.fromarray(np.dstack([np.zeros((FH, FW, 3), np.uint8), (m * 255).astype(np.uint8)]), 'RGBA').save(FR / 'show_storm_c_hole.png', optimize=True)
    print('hole %.4f' % m.mean())

def sheet(i, name, bg, extra=()):
    cmd = ['python3', 'pogos-petros/build/scripts/cut6.py', (i * 3)[:16], name] + list(extra)
    print(' '.join(cmd)); print(subprocess.run(cmd, capture_output=True, text=True).stdout[-800:])

# ---- позы и вставка из правок Gemini вырезки кадра (вкладка chka.am показывала кадр с x0, y0 шириной w на экран 1369×765) ----
sys.path.insert(0, str(Path(__file__).resolve().parent))
import fix11 as F11
VIEW = (1369, 765)
def crop_box(x0, y0, w):
    h = w * VIEW[1] / VIEW[0]; return x0, y0, w, h
def from_crop(gimg, frame_rgb, x0, y0, w):
    """Ответ Gemini на вырезку → картинка всего кадра: кадр, а в рамке вырезки — ответ, совмещённый ECC (аффинно) с кадром."""
    X0, Y0, W, H = crop_box(x0, y0, w)
    xa, ya, xb, yb = int(round(X0)), int(round(Y0)), int(round(X0 + W)), int(round(Y0 + H))
    ref = frame_rgb[ya:yb, xa:xb]
    g = cv2.resize(gimg, (xb - xa, yb - ya), interpolation=cv2.INTER_AREA)
    def ed(a): return cv2.GaussianBlur(cv2.Canny(cv2.cvtColor(a, cv2.COLOR_RGB2GRAY), 50, 130).astype(np.float32), (0, 0), 2)
    Wm = np.eye(2, 3, dtype=np.float32)
    try: cc, Wm = cv2.findTransformECC(ed(ref), ed(g), Wm, cv2.MOTION_AFFINE, (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 300, 1e-6), None, 5)
    except cv2.error: cc = -1
    ga = cv2.warpAffine(g, Wm, (xb - xa, yb - ya), flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP, borderMode=cv2.BORDER_REPLICATE)
    out = frame_rgb.astype(np.float32).copy()
    yy, xx = np.mgrid[0:yb - ya, 0:xb - xa]
    e = np.clip(np.minimum.reduce([xx, xb - xa - 1 - xx, yy, yb - ya - 1 - yy]) / 8.0, 0, 1)[..., None]   # край вырезки — мягко в кадр
    out[ya:yb, xa:xb] = ga * e + out[ya:yb, xa:xb] * (1 - e)
    return out, cc
def pose_png(full, base, rect, out_path, halo=False, F0=None):
    """Как fix11.poses: цвет к кадру, альфа — только отличие (ΔE > 13), мягкий край, рамка в ноль за 3 px."""
    JR = F11.JR
    x0, y0, x1, y1 = JR(rect[0] * FW), JR(rect[1] * FH), JR(rect[2] * FW), JR(rect[3] * FH)
    if halo:
        bx0, by0, bx1, by1 = F11.MAN_BOX
        Cc = full[by0:by1, bx0:bx1].copy(); full = full.copy(); full[by0:by1, bx0:bx1] = np.clip(Cc * F11.halo_gain(Cc, F11.MAN_RECT), 0, 255)
    B = base[y0:y1, x0:x1].astype(np.float32); rgb = full[y0:y1, x0:x1].astype(np.float32); h, w = B.shape[:2]
    X, Y = rgb.reshape(-1, 3), B.reshape(-1, 3); keep = np.ones(len(X), bool); g = np.ones(3)
    for _ in range(4):
        for c in range(3):
            xs, ys = X[keep, c], Y[keep, c]; g[c] = (xs * ys).sum() / max((xs * xs).sum(), 1)
        res = np.abs(X * g - Y).sum(-1); keep = res < np.percentile(res, 60)
    g = np.clip(g, 0.7, 1.5); P1 = np.clip(rgb * g, 0, 255)
    same = (F11.dE(P1, B) < 10).astype(np.float32); ws = F11.gblur(same, 6); ratio = np.ones_like(P1)
    for c in range(3):
        num, den = F11.gblur(B[..., c] * same, 6), F11.gblur(P1[..., c] * same, 6); ratio[..., c] = np.where(ws > 0.03, (num + 1) / (den + 1), 1)
    P2 = np.clip(P1 * np.clip(F11.gblur(ratio, 2), 0.75, 1.35), 0, 255)
    d = F11.dE(P2, B)
    m = (cv2.medianBlur(np.clip(d * 6, 0, 255).astype(np.uint8), 3) > 6 * 13).astype(np.uint8)
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    nc, lb, st, _ = cv2.connectedComponentsWithStats(m)
    for i in range(1, nc):
        if st[i, 4] < 10: m[lb == i] = 0
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))   # фигура целиком, без дыр (иначе старое и новое тело вперемешку)
    ff = m.copy(); hh, ww = ff.shape; mk = np.zeros((hh + 2, ww + 2), np.uint8); cv2.floodFill(ff, mk, (0, 0), 1); m = m | (1 - ff)
    m = cv2.dilate(m, np.ones((3, 3), np.uint8)); soft = np.clip(F11.gblur(m.astype(np.float32), 1.3) * 1.6, 0, 1)
    yy, xx = np.mgrid[0:h, 0:w]
    edge = np.clip(np.minimum.reduce([xx + 0.5, w - 0.5 - xx, yy + 0.5, h - 0.5 - yy]) / 3.0, 0, 1)
    A = np.clip(soft * edge, 0, 1)
    Image.fromarray(np.dstack([P2, A * 255]).astype(np.uint8), 'RGBA').save(out_path, optimize=True)
    print('pose', out_path.name, '%dx%d' % (w, h), 'alpha %.3f' % A.mean(), 'ΔE fig %.1f' % (d[A > 0.5].mean() if (A > 0.5).any() else 0))

MAN_CROP = (140, 895, 380)         # A: вырезка старика на вкладке (x0, y0, ширина в px кадра)
MAN_RECT12 = [0.30, 0.69, 0.52, 0.80]
def man(ids):
    F0 = np.array(Image.open('pogos-petros/build/source/pre11/pogos_a.webp').convert('RGB'))   # кадр, который видел Gemini (до чистки ореола)
    base = np.array(Image.open(FR / 'pogos_a.webp').convert('RGB'))
    for k, i in enumerate(ids):
        full, cc = from_crop(np.array(Image.open(gid(i)).convert('RGB')), F0, *MAN_CROP)
        print('man', i, 'ECC %.3f' % cc)
        pose_png(full, base, MAN_RECT12, FR / ('show_pose_a_old%d.png' % (k + 1)), halo=True)

DOG_CROP = (110, 780, 620)         # B: вырезка у стены (x0, y0, ширина)
def dog(base_id, pose_ids, rect):
    """B: собака из правки Pro вписывается во все слои кадра (кадр, подложка, слой здания) по области отличия; ночью — она же, спит, в тон ночи."""
    Bf = np.array(Image.open(FR / 'pogos_b.webp').convert('RGB')).astype(np.float32)
    full, cc = from_crop(np.array(Image.open(gid(base_id)).convert('RGB')), Bf.astype(np.uint8), *DOG_CROP)
    print('dog base', base_id, 'ECC %.3f' % cc)
    JR = F11.JR; x0, y0, x1, y1 = JR(rect[0] * FW), JR(rect[1] * FH), JR(rect[2] * FW), JR(rect[3] * FH)
    d = F11.dE(full[y0:y1, x0:x1], Bf[y0:y1, x0:x1])
    m = (cv2.medianBlur(np.clip(d * 6, 0, 255).astype(np.uint8), 3) > 6 * 12).astype(np.uint8)
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8)); nc, lb, st, _ = cv2.connectedComponentsWithStats(m)
    if nc > 1: m = (lb == 1 + np.argmax(st[1:, 4])).astype(np.uint8)
    m = cv2.dilate(m, np.ones((5, 5), np.uint8)); a = np.clip(F11.gblur(m.astype(np.float32), 1.5) * 1.5, 0, 1)
    A = np.zeros((FH, FW), np.float32); A[y0:y1, x0:x1] = a
    # цвет вставки — к кадру (как позы): множитель по «тем же» пикселям рамки
    sel = (A[y0:y1, x0:x1] < 0.05) & (d < 10)
    gn = np.array([(Bf[y0:y1, x0:x1][..., c][sel]).mean() / max(full[y0:y1, x0:x1][..., c][sel].mean(), 1) for c in range(3)]) if sel.any() else np.ones(3)
    full = np.clip(full * np.clip(gn, 0.8, 1.25), 0, 255)
    A3 = A[..., None]
    for n in ('pogos_b.webp', 'pogos_b_bg.webp', 'pogos_b_building.webp'):
        im = np.array(Image.open(FR / n)).astype(np.float32)
        im[..., :3] = im[..., :3] * (1 - A3) + full * A3
        Image.fromarray(np.clip(im, 0, 255).astype(np.uint8)).save(FR / n, 'WEBP', quality=93, method=6, **({'alpha_quality': 100, 'exact': True} if im.shape[2] == 4 else {}))
    # ночь: та же спящая собака в тон ночи (отношение ночь/день вокруг, без собаки), в ночной рисунок
    N = np.array(Image.open(FR / 'pogos_b_night.webp').convert('RGB')).astype(np.float32)
    ring = ((F11.gblur(A, 12) > 0.02) & (A < 0.02)).astype(np.float32)
    rn = F11.nblur(N, ring, 14); rd_ = F11.nblur(Bf, ring, 14)
    nd = np.clip(full * (rn / np.maximum(rd_, 4)), 0, 255)
    N = N * (1 - A3) + nd * A3
    Image.fromarray(np.clip(N, 0, 255).astype(np.uint8)).save(FR / 'pogos_b_night.webp', 'WEBP', quality=93, method=6)
    np.save('pogos-petros/build/source/pre11/dog_mask.npy', A)
    print('dog inserted: %.0f px' % (A > 0.5).sum())
    base = np.array(Image.open(FR / 'pogos_b.webp').convert('RGB'))
    for k, i in enumerate(pose_ids):   # позы — правки того же ответа Pro в том же чате (Flash): совмещаем с исходным ответом
        g2 = np.array(Image.open(gid(i)).convert('RGB'))
        fullp, cc = from_crop(g2, Bf.astype(np.uint8), *DOG_CROP); print('dog pose', i, 'ECC %.3f' % cc)
        fullp = np.clip(fullp * np.clip(gn, 0.8, 1.25), 0, 255)
        pose_png(fullp, base, rect, FR / ('show_pose_b_dog%d.png' % (k + 1)))

if __name__ == '__main__':
    a = sys.argv[1:]
    if a[0] == 'storm': storm()
    elif a[0] == 'sheet': sheet(a[1], a[2], None, a[3:])
    elif a[0] == 'man': man(a[1:])
    elif a[0] == 'dog': dog(a[1], a[2:], json.loads(open('pogos-petros/build/source/pre11/dog_rect.json').read()))
