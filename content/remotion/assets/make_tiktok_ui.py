#!/usr/bin/env python3
"""Макет интерфейса TikTok для листа «как в TikTok» (build.mjs): прозрачный PNG 886×1920 —
то, что видно на экране 19,5:9, когда ролик 9:16 растянут по высоте (1920 px = 852 pt, 2,25 px на pt).
Это не точная копия приложения, а места, которые оно закрывает: вкладки сверху, колонка кнопок справа,
имя, подпись и звук снизу, панель вкладок. Запуск: python3 content/remotion/assets/make_tiktok_ui.py"""
import os
from PIL import Image, ImageDraw, ImageFilter

W, H, K = 886, 1920, 2.25
im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
sh = Image.new('RGBA', (W, H), (0, 0, 0, 0))
d, s = ImageDraw.Draw(im), ImageDraw.Draw(sh)
WHITE = (255, 255, 255, 235)

def bar(x, y, w, h, fill=WHITE):
    s.rounded_rectangle([x, y + 3, x + w, y + h + 3], h // 2, fill=(0, 0, 0, 110))
    d.rounded_rectangle([x, y, x + w, y + h], h // 2, fill=fill)

def disc(cx, cy, r, fill=WHITE):
    s.ellipse([cx - r, cy - r + 4, cx + r, cy + r + 4], fill=(0, 0, 0, 120))
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=fill)

# затемнение сверху и снизу, как в приложении
for y in range(0, 330):
    d.line([(0, y), (W, y)], fill=(0, 0, 0, int(70 * (1 - y / 330))))
for y in range(1300, H):
    d.line([(0, y), (W, y)], fill=(0, 0, 0, int(120 * (y - 1300) / (H - 1300))))
# сверху: вкладки «Подписки · Для вас» и поиск (≈ 59 pt статус-бар + вкладки до ≈ 105 pt)
bar(250, 168, 150, 30, (255, 255, 255, 150)); bar(430, 168, 130, 30); bar(470, 212, 50, 8)
disc(W - 70, 183, 26)
# справа: аватар, лайк, комментарий, закладка, поделиться, диск звука (колонка ≈ 63 pt)
for cy, r in [(900, 54), (1040, 44), (1170, 44), (1300, 44), (1430, 44)]:
    disc(W - 78, cy, r)
    if cy > 900: bar(W - 108, cy + 56, 60, 14, (255, 255, 255, 200))
disc(W - 78, 1600, 50, (30, 30, 30, 235)); disc(W - 78, 1600, 16)
# снизу: имя, две строки подписи, звук
bar(30, 1480, 260, 34); bar(30, 1536, 600, 26, (255, 255, 255, 215)); bar(30, 1578, 470, 26, (255, 255, 255, 215)); bar(30, 1634, 380, 24, (255, 255, 255, 190))
# панель вкладок (83 pt): непрозрачная
d.rectangle([0, H - 187, W, H], fill=(0, 0, 0, 255))
for k in range(5):
    cx = int(W * (k + 0.5) / 5)
    d.rounded_rectangle([cx - 26, H - 150, cx + 26, H - 104], 10, fill=(255, 255, 255, 255 if k == 0 else 150))
out = Image.alpha_composite(sh.filter(ImageFilter.GaussianBlur(5)), im)
out.save(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'tiktok-ui.png'), optimize=True)
print('tiktok-ui.png', out.size)
