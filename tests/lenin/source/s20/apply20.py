"""s20: собранные PNG (BUILD_DIR) -> кадры frames/*.webp (q92, как прежние); неизменённые слои не пересохраняются (урок s16)."""
import sys, numpy as np
from pathlib import Path
from PIL import Image
B = Path(__file__).resolve().parents[1].parent; BD = Path(sys.argv[1]); FR = B / 'frames'
only = sys.argv[2:] or ['lenin_1', 'lenin_2', 'lenin_3', 'lenin_4', 'lenin_6']
for n in only:
    for src, dst, mode in ((f'{n}.png', f'{n}.webp', 'RGB'), (f'{n}_bg.png', f'{n}_bg.webp', 'RGB'), (f'{n}_building.png', f'{n}_building.webp', 'RGBA'), (f'{n}_night.png', f'{n}_night.webp', 'RGB'), (f'{n}_depth.png', f'{n}_depth.webp', 'RGB')):
        p = BD / src
        if not p.exists(): print('нет', p); continue
        new = np.asarray(Image.open(p).convert(mode)); old = np.asarray(Image.open(FR / dst).convert(mode))
        s19 = B / 'refs/s20/s19src' / dst
        if s19.exists() and np.array_equal(new, np.asarray(Image.open(s19).convert(mode))):   # слой не менялся — файл s19 байт в байт (без пережатия)
            import shutil; shutil.copyfile(s19, FR / dst); print(n, dst, 'как в s19 (файл s19)'); continue
        diff = int((np.abs(new.astype(int) - old.astype(int)).max(-1) > 3).sum())
        if diff == 0: print(n, dst, 'без изменений — не пересохраняю'); continue
        Image.fromarray(new, mode).save(FR / dst, quality=92, method=6)
        print(n, dst, 'изменено px', diff)
