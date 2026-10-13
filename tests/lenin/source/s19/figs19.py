"""s19: фигуры рисунка двигаются ЗАМЕТНО на телефоне (отзыв Нарека на iPhone после s18: «вообще не двигаются»).
Причина — размер: движение s18 задано в пикселях кадра (0,5–2 px), а кадр 768 px на телефоне ~0,62 css px на px кадра — сдвиг 0,3–1 css px
не видно. Здесь каждой фигуре — множитель движения от её размера и типа (восьмое число в figures.items, движок e1.23), а её маска и
рамка шире на столько же, сколько она может сдвинуться (иначе сдвиг «упирается» в край маски и фигура сминается).
Источник — s18 (маски frames/<кадр>_fig.png и рамки из building.json, сохранены в source/s19/figs18/ при первом запуске).
python3 figs19.py <tests/lenin> [--write]"""
import sys, json, math, re, shutil, numpy as np, cv2
from pathlib import Path
from PIL import Image
B = Path(sys.argv[1]); WRITE = '--write' in sys.argv
HERE = Path(__file__).parent; KEEP = HERE / 'figs18'
FR = ['lenin_1', 'lenin_2', 'lenin_3', 'lenin_4', 'lenin_6']
# множитель: h — высота рамки s18, px кадра; (делитель, мин, макс)
KA = {'sit': (10, 2.5, 4.5), 'stand': (13, 1.5, 2.8), 'chess': (40, 1.5, 2.3), 'pigeon': (16, 1.2, 2.4), 'balloon': (20, 1.2, 2.5),
      'leaf': (1e9, 1.6, 1.6), 'grass': (1e9, 1.6, 1.6)}
def ka_of(t, h):
    d, lo, hi = KA[t]; return round(min(hi, max(lo, h / d)), 2)
def reach(t, k):
    """наибольший сдвиг (px кадра) при множителе k — по figMotion движка e1.23: x, z, w × k; y × √k"""
    r = math.sqrt(k)
    H, V = {'sit': (0.85 * k, 0.5 * r + 0.7 * k), 'stand': (2.0 * k, 0.35 * r), 'chess': (2.7 * k, 0.8 * k + 0.35 * r),
            'pigeon': (1.5 * k, 1.6 * r + 1.5 * k), 'balloon': (1.8 * k, 0.5 * r), 'leaf': (2.0 * k, 1.1 * r), 'grass': (1.7 * k, 0.0)}[t]
    return max(H, V)
def main():
    txt = (B / 'building.json').read_text(encoding='utf-8'); bj = json.loads(txt)
    KEEP.mkdir(exist_ok=True)
    rep = {}
    for i, n in enumerate(FR):
        fr = next(f for f in bj['frames'] if f['name'] == n)
        src_png = KEEP / (n + '_fig.png'); src_js = KEEP / (n + '_items.json')
        if not src_png.exists():   # первый запуск: s18 как исходник (повторный запуск не наращивает маски)
            shutil.copy(B / 'frames' / (n + '_fig.png'), src_png); src_js.write_text(json.dumps(fr['figures']['items']))
        m18 = np.asarray(Image.open(src_png).convert('L')).astype(np.float32) / 255
        items = json.loads(src_js.read_text())
        H, W = m18.shape
        out = np.zeros_like(m18); new = []; rr = []
        for it in items:
            x0, y0, x1, y1 = int(round(it[0] * W)), int(round(it[1] * H)), int(round(it[2] * W)), int(round(it[3] * H))
            t = it[4]; h = y1 - y0; k = ka_of(t, h); g = int(math.ceil(reach(t, k))) + 1
            part = np.zeros_like(m18); part[y0:y1, x0:x1] = m18[y0:y1, x0:x1]
            core = (part > 0.3).astype(np.uint8)
            ker = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * g + 1, 2 * g + 1))
            dil = cv2.dilate(core, ker).astype(np.float32)
            soft = cv2.GaussianBlur(dil, (0, 0), max(1.0, g / 2.5))
            soft = np.clip(np.maximum(soft * 1.15, part), 0, 1)   # у фигуры — 1, к краю кольца — плавно в 0
            bx0, by0, bx1, by1 = max(0, x0 - g - 2), max(0, y0 - g - 2), min(W, x1 + g + 2), min(H, y1 + g + 2)
            clip = np.zeros_like(soft); clip[by0:by1, bx0:bx1] = soft[by0:by1, bx0:bx1]
            out = np.maximum(out, clip)
            lay = it[6] if len(it) > 6 else 0
            new.append([round(bx0 / W, 5), round(by0 / H, 5), round(bx1 / W, 5), round(by1 / H, 5), t, it[5], lay, k])
            rr.append(dict(type=t, h=h, ka=k, ring_px=g))
        out[out < 0.02] = 0
        rep[n] = dict(n=len(new), mask_px_s18=int((m18 > 0.02).sum()), mask_px_s19=int((out > 0.02).sum()), figs=rr)
        print(n, len(new), 'mask px', rep[n]['mask_px_s18'], '->', rep[n]['mask_px_s19'], 'ka', sorted(set((r['type'], r['ka']) for r in rr)))
        if WRITE:
            Image.fromarray(np.clip(np.round(out * 255), 0, 255).astype(np.uint8), 'L').save(B / 'frames' / (n + '_fig.png'), optimize=True)
            # building.json: заменить список items этого кадра текстом (оформление файла не трогаем)
            m = re.search(r'"name":\s*"%s"' % n, txt); fs = txt.index('"figures"', m.end())
            a = txt.index('[', fs); d = 0
            for e in range(a, len(txt)):
                if txt[e] == '[': d += 1
                elif txt[e] == ']':
                    d -= 1
                    if d == 0: break
            ind = '      '
            body = '[\n' + ',\n'.join(ind + '  ' + json.dumps(x, ensure_ascii=False) for x in new) + '\n' + ind + ']'
            txt = txt[:a] + body + txt[e + 1:]
    if WRITE:
        json.loads(txt); (B / 'building.json').write_text(txt, encoding='utf-8')
    (B / 'report/s19').mkdir(parents=True, exist_ok=True)
    json.dump(rep, open(B / 'report/s19/figures_s19.json', 'w'), indent=1, ensure_ascii=False)
main()
