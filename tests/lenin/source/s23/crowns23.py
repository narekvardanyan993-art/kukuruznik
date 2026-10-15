#!/usr/bin/env python3
"""s23: чёткая маска крон по самому рисунку и деление на отдельные деревья.
   python3 crowns23.py <frames_dir> <out_dir> [--viz]
Крона = зелёное пятно рисунка со штрихом внутри (газон — гладкий, без штриха — отбрасывается), без неба (env R), без слоя
памятника. Старая маска деревьев (env G) не нужна: она мягкая, заходит в небо и на кадре 5 сдвинута (кадр перерисован в s20).
Деревья делятся водоразделом по карте расстояний (у каждого — свой край, своя фаза и своя высота).
Пишет <out>/crown_<кадр>.png (0/255) и <out>/trees_<кадр>.npy (номер дерева, 0 — не дерево)."""
import argparse
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

FR = ['lenin_1', 'lenin_2', 'lenin_3', 'lenin_4', 'lenin_6']
MIN_AREA = 150          # px кадра: меньше — куст/пятно, не качаем
SD_MIN = 0.06           # средний разброс яркости 5×5 (штрих кроны); газон, бронза — гладкие
MIN_W = 22              # самое узкое дерево, px кадра
VALLEY = 10             # глубина ложбины между макушками, px кадра
EXCLUDE = {'lenin_2': [(40, 830, 185, 1005)],                          # газон двора с кипарисом
           'lenin_6': [(355, 410, 432, 485), (636, 460, 705, 540)]}       # газоны у бассейна

def build(fd, name):
    rgb = np.array(Image.open(f'{fd}/{name}.webp').convert('RGB'))
    hsv = np.array(Image.fromarray(rgb).convert('HSV')).astype(float)
    h, s, v = hsv[..., 0] * 360 / 255, hsv[..., 1] / 255, hsv[..., 2] / 255
    env = np.array(Image.open(f'{fd}/{name}_env.webp').convert('RGB')).astype(int)
    sky = env[..., 0] > 140
    bld = np.array(Image.open(f'{fd}/{name}_building.webp').convert('RGBA'))[..., 3] > 60
    g = (h > 42) & (h < 175) & (s > 0.16) & (v > 0.10)
    g = ndi.binary_opening(g, iterations=1)
    m = ndi.binary_closing(g, iterations=3)
    m = ndi.binary_fill_holes(m)
    m = ndi.binary_opening(m, iterations=2)
    m &= ~ndi.binary_dilation(bld, iterations=1)
    for (x0, y0, x1, y1) in EXCLUDE.get(name, []): m[y0:y1, x0:x1] = False
    mu = ndi.uniform_filter(v, 5); sd = np.sqrt(np.maximum(ndi.uniform_filter(v * v, 5) - mu * mu, 0))   # штрих: у газона и бронзы гладко
    lab, n = ndi.label(m)
    keep = np.zeros(n + 1, bool)
    sdm = ndi.mean(sd, lab, index=np.arange(1, n + 1))
    area = ndi.sum(np.ones_like(lab), lab, index=np.arange(1, n + 1))
    skyf = ndi.mean(sky.astype(float), lab, index=np.arange(1, n + 1))
    for i in range(n):
        keep[i + 1] = area[i] >= MIN_AREA and sdm[i] >= SD_MIN and skyf[i] < 0.5
    m = keep[lab]
    # деревья: пятно делится вертикальными границами по «ложбинам» верхнего края (между макушками) — у каждого дерева свой
    # край, своя фаза и высота; граница вертикальная, потому что крона движется только по горизонтали (без горизонтальных разрывов)
    lab, n = ndi.label(m)
    trees = np.zeros(m.shape, np.int32); k = 0
    for i in range(1, n + 1):
        sl = ndi.find_objects((lab == i).astype(int))[0]
        mm = lab[sl] == i
        cols = np.nonzero(mm.any(0))[0]
        top = np.array([np.nonzero(mm[:, x])[0].min() if mm[:, x].any() else mm.shape[0] for x in range(mm.shape[1])], float)
        top = ndi.gaussian_filter1d(top, 4)
        cuts = []
        for x in range(MIN_W, mm.shape[1] - MIN_W):
            w = top[max(0, x - 18):x + 19]
            if top[x] >= w.max() - 0.01 and top[x] - min(top[max(0, x - 40):x].min(), top[x + 1:x + 41].min()) >= VALLEY:
                if not cuts or x - cuts[-1] >= MIN_W: cuts.append(x)
        edges = [0] + cuts + [mm.shape[1]]
        for j in range(len(edges) - 1):
            part = np.zeros_like(mm); part[:, edges[j]:edges[j + 1]] = mm[:, edges[j]:edges[j + 1]]
            if part.any():
                k += 1; trees[sl][part] = k
    return rgb, m, trees

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('fd'); ap.add_argument('out'); ap.add_argument('--viz', action='store_true'); a = ap.parse_args()
    rng = np.random.default_rng(3)
    for name in FR:
        rgb, m, trees = build(a.fd, name)
        Image.fromarray((m * 255).astype(np.uint8)).save(f'{a.out}/crown_{name}.png')
        np.save(f'{a.out}/trees_{name}.npy', trees)
        if a.viz:
            col = rng.integers(60, 255, (trees.max() + 1, 3)); col[0] = 0
            vz = rgb.astype(float)
            vz[m] = vz[m] * 0.4 + col[trees[m]] * 0.6
            ed = (ndi.grey_dilation(trees, size=3) != trees) & m
            vz[ed] = [255, 0, 255]
            Image.fromarray(vz.astype(np.uint8)).save(f'{a.out}/crown_{name}_viz.jpg', quality=88)
        print(name, 'crown px', int(m.sum()), 'trees', int(trees.max()))

if __name__ == "__main__":
    main()
