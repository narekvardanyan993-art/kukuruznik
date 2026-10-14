"""s21: ночью люди кадра не двигаются. Дневной ролик ночью движок кладёт в ночную картинку как отношение (видео/рисунок) — на кадре 3
ночью нарисованные люди полупрозрачные, и их движение выглядело как «призраки». Без правки движка: ночной клип (clips[].time "night")
= неподвижная ночная картинка кадра (движок ночью кладёт ночной клип пикселями, не отличием) — 2 с, петля.
python3 night_still21.py <кадр>  -> frames/<кадр>_motion_n1.mp4/.webm"""
import sys, numpy as np, cv2
from pathlib import Path
from PIL import Image
B = Path(__file__).resolve().parents[1].parent
sys.path.insert(0, str(B.parents[1] / 'tools')); sys.path.insert(0, str(Path(__file__).parent))
import people21 as P   # noqa — encode_hq
n = sys.argv[1]
nt = cv2.resize(np.asarray(Image.open(B / f'frames/{n}_night.webp').convert('RGB')).astype(np.float32), (P.W, P.H2), interpolation=cv2.INTER_AREA)
m = np.asarray(Image.open(B / f'frames/{n}_motion_mask.png'))[..., 1][..., None] > 0   # вне маски движок видео не берёт — серое, ролик легче
f = np.clip(np.where(m, nt, 128.0) + 0.5, 0, 255).astype(np.uint8)
mp4 = B / f'frames/{n}_motion_n1.mp4'
print(P.encode_hq([f] * 40, mp4), mp4.stat().st_size // 1024, mp4.with_suffix('.webm').stat().st_size // 1024)
