# Лист снимков захода 18: собака B всегда живая (день c17, день-2, тап, закат, ночь, ночь+тап) и шоу D — огонь букв (тёмный кадр).
# python3 sheet18.py <папка снимков> <выход.jpg>
import sys, os
from PIL import Image, ImageDraw, ImageFont
src, out = sys.argv[1], sys.argv[2]
fp = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
font = ImageFont.truetype(fp, 14) if os.path.exists(fp) else ImageFont.load_default()
w, h = 210, 454; zh = 200; gap = 8; N = 6
rows = [[('dogDAY', 'день (?hour=14): ролик c17', 'K'), ('dogDAY2', 'день-2: дремота (запасной)', 'K'), ('dogTAP', 'тап: смотрит в камеру', 'K'),
         ('dogSUN', 'Закат: живая, в тоне', 'K'), ('dogNIGHT', 'Ночь: живая (дремота)', 'K'), ('dogNIGHTtap', 'Ночь + тап', 'K')],
        [('D0', 'D ночь, без шоу', 'D'), ('D1', 'D 12,6 с: вырезана', 'D'), ('D2', 'D 14,2 с: огонь бежит', 'D'), ('D3', 'D 17,5 с: горит', 'D'), ('D4', 'D 22 с: гаснет', 'D'), ('D3', 'D 17,5 с крупно', 'Z')]]
ZOOM = {'K': (120, 540, 340, 720), 'D': (60, 280, 300, 420), 'Z': (110, 315, 250, 375)}
S = Image.new('RGB', (10 + N * (w + gap), 10 + len(rows) * (h + zh + 44)), (245, 240, 230)); d = ImageDraw.Draw(S)
for i, row in enumerate(rows):
    y = 10 + i * (h + zh + 44)
    for j, (k, t, z) in enumerate(row):
        x = 10 + j * (w + gap); d.text((x, y), t, fill=(20, 20, 20), font=font)
        f = os.path.join(src, k + '.png')
        if not os.path.exists(f): d.text((x, y + 40), 'нет снимка', fill=(200, 0, 0), font=font); continue
        im = Image.open(f).convert('RGB'); S.paste(im.resize((w, h), Image.LANCZOS), (x, y + 22))
        zc = im.crop(ZOOM[z]); zhh = min(zh, int(w * zc.height / zc.width)); S.paste(zc.resize((w, zhh), Image.LANCZOS), (x, y + 22 + h + 4))
S.save(out, quality=88); print(S.size)
