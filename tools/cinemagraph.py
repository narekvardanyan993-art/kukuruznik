#!/usr/bin/env python3
"""Синемаграф из роликов Veo (Flow «Frames to Video»: первый кадр = последний = рисунок) поверх полного рисунка (e1.16).

  python3 tools/cinemagraph.py tests/<здание> <кадр> clip1.mp4[,clip2.mp4…] [--fps 20] [--thr 9] [--crf 30] [--max-kb 600]
          [--exclude u0,v0,u1,v1;…] [--roads маска.png] [--allow маска.png] [--car-area 160] [--no-cars] [--report DIR]

e1.16 (круг s10): петли по полосам, дорисовка машин замороженными кусками и отдельный фоновый слой (s9) — убраны.
Каждый ролик сам начинается и кончается на рисунке (Flow: первый = последний кадр) → петля без шва, машины въезжают и уезжают
за край сами. Клипы не склеиваются и не дорисовываются: каждый клип — отдельный файл, движок после каждого круга берёт
случайный следующий (все стыкуются через рисунок).
1. Кадры клипа → размер кадра, совмещение с рисунком по контурам (по первому кадру клипа — он и есть рисунок).
2. Маска (общая на все клипы кадра): разброс яркости по времени > --thr в любом клипе (без слоя здания, водяного знака,
   рамок --exclude) ∪ дороги целиком (--roads, PNG кадра: машина не уходит «под рисунок» посреди улицы); --allow — готовая маска.
   Края мягкие (размытие), маска — в альфе PNG.
3. Кадр синемаграфа = рисунок, а там, где кадр клипа заметно отличается от медианы клипа по времени (то, что движется), —
   пиксель клипа (как s8): оттенок Veo и его «стоящие» объекты не попадают. Первые/последние 3 кадра плавно сводятся к рисунку
   (гарантия стыка; у годного клипа там и так ничего не движется).
4. Проверка брака (stats + печать): drift — насколько «плывёт» неподвижный рисунок; pop — капли-машины, появившиеся/пропавшие
   не у края маски/кадра (машина исчезла посреди дороги); new — площадь новых стоящих объектов (медиана клипа ≠ рисунок);
   edge_px — движение в первом/последнем кадре.
5. Вывод: frames/<кадр>_motion_<k>.mp4 (H.264 baseline, faststart, без звука), _motion_<k>.webm (VP9), _motion_<k>_cars.json
   (треки машин клипа для ночных фар: {"fps","n","k","ar","cars":[{"s","p":[[u,v,dx,dy,длина,ширина]…]}]}),
   общая frames/<кадр>_motion_mask.png. crf поднимается, пока mp4 ≤ --max-kb. Печатает готовый motionVideo для building.json.
"""
import json, math, subprocess, sys, tempfile
from pathlib import Path
import numpy as np
import cv2
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from gemini_road_mask import align  # noqa: E402


def read_frames(path, W, H, fps):
    tmp = Path(tempfile.mkdtemp())
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(path), '-vf', 'fps=%g,scale=%d:%d:flags=lanczos' % (fps, W, H), str(tmp / 'f_%04d.png')], check=True)
    fr = [np.asarray(Image.open(p).convert('RGB')) for p in sorted(tmp.glob('f_*.png'))]
    for p in tmp.glob('*'):
        p.unlink()
    tmp.rmdir()
    return fr


