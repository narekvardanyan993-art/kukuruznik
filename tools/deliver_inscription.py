#!/usr/bin/env python3
"""Доставка купленной надписи (продажа мест, Polar org Chka): правка Gemini → кадры здания + building.json.

  python3 tools/deliver_inscription.py <здание> <место> <правка_Gemini.jpg> "<ТЕКСТ>" [--id aram-liana] [--dry-run]

место — id из chka-kitchen/money/spots/spots.json (A1…F2): кадр, crop_box 640×640 в высоком кадре pogos-petros/frames/<КАДР>.png.
Правка Gemini — ответ на spots/PROMPT.md с вложенным <место>_crop.png (вырезка тех же 640×640).
1) правка совмещается с вырезкой (масштаб + ECC), надпись = где правка заметно отличается от вырезки (в круге радиусом ~0,45 вырезки,
   края мягкие); переносится как ОТНОШЕНИЕ яркостей (бороздки темнее, сколы светлее) — одинаково ложится на день, ночь, закат;
2) применяется ко всем картинкам кадра в tests/<здание>/frames/: <кадр>.webp, _bg, _building (только где слой непрозрачен), _night, _sunset;
   оригиналы — в pogos-petros/build/source/insc/<id>/ (повторный запуск с тем же id берёт оригиналы — без двойной надписи);
3) building.json: inscriptions += {id, frame, u, v, text}, sale.left -= 1 (если ещё не было такого id).
Личная ссылка покупателя: https://chka.am/<здание>/?n=<id> (после publish_building).
Пример отчёта-листа: pogos-petros/build/report/insc/<id>.jpg (вырезка | правка | маска | результат)."""
import sys, json, re, shutil, argparse, random, string
from pathlib import Path
import numpy as np, cv2
from PIL import Image
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'pogos-petros/build/scripts')); import fix15
KIT = next(p for p in (Path.home() / 'Documents/chka-kitchen', Path.home() / 'mnt/chka-kitchen') if p.exists())

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('building'); ap.add_argument('spot'); ap.add_argument('edit'); ap.add_argument('text')
    ap.add_argument('--id'); ap.add_argument('--dry-run', action='store_true'); a = ap.parse_args()
    spots = {s['id']: s for s in json.load(open(KIT / 'money/spots/spots.json'))}; sp = spots[a.spot]
    iid = a.id or (re.sub(r'[^a-z0-9]+', '-', a.text.lower()).strip('-')[:24] + '-' + ''.join(random.choice(string.ascii_lowercase + string.digits) for _ in range(4)))
    crop = np.array(Image.open(KIT / 'money/spots' / sp['crop']).convert('RGB')); ch, cw = crop.shape[:2]
    G = np.array(Image.open(a.edit).convert('RGB')); tm, cc, W = fix15.locate(G, crop); g = fix15.warp_to(G, W, cw, ch)
    d = np.abs(g.astype(np.float32) - crop.astype(np.float32)).max(-1)
    circ = np.zeros((ch, cw), np.uint8); cv2.circle(circ, (cw // 2, ch // 2), int(0.45 * min(cw, ch)), 1, -1)
    m0 = ((d > 30) & (circ > 0)).astype(np.uint8); m0 = cv2.morphologyEx(m0, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    n, lab, stt, _ = cv2.connectedComponentsWithStats(cv2.dilate(m0, np.ones((25, 25), np.uint8)), 8)
    j = 1 + int(np.argmax(stt[1:, cv2.CC_STAT_AREA])) if n > 1 else 0          # самое крупное пятно правки = надпись
    m = np.zeros_like(m0)
    if j:
        x, y, w2, h2 = stt[j, :4]; pad = 12
        cv2.rectangle(m, (max(0, x - pad), max(0, y - pad)), (min(cw - 1, x + w2 + pad), min(ch - 1, y + h2 + pad)), 1, -1)
    al = np.clip(cv2.GaussianBlur(m.astype(np.float32), (0, 0), 8.0) * 1.2, 0, 1)   # мягкий прямоугольник вокруг надписи
    lc = cv2.cvtColor(crop, cv2.COLOR_RGB2LAB)[..., 0].astype(np.float32) + 8; lg = cv2.cvtColor(g, cv2.COLOR_RGB2LAB)[..., 0].astype(np.float32) + 8
    ratio = 1 + (np.clip(lg / lc, 0.35, 1.8) - 1) * al                                   # отношение яркостей в высоком разрешении
    x0, y0, x1, y1 = sp['crop_box']; FWh, FHh = sp['frame_size']
    fdir = ROOT / 'tests' / a.building / 'frames'; fr = sp['frame'].lower(); pre = ROOT / 'pogos-petros/build/source/insc' / iid
    files = [p for p in [fdir / f'pogos_{fr}.webp', fdir / f'pogos_{fr}_bg.webp', fdir / f'pogos_{fr}_building.webp', fdir / f'pogos_{fr}_night.webp', fdir / f'pogos_{fr}_sunset.webp'] if p.exists()]
    rep = REPDIR = ROOT / 'pogos-petros/build/report/insc'; REPDIR.mkdir(parents=True, exist_ok=True)
    done = []
    for p in files:
        src = pre / p.name if (pre / p.name).exists() else p
        im = Image.open(src); mode = im.mode; arr = np.array(im.convert('RGBA' if 'A' in mode else 'RGB')).astype(np.float32)
        H, Wd = arr.shape[:2]; s = Wd / FWh
        bx0, by0, bx1, by1 = int(round(x0 * s)), int(round(y0 * s)), int(round(x1 * s)), int(round(y1 * s))
        size = (bx1 - bx0, by1 - by0); sub = arr[by0:by1, bx0:bx1]
        op = sub[..., 3:4] / 255.0 if sub.shape[-1] == 4 else np.ones(sub.shape[:2] + (1,), np.float32)   # слой здания — только где непрозрачен
        if p.name.endswith(('_night.webp', '_sunset.webp')):   # ночь/закат: отношение яркостей (бороздки темнее в своём свете)
            r = cv2.resize(ratio, size, interpolation=cv2.INTER_AREA)[..., None]
            sub[..., :3] = np.clip(sub[..., :3] * (1 + (r - 1) * op), 0, 255)
        else:                                                   # день: сами пиксели правки по маске
            gg = cv2.resize(g, size, interpolation=cv2.INTER_AREA).astype(np.float32); aa = cv2.resize(al, size, interpolation=cv2.INTER_AREA)[..., None] * op
            sub[..., :3] = sub[..., :3] * (1 - aa) + gg * aa
        arr[by0:by1, bx0:bx1] = sub
        if not a.dry_run:
            pre.mkdir(parents=True, exist_ok=True)
            if not (pre / p.name).exists(): shutil.copy2(p, pre / p.name)
            Image.fromarray(arr.astype(np.uint8), 'RGBA' if arr.shape[-1] == 4 else 'RGB').save(p, quality=92, method=6)
        done.append(p.name)
    out = (crop.astype(np.float32) * (1 - al[..., None]) + g.astype(np.float32) * al[..., None]).clip(0, 255).astype(np.uint8)
    Image.fromarray(np.concatenate([crop, g, (np.dstack([al] * 3) * 255).astype(np.uint8), out], 1)).resize((1280, 320)).save(REPDIR / f'{iid}.jpg', quality=85)
    bj = ROOT / 'tests' / a.building / 'building.json'; b = json.load(open(bj)); ins = b.setdefault('inscriptions', [])
    u = round((x0 + x1) / 2 / FWh, 4); v = round((y0 + y1) / 2 / FHh, 4)
    bl = fdir / f'pogos_{fr}_building.webp'; layer = 'bg'
    if bl.exists():
        ba = np.array(Image.open(bl).convert('RGBA'))[..., 3]; layer = 'building' if ba[int(v * ba.shape[0]), int(u * ba.shape[1])] > 128 else 'bg'
    import datetime
    if not any(x['id'] == iid for x in ins):
        ins.append({'id': iid, 'frame': f'pogos_{fr}', 'u': u, 'v': v, 'text': a.text[:24], 'year': str(datetime.date.today().year), 'layer': layer, 'note': 'место %s' % a.spot})
        if 'sale' in b and b['sale'].get('left', 0) > 0: b['sale']['left'] -= 1
    if not a.dry_run: open(bj, 'w').write(json.dumps(b, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'id': iid, 'files': done, 'tm': round(tm, 3), 'ecc': round(cc, 3), 'mask_px': int(m.sum()), 'link': f'https://chka.am/{a.building}/?n={iid}', 'left': b.get('sale', {}).get('left'), 'sheet': str(REPDIR / f"{iid}.jpg"), 'dry_run': a.dry_run}, ensure_ascii=False))

if __name__ == '__main__': main()
