#!/usr/bin/env python3
"""s23: GIF «до | после» 10 с бури, масштаб iPhone (1 css px = 1 px GIF), полоса кадра с кронами (+ запас).
   python3 gif23.py <before_run> <after_run> <crowns_dir> <out_dir>"""
import sys, json
import numpy as np
from PIL import Image, ImageDraw
sys.path.insert(0, __file__.rsplit('/', 1)[0])
from ana23 import screen_mask, NAMES

def main():
    b4, af, cr, out = sys.argv[1:5]
    for fi, name in enumerate(NAMES):
        d0, d1 = f'{b4}/f{fi + 1}', f'{af}/f{fi + 1}'
        mp = json.load(open(f'{d1}/map.json'))
        cm = np.array(Image.open(f'{cr}/crown_{name}.png')) > 127
        cs = screen_mask(cm, mp)
        ys = np.nonzero(cs.any(1))[0]
        y0, y1 = max(0, ys.min() - 40), min(844, ys.max() + 30)
        if y1 - y0 > 520:   # высокие кроны (кадр 4): верхняя часть, где качание сильнее
            y1 = y0 + 520
        frames = []
        for i in range(100):
            a = Image.open(f'{d0}/{i:03d}.png').convert('RGB').crop((0, y0, 390, y1))
            b = Image.open(f'{d1}/{i:03d}.png').convert('RGB').crop((0, y0, 390, y1))
            im = Image.new('RGB', (786, y1 - y0 + 18), (250, 246, 238)); im.paste(a, (0, 18)); im.paste(b, (396, 18))
            dr = ImageDraw.Draw(im); dr.text((6, 3), 'before (e1.25)', fill=(90, 40, 30)); dr.text((402, 3), 'after (e1.26)', fill=(30, 80, 30))
            frames.append(im)
        pal = frames[50].quantize(colors=160, method=Image.MEDIANCUT)
        q = [f.quantize(palette=pal, dither=Image.NONE) for f in frames]
        p = f'{out}/wind_gale_f{fi + 1}_before_after_10s.gif'
        q[0].save(p, save_all=True, append_images=q[1:], duration=100, loop=0, optimize=True)
        print(p, y0, y1)

if __name__ == "__main__":
    main()