def track(D, allow, car_area, W, H, road=None, ct=14.0):
    """Капли движения (отличие от медианы) → треки. Машина: капля ≥ car_area px, ровная, ≥ 8 кадров, сдвиг ≥ 20 px, не быстрее 9 px/кадр."""
    T = len(D)
    done, act = [], []
    for t in range(T):
        fg = ((D[t].astype(np.float32) > ct) & allow).astype(np.uint8)
        fg = cv2.morphologyEx(fg, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
        n, lab, st, cen = cv2.connectedComponentsWithStats(fg)
        cs = [(i, st[i], cen[i]) for i in range(1, n) if st[i][4] >= max(30, car_area * 0.2)]
        used, nxt = {}, []
        for tr in act:
            pr = np.array(tr['pts'][-1][:2]) + tr['v']
            best, bd = None, 1e9
            for j, (i, s, c) in enumerate(cs):
                d = math.hypot(*(c - pr)); r = 10 + 0.6 * math.hypot(*tr['v']) + 0.25 * math.sqrt(s[4])
                if d < r and d < bd:
                    bd, best = d, j
            if best is None:
                tr['end'] = t - 1; done.append(tr); continue
            used.setdefault(best, []).append(tr)
        for j, trs in used.items():
            i, s, c = cs[j]
            if len(trs) > 1:                 # слияние двух капель: обе машины «сквозь друг друга» — дальше не ведём
                for tr in trs:
                    tr['end'] = t - 1; tr['merged'] = True; done.append(tr)
                continue
            tr = trs[0]
            tr['v'] = 0.6 * tr['v'] + 0.4 * (c - np.array(tr['pts'][-1][:2]))
            x, y, w, h = s[:4]
            tr['pts'].append((c[0], c[1], s[4], x, y, w, h, lab[y:y + h, x:x + w] == i))
            nxt.append(tr)
        for j, (i, s, c) in enumerate(cs):
            if j not in used:
                x, y, w, h = s[:4]
                nxt.append({'t0': t, 'v': np.zeros(2), 'pts': [(c[0], c[1], s[4], x, y, w, h, lab[y:y + h, x:x + w] == i)]})
        act = nxt
    for tr in act:
        tr['end'] = T - 1; done.append(tr)
    dist = cv2.distanceTransform(np.pad(allow, 1).astype(np.uint8), cv2.DIST_L2, 3)[1:-1, 1:-1]
    cars, pops = [], []
    for tr in done:
        P = tr['pts']
        if len(P) < 8:
            continue
        med = float(np.median([p[2] for p in P]))
        C = np.array([p[:2] for p in P], np.float32)
        spd = np.hypot(*np.diff(C, axis=0).T)
        A_ = np.array([p_[2] for p_ in P], np.float32)
        if med < car_area or math.hypot(*(C[-1] - C[0])) < 20 or spd.mean() > 9:
            continue
        if A_.std() / A_.mean() > 0.4 or np.mean([p_[7].mean() for p_ in P]) < 0.5:
            continue                       # стая голубей: капля меняет площадь и форму, «дырявая» — не машина
        if road is None or np.mean([road[int(min(H - 1, p[1])), int(min(W - 1, p[0]))] for p in P]) < 0.8:
            continue                       # машина — только та, что едет по дороге (голуби, листва, люди на тротуаре — не машины: фар им не надо)

        def edge(p):   # у края кадра или у края маски (дерево, здание, конец дороги), или видна не целиком
            cx, cy, a, x, y, w, h, _ = p
            return x <= 2 or y <= 2 or x + w >= W - 2 or y + h >= H - 2 or dist[int(min(H - 1, cy)), int(min(W - 1, cx))] < 0.9 * math.sqrt(med) + 10 or a < 0.5 * med
        tr['med'] = med
        if not tr.get('merged'):
            for p_, kind, tt in ((P[0], 'in', tr['t0']), (P[-1], 'out', tr['end'])):
                if not edge(p_):
                    pops.append([kind, int(tt), round(float(p_[0]) / W, 3), round(float(p_[1]) / H, 3)])
        cars.append(tr)
    return cars, pops


def cars_json(cars, W, H, fps, T, KS=2):
    out = []
    for tr in sorted(cars, key=lambda t: t['t0']):
        P = tr['pts']; C = np.array([p[:2] for p in P], np.float32); pts = []
        for j in range(0, len(P), KS):
            j0, j1 = max(0, j - 3), min(len(P) - 1, j + 3)
            dv = C[j1] - C[j0]; nv = float(np.hypot(*dv)) or 1.0; ux, uy = dv / nv
            p = P[j]; ys, xs = np.nonzero(p[7]); xs = xs + p[3] - p[0]; ys = ys + p[4] - p[1]
            pr = xs * ux + ys * uy; qr = -xs * uy + ys * ux
            ln = float(np.percentile(pr, 95) - np.percentile(pr, 5)) if len(pr) > 4 else 10.0
            wd = float(np.percentile(qr, 95) - np.percentile(qr, 5)) if len(qr) > 4 else 6.0
            pts.append([round(float(C[j][0]) / W, 4), round(float(C[j][1]) / H, 4), round(float(ux), 3), round(float(uy), 3), round(ln / W, 4), round(wd / W, 4)])
        out.append({'s': int(tr['t0']), 'p': pts})
    return {'fps': fps, 'n': T, 'k': KS, 'ar': round(W / H, 5), 'cars': out}


def encode(out, fps, path_mp4, crf, max_kb, W2, H2):
    tmp = Path(tempfile.mkdtemp()); raw = tmp / 'out.rgb'
    with open(raw, 'wb') as fh:
        for f in out:
            fh.write(f.tobytes())
    inp = ['-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', '%dx%d' % (W2, H2), '-framerate', '%g' % fps, '-i', str(raw)]
    # s10 «G бледный»: видео без пометки цвета iPhone считает BT.709 с гаммой ~1.96 и при выводе на экран осветляет (Apple «washed out»)
    # относительно картинок кадра (sRGB). Матрица BT.709 явно + пометка «передаточная функция sRGB» — видео = рисунок по цвету и яркости.
    col = ['-vf', 'scale=out_color_matrix=bt709:out_range=tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'iec61966-2-1', '-color_range', 'tv']
    while True:
        subprocess.run(['ffmpeg', '-v', 'error', '-y'] + inp + col + ['-an', '-c:v', 'libx264', '-profile:v', 'baseline', '-level', '3.1', '-pix_fmt', 'yuv420p',
                        '-crf', str(crf), '-preset', 'slow', '-movflags', '+faststart', str(path_mp4)], check=True)
        if path_mp4.stat().st_size <= max_kb * 1024 or crf >= 40:
            break
        crf += 2
    wcrf = 40
    webm = path_mp4.with_suffix('.webm')
    while True:
        subprocess.run(['ffmpeg', '-v', 'error', '-y'] + inp + col + ['-an', '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', str(wcrf), '-pix_fmt', 'yuv420p', '-row-mt', '1',
                        '-deadline', 'good', '-cpu-used', '4', str(webm)], check=True)
        if webm.stat().st_size <= max_kb * 1024 or wcrf >= 52:
            break
        wcrf += 3
    raw.unlink(); tmp.rmdir()
    return crf, wcrf


def main():
    a = sys.argv[1:]
    bdir, name, srcs = Path(a[0]), a[1], [Path(s) for s in a[2].split(',') if s]
    opt = lambda k, d=None: a[a.index(k) + 1] if k in a else d
    fps, thr, crf, max_kb = float(opt('--fps', 20)), float(opt('--thr', 9)), int(opt('--crf', 30)), int(opt('--max-kb', 600))
    car_area, no_cars = int(opt('--car-area', 160)), '--no-cars' in a or not opt('--roads')   # без маски дорог машин (и фар) нет
    fd = bdir / 'frames'
    day = np.asarray(Image.open(fd / (name + '.webp')).convert('RGB'))
    H, W = day.shape[:2]
    H2, W2 = H - H % 2, W - W % 2
    d = day.astype(np.float32)
    bld = np.asarray(Image.open(fd / (name + '_building.webp')))[..., 3] > 60
    excl = np.zeros((H, W), bool)
    excl[int(H * 0.93):, int(W * 0.72):] = True                                        # водяной знак Veo
    for box in (opt('--exclude') or '').split(';'):
        if box:
            u0, v0, u1, v1 = map(float, box.split(','))
            excl[int(v0 * H):int(v1 * H), int(u0 * W):int(u1 * W)] = True
    off = excl | cv2.dilate(bld.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool)
    clips = []
    for src in srcs:                                            # 1. кадры, совмещение, медиана, разброс
        fr = read_frames(src, W, H, fps)
        M, score, par = align(day, fr[0], np.zeros((H, W), bool))
        fr = [cv2.warpAffine(f, M, (W, H), borderMode=cv2.BORDER_REPLICATE) for f in fr]
        bg = np.median(np.stack(fr[::3]).astype(np.float32), 0)
        L = np.stack([cv2.GaussianBlur(cv2.cvtColor(f, cv2.COLOR_RGB2GRAY), (0, 0), 1.6) for f in fr]).astype(np.float32)
        sd = L.std(0); del L
        clips.append({'src': src, 'M': M, 'bg': bg, 'sd': sd, 'par': par, 'corr': score})   # кадры не держим (память VM ~4 ГБ) — второй проход читает заново
        print('%s: %s — %d кадров по %g к/с, совмещено sx=%.3f sy=%.3f dx=%d dy=%d (corr %.3f)' % (name, src.name, len(fr), fps, *par, score))
        del fr
    road_k = None
    if opt('--allow'):                                          # 2. маска
        mask = np.asarray(Image.open(opt('--allow')).convert('LA'))[..., 1].astype(np.float32) / 255
        mask = cv2.resize(mask, (W, H))
    else:
        mv = (np.max([c['sd'] for c in clips], 0) > thr).astype(np.uint8)
        mv[off] = 0
        mv = cv2.morphologyEx(mv, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
        n, lab, st, _ = cv2.connectedComponentsWithStats(mv)
        mv = np.isin(lab, [i for i in range(1, n) if st[i][4] >= 12]).astype(np.uint8)
        mv = cv2.dilate(mv, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (13, 13)))
        if opt('--roads'):                                      # дороги целиком: машина не уходит под рисунок посреди улицы
            rd = np.asarray(Image.open(opt('--roads')).convert('L').resize((W, H), Image.NEAREST)) > 127
            rd = cv2.dilate(rd.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (17, 17)))
            mv = np.maximum(mv, rd)
            road_k = rd.astype(bool)
        mv[off] = 0
        mask = np.clip(cv2.GaussianBlur(mv.astype(np.float32), (0, 0), 4.0) * 1.5, 0, 1)
        mask[off] = 0
        mask = cv2.GaussianBlur(mask, (0, 0), 1.0)
    allow = mask > 0.5
    print('%s: маска — в движении %.1f %% кадра' % (name, allow.mean() * 100))
    stats, conf = [], []
    for k, C in enumerate(clips, 1):                            # 3. композит, проверка, вывод
        fr = [cv2.warpAffine(f, C['M'], (W, H), borderMode=cv2.BORDER_REPLICATE) for f in read_frames(C['src'], W, H, fps)]
        bg, T = C['bg'], len(fr)
        D = [cv2.GaussianBlur(np.abs(f.astype(np.float32) - bg).max(-1), (0, 0), 1.5).astype(np.float16) for f in fr]
        static = (~allow) & (~off)
        g0 = cv2.GaussianBlur(cv2.cvtColor(fr[0], cv2.COLOR_RGB2GRAY), (0, 0), 2).astype(np.float32)
        drift = max(float(np.abs(cv2.GaussianBlur(cv2.cvtColor(f, cv2.COLOR_RGB2GRAY), (0, 0), 2).astype(np.float32) - g0)[static].mean()) for f in fr[::5])
        newo = cv2.GaussianBlur(np.abs(bg - fr[0].astype(np.float32)).max(-1), (0, 0), 3) > 28
        newo &= ~off
        new_px = int(cv2.morphologyEx(newo.astype(np.uint8), cv2.MORPH_OPEN, np.ones((7, 7), np.uint8)).sum())
        if no_cars:
            cars, pops = [], []
        else:
            cars, pops = track(D, allow, car_area, W, H, road_k)
        out = []
        for t in range(T):
            wv = np.clip((D[t].astype(np.float32) - 10) / 18, 0, 1) * mask
            ramp = min(1.0, t / 3, (T - 1 - t) / 3)                 # стык: первый и последний кадр — рисунок
            wv = (wv * ramp)[..., None]
            out.append(np.clip(d * (1 - wv) + fr[t].astype(np.float32) * wv + 0.5, 0, 255).astype(np.uint8)[:H2, :W2])
        edge_px = int(((D[0] > 20) & allow).sum() + ((D[-1] > 20) & allow).sum())
        mp4 = fd / ('%s_motion_%d.mp4' % (name, k))
        c1, c2 = encode(out, fps, mp4, crf, max_kb, W2, H2)
        cj = None
        if cars:
            cj = '%s_motion_%d_cars.json' % (name, k)
            json.dump(cars_json(cars, W, H, fps, T), open(fd / cj, 'w'), separators=(',', ':'))
        s = {'clip': C['src'].name, 'out': mp4.name, 'frames': T, 'sec': round(T / fps, 2), 'mp4_kb': mp4.stat().st_size // 1024,
             'webm_kb': mp4.with_suffix('.webm').stat().st_size // 1024, 'crf': [c1, c2], 'cars': len(cars), 'pop': len(pops), 'pops': pops,
             'drift': round(drift, 2), 'new_px': new_px, 'edge_px': edge_px, 'align': [round(float(x), 3) for x in C['par']], 'corr': round(float(C['corr']), 3)}
        stats.append(s); conf.append({'src': mp4.name, **({'cars': cj} if cj else {})})
        print('%s: %s → %s %d КБ (webm %d КБ), машин %d, pop %d %s, drift %.2f, new %d px, края %d px' % (
            name, C['src'].name, mp4.name, s['mp4_kb'], s['webm_kb'], len(cars), len(pops), pops, drift, new_px, edge_px))
        rep = opt('--report')
        if rep:
            rep = Path(rep); rep.mkdir(parents=True, exist_ok=True)
            idx = np.linspace(0, T - 1, 8).astype(int)
            sm = [cv2.resize(out[i], (W2 // 3, H2 // 3), interpolation=cv2.INTER_AREA) for i in idx]
            Image.fromarray(np.hstack(sm)).save(rep / ('sheet_%s_%d.jpg' % (name, k)), quality=85)
        del fr, D, out
    ma = (mask[:H2, :W2] * 255 + 0.5).astype(np.uint8)
    Image.fromarray(np.dstack([np.full_like(ma, 255), ma]), 'LA').save(fd / (name + '_motion_mask.png'), optimize=True)
    mvj = {'clips': conf, 'mask': name + '_motion_mask.png'}
    print('motionVideo:', json.dumps(mvj, ensure_ascii=False))
    rep = opt('--report')
    if rep:
        m3 = mask[..., None]
        ov = d * (1 - 0.45 * m3) + np.array([255, 40, 160]) * 0.45 * m3
        Image.fromarray(ov.astype(np.uint8)).save(Path(rep) / ('mask_%s.jpg' % name), quality=85)
        json.dump({'stats': stats, 'motionVideo': mvj, 'moving_pct': round(float(allow.mean() * 100), 2)}, open(Path(rep) / ('stats_%s.json' % name), 'w'), ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
