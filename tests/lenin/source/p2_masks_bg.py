#!/usr/bin/env python3
"""Ленин П2 (05.10.2026): маска памятника + подложка _bg без Gemini + layers.json для tools/new_frame.py.

  python3 tests/lenin/source/p2_masks_bg.py --models ~/models [lenin_3 ...]

Маска (кадр 768×1365) = IS-Net внутри полигона памятника (статуя, постамент, основание); у мелких памятников (B, G) — полигон, уточнённый IS-Net.
Подложка (размер рисунка, JPEG q95) = рисунок, где маска (+запас) залита ЗЕРКАЛОМ соседних пикселей той же строки (слева и справа, плавная склейка):
небо, кроны, стены за постаментом продолжаются как есть, ничего нового не дорисовывается. Видна только полоска у края памятника при наклоне.
Вне маски подложка = рисунок пиксель в пиксель. Gemini-подложку («strict local inpainting») можно подставить позже тем же именем.
layers.json: cutout.region — контур маски с запасом, cutout.add — сам контур маски (вырезка = маска, а не случайная разница заливки).
Превью маски — tests/lenin/report/<кадр>/mask.jpg.
"""
import argparse, json, os, sys
from pathlib import Path
import cv2, numpy as np, onnxruntime as ort
from PIL import Image
from scipy import ndimage

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
W, H = 768, 1365
CFG = {   # координаты кадра 768×1365
 'lenin_2': {'sky_max_v': 0.225, 'poly': [(272,447),(290,447),(294,478),(294,515),(312,519),(312,547),(267,547),(267,516),(271,478)], 'isnet': 'refine'},
 'lenin_3': {'poly': [(300,290),(462,290),(462,872),(300,872)], 'isnet': 'inside',
             'extra': [[(212,868),(556,868),(556,1003),(212,1003)]]},
 'lenin_4': {'poly': [(60,170),(712,170),(712,1150),(768,1150),(768,1365),(0,1365),(0,1150),(60,1150)], 'isnet': 'inside', 'no_sky': True, 'top': (420, 0.3), 'close': 13, 'grow': 0,
             'head': [(338,190),(432,190),(438,288),(452,305),(478,318),(505,335),(525,365),(545,425),(212,425),(232,368),(255,338),(285,320),(318,305),(334,290)]},
 'lenin_5': {'grade': {'chroma': 1.15, 'gamma': 1.0}, 'poly': [(50,330),(175,330),(175,560),(50,560)], 'isnet': 'inside',
             'extra': [[(20,553),(162,553),(162,795),(215,800),(220,835),(265,840),(268,912),(45,915),(28,795)]]},
 'lenin_6': {'sky_max_v': 0.115, 'poly': [(150,830),(185,830),(205,870),(215,960),(222,965),(232,1080),(237,1140),(190,1175),(130,1150),(122,1080),(135,1050),(140,965),(145,880)], 'isnet': 'refine'},
}

def fill(m, polys):
    for p in polys: cv2.fillPoly(m, [np.array(p, np.int32)], 1)
    return m

def isnet(sess, rgb01):
    x = (cv2.resize(rgb01, (1024, 1024)) - 0.5).transpose(2, 0, 1)[None].astype(np.float32)
    m = sess.run(None, {sess.get_inputs()[0].name: x})[0][0, 0]
    m = (m - m.min()) / (m.max() - m.min() + 1e-9)
    return cv2.resize(m, (W, H))

