"""s20 ночь: статуя под прожектором из Gemini (правка ночного кадра) вклеивается мягкой маской на 10 px шире статуи,
небо у силуэта — из ответа Gemini (чистое), цвет подогнан по кольцу 14–30 px. python3 night20.py BUILD_DIR [кадры]"""
import sys, json, numpy as np, cv2
from pathlib import Path
from PIL import Image
from scipy import ndimage
sys.path.insert(0, str(Path(__file__).parent))
import statue20 as S
B = S.B; OUT = Path(sys.argv[1])
PICK = json.load(open(Path(__file__).parent / 'night_pick.json'))
only = sys.argv[2:] or list(PICK)
st_all = {}
for n in only:
    curn = S.rd(OUT / f'{n}_night_base.png').astype(np.float32)   # ночь s19 без нарисованных голубей
    bl = S.rd(OUT / f'{n}_building.png', 'RGBA').astype(np.float32)      # новая вырезка дня (day20.py)
    g, valid, cc, M = S.gem(n, 'night', S.R20 / 'out' / PICK[n], curn.astype(np.uint8))
    st = S.statue_mask(n)
    a_new = bl[..., 3] / 255
    stn = (a_new > 0.5) & (np.arange(S.H)[:, None] <= S.FEET[n]) if n in S.SMALL else st
    ringsel = S.ring(stn, 14, 30) & (a_new < 0.04) & (valid > 0.99)
    gm = S.color_fit(g, curn, ringsel)
    stw = cv2.GaussianBlur(ndimage.binary_dilation(stn, iterations=1).astype(np.float32), (0, 0), 1.2)[..., None]
    gm = gm * (1 - stw) + g.astype(np.float32) * stw
    gm, nred = S.red_fringe(gm, ndimage.binary_dilation(stn, iterations=2), amax=12.0)
    P = S.paste_mask(stn, n, 2 if n in S.SMALL else 10, valid)
    n1 = curn * (1 - P[..., None]) + gm * P[..., None]
    if n in S.SMALL:   # виды сверху: Gemini даёт свечение крон вокруг статуи, а в ночи s19 у силуэта светлая кайма — кольцо 1–5 px
        # снаружи силуэта заполняется окружением (кроны/мостовая дальше 5 px), а не старым краем
        sil = a_new > 0.3
        rg = ndimage.binary_dilation(sil, iterations=5) & ~ndimage.binary_dilation(sil, iterations=1)
        rg[S.FEET[n] + 1:] = False
        n1 = cv2.inpaint(np.clip(np.round(n1), 0, 255).astype(np.uint8), rg.astype(np.uint8), 4, cv2.INPAINT_TELEA).astype(np.float32)
    n1, _ = S.deglow(n1, a_new > 0.6, r_in=0, feet=S.FEET[n])   # свечение вокруг статуи (ночь s17–s19, Gemini) -> тон неба/крон дальше от статуи
    Image.fromarray(np.clip(np.round(n1), 0, 255).astype(np.uint8)).save(OUT / f'{n}_night.png')
    # кольцо 1–6 px снаружи силуэта ночью: светлее неба в 10 px дальше?
    Lm = cv2.cvtColor(np.clip(n1, 0, 255).astype(np.uint8), cv2.COLOR_RGB2GRAY).astype(np.float32)
    r_in = S.ring(a_new > 0.5, 1, 3); r_out = S.ring(a_new > 0.5, 10, 14)
    st_all[n] = dict(ecc=round(cc, 4), red_px=nred, ring3_minus_sky=round(float(Lm[r_in].mean() - Lm[r_out].mean()), 2))
    print(n, st_all[n], flush=True)
json.dump(st_all, open(OUT / 'night_stats.json', 'w'), indent=1)
