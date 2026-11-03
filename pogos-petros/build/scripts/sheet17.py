# Лист снимков захода 17: шоу C (фаэтон поверх здания), шоу B (снос → кинотеатр → назад), собака B утро/день/закат/вечер/ночь, шоу D (надпись пишется) + крупно.
# python3 sheet17.py <папка снимков> <выход.jpg>
import sys, os
from PIL import Image, ImageDraw, ImageFont
src, out = sys.argv[1], sys.argv[2]
fp = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
font = ImageFont.truetype(fp, 14) if os.path.exists(fp) else ImageFont.load_default()
w, h = 210, 454; zh = 200; gap = 8; N = 5
rows = [[('C0', 'C без шоу', 'C'), ('C1', 'C шоу 3,5 с: фаэтон вдали', 'C'), ('C2', 'C 6,5 с: ближе, поверх здания', 'C'), ('C3', 'C 9 с: у края', 'C')],
        [('B1', 'B шоу 5 с: снос', 'B'), ('B2', 'B 10,4 с: руины', 'B'), ('B3', 'B 15,5 с: кинотеатр растёт', 'B'), ('B4', 'B 20,5 с: кинотеатр', 'B'), ('B5', 'B 26 с: назад к церкви', 'B')],
        [('dogAM', 'собака утро (?hour=8)', 'K'), ('dogDAY', 'собака день (?hour=14)', 'K'), ('dogSUN', 'Закат: собака на месте', 'K'), ('dogEVE', 'вечер (?hour=23): спит', 'K'), ('dogNIGHT', 'Ночь: спит', 'K')],
        [('D0', 'D без шоу', 'D'), ('D1', 'D 7,5 с: ՍՈՒՐ + половина Բ', 'D'), ('D1b', 'D 8,6 с: буква режется штрихом', 'D'), ('D3', 'D 13,5 с: вся надпись', 'D'), ('D3', 'D крупно ×3', 'Z')]]
ZOOM = {'C': (0, 470, 390, 844), 'B': (0, 80, 390, 640), 'K': (130, 560, 330, 700), 'D': (60, 280, 300, 420), 'Z': (110, 315, 250, 375)}
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
