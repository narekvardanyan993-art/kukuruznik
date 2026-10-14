"""s20: нарисованные голуби (вписаны из Gemini в s17) убираются — в их рамках пиксели s15 (до вписывания),
подогнанные к текущему тону кадра по кольцу вокруг (у кадра 5 после s17 менялся цвет мощения). День, подложка, ночь.
python3 pigeons20.py BUILD_DIR  -> <кадр>_base.png, <кадр>_bg_base.png, <кадр>_night_base.png (+ pigeons_mask_<кадр>.png)"""
import sys, json, numpy as np, cv2
from pathlib import Path
from PIL import Image
from scipy import ndimage
sys.path.insert(0, str(Path(__file__).parent))
import statue20 as S
B = S.B; OUT = Path(sys.argv[1]); OUT.mkdir(parents=True, exist_ok=True)
FIG = json.load(open(Path(__file__).parent / 'figures_s19.json'))
def restore(cur, old, w):
    """old (s15) в маске w, тон — как у cur вокруг (кольцо 4–14 px вне маски)"""
    m = w > 0.01
    ring = ndimage.binary_dilation(m, iterations=14) & ~ndimage.binary_dilation(m, iterations=4)
    out = cur.copy()
    rk = ring.astype(np.float32)
    num = cv2.GaussianBlur(cur * rk[..., None], (0, 0), 10); den = cv2.GaussianBlur(old * rk[..., None], (0, 0), 10)
    ratio = np.clip((num + 1) / (den + 1), 0.6, 1.6)
    fix = old * ratio
    return cur * (1 - w[..., None]) + fix * w[..., None]
st = {}
for n, f in FIG.items():
    cur = S.rd(S.S19 / f'{n}.webp').astype(np.float32)
    bg = S.rd(S.S19 / f'{n}_bg.webp').astype(np.float32)
    nt = S.rd(S.S19 / f'{n}_night.webp').astype(np.float32)
    w = np.zeros((S.H, S.W), np.float32); extra = 0
    items = [i for i in (f or {}).get('items', []) if i[4] == 'pigeon']
    if items:
        a = S.rd(B / f'source/s17/patches/{n}.png', 'RGBA')[..., 3].astype(np.float32) / 255
        box = np.zeros((S.H, S.W), bool)
        for u0, v0, u1, v1, *_ in items:
            box[int(v0 * S.H):int(np.ceil(v1 * S.H)) + 1, int(u0 * S.W):int(np.ceil(u1 * S.W)) + 1] = True
        # голуби стаи, не попавшие в фигуры s18 (рядом со стаей, серые, мелкие): отличие от s15 по ΔE, низкая хрома
        s0_ = S.rd(S.S15 / f'{n}.webp').astype(np.float32)
        dE = S.deltaE(cur, s0_)
        lab = cv2.cvtColor(cur.astype(np.uint8), cv2.COLOR_RGB2LAB).astype(np.float32)
        chroma = np.hypot(lab[..., 1] - 128, lab[..., 2] - 128)
        alpha_b = S.rd(S.S19 / f'{n}_building.webp', 'RGBA')[..., 3] > 10
        cand = (dE > 12) & (a > 0.05) & ~alpha_b
        lb, k = ndimage.label(ndimage.binary_closing(cand, iterations=1))
        near = ndimage.binary_dilation(box, iterations=40)
        maxa = max((v1 - v0) * S.H * (u1 - u0) * S.W for u0, v0, u1, v1, *_ in items)
        extra = 0
        for i, sl in enumerate(ndimage.find_objects(lb), 1):
            r = lb[sl] == i; ar = int(r.sum())
            if ar < 6 or ar > 0.6 * maxa: continue
            if box[sl][r].mean() > 0.5: continue
            hh = sl[0].stop - sl[0].start; ww = sl[1].stop - sl[1].start
            if not near[sl][r].any() and (hh > 1.2 * ww or np.median(chroma[sl][r]) > 11): continue   # вдали от стаи — только лежачие серые (люди стоят — выше, чем шире)
            if np.median(chroma[sl][r]) > 14: continue
            box[sl] |= ndimage.binary_dilation(r, iterations=2); extra += 1
        aa = ndimage.grey_dilation(a, size=(5, 5))          # край вписанного голубя + 2 px
        w = np.clip(cv2.GaussianBlur((aa * box).astype(np.float32), (0, 0), 0.8) * 1.2, 0, 1)
    s0, b0, n0 = (S.rd(S.S15 / f'{n}{s}.webp').astype(np.float32) for s in ('', '_bg', '_night'))
    d1 = restore(cur, s0, w); bg1 = restore(bg, b0, w); n1 = restore(nt, n0, w)
    for arr, nm in ((d1, f'{n}_base'), (bg1, f'{n}_bg_base'), (n1, f'{n}_night_base')):
        Image.fromarray(np.clip(np.round(arr), 0, 255).astype(np.uint8)).save(OUT / f'{nm}.png')
    Image.fromarray((w * 255).astype(np.uint8)).save(OUT / f'pigeons_mask_{n}.png')
    st[n] = dict(pigeon_items=len(items), extra_blobs=extra if items else 0, restored_px=int((w > 0.5).sum()))
    print(n, st[n], flush=True)
json.dump(st, open(OUT / 'pigeons_stats.json', 'w'), indent=1)
