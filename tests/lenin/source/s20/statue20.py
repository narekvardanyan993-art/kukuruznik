"""s20: статуя Ленина целиком из Gemini (не перекраска масками) + новая вырезка с мягкой маской и очисткой края.
- gem(n, kind): ответ Gemini (весь кадр или увеличенный кусок — refs/s20/in/crops.json) -> координаты кадра 768x1365, выравнивание ECC.
- statue_mask: статуя = вырезка s15 выше ступней (FEET).
- paste: ответ Gemini вклеивается мягкой маской на 8–12 px шире статуи; цвет ответа подогнан к кадру по кольцу 14–30 px вокруг.
- matte: альфа статуи по отличию рисунка от подложки (bg), осколки отброшены; цвет края — от ближайшего пикселя внутри (не небо)."""
import json, numpy as np, cv2
from pathlib import Path
from PIL import Image
from scipy import ndimage
B = Path(__file__).resolve().parents[2]
S15 = B / 'source/night/s15src'
R20 = B / 'refs/s20'
S19 = R20 / 's19src'   # кадры s19 (коммит 13dcbc2), выгружены из git: git show 13dcbc2:tests/lenin/frames/<файл>
FEET = {'lenin_1': 514, 'lenin_2': 481, 'lenin_3': 547, 'lenin_4': 940, 'lenin_6': 946}
W, H = 768, 1365
def rd(p, mode='RGB'): return np.asarray(Image.open(p).convert(mode))
def ecc(ref, mov, mask=None):
    a = cv2.GaussianBlur(cv2.cvtColor(ref, cv2.COLOR_RGB2GRAY).astype(np.float32) / 255, (0, 0), 1.5)
    b = cv2.GaussianBlur(cv2.cvtColor(mov, cv2.COLOR_RGB2GRAY).astype(np.float32) / 255, (0, 0), 1.5)
    M = np.eye(2, 3, dtype=np.float32)
    try:
        cc, M = cv2.findTransformECC(a, b, M, cv2.MOTION_AFFINE, (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 200, 1e-6), mask, 5)
    except Exception as e:
        print('ECC fail', e); cc = -1
    out = cv2.warpAffine(mov, M, (ref.shape[1], ref.shape[0]), flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP, borderMode=cv2.BORDER_REFLECT)
    return out, float(cc), M
def gem(n, kind, file, ref_full):
    """ответ Gemini -> (картинка кадра, где валидно, cc). ref_full — то, что отправляли (полный кадр)."""
    g = rd(file)
    crops = json.load(open(R20 / 'in/crops.json'))
    if n in crops:
        x0, y0, w, h = crops[n]
        gc = cv2.resize(g, (w, h), interpolation=cv2.INTER_AREA)
        ref = ref_full[y0:y0 + h, x0:x0 + w]
        al, cc, M = ecc(ref, gc)
        out = ref_full.copy(); out[y0:y0 + h, x0:x0 + w] = al
        valid = np.zeros((H, W), np.float32); valid[y0 + 4:y0 + h - 4, x0 + 4:x0 + w - 4] = 1
        return out, cv2.GaussianBlur(valid, (0, 0), 2), cc, M
    gg = cv2.resize(g, (W, H), interpolation=cv2.INTER_AREA)
    al, cc, M = ecc(ref_full, gg)
    return al, np.ones((H, W), np.float32), cc, M
def statue_mask(n):
    a = rd(S15 / f'{n}_building.webp', 'RGBA')[..., 3] > 100
    a[FEET[n]:] = False
    lab, k = ndimage.label(a)
    if k > 1:
        sz = ndimage.sum(a, lab, range(1, k + 1)); a = lab == (1 + int(np.argmax(sz)))
    return a
def ring(m, r0, r1):
    return ndimage.binary_dilation(m, iterations=r1) & ~ndimage.binary_dilation(m, iterations=r0)
