# Ленин (тест): кадр 9:16, глубина, вырезка памятника, небо — по исходному фото
import sys, numpy as np, onnxruntime as ort, cv2
from PIL import Image
from scipy import ndimage
SP = sys.argv[1]; SRC = sys.argv[2]
im = Image.open(SRC).convert('L'); W0, H0 = im.size
cw = int(H0 * 768 / 1365); cx = 575
x0 = max(0, min(W0 - cw, cx - cw // 2))
g = np.asarray(im.crop((x0, 0, x0 + cw, H0)).resize((768, 1365), Image.LANCZOS))
# плёночное зерно и пятна пыли — прочь, края оставить
g = cv2.medianBlur(g, 3); g = cv2.bilateralFilter(g, 9, 40, 7)
cv2.imwrite('photo.png', g)
rgb = np.stack([g] * 3, -1).astype(np.float32) / 255
W, H = 768, 1365
mean, std = np.array([0.485, 0.456, 0.406]), np.array([0.229, 0.224, 0.225])
s = 518 / W; w14, h14 = 518, int(round(H * s / 14)) * 14
x = ((cv2.resize(rgb, (w14, h14), interpolation=cv2.INTER_CUBIC) - mean) / std).transpose(2, 0, 1)[None].astype(np.float32)
d = ort.InferenceSession(f'{SP}/models/da2s.onnx').run(None, {'image': x})[0][0]
d = (d - d.min()) / (d.max() - d.min()); d = cv2.resize(d, (W, H), interpolation=cv2.INTER_LINEAR)
cv2.imwrite('depth.png', (d * 255).astype(np.uint8))
x = ((cv2.resize(rgb, (1024, 1024)) - 0.5)).transpose(2, 0, 1)[None].astype(np.float32)
m = ort.InferenceSession(f'{SP}/models/isnet.onnx').run(None, {'input_image': x})[0][0, 0]
m = (m - m.min()) / (m.max() - m.min()); m = cv2.resize(m, (W, H))
cv2.imwrite('mask.png', (m * 255).astype(np.uint8))
gf = g.astype(np.float32) / 255
grad = np.hypot(*np.gradient(ndimage.gaussian_filter(gf, 2)))
cand = (d < 0.35) & (m < 0.3) & (grad < 0.03)
lab, n = ndimage.label(cand); top = set(np.unique(lab[:5, :])) - {0}
sky = ndimage.binary_fill_holes(ndimage.binary_closing(np.isin(lab, list(top)), iterations=4))
cv2.imwrite('sky.png', sky.astype(np.uint8) * 255)
print('sky share', round(float(sky.mean()), 3), 'mask share', round(float((m > .5).mean()), 3))
