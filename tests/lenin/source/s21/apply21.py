"""s21: собранные PNG (BUILD_DIR) -> frames/*.webp (q92); неизменённые слои не пересохраняются (урок s16)."""
import sys, numpy as np
from pathlib import Path
from PIL import Image
B = Path(__file__).resolve().parents[1].parent; BD = Path(sys.argv[1]); FR = B / 'frames'
for n in sys.argv[2:]:
    for src, dst, mode in ((f'{n}.png', f'{n}.webp', 'RGB'), (f'{n}_bg.png', f'{n}_bg.webp', 'RGB'), (f'{n}_night.png', f'{n}_night.webp', 'RGB')):
        p = BD / src
        if not p.exists(): print('нет', p); continue
        new = np.asarray(Image.open(p).convert(mode)); old = np.asarray(Image.open(FR / dst).convert(mode))
        diff = int((np.abs(new.astype(int) - old.astype(int)).max(-1) > 3).sum())
        if diff == 0: print(n, dst, 'без изменений — не пересохраняю'); continue
        Image.fromarray(new, mode).save(FR / dst, quality=92, method=6)
        print(n, dst, 'изменено px', diff)
