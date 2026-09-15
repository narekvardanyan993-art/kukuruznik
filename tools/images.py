# -*- coding: utf-8 -*-
"""Картинки для сайта Չկա: берёт исходники и делает лёгкие версии для телефона.

   Первый экран главной:
     assets/source/hero-photo.jpg   архивное фото (квадрат)
     assets/source/hero-sketch.jpg  карандашный рисунок — ТОТ ЖЕ кадр, та же рамка
   -> assets/hero-photo-720.webp, -1080.webp, -1080.jpg (и то же для sketch)

   Карточка здания:
     <папка здания>/card-source.jpg (или .png)
   -> <папка здания>/card.webp (ширина 480)

   Запуск:  python3 tools/images.py
"""
import os, sys
from PIL import Image, ImageOps

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXT = ('.jpg', '.jpeg', '.png', '.webp')


def find(base):
    for e in EXT:
        if os.path.exists(base + e):
            return base + e
    return None


def square(img):
    s = min(img.size)
    return ImageOps.fit(img, (s, s), Image.LANCZOS)


def hero(name):
    src = find(os.path.join(HERE, 'assets', 'source', name))
    if not src:
        return
    img = square(ImageOps.exif_transpose(Image.open(src)).convert('RGB'))
    out = os.path.join(HERE, 'assets', name)
    for w in (720, 1080):
        img.resize((w, w), Image.LANCZOS).save('%s-%d.webp' % (out, w), 'WEBP', quality=72, method=6)
    img.resize((1080, 1080), Image.LANCZOS).save(out + '-1080.jpg', 'JPEG', quality=76, optimize=True, progressive=True)
    print('первый экран  <- %s' % os.path.relpath(src, HERE))


def cards():
    for d in sorted(os.listdir(HERE)):
        src = find(os.path.join(HERE, d, 'card-source'))
        if not src:
            continue
        img = ImageOps.exif_transpose(Image.open(src)).convert('RGB')
        w = 480
        h = round(img.height * w / img.width)
        img.resize((w, h), Image.LANCZOS).save(os.path.join(HERE, d, 'card.webp'), 'WEBP', quality=74, method=6)
        print('карточка  %s/card.webp  (%dx%d — впиши эти числа в карточку)' % (d, w, h))


def galleries():
    """Галерея архивных фото на странице здания — необязательный блок.

       Кладёшь снимки в <папка здания>/gallery-source/что-угодно.jpg —
       имя файла станет и именем в gallery/, и его нужно будет
       подставить в data-full/src на странице (см. docs/NOVOE-ZDANIE.md).
    """
    for d in sorted(os.listdir(HERE)):
        src_dir = os.path.join(HERE, d, 'gallery-source')
        if not os.path.isdir(src_dir):
            continue
        out_dir = os.path.join(HERE, d, 'gallery')
        os.makedirs(out_dir, exist_ok=True)
        for fname in sorted(os.listdir(src_dir)):
            base, ext = os.path.splitext(fname)
            if ext.lower() not in ('.jpg', '.jpeg', '.png', '.webp'):
                continue
            img = ImageOps.exif_transpose(Image.open(os.path.join(src_dir, fname))).convert('RGB')
            w, h = img.size
            full_w = min(1200, w)
            full = img.resize((full_w, round(h * full_w / w)), Image.LANCZOS)
            full.save(os.path.join(out_dir, base + '.webp'), 'WEBP', quality=76, method=6)
            s = min(w, h)
            thumb = ImageOps.fit(img, (s, s), Image.LANCZOS).resize((480, 480), Image.LANCZOS)
            thumb.save(os.path.join(out_dir, base + '-thumb.webp'), 'WEBP', quality=72, method=6)
            print('галерея  %s/gallery/%s.webp + %s-thumb.webp' % (d, base, base))


hero('hero-photo')
hero('hero-sketch')
cards()
galleries()
