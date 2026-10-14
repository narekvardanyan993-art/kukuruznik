"""s21: лист «рисунок + ролик» по местам (увеличение ×4) — проверка движения людей в собранном ролике кадра.
python3 zoom21.py <кадр> <out.jpg> name:x0,y0,x1,y1,delay[,secs] ..."""
import sys, cv2, numpy as np
from pathlib import Path
from PIL import Image
B = Path(__file__).resolve().parents[1].parent
n, outp = sys.argv[1], sys.argv[2]
Z = []
for a in sys.argv[3:]:
    nm, v = a.split(':'); v = [float(t) for t in v.split(',')]; Z.append((nm, *[int(t) for t in v[:4]], v[4], v[5] if len(v) > 5 else 10))
want = {}
for nm, x0, y0, x1, y1, dl, secs in Z:
    for s in np.linspace(dl + 0.25, dl + secs - 0.25, 12): want.setdefault(int(s * 20), []).append(nm)
cap = cv2.VideoCapture(str(B / f'frames/{n}_motion_1.mp4')); fr = {}; i = 0
while True:
    ok, f = cap.read()
    if not ok: break
    for k in want:
        if k % 100000 == i or False: pass
    fr[i] = f[..., ::-1].copy() if any((k == i) for k in want) else None
    if fr[i] is None: del fr[i]
    i += 1
L = i
d = cv2.resize(np.asarray(Image.open(B / f'frames/{n}.webp').convert('RGB')).astype(np.float32), (768, 1364), interpolation=cv2.INTER_AREA)
m = np.asarray(Image.open(B / f'frames/{n}_motion_mask.png'))[..., 1][..., None] / 255.
rows = []
for nm, x0, y0, x1, y1, dl, secs in Z:
    tiles = []
    for s in np.linspace(dl + 0.25, dl + secs - 0.25, 12):
        t = int(s * 20)
        v = fr.get(t % L) if (t % L) in fr else fr.get(t)
        if v is None: continue
        sl = (slice(y0, y1), slice(x0, x1))
        c = d[sl] * (1 - m[sl]) + np.clip(d[sl] + v[sl].astype(np.float32) - 128, 0, 255) * m[sl]
        tiles.append(Image.fromarray(c.astype(np.uint8)).resize(((x1 - x0) * 4, (y1 - y0) * 4), Image.LANCZOS))
    row = Image.new('RGB', (sum(t.width for t in tiles), tiles[0].height), 'white'); x = 0
    for t in tiles: row.paste(t, (x, 0)); x += t.width
    rows.append(row)
out = Image.new('RGB', (max(r.width for r in rows), sum(r.height for r in rows)), 'white'); y = 0
for r in rows: out.paste(r, (0, y)); y += r.height
out.save(B / outp, quality=85); print(out.size, L)
