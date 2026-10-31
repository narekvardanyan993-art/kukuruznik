# Лист снимков захода 14: собака B — 3 момента видео; старик A и пара F — видео; погода (дождь) B/A/F + снег B.
# python3 sheet14.py <папка снимков> <выход.jpg>
import sys, os
from PIL import Image, ImageDraw, ImageFont
src, out = sys.argv[1], sys.argv[2]
fp = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
font = ImageFont.truetype(fp, 20) if os.path.exists(fp) else ImageFont.load_default()
rows = [[('vB1', 'B собака: видео 1'), ('vB2', 'видео 2'), ('vB3', 'видео 3'), ('rB', 'B дождь: будка'), ('sB', 'B снег: будка')],
        [('vA1', 'A старик: видео'), ('rA', 'A дождь: пусто'), ('vF1', 'F пара: видео 1'), ('vF2', 'видео 2'), ('rF', 'F дождь: зонт')]]
w, h = 234, 506; zh = 230
S = Image.new('RGB', (10 + 5 * (w + 8), 10 + len(rows) * (h + zh + 50)), (245, 240, 230)); d = ImageDraw.Draw(S)
ZOOM = {'B': (110, 540, 410, 760), 'A': (60, 540, 340, 760), 'F': (0, 520, 300, 760)}   # где живое место на экране 390×844
for i, row in enumerate(rows):
    y = 10 + i * (h + zh + 50)
    for j, (k, t) in enumerate(row):
        x = 10 + j * (w + 8); d.text((x, y), t, fill=(20, 20, 20), font=font)
        f = os.path.join(src, k + '.png')
        if not os.path.exists(f): continue
        im = Image.open(f).convert('RGB'); S.paste(im.resize((w, h), Image.LANCZOS), (x, y + 26))
        S.paste(im.crop(ZOOM[k[1]]).resize((w, zh), Image.LANCZOS), (x, y + 26 + h + 6))
S.save(out, quality=86); print(S.size)
