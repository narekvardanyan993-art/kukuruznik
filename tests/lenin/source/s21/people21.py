"""s21: оживление мелких людей видео (motionVideo, MV_DELTA), а не сдвигом фигур.
Ролик Flow (Veo 3.1 Fast, первый = последний кадр = увеличенный кусок рисунка, refs/s21/in/<место>.png) → уменьшение до размера куска
→ совмещение с первым кадром ролика по неподвижному фону (ECC, сдвиг) → отличие кадра ролика от его начала (= рисунок) →
только внутри мягкой маски людей (то, что реально двигалось, ∩ зона места, без «запретных» прямоугольников — то, что на рисунке перед
людьми, например парапет: нога, ушедшая за него, прячется) → полный кадр 768×1364, серый 128 = «как на рисунке» + калибровочная полоска
(tools/cinemagraph.py) → ролик: замедленный клип + пауза (рисунок) → петля без шва.
Несколько мест на кадре — каждое со своей задержкой в петле (не синхронно). Один ролик на кадр.
python3 people21.py <spec.json> → frames/<кадр>_motion_<k>.mp4/.webm, frames/<кадр>_motion_mask.png, report/s21/<кадр>_people_*"""
import sys, json, math, numpy as np, cv2
from pathlib import Path
from PIL import Image
from scipy import ndimage
B = Path(__file__).resolve().parents[1].parent; ROOT = B.parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
import cinemagraph as CG
W, H2, FPS = 768, 1364, 20
HF = 1365   # высота кадра; ролик 1364 (чётная для H.264) — отличие ДОЛЖНО быть пережато 1365→1364, иначе на y≈950 сдвиг 0,7 px
# и тонкие линии людей не гасятся (светлый контур-призрак и «прозрачное» тело в настоящем рендере, s21)
def rd(p, mode='RGB'): return np.asarray(Image.open(p).convert(mode))
def frames(path, w, h):
    cap = cv2.VideoCapture(str(path)); fps = cap.get(cv2.CAP_PROP_FPS) or 24; out = []
    while True:
        ok, f = cap.read()
        if not ok: break
        out.append(cv2.resize(f[..., ::-1], (w, h), interpolation=cv2.INTER_AREA).astype(np.float32))
    return out, fps
