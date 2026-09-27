#!/usr/bin/env python3
"""Тестовое здание с кадрами ДРУГОЙ ПРОПОРЦИИ (4:5) — только на Mac, в git не идёт (docs/ENGINE-PLAN.md, п.6).

  python3 tools/make_prop45.py

Берёт кадры Кукурузника с живого сайта (origin/main), режет из каждого слоя окно 768×960 (пропорция 4:5, y 150…1110) и пишет
  tests/local/prop45/frames/*.webp   — обрезанные кадры (8 слоёв на кадр)
  tests/local/prop45/building.json   — настройки здания: те же точки, фонари, небо, солнце, флаги, газон, но пересчитанные под окно.
Дальше: python3 tools/check_local.py — соберёт бету с этим зданием во временной копии и прогонит проверку (в публикацию не попадает).
Пересчёт координат — честный: v' = (v·1365 − 150) / 960 (u не меняется); то, что после обрезки вышло за кадр, из настроек убирается.
Никаких подгонок под 4:5 в движке нет: всё, что «поехало», чинится в движке через размер кадра (look.frameSize) и настройки.
"""
import copy
import io
import json
import subprocess
import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_pages as bp   # noqa: E402

ROOT = bp.ROOT
OUT = ROOT / 'tests' / 'local' / 'prop45'
SRC_FRAMES = ['v_angle_0', 'v_angle_1', 'v_angle_2']
NEW = {'v_angle_0': 'p45_a', 'v_angle_1': 'p45_b', 'v_angle_2': 'p45_c'}
LAYERS = ['', '_depth', '_bg', '_building', '_env', '_win2', '_sunset', '_night']
LOSSLESS = ('_depth', '_env', '_win2')   # маски и глубина — без потерь, как на сайте
Y0, H, W = 150, 960, 768


def git_show(path):
    return subprocess.run(['git', '-C', str(ROOT), 'show', 'origin/main:' + path], capture_output=True, check=True).stdout


def vv(v):
    return round((v * 1365 - Y0) / H, 4)


def inside(v, lo=0.02, hi=0.98):
    return lo <= v <= hi


def main():
    subprocess.run(['git', '-C', str(ROOT), 'fetch', '-q', 'origin', 'main'], check=True)
    (OUT / 'frames').mkdir(parents=True, exist_ok=True)
    for f in SRC_FRAMES:
        for suf in LAYERS:
            im = Image.open(io.BytesIO(git_show('kukuruznik/frames/%s%s.webp' % (f, suf))))
            assert im.size == (768, 1365), (f, suf, im.size)
            c = im.crop((0, Y0, W, Y0 + H))
            dst = OUT / 'frames' / ('%s%s.webp' % (NEW[f], suf))
            if suf in LOSSLESS:
                c.save(dst, 'WEBP', lossless=True, method=6)
            elif suf == '_building':
                c.convert('RGBA').save(dst, 'WEBP', quality=90, alpha_quality=100, method=6)
            else:
                c.convert('RGB').save(dst, 'WEBP', quality=90, method=6)
    K = bp.load_building('kukuruznik')
    T1 = bp.load_building('tests/test-1')
    facts = T1['facts']
    keymap = {'tower1': 'fact_a', 'tower2': 'fact_b', 'architects': 'fact_c', 'mother_armenia': 'fact_d', 'construction': 'fact_d'}
    frames = []
    for f in K['frames']:
        if f['name'] not in SRC_FRAMES:
            continue
        g = copy.deepcopy(f)
        g['name'] = NEW[f['name']]
        g.pop('parade', None)
        g['hidden'] = False
        # точки-подсказки, фонари: v пересчитываем, что вышло за кадр — убираем
        g['hotspots'] = [dict(h, key=keymap[h['key']], v=vv(h['v'])) for h in f['hotspots'] if inside(vv(h['v']))]
        for h in g['hotspots']:
            h.pop('depth', None)
        for k in ('nightLamps', 'lamps'):
            g[k] = [[l[0], vv(l[1]), l[2], vv(l[3])] for l in f[k] if inside(vv(l[1])) and inside(vv(l[3]))]
        # небо, солнце, флаги, газон
        b = f['sky']['band']
        g['sky']['band'] = [max(0.02, vv(b[0])), min(0.95, vv(b[1]))]
        g['sky']['end'] = min(1.0, vv(f['sky']['end']))
        for k in ('day', 'sunset', 'moon'):
            u, v = f['sun'][k]
            g['sun'][k] = [u, min(0.9, max(0.04, vv(v)))]
        if f['flag']:
            x, y, w, h = f['flag']
            g['flag'] = [x, vv(y), w, round(h * 1365 / H, 4)]
        if 'lawn' in f:
            u0, v0, u1, v1 = f['lawn']
            v0, v1 = vv(v0), min(0.98, vv(v1))
            if v1 - v0 > 0.05:
                g['lawn'] = [u0, v0, u1, v1]
            else:
                g.pop('lawn')
        frames.append(g)
    B = copy.deepcopy(T1)
    B['id'] = 'prop45'
    B['meta'].update({'url': 'https://chka.am/beta/tests/local/prop45/', 'favicon': '../../../assets/favicon-32.png', 'appleTouchIcon': '../../../assets/icon-180.png'})
    B['links'] = {'home': '../../../', 'history': None}
    B['framesDir'] = 'frames/'
    B['facts'] = facts
    B['look']['frameSize'] = [W, H]
    B['look']['sunSide'] = 'right'
    B['tuning'] = {}
    B['postcardFile'] = 'prop45.png'
    for k, v in (('title', ('Թեստ-4:5, 2000', 'Тест-4:5, 2000', 'Test-4:5, 2000')), ('panelTitle', ('Թեստ-4:5', 'Тест-4:5', 'Test-4:5'))):
        B['text'][k] = {'hy': v[0], 'ru': v[1], 'en': v[2]}
    B['frames'] = frames
    B['frames'][0]['parade'] = True
    (OUT / 'building.json').write_text(json.dumps(B, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print('готово: %s (%d кадров %dx%d, пропорция 4:5)' % (OUT.relative_to(ROOT), len(frames), W, H))


if __name__ == '__main__':
    main()