def color_fit(src, dst, sel):
    """линейная подгонка каналов src->dst по пикселям sel (кольцо неба/фона вокруг статуи)"""
    out = src.astype(np.float32).copy()
    for c in range(3):
        x = src[..., c][sel].astype(np.float32); y = dst[..., c][sel].astype(np.float32)
        A = np.vstack([x, np.ones_like(x)]).T
        k, b = np.linalg.lstsq(A, y, rcond=None)[0]
        k = float(np.clip(k, 0.8, 1.25)); b = float(np.clip(b, -30, 30))
        out[..., c] = out[..., c] * k + b
    return np.clip(out, 0, 255)
def paste_mask(st, n, grow=10, valid=None):
    m = ndimage.binary_dilation(st, iterations=grow)
    P = cv2.GaussianBlur(m.astype(np.float32), (0, 0), 2.5)
    P = np.clip(P * 1.25, 0, 1)
    yy = np.arange(H)[:, None]
    P *= np.clip((FEET[n] + 2 - yy) / 3.0, 0, 1)          # ниже ступней — постамент кадра, не трогаем
    if valid is not None: P *= valid
    return P
def deltaE(a, b):
    la = cv2.cvtColor(np.clip(a, 0, 255).astype(np.uint8), cv2.COLOR_RGB2LAB).astype(np.float32)
    lb = cv2.cvtColor(np.clip(b, 0, 255).astype(np.uint8), cv2.COLOR_RGB2LAB).astype(np.float32)
    la[..., 0] *= 100 / 255; lb[..., 0] *= 100 / 255; la[..., 1:] -= 128; lb[..., 1:] -= 128
    return np.sqrt(((la - lb) ** 2).sum(-1))
def matte(img, bg, st, n, t0=7.0, t1=20.0):
    """альфа статуи: отличие рисунка от подложки (небо/фон за статуей) в полосе вокруг старой маски"""
    zone = ndimage.binary_dilation(st, iterations=6)
    zone[FEET[n] + 1:] = False
    dE = deltaE(img, bg)
    Lp = cv2.cvtColor(np.clip(img, 0, 255).astype(np.uint8), cv2.COLOR_RGB2LAB)[..., 0].astype(np.float32) * 100 / 255
    core = (dE > t1) & zone & (Lp < 84)          # светлое (облако/небо в просвете) — не бронза
    core = ndimage.binary_closing(core, iterations=2) & zone
    lab, k = ndimage.label(core)
    if k > 1:
        sz = ndimage.sum(core, lab, range(1, k + 1)); keep = np.zeros(k + 1, bool); keep[1:] = sz >= max(40, 0.02 * sz.max())
        main = 1 + int(np.argmax(sz)); keep[:] = False; keep[main] = True
        # кусочки рядом с главным (рука, кулак, отдельный штрих) — оставить, если касаются через 2 px
        near = ndimage.binary_dilation(lab == main, iterations=2)
        for i in range(1, k + 1):
            if i != main and (near & (lab == i)).any(): keep[i] = True
        core = keep[lab]
    filled = ndimage.binary_fill_holes(core)
    holes, hk = ndimage.label(filled & ~core)
    for i in range(1, hk + 1):
        h = holes == i
        if h.sum() > 40 and dE[h].mean() < 8: filled[h] = False        # настоящий просвет неба (между рукой и телом, между ног)
    soft = np.clip((dE - t0) / (t1 - t0), 0, 1) * ndimage.binary_dilation(filled, iterations=1) * (Lp < 84)
    a = np.maximum(filled.astype(np.float32), soft)
    a = np.where(ndimage.binary_erosion(filled, iterations=1), 1.0, a)
    a = np.maximum(a, cv2.GaussianBlur(a, (0, 0), 0.7) * 0.9)   # мягкий край ~1 px, без «лесенки»
    return a.astype(np.float32), dE
