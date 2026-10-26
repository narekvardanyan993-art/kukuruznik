"""Заход 4: D — пасмурный зимний свет из Gemini-правки, штрих исходника.
Цвет/свет берём у Gemini крупно (отношение размытых картинок, σ = 14 px полного кадра), линии и бумага остаются свои
(Gemini по уроку не правит кадр — мы смешиваем). Тёплое пятно свечи в двери остаётся исходным (маска двери по жёлтому).
python3 pogos-petros/build/scripts/winter4.py <gemini_id>
"""
import sys, shutil, numpy as np
from pathlib import Path
from PIL import Image
from scipy import ndimage
R = Path(__file__).resolve().parents[2]
src = R/'frames/D.png'; keep = R/'frames/_rejected/D_pre4.png'
if not keep.exists(): shutil.copyfile(src, keep)
o = np.asarray(Image.open(keep).convert('RGB')).astype(np.float32); H, W = o.shape[:2]
g = Image.open(R/'gemini/in'/('Gemini_Generated_Image_%s.jpeg' % sys.argv[1])).convert('RGB')
gw, gh = g.size; h = round(gw*H/W)
if gh > h: g = g.crop((0, gh-h, gw, gh))
g = np.asarray(g.resize((W, H), Image.LANCZOS)).astype(np.float32)
s = 14
ratio = (ndimage.gaussian_filter(g, (s, s, 0)) + 4) / (ndimage.gaussian_filter(o, (s, s, 0)) + 4)
ratio = np.clip(ratio, 0.55, 1.6)
# свеча: тёплое и яркое в исходнике — не трогаем
warm = ((o[..., 0] - o[..., 2]) > 70) & (o.mean(-1) > 120)
warm = ndimage.gaussian_filter(ndimage.binary_dilation(warm, iterations=10).astype(np.float32), 6)[..., None]
out = o*ratio*(1-warm) + o*warm
Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).save(src)
print('D ratio mean', np.round(ratio.reshape(-1, 3).mean(0), 3), 'warm px', int((warm > 0.5).sum()))
Image.fromarray(np.concatenate([o, np.full((H, 16, 3), 255), np.clip(out, 0, 255)], 1).astype(np.uint8)).resize(((2*W+16)//3, H//3)).save(R/'build/report/s4clean/winter_D.jpg', quality=85)