def object_mask(fid, rgb01, sess):
    c = CFG[fid]
    poly = fill(np.zeros((H, W), np.uint8), [c['poly']]) > 0
    net = isnet(sess, rgb01)
    net = np.where(np.arange(H)[:, None] < c.get('top', (0, 0))[0], net > c.get('top', (0, 0))[1], net > 0.3)
    green = cv2.cvtColor((rgb01 * 255).astype(np.uint8), cv2.COLOR_RGB2LAB).astype(np.float32)[..., 1] - 128 < -6
    if c['isnet'] == 'inside':
        m = net & poly & ~green
        if c.get('no_sky'):   # ореол облаков у головы: белая бумага/облако и голубое небо — не статуя
            lab = cv2.cvtColor((rgb01 * 255).astype(np.uint8), cv2.COLOR_RGB2LAB).astype(np.float32)
            L, A, B = lab[..., 0] * 100 / 255, lab[..., 1] - 128, lab[..., 2] - 128
            sky = ((L > 82) & (np.hypot(A, B) < 12)) | (B < -6)
            head = fill(np.zeros((H, W), np.uint8), [c['head']]) > 0
            m &= ~(ndimage.binary_opening(sky, iterations=2) & ~ndimage.binary_erosion(head, iterations=6))   # блик на лысине — не небо
            top = np.arange(H)[:, None] < c['top'][0]   # голова и плечи: только внутри ручного контура (облака у плеч IS-Net цепляет)
            m &= ~top | head
            # белый ореол облака по краю головы и плеч: светлые не бронзовые пиксели в полосе 14 px у края (кроме блика на лысине)
            band = m & ~ndimage.binary_erosion(m, iterations=14)
            yy, xx = np.mgrid[:H, :W]
            zone = (yy >= 200) & (yy < 425) & ~((xx > 355) & (xx < 425) & (yy < 245))
            m &= ~(band & zone & (L > 76) & (np.hypot(A, B) < 14))
            # defringe (06.10): у верхней половины край маски внутрь на 2 px и светлые небронзовые пиксели в полосе 4 px — не статуя
            up = yy < c.get('defringe_y', 980)
            edge = m & ~ndimage.binary_erosion(m, iterations=4)
            m &= ~(edge & up & (L > 70) & (np.hypot(A, B) < 16))
            m = np.where(up, ndimage.binary_erosion(m, iterations=2), m)
    else:   # refine: полигон, но без явного фона, который IS-Net не считает объектом
        m = poly & (net | ndimage.binary_erosion(poly, iterations=3))
    m |= fill(np.zeros((H, W), np.uint8), c.get('extra', [])) > 0
    k = c.get('close', 5)
    m = ndimage.binary_opening(m, structure=np.ones((3, 3)))
    m = ndimage.binary_closing(np.pad(m, k + 1), structure=np.ones((k, k)))[k + 1:-k - 1, k + 1:-k - 1]
    m = ndimage.binary_fill_holes(m)
    lab, k = ndimage.label(m)
    if k > 1:
        sizes = ndimage.sum(m, lab, range(1, k + 1)); m = np.isin(lab, 1 + np.nonzero(sizes > 0.02 * sizes.max())[0])
    return m

def bounce(k, start, step, n):
    """k-й пиксель отражения от края start в сторону step внутри полосы длиной n (туда-обратно, «треугольная волна»)."""
    k = k % (2 * n); k = np.where(k >= n, 2 * n - 1 - k, k)
    return start + step * k


def mirror_fill(img, hole):
    """Каждая строка: дыра заливается отражением соседних пикселей слева и справа, вес — по расстоянию до края."""
    out = img.astype(np.float32).copy(); h, w = hole.shape
    last = None
    for y in range(h):
        row = hole[y]
        if not row.any(): last = y; continue
        if row.all():   # дыра во всю ширину (низ кадра D): строка ближайшего целого ряда выше — этот фон при наклоне не открывается
            out[y] = out[last] if last is not None else out[y]; continue
        last = y
        d = np.diff(np.r_[0, row.astype(np.int8), 0]); starts, ends = np.nonzero(d == 1)[0], np.nonzero(d == -1)[0]
        for a, b in zip(starts, ends):
            x = np.arange(a, b); n = b - a
            li = bounce(x - a, a - 1, -1, a) if a > 0 else None          # зеркало внутрь полосы [0, a), без захода в дыру
            ri = bounce(b - 1 - x, b, 1, w - b) if b < w else None        # зеркало внутрь полосы [b, w)
            if li is None: out[y, a:b] = img[y, ri]; continue
            if ri is None: out[y, a:b] = img[y, li]; continue
            wl = ((b - x) / (n + 1.0))[:, None]
            out[y, a:b] = img[y, li] * wl + img[y, ri] * (1 - wl)
    return out

