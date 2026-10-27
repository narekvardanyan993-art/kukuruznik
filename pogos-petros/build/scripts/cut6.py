"""Заход 6: вырезать картинки шоу из листа Gemini на однотонном фоне (белом) → RGBA PNG (по уроку: фон — заливкой от краёв,
закрытые светлые места внутри фигуры остаются). Каждая крупная фигура листа — отдельный файл, слева направо, сверху вниз.
python3 pogos-petros/build/scripts/cut6.py <gemini_id> <имя> [--max 256] [--min 0.02] [--thr 28]
→ pogos-petros/gemini/show/<имя>_<n>.png и копия в tests/pogos-petros/frames/show_<имя>_<n>.png
"""
import sys, shutil, numpy as np
from pathlib import Path
from PIL import Image
from scipy import ndimage
R = Path(__file__).resolve().parents[2]; T = R.parent/'tests/pogos-petros/frames'
gid, name = sys.argv[1], sys.argv[2]
def arg(k, d): return type(d)(sys.argv[sys.argv.index(k)+1]) if k in sys.argv else d
MAXH, MINF, THR = arg('--max', 256), arg('--min', 0.02), arg('--thr', 28.0)
src = R/'gemini/in'/('Gemini_Generated_Image_%s.jpeg' % gid)
im = np.asarray(Image.open(src).convert('RGB')).astype(np.float32); H, W = im.shape[:2]
edge = np.concatenate([im[0], im[-1], im[:, 0], im[:, -1]]); bgc = np.median(edge, 0)
d = np.sqrt(((im - bgc) ** 2).sum(-1))
near = d < THR
lab, n = ndimage.label(near)
border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
bg = np.isin(lab, list(border))
fg = ~bg
fg = ndimage.binary_opening(fg, iterations=1)
lab2, n2 = ndimage.label(ndimage.binary_dilation(fg, iterations=6))
sz = ndimage.sum(fg, lab2, range(1, n2 + 1)); big = [i + 1 for i in range(n2) if sz[i] > MINF * sz.max()]
objs = []
for i in big:
    ys, xs = np.nonzero((lab2 == i) & fg); objs.append((ys.min(), xs.min(), ys.max(), xs.max(), i))
rowh = np.median([o[2] - o[0] for o in objs]) if objs else 1
objs.sort(key=lambda o: (round(o[0] / (rowh * 0.8)), o[1]))
alpha = np.clip((d - THR * 0.5) / (THR * 0.8), 0, 1); alpha[fg & ~bg] = np.maximum(alpha[fg & ~bg], 0.0); alpha[bg] = np.minimum(alpha[bg], np.clip((d[bg] - THR * 0.5) / THR, 0, 1))
inner = ndimage.binary_erosion(fg, iterations=2); alpha[inner] = 1.0
out = []
for k, (y0, x0, y1, x1, i) in enumerate(objs):
    pad = 4; y0, x0, y1, x1 = max(0, y0 - pad), max(0, x0 - pad), min(H, y1 + pad + 1), min(W, x1 + pad + 1)
    m = (lab2[y0:y1, x0:x1] == i)
    a = alpha[y0:y1, x0:x1] * ndimage.binary_dilation(m, iterations=3)
    rgb = im[y0:y1, x0:x1]
    a3 = np.clip(a, 1e-3, 1)[..., None]
    rgb = np.clip((rgb - bgc * (1 - a3)) / a3, 0, 255)   # без белой каймы
    rgba = np.dstack([rgb, a * 255]).astype(np.uint8)
    img = Image.fromarray(rgba, 'RGBA')
    if img.size[1] > MAXH: img = img.resize((round(img.size[0] * MAXH / img.size[1]), MAXH), Image.LANCZOS)
    fn = '%s_%d.png' % (name, k + 1)
    img.save(R/'gemini/show'/fn); shutil.copyfile(R/'gemini/show'/fn, T/('show_' + fn)); out.append((fn, img.size))
print(name, 'bg', bgc.astype(int), 'pieces', out)
