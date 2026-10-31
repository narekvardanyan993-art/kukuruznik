# Лист снимков захода 15: шоу A/B/C (видео Veo) по 3 момента, старик A в дождь/снег. python3 sheet15.py <папка снимков> <выход.jpg>
import sys, os
from PIL import Image, ImageDraw, ImageFont
src, out = sys.argv[1], sys.argv[2]
fp = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
font = ImageFont.truetype(fp, 14) if os.path.exists(fp) else ImageFont.load_default()
rows = [[('A1', 'A шоу 2,2 с: колокол, голуби'), ('A2', 'A 5 с: голуби улетают'), ('A3', 'A 9,5 с: колокол качается'), ('rA', 'A дождь: газета'), ('sA', 'A снег: воротник')],
        [('B1', 'B шоу 7 с: звонницы падают'), ('B2', 'B 12 с: руины (пауза)'), ('B3', 'B 16 с: отмотка назад'), ('C1', 'C шоу 3 с: фаэтон вдали'), ('C2', 'C 6 с: ближе')],
        [('C3', 'C 9 с: у края'), ('A0', 'A без шоу (для сравнения)')]]
ZOOM = {'A': (140, 140, 360, 420), 'B': (0, 120, 390, 760), 'C': (0, 560, 390, 844), 'r': (60, 530, 290, 740), 's': (60, 530, 290, 740)}
w, h = 234, 506; zh = 250
S = Image.new('RGB', (10 + 5 * (w + 8), 10 + len(rows) * (h + zh + 50)), (245, 240, 230)); d = ImageDraw.Draw(S)
for i, row in enumerate(rows):
    y = 10 + i * (h + zh + 50)
    for j, (k, t) in enumerate(row):
        x = 10 + j * (w + 8); d.text((x, y), t, fill=(20, 20, 20), font=font)
        f = os.path.join(src, k + '.png')
        if not os.path.exists(f): d.text((x, y + 40), 'нет снимка', fill=(200, 0, 0), font=font); continue
        im = Image.open(f).convert('RGB'); S.paste(im.resize((w, h), Image.LANCZOS), (x, y + 26))
        z = ZOOM[k[0]]; zc = im.crop(z); zw = w; zhh = min(zh, int(zw * zc.height / zc.width))
        S.paste(zc.resize((zw, zhh), Image.LANCZOS), (x, y + 26 + h + 6))
S.save(out, quality=86); print(S.size)
