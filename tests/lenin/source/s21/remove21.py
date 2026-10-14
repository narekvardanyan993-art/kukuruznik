"""s21: крупные стоящие люди (выше ~60 px кадра) убираются. На кадрах 1–3 все люди — вписанные из Gemini в s17 на пустые места рисунка s15,
поэтому фон под ними есть: пиксели s15 (source/night/s15src), тон подогнан к текущему кадру по кольцу вокруг (метод s20 pigeons20.restore).
День, подложка (_bg), ночь — одной маской. Список мест — PLACES (рамка, где искать отличие от s15).
python3 remove21.py BUILD_DIR -> <кадр>.png, <кадр>_bg.png, <кадр>_night.png, remove_mask_<кадр>.png"""
import sys, json, numpy as np, cv2
from pathlib import Path
from PIL import Image
from scipy import ndimage
B = Path(__file__).resolve().parents[1].parent
FR = B / 'frames'; S15 = B / 'source/night/s15src'
OUT = Path(sys.argv[1]); OUT.mkdir(parents=True, exist_ok=True)
# кадр: [x0, y0, x1, y1] — рамки крупных стоящих людей (опись report/s21/people.md)
PLACES = {'lenin_3': [[712, 900, 768, 990]]}
def rd(p, mode='RGB'): return np.asarray(Image.open(p).convert(mode))
def dE(a, b):
    la = cv2.cvtColor(a.astype(np.uint8), cv2.COLOR_RGB2LAB).astype(np.float32); lb = cv2.cvtColor(b.astype(np.uint8), cv2.COLOR_RGB2LAB).astype(np.float32)
    return np.linalg.norm(la - lb, axis=2)
def restore(cur, old, w):
    m = w > 0.01
    ring = ndimage.binary_dilation(m, iterations=14) & ~ndimage.binary_dilation(m, iterations=4)
    rk = ring.astype(np.float32)
    num = cv2.GaussianBlur(cur * rk[..., None], (0, 0), 10); den = cv2.GaussianBlur(old * rk[..., None], (0, 0), 10)
    ratio = np.clip((num + 1) / (den + 1), 0.6, 1.6)
    return cur * (1 - w[..., None]) + old * ratio * w[..., None]
st = {}
for n, boxes in PLACES.items():
    cur = rd(FR / f'{n}.webp').astype(np.float32); s0 = rd(S15 / f'{n}.webp').astype(np.float32)
    H, W = cur.shape[:2]
    d = dE(cur, s0); box = np.zeros((H, W), bool)
    for x0, y0, x1, y1 in boxes: box[y0:y1, x0:x1] = True
    m = ndimage.binary_closing((d > 8) & box, iterations=2)
    m = ndimage.binary_fill_holes(m)
    lb, k = ndimage.label(m); keep = np.zeros_like(m)
    for i, sl in enumerate(ndimage.find_objects(lb), 1):
        if (lb[sl] == i).sum() >= 30: keep |= lb == i
    w = np.clip(cv2.GaussianBlur(ndimage.binary_dilation(keep, iterations=3).astype(np.float32), (0, 0), 1.2) * 1.3, 0, 1) * box
    for suf in ('', '_bg', '_night'):
        c = rd(FR / f'{n}{suf}.webp').astype(np.float32); o = rd(S15 / f'{n}{suf}.webp').astype(np.float32)
        Image.fromarray(np.clip(np.round(restore(c, o, w)), 0, 255).astype(np.uint8)).save(OUT / f'{n}{suf}.png')
    Image.fromarray((w * 255).astype(np.uint8)).save(OUT / f'remove_mask_{n}.png')
    dep = rd(FR / f'{n}_depth.webp').astype(np.float32); dep0 = rd(S15 / f'{n}_depth.webp').astype(np.float32) if (S15 / f'{n}_depth.webp').exists() else dep
    st[n] = dict(removed_px=int((w > 0.5).sum()), bbox=[int(v) for v in np.argwhere(w > 0.5)[:, ::-1].min(0).tolist() + np.argwhere(w > 0.5)[:, ::-1].max(0).tolist()],
                 depth_diff_vs_s15_in_mask=float(np.abs(dep - dep0)[w > 0.5].max()) if (w > 0.5).any() else 0)
    print(n, st[n], flush=True)
json.dump(st, open(OUT / 'remove_stats.json', 'w'), indent=1)