def decontam(rgb, a, thr=0.97):
    """цвет полупрозрачного края = цвет ближайшего непрозрачного пикселя (контур статуи), не старое небо"""
    inside = a >= thr
    if not inside.any(): return rgb
    _, (iy, ix) = ndimage.distance_transform_edt(~inside, return_indices=True)
    near = rgb[iy, ix]
    edge = (a > 0.001) & ~inside
    out = rgb.astype(np.float32).copy(); out[edge] = near[edge]
    return out

def red_fringe(img, zone, amax=5.0):
    """Gemini-jpeg: красноватая кайма/точки на тёмном контуре статуи (артефакт сжатия, не рисунок) — a* (красный) не выше amax"""
    lab = cv2.cvtColor(np.clip(img, 0, 255).astype(np.uint8), cv2.COLOR_RGB2LAB).astype(np.float32)
    a = lab[..., 1] - 128
    sel = zone & (a > amax) & (lab[..., 0] < 150)   # только тёмный контур/бронза (L* < ~59): светлое мощение/туф вокруг не трогаем
    lab[..., 1] = np.where(sel, 128 + amax, lab[..., 1])
    out = cv2.cvtColor(np.clip(np.round(lab), 0, 255).astype(np.uint8), cv2.COLOR_LAB2RGB).astype(np.float32)
    return np.where(sel[..., None], out, img), int(sel.sum())
SMALL = ('lenin_2', 'lenin_6')   # виды сверху: вырезка выше ступней — статуя + кусок крон/мостовой; статую берём по тёмной бронзе
def small_statue(img, n, bg=None):
    zone = statue_mask(n)
    lab = cv2.cvtColor(np.clip(img, 0, 255).astype(np.uint8), cv2.COLOR_RGB2LAB).astype(np.float32)
    L = lab[..., 0] * 100 / 255
    v = L[zone]
    T = float(np.clip(np.percentile(v, 45), 30, 55))
    z2 = ndimage.binary_dilation(zone, iterations=2)
    dark = ndimage.binary_closing((L < T) & z2, iterations=1)
    lb, k = ndimage.label(dark)
    if k == 0: return zone, T
    sz = ndimage.sum(dark, lb, range(1, k + 1))
    m = lb == (1 + int(np.argmax(sz)))
    if bg is not None:   # блики головы/плеч: всё, что заметно отличается от подложки, рядом с тёмной бронзой и связано с ней
        grow = (deltaE(img, bg) > 18) & (L < 84) & ndimage.binary_dilation(m, iterations=5) & z2
        m = ndimage.binary_propagation(m, mask=m | grow)
    m = ndimage.binary_fill_holes(ndimage.binary_closing(m, iterations=2))
    m[FEET[n] + 1:] = False
    return m, T
def deglow(img, sil, r_in=1, r_glow=14, r_far=30, feet=None):
    """свечение вокруг силуэта (ночь, виды сверху): яркость кольца 1–14 px приводится к фону 16–30 px (нормированная свёртка),
    сама статуя и всё дальше 16 px не меняются"""
    near = ndimage.binary_dilation(sil, iterations=r_glow) & ~(ndimage.binary_dilation(sil, iterations=r_in) if r_in > 0 else sil)
    far = ndimage.binary_dilation(sil, iterations=r_far) & ~ndimage.binary_dilation(sil, iterations=r_glow + 2)
    if feet is not None: near[feet + 1:] = False
    x = img.astype(np.float32)
    def nconv(m, s):
        mm = m.astype(np.float32); num = cv2.GaussianBlur(x * mm[..., None], (0, 0), s); den = cv2.GaussianBlur(mm, (0, 0), s)[..., None] + 1e-4
        return num / den, den[..., 0]
    tgt, dt = nconv(far, 10)
    cur, dc = nconv(near, 4)
    ratio = np.clip(tgt.mean(-1, keepdims=True) / (cur.mean(-1, keepdims=True) + 1), 0.45, 1.0)
    w = cv2.GaussianBlur(near.astype(np.float32), (0, 0), 1.5)[..., None] * (1 - sil[..., None])
    out = x * (1 - w) + x * ratio * w
    return out, int(near.sum())
