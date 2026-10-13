"""s17 шаг 1: детали из правок Gemini -> патчи RGBA (source/s17/patches/<кадр>.png).
Gemini (pro.gemini.one1, «Создание изображений», 3.8 Flash) правил ДНЕВНОЙ кадр s15 целиком; полные ответы — ~/Documents/chka-kitchen/lenin-s17/gem/.
Здесь: выравнивание (масштаб + ECC) -> отбор новых объектов в пустых местах (gpaste.detect) -> пиксели Gemini с подгонкой тона по кольцу -> патч.
python3 make_patches.py <tests/lenin> <папка с ответами Gemini>"""
import sys, json, numpy as np
from pathlib import Path
from PIL import Image
sys.path.insert(0, str(Path(__file__).parent))
import align, gpaste, common
B = Path(sys.argv[1]); G = Path(sys.argv[2]); OUT = Path(__file__).parent / 'patches'; OUT.mkdir(exist_ok=True)
# лучший вариант на кадр (выбран глазами по листам до/после) и настройки отбора
PICK = {
    'lenin_1': ('g1_v2.jpg', dict(dark_t=8, de_t=8, group=4, hmax=70, wmax=90, empty_frac=0.3)),
    'lenin_2': ('g2_v1.jpg', dict(dark_t=8, de_t=8, group=2)),
    'lenin_3': ('g3_v3.jpg', dict(dark_t=8, de_t=8, empty_frac=0.25, hmax=95, wmax=120)),
    'lenin_4': ('g4_v2.jpg', dict(dark_t=8, de_t=8, empty_frac=0.0, thin_pass=True)),   # крупный план: только текстуры на постаменте
    'lenin_6': ('g5_v1.jpg', dict(dark_t=8, de_t=8, group=2)),
}
stats = {}
for n, (g, kw) in PICK.items():
    o = common.load(str(B), n)
    w, cc, M = align.align(o, np.asarray(Image.open(G / g).convert('RGB')))
    fb, _ = common.forbid2(str(B), n)
    keep, info, rej = gpaste.detect(o, w, fb, **kw)
    out, a = gpaste.paste(o, w, keep)
    a = a * ~fb                                   # вне разрешённого — никогда
    rgb = np.clip(np.round(gpaste.paste.wc), 0, 255).astype(np.uint8); rgb[a <= 0] = 0   # пусто вне патча — файл маленький
    rgba = np.dstack([rgb, np.clip(np.round(a * 255), 0, 255).astype(np.uint8)])
    Image.fromarray(rgba, 'RGBA').save(OUT / (n + '.png'), optimize=True)
    stats[n] = dict(gemini=g, ecc=round(cc, 4), objects=len(info), patch_px=int((a > 0.01).sum()), rejected={k: v for k, v in rej.items() if k != 'L'})
    print(n, stats[n], flush=True)
json.dump(stats, open(OUT / 'patches.json', 'w'), indent=1, ensure_ascii=False)
