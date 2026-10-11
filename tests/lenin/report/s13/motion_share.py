import sys, numpy as np, cv2
# mstat.py clip.mp4 — доля кадра, которая заметно меняется за ролик (σ яркости > 2,5 и размах > 12 по 8-битной шкале)
cap = cv2.VideoCapture(sys.argv[1]); L = []
while True:
    ok, f = cap.read()
    if not ok: break
    L.append(cv2.GaussianBlur(cv2.cvtColor(f, cv2.COLOR_BGR2GRAY), (0, 0), 1.0).astype(np.float32))
L = np.stack(L); sd = L.std(0); rg = np.percentile(L, 95, 0) - np.percentile(L, 5, 0)
m = (sd > 2.5) & (rg > 12)
print('%s: кадров %d, движется %.2f %% кадра' % (sys.argv[1].split('/')[-1], len(L), m.mean() * 100))
