# Лист снимков захода 16: шоу D (надпись-резьба) 3 момента + крупно, будка B в снег, шоу A с наездом, руины B. python3 sheet16.py <папка снимков> <выход.jpg>
import sys, os
from PIL import Image, ImageDraw, ImageFont
src, out = sys.argv[1], sys.argv[2]
fp = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
font = ImageFont.truetype(fp, 14) if os.path.exists(fp) else ImageFont.load_default()
w, h = 234, 506; zh = 236; gap = 8
rows = [[('D1', 'D шоу 6,6 с: первые буквы', 'D'), ('D2', 'D 9,5 с: резьба + угли', 'D'), ('D3', 'D 12,5 с: вся надпись', 'D'), ('sB', 'B снег: снег только на крыше будки', 'K')],
        [('A0', 'A без шоу', 'A'), ('A1', 'A шоу 2,2 с: наезд начался', 'A'), ('A2', 'A 5,5 с: колокол крупно', 'A'), ('B2', 'B шоу 12 с: руины, небо чистое', 'B')]]
ZOOM = {'D': (40, 270, 300, 400), 'K': (150, 560, 330, 700), 'A': (95, 120, 295, 380), 'B': (0, 60, 390, 420)}
S = Image.new('RGB', (10 + 4 * (w + gap), 10 + len(rows) * (h + zh + 50)), (245, 240, 230)); d = ImageDraw.Draw(S)
for i, row in enumerate(rows):
    y = 10 + i * (h + zh + 50)
    for j, (k, t, z) in enumerate(row):
        x = 10 + j * (w + gap); d.text((x, y), t, fill=(20, 20, 20), font=font)
        f = os.path.join(src, k + '.png')
        if not os.path.exists(f): d.text((x, y + 40), 'нет снимка', fill=(200, 0, 0), font=font); continue
        im = Image.open(f).convert('RGB'); S.paste(im.resize((w, h), Image.LANCZOS), (x, y + 24))
        zc = im.crop(ZOOM[z]); zhh = min(zh, int(w * zc.height / zc.width)); S.paste(zc.resize((w, zhh), Image.LANCZOS), (x, y + 24 + h + 6))
S.save(out, quality=88); print(S.size)
