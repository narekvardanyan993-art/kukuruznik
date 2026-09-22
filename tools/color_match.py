#!/usr/bin/env python3
"""Приводит палитру кадров test-assets/frames/ к эталону (по умолчанию
v_angle_4.png — архивное фото hillview). Разовая правка, конвейер
tools/build_frames.py не запускает сам — после неё нужно перезапустить
tools/build_frames.py --force, чтобы глубина и вырезка здания
пересчитались с новых цветов.

Одна команда:
  .venv-depth/bin/python tools/color_match.py [--ref frames/v_angle_4.png] [имена кадров...]

Без аргументов правит все кадры в test-assets/frames/, кроме эталона
(и кроме уже готовых *_depth.png/*_building.png).

Метод — перенос среднего и дисперсии по каналам RGB (Reinhard-style),
не точное гистограммное выравнивание: последнее пробовал первым, оно
давало резкие, ненатуральные цветовые пятна на плоских акварельных
заливках скетча. Перенос среднего/дисперсии мягче и правдоподобнее.
strength=0.7 — не отдаём палитру эталону полностью, чтобы кадр не
терял собственный свет.
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
FRAMES_DIR = ROOT / 'test-assets' / 'frames'
STRENGTH = 0.7


def match_mean_std(src_img, ref_img, strength=STRENGTH):
    src = np.asarray(src_img.convert('RGB')).astype(np.float64)
    ref = np.asarray(ref_img.convert('RGB')).astype(np.float64)
    out = src.copy()
    for c in range(3):
        s_mean, s_std = src[:, :, c].mean(), src[:, :, c].std()
        r_mean, r_std = ref[:, :, c].mean(), ref[:, :, c].std()
        scale = (r_std / s_std) if s_std > 1e-6 else 1.0
        adjusted = (src[:, :, c] - s_mean) * scale + r_mean
        out[:, :, c] = src[:, :, c] * (1 - strength) + adjusted * strength
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))


def main():
    args = sys.argv[1:]
    ref_name = 'v_angle_4.png'
    if '--ref' in args:
        i = args.index('--ref')
        ref_name = args[i + 1]
        args = args[:i] + args[i + 2:]

    ref_path = FRAMES_DIR / ref_name
    if not ref_path.exists():
        raise SystemExit('Эталон не найден: %s' % ref_path)
    ref_img = Image.open(ref_path)

    if args:
        targets = [FRAMES_DIR / name for name in args]
    else:
        targets = [
            p for p in sorted(FRAMES_DIR.glob('*.png'))
            if p.name != ref_name
            and not p.stem.endswith('_depth')
            and not p.stem.endswith('_building')
        ]

    print('эталон:', ref_path.name)
    for p in targets:
        if not p.exists():
            print('  ! нет файла', p.name, '- пропуск')
            continue
        img = Image.open(p)
        matched = match_mean_std(img, ref_img)
        matched.save(p)
        print('  matched', p.name)

    print('готово. Теперь пересчитай конвейер: .venv-depth/bin/python tools/build_frames.py --force')


if __name__ == '__main__':
    main()
