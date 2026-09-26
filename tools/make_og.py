#!/usr/bin/env python3
"""Картинка для превью ссылки (og:image / twitter:image), 1200×630 -> test-assets/og-kukuruznik.jpg.

  node tools/og_shot.mjs /tmp/og-frame.png                       # снимок дневного кадра 1 в паспарту (сервер :8080)
  /tmp/fontvenv/bin/python tools/make_og.py /tmp/og-frame.png    # нужны fonttools, brotli, pillow

Бумага цвета сайта, слева экспонат (лучший дневной кадр), справа название на армянском (Noto Serif Armenian, SIL OFL 1.1 — файл проекта),
«Չկա» и годы (Noto Serif Latin, OFL). Тонкая линия-разделитель.
"""
import sys
import tempfile
from pathlib import Path

from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
FONTS = ROOT / 'test-assets' / 'fonts'
PAPER, INK = (245, 236, 218), (47, 42, 37)


def ttf(name, wght):
    f = instantiateVariableFont(TTFont(FONTS / name), {'wght': wght})
    p = Path(tempfile.gettempdir()) / ('og-' + name + str(wght) + '.ttf')
    f.flavor = None
    f.save(p)
    return str(p)


def main():
    src = Path(sys.argv[1] if len(sys.argv) > 1 else '/tmp/og-frame.png')
    W, H = 1200, 630
    im = Image.new('RGB', (W, H), PAPER)
    fr = Image.open(src).convert('RGB')
    h = 560
    fr = fr.resize((int(fr.width * h / fr.height), h), Image.LANCZOS)
    im.paste(fr, (60, (H - h) // 2))
    d = ImageDraw.Draw(im)
    x0 = 60 + fr.width + 80
    d.line([(x0 - 40, 70), (x0 - 40, H - 70)], fill=(93, 76, 49), width=2)
    hy_b = ImageFont.truetype(ttf('NotoSerifArmenian-armenian.woff2', 700), 84)
    hy_m = ImageFont.truetype(ttf('NotoSerifArmenian-armenian.woff2', 500), 38)
    hy_s = ImageFont.truetype(ttf('NotoSerifArmenian-armenian.woff2', 700), 56)
    la = ImageFont.truetype(ttf('NotoSerif-latin.woff2', 600), 40)
    d.text((x0, 92), 'Չկա', font=hy_s, fill=(93, 76, 49))
    d.text((x0, 230), 'Կուկուռուզնիկ', font=hy_b, fill=INK)
    d.line([(x0, 362), (x0 + 250, 362)], fill=INK, width=3)
    d.text((x0, 392), 'Երիտասարդական պալատ', font=hy_m, fill=INK)
    d.text((x0, 448), 'Երևան', font=hy_m, fill=INK)
    d.text((x0, 512), '1979 – 2006', font=la, fill=(93, 76, 49))
    out = ROOT / 'test-assets' / 'og-kukuruznik.jpg'
    im.save(out, 'JPEG', quality=88, optimize=True, progressive=True)
    print(out, im.size, out.stat().st_size // 1024, 'KB')


if __name__ == '__main__':
    main()