def lab(a): return cv2.cvtColor(np.clip(a, 0, 255).astype(np.uint8), cv2.COLOR_RGB2LAB).astype(np.float32)
def place(spec_place, drawing):
    x, y, w, h = spec_place['crop']
    fr, sfps = frames(B / spec_place['clip'], w, h)
    if 'range' in spec_place: fr = fr[spec_place['range'][0]:spec_place['range'][1]]   # только удачный кусок ролика (дальше Veo портит)
    g = [cv2.cvtColor(f.astype(np.uint8), cv2.COLOR_RGB2GRAY).astype(np.float32) / 255 for f in fr]
    std = np.std(np.stack(g), 0); static = (std < 0.02).astype(np.uint8)
    al = [fr[0]]
    for t in range(1, len(fr)):
        M = np.eye(2, 3, dtype=np.float32)
        try: _, M = cv2.findTransformECC(g[0], g[t], M, cv2.MOTION_TRANSLATION, (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 60, 1e-5), static, 3)
        except cv2.error: pass
        al.append(cv2.warpAffine(fr[t], M, (w, h), flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP, borderMode=cv2.BORDER_REPLICATE))
    base = (al[0] + al[1]) / 2
    # s21 (после первого рендера): чистая разница «кадр − начало ролика» оставляла призрак (голова на старом месте), потому что
    # начало ролика Veo ≠ рисунку пиксель в пиксель. Теперь: ролик совмещается с РИСУНКОМ (ECC, аффинно) и подгоняется по цвету
    # (линейно по каналам на неподвижном фоне), а в кадре берётся пиксель ролика там, где он отличается от начала (вес по ΔE),
    # иначе — рисунок. Ушедшая голова → стена из ролика, а не «рисунок минус голова».
    ref = drawing[y:y + h, x:x + w]
    gb = cv2.cvtColor(base.astype(np.uint8), cv2.COLOR_RGB2GRAY).astype(np.float32) / 255
    gr = cv2.cvtColor(ref.astype(np.uint8), cv2.COLOR_RGB2GRAY).astype(np.float32) / 255
    M = np.eye(2, 3, dtype=np.float32)
    try: _, M = cv2.findTransformECC(gr, gb, M, cv2.MOTION_AFFINE, (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 200, 1e-6), static, 3)
    except cv2.error: pass
    warp = lambda a: cv2.warpAffine(a, M, (w, h), flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP, borderMode=cv2.BORDER_REPLICATE)
    al = [warp(a) for a in al]; base = warp(base)
    st = static.astype(bool) & (cv2.erode(static, np.ones((5, 5), np.uint8)) > 0)
    for c in range(3):
        A = np.vstack([base[..., c][st], np.ones(st.sum())]).T
        k_, b_ = np.linalg.lstsq(A, ref[..., c][st], rcond=None)[0]
        for a in al: a[..., c] = a[..., c] * k_ + b_
        base[..., c] = base[..., c] * k_ + b_
    L0 = lab(base); dmax = np.zeros((h, w), np.float32); WT = []
    for a in al:
        de = np.linalg.norm(lab(a) - L0, axis=2); dmax = np.maximum(dmax, de)
        WT.append(np.clip((cv2.GaussianBlur(ndimage.grey_dilation(de, size=(5, 5)), (0, 0), 1.5) - 6) / 12, 0, 1))
    WT = [np.mean(WT[max(0, t - 2):t + 3], 0) for t in range(len(WT))]      # без мерцания веса
    D = [(a - ref) * wt[..., None] for a, wt in zip(al, WT)]
    zone = np.zeros((h, w), np.float32)
    for zx0, zy0, zx1, zy1 in spec_place['zones']:      # в координатах кадра
        zone[max(0, zy0 - y):max(0, zy1 - y), max(0, zx0 - x):max(0, zx1 - x)] = 1
    for zx0, zy0, zx1, zy1 in spec_place.get('forbid', []):
        zone[max(0, zy0 - y):max(0, zy1 - y), max(0, zx0 - x):max(0, zx1 - x)] = 0
    zone = cv2.GaussianBlur(zone, (0, 0), 0.8); zone[:2] = zone[-2:] = 0; zone[:, :2] = zone[:, -2:] = 0
    D = [d * zone[..., None] for d in D]
    m = np.clip(np.max(np.stack(WT), 0) * zone, 0, 1)
    m = np.maximum(m, cv2.GaussianBlur(cv2.dilate((m > 0.02).astype(np.float32), np.ones((5, 5), np.uint8)), (0, 0), 1.0) * zone)
    # амплитуда: оптический поток от начала к каждому кадру (px кадра), в маске
    amp = []
    b8 = cv2.cvtColor(base.astype(np.uint8), cv2.COLOR_RGB2GRAY)
    for a in al[::4]:
        fl = cv2.calcOpticalFlowFarneback(b8, cv2.cvtColor(a.astype(np.uint8), cv2.COLOR_RGB2GRAY), None, 0.5, 5, 21, 5, 7, 1.5, 0)
        mag = np.hypot(fl[..., 0], fl[..., 1])[m > 0.5]
        amp.append(float(np.percentile(mag, 99)) if mag.size else 0)
    # размах (s21): насколько далеко от силуэта человека в покое уходит изменившийся пиксель (рука, голова) — px кадра.
    # Поток Фарнебэка на тонких руках в 1–2 px занижает в разы, поэтому главный замер — этот.
    Lb = lab(base); bgb = lab(cv2.medianBlur(np.clip(base, 0, 255).astype(np.uint8), 15).astype(np.float32))
    sil = (np.linalg.norm(Lb - bgb, axis=2) > 14) & (zone > 0.5)
    dist = ndimage.distance_transform_edt(~sil) if sil.any() else np.zeros((h, w))
    reach = 0.0
    for a, wt in zip(al, WT):
        ch = (np.linalg.norm(lab(a) - Lb, axis=2) > 20) & (wt > 0.5) & (zone > 0.5)
        ch = ndimage.binary_opening(ch, iterations=1)
        if ch.any(): reach = max(reach, float(np.percentile(dist[ch], 99)))
    # дрейф вне маски (рисунок плывёт?)
    out_m = (cv2.dilate((m > 0.02).astype(np.uint8), np.ones((9, 9), np.uint8)) == 0)
    drift = max(float(np.abs(d[out_m]).mean()) for d in D)
    return dict(x=x, y=y, w=w, h=h, D=D, m=m, sfps=sfps, amp=max(amp), reach=reach, drift=drift, n=len(D))
