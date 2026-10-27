"""Заход 6: призрак церкви над кинотеатром — нарисован Gemini (правка F0, 3.1 Pro). Слой = пиксели Gemini там, где правка
отличается от F0, в рамке силуэта призрака; мягкий край. → tests/pogos-petros/frames/show_ghost_f.webp (RGBA 768×1365) и
gemini/show/ghost_f.png; F_gemini.png — весь кадр Gemini для справки.
python3 pogos-petros/build/scripts/ghost6.py <gemini_id>
"""
import sys, numpy as np
from pathlib import Path
from PIL import Image
from scipy import ndimage
R = Path(__file__).resolve().parents[2]; T = R.parent/'tests/pogos-petros/frames'
g = Image.open(R/'gemini/in'/('Gemini_Generated_Image_%s.jpeg' % sys.argv[1])).convert('RGB')
W, H = 768, 1365
gw, gh = g.size; h = round(gw * 2731 / 1536)
if gh > h: g = g.crop((0, gh - h, gw, gh))
g.save(R/'gemini/show/F_gemini.png')
G = np.asarray(g.resize((W, H), Image.LANCZOS)).astype(np.float32)
F = np.asarray(Image.open(R/'frames/F0.png').convert('RGB').resize((W, H), Image.LANCZOS)).astype(np.float32)
d = ndimage.gaussian_filter(np.abs(G - F).mean(-1), 2.0)
light = (G.mean(-1) - F.mean(-1))   # призрак светлее того, что под ним
m = np.clip((d - 10) / 25, 0, 1) * np.clip((light + 4) / 20, 0, 1)
box = np.zeros((H, W), np.float32); box[int(0.125 * H):int(0.665 * H), int(0.08 * W):int(0.90 * W)] = 1
box = ndimage.gaussian_filter(box, 12)
m = ndimage.gaussian_filter(m, 1.2) * box
a = np.clip(m * 1.15, 0, 0.92)
rgba = np.dstack([G, a * 255]).astype(np.uint8)
Image.fromarray(rgba, 'RGBA').save(T/'show_ghost_f.webp', lossless=False, quality=90)
Image.fromarray(rgba, 'RGBA').save(R/'gemini/show/ghost_f.png')
prev = (F * (1 - a[..., None]) + G * a[..., None]).astype(np.uint8)
Image.fromarray(np.concatenate([F.astype(np.uint8), prev], 1)).resize((W, H // 2)).save(R/'gemini/prev/ghost_layer.jpg', quality=85)
print('ghost alpha mean %.3f, px>0.3: %d' % (a.mean(), (a > 0.3).sum()))