def contour(m, eps):
    cs, _ = cv2.findContours(m.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    res = []
    for c in sorted(cs, key=cv2.contourArea, reverse=True):
        if cv2.contourArea(c) < 30: continue
        a = cv2.approxPolyDP(c, eps, True)[:, 0]
        res.append([[int(np.clip(x, 0, W)), int(np.clip(y, 0, H))] for x, y in a])
    return res

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--models', required=True); ap.add_argument('frames', nargs='*')
    a = ap.parse_args()
    sess = ort.InferenceSession(str(Path(a.models).expanduser() / 'isnet-general-use.onnx'), providers=['CPUExecutionProvider'])
    base = json.loads((ROOT / 'tests/lenin/layers.json').read_text(encoding='utf-8'))
    for fid in a.frames or list(CFG):
        fd = HERE / fid
        src = Image.open(fd / (fid + '.jpg')).convert('RGB')
        sw, sh = src.size
        small = np.asarray(src.resize((W, H), Image.LANCZOS)).astype(np.float32) / 255
        m = object_mask(fid, small, sess)
        hole = cv2.resize(ndimage.binary_dilation(m, iterations=8).astype(np.uint8), (sw, sh), interpolation=cv2.INTER_NEAREST) > 0
        hole = ndimage.binary_closing(np.pad(hole, 30), structure=np.ones((1, 51)))[30:-30, 30:-30]   # узкие щели между рукой и телом — тоже дыра
        big = np.asarray(src)
        bg = mirror_fill(big, hole)
        soft = cv2.GaussianBlur(hole.astype(np.float32), (0, 0), 2)[..., None]
        bg = big * (1 - soft) + bg * soft
        Image.fromarray(np.clip(bg + .5, 0, 255).astype(np.uint8)).save(fd / (fid + '_bg.jpg'), quality=95, subsampling=0)
        spec = json.loads(json.dumps(base)); spec.update(name=fid, size=[W, H], window_boxes=[])
        # цвет: новые рисунки уже насыщенные (HSV 0,12–0,18 против 0,146 у живого lenin_1 после grade 1,3) — не усиливаем, E чуть поднимаем
        spec['grade'] = CFG[fid].get('grade', {'chroma': 1.0, 'gamma': 1.0})
        reg = contour(ndimage.binary_dilation(m, iterations=10), 2.0)
        spec['cutout'] = dict(base['cutout'], region=reg[0], add=contour(m, 0.8))
        if 'grow' in CFG[fid]:
            spec['cutout']['grow'] = CFG[fid]['grow']      # D: без расширения края (иначе белая каёмка неба на плечах)
        if 'sky_max_v' in CFG[fid]:
            spec['sky'] = dict(spec.get('sky') or {}, max_v=CFG[fid]['sky_max_v'])
        (fd / 'layers.json').write_text(json.dumps(spec, ensure_ascii=False) + '\n', encoding='utf-8')
        rep = ROOT / 'tests/lenin/report' / fid; rep.mkdir(parents=True, exist_ok=True)
        ov = (small * 255).astype(np.uint8).copy(); e = m ^ ndimage.binary_erosion(m, iterations=2)
        ov[m] = (ov[m] * 0.6 + np.array([255, 0, 0]) * 0.4).astype(np.uint8); ov[e] = (255, 0, 0)
        bgs = np.asarray(Image.open(fd / (fid + '_bg.jpg')).resize((W, H)))
        Image.fromarray(np.hstack([ov, bgs])).resize((768, 682)).save(rep / 'mask.jpg', quality=88)
        print(fid, 'маска %.1f %% кадра, region %d точек, add %d контур(ов)' % (100 * m.mean(), len(reg[0]), len(spec['cutout']['add'])))

if __name__ == '__main__':
    main()
