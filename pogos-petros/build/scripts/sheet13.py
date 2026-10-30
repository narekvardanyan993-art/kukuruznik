# Лист снимков захода 13: строки — кадры A–F, столбцы — день (с инфо-точками), дождь, снег, инфо-точка открыта, ночь (A, E).
# python3 sheet13.py <папка снимков> <выход.jpg>
import sys, os
from PIL import Image, ImageDraw, ImageFont
src, out = sys.argv[1], sys.argv[2]
fp = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
font = ImageFont.truetype(fp, 22) if os.path.exists(fp) else ImageFont.load_default()
w, h = 234, 506
cols = [('d', 'день + точки'), ('r', 'дождь'), ('s', 'снег'), ('h', 'точка открыта'), ('n', 'ночь')]
S = Image.new('RGB', (50 + len(cols) * (w + 8), 44 + 6 * (h + 8)), (245, 240, 230)); d = ImageDraw.Draw(S)
for j, (_, t) in enumerate(cols): d.text((50 + j * (w + 8), 10), t, fill=(20, 20, 20), font=font)
for i, l in enumerate('ABCDEF'):
    y = 44 + i * (h + 8); d.text((14, y + h // 2), l, fill=(20, 20, 20), font=font)
    for j, (k, _) in enumerate(cols):
        f = os.path.join(src, '%s_%s.png' % (k, l))
        if os.path.exists(f): S.paste(Image.open(f).convert('RGB').resize((w, h), Image.LANCZOS), (50 + j * (w + 8), y))
        else: d.text((60 + j * (w + 8), y + h // 2), '—', fill=(150, 140, 130), font=font)
S.save(out, quality=85); print(S.size)
