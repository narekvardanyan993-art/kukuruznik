"""s20 кадр 5 (lenin_6): перерисовка Gemini в стиле кадра 2 (refs/s20/out/f5_redraw_g2.jpg; вход — кадр 5 s20 + кадр 2 + архив 384446).
Совмещение с прежним кадром (ECC) -> те же глубина/окружение/окна-карта/точки. Статуя — наша s20 (шаг 1), вклеена по силуэту.
Ночь = новый день × карта света (размытая ночь s15 / размытый день s15, σ 9 — без окон s16+) + окна, найденные на НОВОМ рисунке,
+ статуя под прожектором s20. Подложка — новый день, место постамента/статуи заполнено окружением.
python3 f5_20.py BUILD_DIR  (после day20.py / night20.py)"""
import sys, json, numpy as np, cv2, shutil, tempfile
from pathlib import Path
from PIL import Image
from scipy import ndimage
HERE = Path(__file__).parent; sys.path.insert(0, str(HERE)); sys.path.insert(0, str(HERE.parent / 's16'))
import statue20 as S
OUT = Path(sys.argv[1]); n = 'lenin_6'
d1 = S.rd(OUT / f'{n}.png').astype(np.float32)                 # кадр 5 s20 (статуя Gemini, без голубей)
bl = S.rd(OUT / f'{n}_building.png', 'RGBA').astype(np.float32)
n1 = S.rd(OUT / f'{n}_night.png').astype(np.float32)
g = S.rd(S.R20 / 'out/f5_redraw_g2.jpg')
gg = cv2.resize(g, (S.W, S.H), interpolation=cv2.INTER_AREA)
G, cc, M = S.ecc(d1.astype(np.uint8), gg)
G = G.astype(np.float32)
st = {'ecc': round(cc, 4), 'M': np.round(M, 4).tolist()}
a = bl[..., 3] / 255
up = (np.arange(S.H)[:, None] <= S.FEET[n])
stat = (a > 0.05) & up                                           # статуя (вырезка s20 выше ступней)
# 1) день: новый рисунок, статуя — наша (силуэт + 2 px), цвет вокруг не трогаем
Pst = cv2.GaussianBlur(ndimage.binary_dilation(stat, iterations=2).astype(np.float32), (0, 0), 0.8)[..., None]
KC = 1.12   # насыщенность нового рисунка к кадру 2: в настоящем рендере хрома кадра 5 была 0,82 от кадра 2 (цель ±15 %)
labG = cv2.cvtColor(np.clip(np.round(G), 0, 255).astype(np.uint8), cv2.COLOR_RGB2LAB).astype(np.float32)
labG[..., 1:] = 128 + (labG[..., 1:] - 128) * KC
G = cv2.cvtColor(np.clip(np.round(labG), 0, 255).astype(np.uint8), cv2.COLOR_LAB2RGB).astype(np.float32)
D5 = G * (1 - Pst) + d1 * Pst
# 2) вырезка: статуя — альфа s20; постамент — прежняя альфа (геометрия та же после совмещения); цвет края — изнутри
rgb = S.decontam(D5.copy(), a)
Image.fromarray(np.clip(np.round(np.dstack([rgb, a * 255])), 0, 255).astype(np.uint8), 'RGBA').save(OUT / f'{n}_building.png')
# 3) подложка: новый день, под вырезкой (+3 px) — окружение (нормированное размытие + Telea по краю)
hole = ndimage.binary_dilation(a > 0.02, iterations=3)
bgp = cv2.inpaint(np.clip(np.round(D5), 0, 255).astype(np.uint8), hole.astype(np.uint8), 7, cv2.INPAINT_TELEA).astype(np.float32)
Image.fromarray(np.clip(np.round(D5), 0, 255).astype(np.uint8)).save(OUT / f'{n}.png')
Image.fromarray(np.clip(np.round(bgp), 0, 255).astype(np.uint8)).save(OUT / f'{n}_bg.png')
# 4) ночь: карта света s15 (до окон s16) на новый рисунок
d15 = S.rd(S.S15 / f'{n}.webp').astype(np.float32); n15 = S.rd(S.S15 / f'{n}_night.webp').astype(np.float32)
def gb(x, s): return cv2.GaussianBlur(x, (0, 0), s)
ratio = np.clip((gb(n15, 9) + 2) / (gb(d15, 9) + 2), 0.05, 1.6)
N5 = D5 * ratio
# окна — по новому рисунку (win4: стекло темнее стены цвета фасада, ряды соседей), свет рисуется в ночи
import win4, night_s16
tmp = Path(tempfile.mkdtemp()); Image.fromarray(np.clip(np.round(D5), 0, 255).astype(np.uint8)).save(tmp / f'{n}.webp', quality=95)
shutil.copy(S.S19 / f'{n}_env.webp', tmp / f'{n}_env.webp'); Image.fromarray(np.clip(np.round(np.dstack([rgb, a * 255])), 0, 255).astype(np.uint8), 'RGBA').save(tmp / f'{n}_building.webp', lossless=True)
win4.S = str(tmp) + '/'
_, lbl, wins = win4.detect(n)
env = S.rd(S.S19 / f'{n}_env.webp').astype(np.float32) / 255
N5, lit, nlit = night_s16.paint_windows(n, N5, np.clip(np.round(D5), 0, 255).astype(np.uint8), lbl, env=env)
st['windows_found'] = len(wins); st['windows_lit'] = int(nlit)
# статуя под прожектором — ночь s20 (night20.py), силуэт + 2 px; вокруг — свечение не допускаем
N5 = N5 * (1 - Pst) + n1 * Pst
N5, _ = S.deglow(N5, a > 0.6, r_in=0, feet=S.FEET[n])
Image.fromarray(np.clip(np.round(N5), 0, 255).astype(np.uint8)).save(OUT / f'{n}_night.png')
# оверлей окон
ov = D5.copy(); ov[lbl > 0] = [0, 220, 255]
Image.fromarray(np.clip(ov, 0, 255).astype(np.uint8)).save(OUT / f'{n}_windows_overlay.png')
json.dump(st, open(OUT / 'f5_stats.json', 'w'), indent=1); print(st)
