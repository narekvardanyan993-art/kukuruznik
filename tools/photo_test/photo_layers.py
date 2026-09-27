# Тест «одно фото»: кадр + карта глубины (Depth Anything V2 Small, ONNX) + вырезка главного объекта (IS-Net) + маска неба.
import sys, numpy as np, onnxruntime as ort
from PIL import Image, ImageFilter
from scipy import ndimage
SP = sys.argv[1]; SRC = sys.argv[2]; OUT = sys.argv[3]; N = 'p1'
im = Image.open(SRC).convert('RGB').crop((0, 0, 1064, 868))
W, H = im.size
im.save(f'{OUT}/{N}.png')
a = np.asarray(im).astype(np.float32) / 255
mean, std = np.array([0.485, 0.456, 0.406]), np.array([0.229, 0.224, 0.225])
# глубина: короткая сторона 518, кратно 14 (как у Depth-Anything-V2 в transformers)
s = 518 / min(W, H); w14, h14 = int(round(W * s / 14)) * 14, int(round(H * s / 14)) * 14
x = ((np.asarray(im.resize((w14, h14), Image.BICUBIC)).astype(np.float32) / 255 - mean) / std).transpose(2, 0, 1)[None].astype(np.float32)
d = ort.InferenceSession(f'{SP}/models/da2s.onnx').run(None, {'image': x})[0][0]
d = (d - d.min()) / (d.max() - d.min())
dep = Image.fromarray((d * 255).astype(np.uint8)).resize((W, H), Image.BILINEAR)
dep.save(f'{OUT}/{N}_depth.png'); dep.save(f'{OUT}/{N}_bg_depth.png')
im.save(f'{OUT}/{N}_bg.png')   # фон без здания нужен только запасному режиму без WebGL — для теста тот же кадр
# вырезка главного объекта
x = ((np.asarray(im.resize((1024, 1024), Image.BILINEAR)).astype(np.float32) / 255 - 0.5) / 1.0).transpose(2, 0, 1)[None].astype(np.float32)
m = ort.InferenceSession(f'{SP}/models/isnet.onnx').run(None, {'input_image': x})[0][0, 0]
m = (m - m.min()) / (m.max() - m.min())
mask = Image.fromarray((m * 255).astype(np.uint8)).resize((W, H), Image.BILINEAR)
rgba = im.copy(); rgba.putalpha(mask); rgba.save(f'{OUT}/{N}_building.png')
mask.save(f'{OUT}/_mask_preview.png')
m_full = np.asarray(mask).astype(np.float32) / 255
# небо: светлое, гладкое, далёкое, связанное с верхним краем
g = np.asarray(im.convert('L')).astype(np.float32) / 255
grad = np.hypot(*np.gradient(ndimage.gaussian_filter(g, 1.5)))
dd = np.asarray(dep).astype(np.float32) / 255
cand = (g > 0.62) & (grad < 0.02) & (dd < 0.06) & (m_full < 0.3)
lab, n = ndimage.label(cand)
top = set(np.unique(lab[0, :])) - {0}
sky = np.isin(lab, list(top))
sky = ndimage.binary_closing(sky, iterations=3)
env = np.zeros((H, W, 3), np.uint8); env[..., 0] = sky * 255
Image.fromarray(env).save(f'{OUT}/{N}_env.png')
Image.fromarray(np.zeros((H, W), np.uint8)).save(f'{OUT}/{N}_win2.png')
rows = sky.mean(axis=1); ref = next((y for y in range(H) if rows[y] < 0.5), H) / H
print('size', W, H, 'sky rows share<0.5 at v=', round(ref, 3), 'sky px', int(sky.sum()), 'mask>0.5', round(float((m > 0.5).mean()), 3))
