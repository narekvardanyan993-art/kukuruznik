"""s20 день: статуя из Gemini во все кадры + новая вырезка. python3 day20.py OUTDIR"""
import sys, json, numpy as np, cv2
from pathlib import Path
from PIL import Image
from scipy import ndimage
sys.path.insert(0, str(Path(__file__).parent))
import statue20 as S
B = S.B; OUT = Path(sys.argv[1]); OUT.mkdir(parents=True, exist_ok=True)
PICK = {'lenin_1': 'day_lenin_1_g1.jpg', 'lenin_2': 'dayc_lenin_2_g1.jpg', 'lenin_3': 'day_lenin_3_g2.jpg', 'lenin_4': 'day_lenin_4_g1.jpg', 'lenin_6': 'dayc_lenin_6_g1.jpg'}
only = sys.argv[2:] or list(PICK)
stats = {}
for n in only:
    s0 = S.rd(S.S15 / f'{n}.webp')
    cur = S.rd(OUT / f'{n}_base.png').astype(np.float32)      # кадр s19 без нарисованных голубей (pigeons20.py)
    bg = S.rd(OUT / f'{n}_bg_base.png').astype(np.float32)
    bl = S.rd(S.S19 / f'{n}_building.webp', 'RGBA').astype(np.float32)
    g, valid, cc, M = S.gem(n, 'day', S.R20 / 'out' / PICK[n], s0)
    st = S.statue_mask(n)
    st_col = S.small_statue(g.astype(np.float32), n, bg if n == 'lenin_6' else None)[0] if n in S.SMALL else st   # виды сверху: вырезка шире статуи (мощение/кроны) — цвет Gemini как есть только у самой статуи
    ringsel = (S.ring(st_col, 6, 18) if n in S.SMALL else S.ring(st, 14, 30) & (bl[..., 3] < 10)) & (valid > 0.99)
    gm = S.color_fit(g, cur, ringsel)
    stw = cv2.GaussianBlur(ndimage.binary_dilation(st_col, iterations=1).astype(np.float32), (0, 0), 1.2)[..., None]
    gm = gm * (1 - stw) + g.astype(np.float32) * stw   # статуя — цвета Gemini как есть; подгонка только для неба/фона вокруг
    gm, nred = S.red_fringe(gm, ndimage.binary_dilation(st_col, iterations=2))   # красная кайма сжатия jpeg Gemini по контуру статуи
    P = S.paste_mask(st_col, n, 6 if n in S.SMALL else 10, valid)
    d1 = cur * (1 - P[..., None]) + gm * P[..., None]
    # вырезка статуи: по отличию от подложки
    stm = st
    if n in S.SMALL:
        stm, T = S.small_statue(d1, n, bg if n == "lenin_6" else None)   # кадр 2: кроны за статуей отличаются от подложки — рост только по тёмной бронзе; stats_T = T
    a, dE = S.matte(d1, bg, stm, n)
    if n in S.SMALL: a *= ndimage.binary_dilation(stm, iterations=1)   # кроны/мостовая вокруг мелкой статуи — не статуя
    A0 = bl[..., 3] / 255
    yy = np.arange(S.H)[:, None]
    up = (yy <= S.FEET[n]).astype(np.float32)
    zone = (np.ones_like(up) if n in S.SMALL else ndimage.binary_dilation(st, iterations=8).astype(np.float32)) * up
    anew = A0 * (1 - zone) + a * zone
    rgb = bl[..., :3].copy()
    rgb = rgb * (1 - P[..., None]) + d1 * P[..., None]
    rgb = S.decontam(rgb, anew)
    bl2 = np.dstack([rgb, np.clip(anew * 255, 0, 255)])
    # подложка под бывшей вырезкой статуи: раньше её закрывала широкая вырезка (там грубая заливка — у кадра 5 зелёная),
    # теперь вырезка узкая и подложка видна вокруг статуи -> подложка = сам кадр вокруг статуи, силуэт (+3 px) заполнен окружением
    sil = (anew > 0.02) & (up > 0)
    if n in S.SMALL:
        d1, _ = S.deglow(d1, anew > 0.6, r_in=0, r_glow=12, r_far=26, feet=S.FEET[n])   # светлая бумажная кайма рисунка у силуэта (в самом кадре) -> тон фона дальше
    else:
        # статуя на фоне неба (1, 3, 4): движок показывает вокруг здания САМ КАДР (земля = кадр, подложка только под вырезкой +3 px),
        # поэтому небо вокруг силуэта в кадре = чистая подложка s19 (без статуи и без каймы), а не небо Gemini/старый рисунок
        As = cv2.GaussianBlur(anew, (0, 0), 0.6)[..., None]
        d1 = d1 * (1 - P[..., None]) + (d1 * As + bg * (1 - As)) * P[..., None]
    D3 = cv2.GaussianBlur(ndimage.binary_dilation(sil, iterations=3).astype(np.float32), (0, 0), 1.0)[..., None]
    under = bg.copy()
    if n == 'lenin_6':   # под статуей кадра 5 — старая заливка подложки светло-жёлтая (HSV 36–62°): движок тянет её к зелени -> охра ≤ 35° (как мощение s19)
        hsv = cv2.cvtColor(np.clip(under, 0, 255).astype(np.uint8), cv2.COLOR_RGB2HSV_FULL).astype(np.float32)
        hd = hsv[..., 0] * 360 / 256; sel = (hd > 35) & (hd < 62) & (hsv[..., 1] > 12)
        hsv[..., 0] = np.where(sel, 35 * 256 / 360, hsv[..., 0])
        under = cv2.cvtColor(np.clip(np.round(hsv), 0, 255).astype(np.uint8), cv2.COLOR_HSV2RGB_FULL).astype(np.float32)
    fill = d1 * (1 - D3) + under * D3      # вокруг статуи — сам кадр (мощение/кроны/небо), под силуэтом — прежняя подложка
    wo = np.clip(cv2.GaussianBlur((ndimage.binary_dilation(A0 > 0.02, iterations=2) & (up > 0)).astype(np.float32), (0, 0), 1.0) * 1.3, 0, 1)[..., None]
    if n in S.SMALL: bg = bg * (1 - wo) + fill * wo   # у статуи на фоне неба подложка s19 — чистое небо, остаётся
    Image.fromarray(np.clip(np.round(bg), 0, 255).astype(np.uint8)).save(OUT / f'{n}_bg.png')
    # глубина: бывшее кольцо вырезки (теперь подложка) имело глубину статуи -> движок не красил там небо (светлое кольцо днём). Там — глубина подложки
    dp = S.rd(S.S19 / f'{n}_depth.webp', 'L').astype(np.float32); bdp = S.rd(S.S19 / f'{n}_bg_depth.webp', 'L').astype(np.float32)
    keep = cv2.GaussianBlur(ndimage.binary_dilation(anew > 0.05, iterations=1).astype(np.float32), (0, 0), 0.7)
    keep = np.maximum(keep, 1 - up[..., 0] if up.ndim == 3 else 1 - up)     # ниже ступней — как было
    keep = np.maximum(keep, 1 - wo[..., 0])     # вне бывшей вырезки — как было
    dp2 = dp * keep + bdp * (1 - keep)
    Image.fromarray(np.clip(np.round(dp2), 0, 255).astype(np.uint8), 'L').save(OUT / f'{n}_depth.png')
    Image.fromarray(np.clip(np.round(d1), 0, 255).astype(np.uint8)).save(OUT / f'{n}.png')
    Image.fromarray(np.clip(np.round(bl2), 0, 255).astype(np.uint8), 'RGBA').save(OUT / f'{n}_building.png')
    np.save(OUT / f'{n}_paste.npy', P.astype(np.float16))
    stats[n] = dict(ecc=round(cc, 4), shift=[round(float(M[0, 2]), 2), round(float(M[1, 2]), 2)], scale=[round(float(M[0, 0]), 4), round(float(M[1, 1]), 4)],
                    statue_px_old=int((A0 * up > 0.5).sum()), statue_px_new=int((anew * up > 0.5).sum()), paste_px=int((P > 0.5).sum()), red_fringe_px=nred)
    print(n, stats[n], flush=True)
json.dump(stats, open(OUT / 'day_stats.json', 'w'), indent=1)
