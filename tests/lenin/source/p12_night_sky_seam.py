#!/usr/bin/env python3
"""s14: ночью на видах сверху (B = lenin_2, G = lenin_6) небо и город делила ровная горизонтальная линия.

  python3 tests/lenin/source/p12_night_sky_seam.py [--report DIR]

Причина в ночной картинке: небо взято «вертикальным ходом» ночи Gemini (по строкам, урок s4), город — переносом тона;
на границе неба (низ полосы неба карты _env) яркость прыгает на 6–9 уровней во всю ширину кадра — глаз видит линию.
Что делает: местный средний тон (усреднение по горизонтали σ 30 px) в полосе ±40 строк у границы заменяется плавным по
вертикали (σ 14 строк) — ступенька тона уходит, штрих и мелкие детали (высокие частоты) не трогаются. Источник — копия ночи до s14
(source/night/s14src/), запуск повторяемый.
"""
import sys
from pathlib import Path
import numpy as np, cv2
from PIL import Image
B = Path(__file__).resolve().parents[1]
FD, BK = B / 'frames', B / 'source/night/s14src'


def main():
    rep = sys.argv[sys.argv.index('--report') + 1] if '--report' in sys.argv else None
    for name in ('lenin_2', 'lenin_6'):
        n = np.asarray(Image.open(BK / (name + '_night.webp')).convert('RGB')).astype(np.float32)
        env = np.asarray(Image.open(FD / (name + '_env.webp')).convert('RGBA'))[..., 0]
        H = n.shape[0]
        y0 = int(np.where((env > 127).mean(1) > 0.5)[0].max()) + 1      # первая строка под небом
        a, b = max(0, y0 - 40), min(H, y0 + 40)
        # местный средний тон (по горизонтали σ 30 px) → плавный по вертикали (σ 14 строк); разница — только в полосе у границы
        M = cv2.GaussianBlur(n, (0, 0), sigmaX=30, sigmaY=0.01)
        S = cv2.GaussianBlur(M, (0, 0), sigmaX=0.01, sigmaY=14)
        w = np.zeros(H, np.float32); w[a:b] = np.hanning(b - a)
        out = n + (S - M) * w[:, None, None]
        out = np.clip(out + 0.5, 0, 255).astype(np.uint8)
        Image.fromarray(out).save(FD / (name + '_night.webp'), quality=92, method=6)
        d0 = np.abs(np.diff(n.mean((1, 2))))[y0 - 3:y0 + 3].max(); d1 = np.abs(np.diff(out.astype(np.float32).mean((1, 2))))[y0 - 3:y0 + 3].max()
        print('%s: граница неба — строка %d, скачок яркости строки %.1f → %.1f' % (name, y0, d0, d1))
        if rep:
            rp = Path(rep); rp.mkdir(parents=True, exist_ok=True)
            Image.fromarray(np.vstack([n.astype(np.uint8)[a - 40:b + 40], out[a - 40:b + 40]])).save(rp / ('night_sky_seam_%s_before_after.jpg' % name), quality=88)


if __name__ == '__main__':
    main()
