"""s19: статуя — ТЁМНАЯ бронза (почти чёрно-коричневая), холодная серо-зелёная патина, низкая насыщенность — в НАСТОЯЩЕМ рендере.
Почему s18 вышла «золотой матовой» (настоящий Chrome, tests/lenin/report/s19/causes.md): блик s18 — тёплый охристый (a* 8, b* 13,
оттенок Lab ~58°, хрома 15), средняя L* 34 и контраст штриха ×1,05 — на телефоне это светлое тёплое пятно без глубины;
ночью прожектор 3500 K (тёплый), хрома ×1,3 и яркость подгонялась до «статуя ≥ 2,2× неба» — всё тело светилось медью.
Здесь: L* 21, штрих ×1,15 (складки читаются), блик — нейтрально-серый с едва тёплым (хрома ~4), патина в тенях и на большей площади —
холодная серо-зелёная (оттенок Lab ~190°, HSV ~175–190° — вне полосы «зелени» движка 36–162°, движок её не перекрашивает).
Ночь: прожектор почти белый (≈4500 K); хрома ×1; свет по форме (Y/Ym)^1,15 — блики на складках и лице, тело тёмное;
яркость — по цели средней L* статуи в итоге движка (не «ярче неба»)."""
import numpy as np, cv2, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 's18'))
import bronze as b18
from bronze import ss, to_lab, from_lab, to_lin, to_srgb
L_T = 21.0; KC = 1.15
HI = np.array([1.8, 3.4]); MID = np.array([2.2, 4.2]); PAT = np.array([-4.6, -1.0])   # (a*, b*): блик, середина, патина
LIGHT = np.array([1.0, 0.97, 0.92])   # прожектор: почти белый (≈4500 K) — бронза под ним коричневая, не медная
def recolor(d, st, w, seed=0):
    lab = to_lab(d.astype(np.float32)); L = lab[..., 0]
    Lm = float(L[st].mean())
    La = cv2.GaussianBlur(L, (0, 0), 4.0)
    sd = float(La[st].std()) + 1e-3
    t = np.clip((La - Lm) / sd, -2.5, 2.5)
    hi = ss(0.4, 1.8, t); sh = ss(0.3, -1.2, t)
    rng = np.random.RandomState(seed); nz = cv2.GaussianBlur(rng.rand(*L.shape).astype(np.float32), (0, 0), 9); nz = (nz - nz.mean()) / (nz.std() + 1e-6)
    pat = np.clip(sh * 0.8 + 0.25 * nz + 0.35, 0, 1) * (1 - 0.7 * hi)          # патина — на большей части тела, меньше на бликах
    ab = MID[None, None, :] * (1 - hi[..., None]) + HI[None, None, :] * hi[..., None]
    ab = ab * (1 - pat[..., None]) + PAT[None, None, :] * pat[..., None]
    L2 = np.clip(L_T + (L - Lm) * KC, 3, 64)
    ab *= ss(3, 14, L2)[..., None]                                              # тёмный штрих — без цвета
    rgb = from_lab(np.dstack([L2, ab[..., 0], ab[..., 1]]))
    return d * (1 - w[..., None]) + rgb * w[..., None]
def floodlight(night, day_bronze, alpha, st, w, k=1.0, top=0.6, gamma=1.15, chroma=1.0):
    H, W = st.shape
    lab = to_lab(day_bronze.astype(np.float32)); lab[..., 1:] *= chroma
    dl = to_lin(from_lab(lab))
    Y = (dl * np.array([0.2126, 0.7152, 0.0722])).sum(-1); Ym = float(Y[st].mean()) + 1e-5
    Ya = cv2.GaussianBlur(Y, (0, 0), 1.0)
    ys = np.where(st.any(1))[0]; y0, y1 = ys.min(), ys.max()
    xsa = np.where(st.any(0))[0]; cx = (xsa.min() + xsa.max()) / 2; sw = max(8, xsa.max() - xsa.min())
    yy = (np.arange(H, dtype=np.float32)[:, None] - y0) / max(1, (y1 - y0))
    g = top + (1 - top) * np.clip(yy, 0, 1) ** 0.9
    xx = (np.arange(W, dtype=np.float32)[None, :] - cx) / (sw * 0.75)
    beam = 0.85 + 0.15 * np.exp(-xx ** 2)
    rel = np.clip(Ya / Ym, 0.05, 8) ** gamma
    lit = to_srgb(dl * LIGHT * (k * g * beam * rel)[..., None])
    return np.clip(night.astype(np.float32) * (1 - w[..., None]) + lit * w[..., None], 0, 255)
def clean_head(night, day, alpha, st, env_sky, force=None):
    """светлые обрывки фона внутри вырезки статуи у головы/плеч (кадр 1: полоски бумаги у шеи) -> местный цвет ночного неба.
    Обрывок = пиксель вырезки (альфа > 8) вне статуи (+1 px), в полосе высоты статуи, светлее ночного неба рядом."""
    H, W = st.shape
    ys = np.where(st.any(1))[0]
    if len(ys) == 0: return night, 0
    y0, y1 = ys.min(), ys.min() + int(0.45 * (ys.max() - ys.min()))   # голова и плечи — верх статуи
    near = cv2.dilate(st.astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool)
    band = np.zeros_like(st); band[max(0, y0 - 6):y1] = True
    cand = (alpha > 8) & ~near & band
    sky = (alpha < 8) & (env_sky > 100)
    nl = night.astype(np.float32).mean(2)
    num = cv2.GaussianBlur(night.astype(np.float32) * sky[..., None], (0, 0), 7); den = cv2.GaussianBlur(sky.astype(np.float32), (0, 0), 7)[..., None] + 1e-4
    skyc = num / den
    frag = cand & (nl > skyc.mean(2) + 10)
    if force is not None: frag |= force & (alpha > 8)
    frag = cv2.dilate(frag.astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool) & cand
    wgt = np.clip(cv2.GaussianBlur(frag.astype(np.float32), (0, 0), 0.8) * 1.5, 0, 1) * cand
    out = night.astype(np.float32) * (1 - wgt[..., None]) + skyc * wgt[..., None]
    return out, int(frag.sum())

def bg_fragments(day, alpha, st):
    """светлые обрывки фона внутри вырезки у головы/плеч: светлые (как небо) пиксели, связанные светлым же путём с небом вне вырезки.
    Блики на лице отделены от неба тёмным контуром — в обрывки не попадают."""
    from scipy import ndimage
    g = day.astype(np.float32).mean(2)
    ys = np.where(st.any(1))[0]
    band = np.zeros_like(st)
    if len(ys): band[max(0, ys.min() - 6):ys.min() + int(0.45 * (ys.max() - ys.min()))] = True
    light = g > 185
    lab, n = ndimage.label(light)
    seeds = np.unique(lab[light & (alpha < 8)])
    reach = np.isin(lab, seeds[seeds > 0])
    return reach & (alpha >= 8) & band
