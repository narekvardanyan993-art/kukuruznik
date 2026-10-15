#!/usr/bin/env python3
"""s23: «серый ореол» вокруг крон и края постамента в настоящем рендере — небо в карте окружения (env R) кончается за 6–10 px
до кроны (старый build_env_masks: небо отступает от «деревьев» на 6 px и размыто), и полоса чистой бумаги неба над кроной
обрабатывается как земля (темнее, серее) — видно и без ветра. Здесь небо доводится до самого силуэта кроны: пиксели рядом
с небом (до 16 px) и с кроной (до 14 px), цветом как бумага неба рядом и без штриха, не крона и не здание, становятся небом. G, B (деревья) не трогаем.
   python3 skyedge23.py <frames_dir> <crowns_dir> [--dry]
env.webp пересохраняется без потерь (lossless)."""
import argparse
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

FR = ['lenin_1', 'lenin_2', 'lenin_3', 'lenin_4', 'lenin_6']

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('frames'); ap.add_argument('crowns'); ap.add_argument('--dry', action='store_true'); a = ap.parse_args()
    for n in FR:
        env = np.array(Image.open(f'{a.frames}/{n}_env.webp').convert('RGB'))
        rgb = np.array(Image.open(f'{a.frames}/{n}.webp').convert('RGB')).astype(float)
        bld = np.array(Image.open(f'{a.frames}/{n}_building.webp').convert('RGBA'))[..., 3] > 40
        crown = np.array(Image.open(f'{a.crowns}/crown_{n}.png')) > 127
        sky = env[..., 0] > 200
        # цвет неба рядом: размытое среднее по уверенному небу
        w = ndi.gaussian_filter(sky.astype(float), 12) + 1e-6
        ref = np.dstack([ndi.gaussian_filter(rgb[..., c] * sky, 12) / w for c in range(3)])
        dc = np.sqrt(((rgb - ref) ** 2).sum(-1))
        v = rgb.mean(-1); mu = ndi.uniform_filter(v, 3); sd = np.sqrt(np.maximum(ndi.uniform_filter(v * v, 3) - mu * mu, 0))
        cand = ndi.binary_dilation(sky, iterations=16) & ndi.binary_dilation(crown, iterations=14) & ~sky & ~ndi.binary_dilation(crown, iterations=1) & ~bld & (dc < 26) & (sd < 22)
        # только связанное с небом
        lab, k = ndi.label(cand | sky)
        keep = np.zeros(k + 1, bool); keep[np.unique(lab[sky])] = True; keep[0] = False
        add = cand & keep[lab]
        R = np.maximum(env[..., 0].astype(float), ndi.gaussian_filter(add.astype(float) * 255, 0.7))
        R = np.where(ndi.binary_dilation(crown, iterations=1) & ~sky, env[..., 0], R)
        print(n, 'небо +px', int(add.sum()))
        if not a.dry and add.any():
            env2 = env.copy(); env2[..., 0] = np.clip(R, 0, 255).astype(np.uint8)
            Image.fromarray(env2).save(f'{a.frames}/{n}_env.webp', lossless=True, quality=100, method=6)

if __name__ == "__main__":
    main()