def encode_hq(out, mp4, crf=18, wcrf=24, max_kb=900, raw=None):
    """как tools/cinemagraph.encode (пометка цвета BT.709 + sRGB), но качество выше: у людей отличие от рисунка большое
    (тёмная голова ↔ светлая стена), при crf 30/40 на месте ушедшей головы оставалось светлое «пятно-призрак» из шума сжатия."""
    import subprocess, tempfile
    tmp = Path(tempfile.mkdtemp())
    if raw is None:
        raw = tmp / 'out.rgb'
        with open(raw, 'wb') as fh:
            for f in out: fh.write(f.tobytes())
    inp = ['-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', '%dx%d' % (W, H2), '-framerate', str(FPS), '-i', str(raw)]
    col = ['-vf', 'scale=out_color_matrix=bt709:out_range=tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'iec61966-2-1', '-color_range', 'tv']
    while True:
        subprocess.run(['ffmpeg', '-v', 'error', '-y'] + inp + col + ['-an', '-c:v', 'libx264', '-profile:v', 'baseline', '-level', '3.1', '-pix_fmt', 'yuv420p', '-crf', str(crf), '-preset', 'medium', '-movflags', '+faststart', str(mp4)], check=True)
        if mp4.stat().st_size <= max_kb * 1024 or crf >= 30: break
        crf += 2
    webm = mp4.with_suffix('.webm')
    while True:
        subprocess.run(['ffmpeg', '-v', 'error', '-y'] + inp + col + ['-an', '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', str(wcrf), '-pix_fmt', 'yuv420p', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '5', str(webm)], check=True)
        if webm.stat().st_size <= max_kb * 1024 or wcrf >= 40: break
        wcrf += 3
    Path(raw).unlink(); tmp.rmdir()
    return crf, wcrf
def main():
    spec = json.load(open(sys.argv[1])); name = spec['frame']
    drawing = rd(B / spec['drawing']).astype(np.float32)
    P = [place(p, drawing) for p in spec['places']]
    speed = spec.get('speed', 0.8); rest = spec.get('rest', 6.0)
    seg = [int(round(p['n'] / p['sfps'] / speed * FPS)) for p in P]
    total = int(round(max(s + int(pl.get('delay', 0) * FPS) for s, pl in zip(seg, spec['places'])) + rest * FPS))
    mask = np.zeros((HF, W), np.float32)
    base, bmask = None, None
    if spec.get('base'):   # у кадра уже есть ролик (листва/вода): люди добавляются в ТОТ ЖЕ ролик (один ролик на кадр), петля = кратна его длине
        cap = cv2.VideoCapture(str(B / spec['base']['video'])); base = []
        while True:
            ok, f = cap.read()
            if not ok: break
            base.append(f[..., ::-1].copy())
        bmask = cv2.resize(rd(B / spec['base']['mask'], 'LA')[..., 1].astype(np.float32) / 255, (W, HF), interpolation=cv2.INTER_LINEAR)
        total = int(math.ceil(total / len(base)) * len(base))
        mask = np.maximum(mask, bmask)
    for p in P: mask[p['y']:p['y'] + p['h'], p['x']:p['x'] + p['w']] = np.maximum(mask[p['y']:p['y'] + p['h'], p['x']:p['x'] + p['w']], p['m'])
    import tempfile
    rawp = Path(tempfile.mkdtemp()) / 'out.rgb'; fh = open(rawp, 'wb'); keep = {}
    idx = set(np.linspace(0, total - 1, 12).astype(int).tolist())
    for t in range(total):
        o = np.full((HF, W, 3), 128.0, np.float32)
        for p, pl, s in zip(P, spec['places'], seg):
            k = t - int(pl.get('delay', 0) * FPS)
            if k < 0 or k >= s: continue
            src = k / FPS * speed * p['sfps']; i0 = int(src); fa = src - i0
            d = p['D'][min(i0, p['n'] - 1)] * (1 - fa) + p['D'][min(i0 + 1, p['n'] - 1)] * fa
            ramp = min(1.0, k / 6, (s - 1 - k) / 6)
            sl = (slice(p['y'], p['y'] + p['h']), slice(p['x'], p['x'] + p['w']))
            o[sl] += d * ramp
        o = cv2.resize(o, (W, H2), interpolation=cv2.INTER_AREA)   # сетка кадра 1365 → сетка ролика 1364
        if base is not None: o = o + base[t % len(base)].astype(np.float32) - 128   # ролик кадра (листва) уже в сетке 1364
        o = np.clip(o + 0.5, 0, 255).astype(np.uint8)
        o = CG.draw_cal(o.copy(), W, H2); fh.write(o.tobytes())
        if t in idx: keep[t] = o
    fh.close(); out = keep
    fd = B / 'frames'; k = spec.get('k', 1)
    mp4 = fd / f'{name}_motion_{k}.mp4'
    c1, c2 = encode_hq(None, mp4, crf=spec.get('crf', 18), wcrf=spec.get('wcrf', 24), raw=rawp)
    mask = cv2.resize(mask, (W, H2), interpolation=cv2.INTER_AREA); mask[H2 - CG.CAL_ROWS - 2:] = 0
    Image.fromarray(np.dstack([np.full((H2, W), 255, np.uint8), np.clip(mask * 255 + 0.5, 0, 255).astype(np.uint8)]), 'LA').save(fd / f'{name}_motion_mask.png')
    rep = B / 'report/s21'
    st = dict(base=spec.get('base'), frame=name, seconds=round(total / FPS, 2), speed=speed, rest=rest, crf=[c1, c2], mp4_kb=mp4.stat().st_size // 1024,
              webm_kb=mp4.with_suffix('.webm').stat().st_size // 1024, mask_px=int((mask > 0.5).sum()),
              places=[dict(name=pl.get('name', ''), clip=pl['clip'], reach_px_frame=round(p['reach'], 1), flow_p99_px_frame=round(p['amp'], 1), drift=round(p['drift'], 2), delay=pl.get('delay', 0)) for p, pl in zip(P, spec['places'])])
    json.dump(st, open(rep / f'{name}_people_stats.json', 'w'), indent=1); print(json.dumps(st, ensure_ascii=False))
    # лист: рисунок + отличие, 12 кадров, увеличенные места
    idx = sorted(keep); tiles = []
    for p in P:
        for i in idx:
            v = np.clip(drawing[p['y']:p['y'] + p['h'], p['x']:p['x'] + p['w']] + out[i][p['y']:p['y'] + p['h'], p['x']:p['x'] + p['w']].astype(np.float32) - 128 * (mask[p['y']:p['y'] + p['h'], p['x']:p['x'] + p['w']] > -1)[..., None], 0, 255).astype(np.uint8)
            tiles.append(Image.fromarray(v).resize((p['w'] * 2, p['h'] * 2), Image.LANCZOS))
    tw = max(t.width for t in tiles); th = max(t.height for t in tiles)
    sheet = Image.new('RGB', (tw * 6, th * math.ceil(len(tiles) / 6)), 'white')
    for j, tl in enumerate(tiles): sheet.paste(tl, ((j % 6) * tw, (j // 6) * th))
    sheet.save(rep / f'{name}_people_sheet.jpg', quality=88)
if __name__ == "__main__": main()
