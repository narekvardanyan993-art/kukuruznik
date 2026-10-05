#!/usr/bin/env python3
"""Станок: новый кадр здания (порядок и критерии — docs/NEW-FRAME-CHECKLIST.md, стандарт — docs/STANDARD-EXHIBIT.md).

  python3 tools/new_frame.py <здание> <кадр> --check     # только проверки: ничего не пишет, ничего не собирает
  python3 tools/new_frame.py <здание> <кадр>             # следующий шаг: шаблоны → слои → числа кадра → скриншот → отчёт
  python3 tools/new_frame.py <здание> <кадр> --add       # готовый кадр: слои в tests/<здание>/frames/, кадр в building.json СКРЫТЫМ
  ключи: --models ПАПКА (модели глубины/вырезки; по умолчанию $CHKA_MODELS или ~/Documents/chka-kitchen/models),
         --online (сверить снимки pastvu с паспортом по сети), --no-shots (без скриншотов)

<здание> — имя папки tests/<здание> (например lenin). Кукурузник через станок не идёт (его кадры — старый конвейер test-assets/).
<кадр>  — имя кадра латиницей (lenin_2). Всё про кадр до --add лежит в tests/<здание>/source/<кадр>/:
  passport.json         паспорт ракурса: точка съёмки, город, эпоха, источники (стадия 0 — ДО рисования)
  <кадр>.png|jpg        рисунок 9:16 (Gemini, pro.gemini.one1)      <кадр>_bg.png|jpg  тот же кадр без здания
  <кадр>_sunset.*, <кадр>_night.*  закат и ночь (по желанию; обязательны до рекламы)
  layers.json           настройки вырезки для tools/build_building_layers.py (грубая область cutout.region)
  frame.json            блок кадра для building.json (числа неба считает скрипт; точки и фонари — руками)
  layers/               собранные слои (в git не идут)
Отчёт и скриншот 390×844 — tests/<здание>/report/<кадр>/. Живые страницы и building.json до --add не трогаются.
Код выхода: 0 — ошибок нет (стадии «ещё не сделано» не ошибка), 1 — есть ошибки.
"""
import argparse
import copy
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_pages as bp        # noqa: E402
import building_schema          # noqa: E402

ROOT = bp.ROOT
IMG_EXT = ('.png', '.jpg', '.jpeg', '.webp')
MODELS = ('depth_anything_v2_vits.onnx', 'isnet-general-use.onnx')
MODEL_URLS = {
    'depth_anything_v2_vits.onnx': 'https://github.com/fabio-sim/Depth-Anything-ONNX/releases/download/v2.0.0/depth_anything_v2_vits.onnx',
    'isnet-general-use.onnx': 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx',
}
DEPS = (('PIL', 'pillow'), ('numpy', 'numpy'), ('scipy', 'scipy'), ('cv2', 'opencv-python-headless'), ('onnxruntime', 'onnxruntime'))
LAYERS = ('', '_depth', '_bg', '_bg_depth', '_building', '_env', '_win2')
PASSPORT_TEMPLATE = {
    'frame': '', 'city': 'TODO город (как на страницах снимков)', 'era': [0, 0],
    'target': [0.0, 0.0],
    'camera': {'where': 'TODO откуда камера (точка на площади/улице)', 'bearing': None, 'height': 'земля'},
    'left': 'TODO что слева (с источником)', 'center': 'TODO что в центре', 'right': 'TODO что справа',
    'not_in_frame': ['современные машины', 'дорожные знаки и вывески не той эпохи'],
    'sources': [{'url': 'https://pastvu.com/p/TODO', 'year': 'TODO', 'city': 'TODO', 'city_checked': 'TODO чем проверен город',
                 'camera_bearing': None, 'use': 'TODO что берём из снимка'}],
    'approved': False,
}
NOTE = {'ok': 'OK', 'todo': 'НЕТ', 'warn': 'ВНИМАНИЕ', 'err': 'ОШИБКА'}


class Report:
    def __init__(self):
        self.items = []

    def add(self, stage, kind, msg):
        self.items.append((stage, kind, msg))

    def errors(self):
        return [i for i in self.items if i[1] == 'err']

    def text(self):
        return '\n'.join('%-9s %-14s %s' % (NOTE[k], s, m) for s, k, m in self.items)


# ---------------------------------------------------------------- пути
def building_dir(slug, root=None):
    root = Path(root or ROOT)
    if slug == 'kukuruznik':
        raise SystemExit('СТОП: Кукурузник через станок не идёт — его кадры собраны старым конвейером test-assets/ (не трогаем)')
    if not re.fullmatch(r'[a-z0-9_\-]+', slug):
        raise SystemExit('СТОП: имя здания %r — латиница, цифры, _ и - (как папка tests/<здание>)' % slug)
    bd = root / 'tests' / slug
    if not (bd / 'building.json').is_file():
        raise SystemExit('СТОП: нет tests/%s/building.json — станок работает с тестовыми зданиями из tests/' % slug)
    return bd


def frame_dir(bd, fid):
    return bd / 'source' / fid


def find_img(d, stem):
    for e in IMG_EXT:
        p = d / (stem + e)
        if p.is_file():
            return p
    return None


def is_todo(v):
    return v is None or (isinstance(v, str) and (not v.strip() or 'TODO' in v))


# ---------------------------------------------------------------- стадия 0: источник
def years(s):
    return [int(y) for y in re.findall(r'(1[89]\d\d|20\d\d)', str(s))]


def ang_diff(a, b):
    d = abs(a - b) % 360
    return min(d, 360 - d)


def pastvu_id(url):
    m = re.fullmatch(r'https://(?:www\.)?pastvu\.com/(?:p/)?(\d+)/?', str(url).strip())
    return int(m.group(1)) if m else None


def check_passport(p, fid, rep, fetch=None):
    """Паспорт ракурса. fetch(id) -> {'geo': [lat, lon], 'year': int, 'year2': int} или исключение (для --online)."""
    st = '0. источник'
    if p.get('frame') != fid:
        rep.add(st, 'err', 'passport.json: "frame" должен быть %r, а не %r' % (fid, p.get('frame')))
    todo = [k for k in ('city', 'left', 'center', 'right') if is_todo(p.get(k))]
    cam = p.get('camera') or {}
    if is_todo(cam.get('where')):
        todo.append('camera.where')
    b = cam.get('bearing')
    if not isinstance(b, (int, float)) or isinstance(b, bool) or not 0 <= b <= 360:
        todo.append('camera.bearing (0–360, куда смотрит камера)')
        b = None
    era = p.get('era')
    if not (isinstance(era, list) and len(era) == 2 and all(isinstance(x, int) for x in era) and 1800 <= era[0] <= era[1] <= 2100):
        todo.append('era [год, год]')
        era = None
    tg = p.get('target')
    if not (isinstance(tg, list) and len(tg) == 2 and all(isinstance(x, (int, float)) for x in tg) and (tg[0] or tg[1])):
        todo.append('target [широта, долгота] здания')
        tg = None
    if todo:
        rep.add(st, 'todo', 'паспорт не заполнен: ' + ', '.join(todo))
    srcs = p.get('sources') or []
    if not srcs:
        rep.add(st, 'err', 'нет ни одного источника — без снимка ракурс не рисуем (стандарт: минимум 4 кадра, лучше меньше, чем выдуманное)')
    city = str(p.get('city') or '').strip().lower()
    era_ok = same_angle = 0
    for i, s in enumerate(srcs):
        w = 'источник %d' % (i + 1)
        url = s.get('url', '')
        pid = pastvu_id(url)
        if not pid and not re.match(r'https://commons\.wikimedia\.org/', str(url)):
            rep.add(st, 'err' if 'TODO' not in str(url) else 'todo', '%s: ссылка %r — нужна страница снимка pastvu (https://pastvu.com/p/<номер>) или Commons' % (w, url))
        if is_todo(s.get('city')) or is_todo(s.get('city_checked')):
            rep.add(st, 'todo', '%s: город не проверен — открыть страницу снимка, сверить теги и координаты (урок: 240470 оказался Батуми)' % w)
        elif city and not is_todo(p.get('city')) and str(s['city']).strip().lower() != city:
            rep.add(st, 'err', '%s: город снимка «%s» ≠ город экспоната «%s» — снимок не годится' % (w, s['city'], p.get('city')))
        ys = years(s.get('year'))
        if era and ys:
            inside = any(era[0] <= y <= era[1] for y in ys) or (min(ys) <= era[1] and max(ys) >= era[0])
            if inside:
                era_ok += 1
            elif not s.get('geometry_only'):
                rep.add(st, 'warn', '%s: год %s вне эпохи %d–%d — годится только для геометрии ("geometry_only": true), окружение по нему не рисовать' % (w, s.get('year'), era[0], era[1]))
        elif not ys:
            rep.add(st, 'todo', '%s: нет года снимка' % w)
        cb = s.get('camera_bearing')
        if b is not None and isinstance(cb, (int, float)) and not isinstance(cb, bool):
            if ang_diff(b, cb) <= 60:
                same_angle += 1
        if fetch and pid:
            try:
                info = fetch(pid)
            except Exception as e:   # нет сети / сайт закрыт — не ошибка кадра
                rep.add(st, 'warn', '%s: онлайн-проверка pastvu %d не прошла (%s) — сверить город и координаты по странице вручную' % (w, pid, str(e)[:60]))
            else:
                g = info.get('geo')
                if tg and g:
                    km = geo_km(tg, g)
                    if km > 3:
                        rep.add(st, 'err', '%s: снимок pastvu %d сделан в %.0f км от здания — не отсюда' % (w, pid, km))
                    else:
                        rep.add(st, 'ok', '%s: pastvu %d в %.1f км от здания' % (w, pid, km))
                py = [y for y in (info.get('year'), info.get('year2')) if y]
                if py and ys and not (min(ys) <= max(py) and max(ys) >= min(py)):
                    rep.add(st, 'warn', '%s: год в паспорте %s, на pastvu %s' % (w, s.get('year'), '–'.join(map(str, sorted(set(py))))))
    if srcs and era and not era_ok:
        rep.add(st, 'err', 'ни одного источника эпохи %d–%d — ракурс без честного источника не рисуем' % tuple(era))
    if srcs and b is not None and not same_angle:
        rep.add(st, 'warn', 'нет снимка с этого ракурса (±60° от camera.bearing) — композицию брать только из плана, окружение не выдумывать')
    if not p.get('approved'):
        rep.add(st, 'todo', 'паспорт ждёт «ок» Нарека ("approved": true) — до этого не рисовать')
    if not [i for i in rep.items if i[0] == st and i[1] in ('err', 'todo')]:
        rep.add(st, 'ok', 'паспорт: %s, %s, источников %d (эпохи %d, с ракурса %d)' % (p.get('city'), '%d–%d' % tuple(era), len(srcs), era_ok, same_angle))


def geo_km(a, b):
    import math
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(h))


def pastvu_fetch(pid):
    import urllib.parse
    import urllib.request
    q = urllib.parse.quote(json.dumps({'cid': pid}))
    with urllib.request.urlopen('https://pastvu.com/api2?method=photo.giveForPage&params=' + q, timeout=15) as r:
        ph = json.loads(r.read().decode('utf-8'))['result']['photo']
    return {'geo': ph.get('geo'), 'year': ph.get('year'), 'year2': ph.get('year2')}


# ---------------------------------------------------------------- стадия 1: основа
def check_drawings(fd, fid, size, rep):
    st = '1. основа'
    from PIL import Image
    main, bg = find_img(fd, fid), find_img(fd, fid + '_bg')
    if not main:
        rep.add(st, 'todo', 'нет рисунка source/%s/%s.png (Gemini, 9:16, вход — ориентиры из паспорта + кадр Кукурузника как стиль)' % (fid, fid))
        return False
    W, H = size
    with Image.open(main) as im:
        w, h = im.size
    ok = True
    if abs(w / h - W / H) > 0.01 * W / H:
        rep.add(st, 'err', '%s: %d×%d — не 9:16 (нужно %d:%d, допуск 1 %%); обрезкой не спасать — перерисовать в режиме 9:16' % (main.name, w, h, W, H))
        ok = False
    elif w < W or h < H:
        rep.add(st, 'err', '%s: %d×%d — меньше кадра %d×%d' % (main.name, w, h, W, H))
        ok = False
    else:
        rep.add(st, 'ok', 'рисунок %s %d×%d' % (main.name, w, h))
    if not bg:
        rep.add(st, 'todo', 'нет подложки source/%s/%s_bg.png (тот же кадр без здания, Gemini «strict local inpainting»)' % (fid, fid))
        ok = False
    for suf, what, need in (('_bg', 'подложка', True), ('_sunset', 'закат', False), ('_night', 'ночь', False)):
        p = find_img(fd, fid + suf)
        if not p:
            if not need:
                rep.add(st, 'warn', 'нет картинки «%s» (%s%s) — для беты можно, до рекламы обязательно' % (what, fid, suf))
            continue
        with Image.open(p) as im2:
            if im2.size != (w, h):
                rep.add(st, 'err', '%s: %d×%d, а рисунок %d×%d — размер должен совпадать' % (p.name, im2.size[0], im2.size[1], w, h))
                ok = False if need else ok
                continue
        d = mean_diff(main, p)
        if suf == '_bg':
            kind = 'ok' if d < 15 else 'warn'
            rep.add(st, kind, 'подложка: среднее расхождение с рисунком %.1f из 255%s' % (d, '' if kind == 'ok' else ' — ракурс или цвет уехал, проверить наложением'))
        else:
            rep.add(st, 'ok', '%s: %s того же размера' % (what, p.name))
    return ok


def mean_diff(a, b):
    import numpy as np
    from PIL import Image
    x = np.asarray(Image.open(a).convert('RGB').resize((192, 341)), dtype=np.float32)
    y = np.asarray(Image.open(b).convert('RGB').resize((192, 341)), dtype=np.float32)
    return float(np.abs(x - y).mean())


# ---------------------------------------------------------------- стадия 2: слои
def models_dir(arg=None):
    return Path(arg or os.environ.get('CHKA_MODELS') or Path.home() / 'Documents' / 'chka-kitchen' / 'models').expanduser()


def check_tools(rep, models):
    st = '2. слои'
    import importlib
    miss = []
    for mod, pkg in DEPS:
        try:
            importlib.import_module(mod)
        except Exception:
            miss.append(pkg)
    if miss:
        rep.add(st, 'todo', 'не хватает пакетов Python: %s — поставить: pip3 install %s (и записать в «мои-инструменты.md»)' % (', '.join(miss), ' '.join(miss)))
    nomod = [m for m in MODELS if not (models / m).is_file()]
    if nomod:
        rep.add(st, 'todo', 'нет моделей в %s: %s — скачать: %s' % (models, ', '.join(nomod), ' ; '.join('curl -L -o %s/%s %s' % (models, m, MODEL_URLS[m]) for m in nomod)))
    if not miss and not nomod:
        rep.add(st, 'ok', 'пакеты Python и модели на месте (%s)' % models)
    return not miss and not nomod


def check_layers_spec(fd, fid, size, rep):
    st = '2. слои'
    f = fd / 'layers.json'
    if not f.is_file():
        rep.add(st, 'todo', 'нет source/%s/layers.json (создаёт скрипт без --check)' % fid)
        return None
    try:
        s = json.loads(f.read_text(encoding='utf-8'))
    except json.JSONDecodeError as e:
        rep.add(st, 'err', 'layers.json не читается (строка %d): %s' % (e.lineno, e.msg))
        return None
    ok = True
    if s.get('name') != fid:
        rep.add(st, 'err', 'layers.json: "name" должен быть %r' % fid)
        ok = False
    if list(s.get('size') or []) != list(size):
        rep.add(st, 'err', 'layers.json: "size" должен быть %s (look.frameSize здания)' % list(size))
        ok = False
    reg = (s.get('cutout') or {}).get('region') or []
    if len(reg) < 3:
        rep.add(st, 'todo', 'layers.json: обвести здание грубым полигоном cutout.region [[x, y], …] в координатах %d×%d' % tuple(size))
        ok = False
    elif not all(isinstance(p, list) and len(p) == 2 and 0 <= p[0] <= size[0] and 0 <= p[1] <= size[1] for p in reg):
        rep.add(st, 'err', 'layers.json: точки cutout.region вне кадра %d×%d' % tuple(size))
        ok = False
    if ok:
        rep.add(st, 'ok', 'layers.json: вырезка по разнице с подложкой, область %d точек' % len(reg))
    return s if ok else None


def built_layers(fd, fid, fr=None):
    d = fd / 'layers'
    need = list(LAYERS)
    if fr is not None:
        need += [s for s, k in (('_sunset', 'sunset'), ('_night', 'night')) if fr.get(k, True) is not False]
    return [fid + s + '.webp' for s in need if not (d / (fid + s + '.webp')).is_file()]


def build_layers(fd, fid, size, models, run=subprocess.run):
    """Слои: tools/build_building_layers.py (общий, как у Ленина) + закат/ночь в WebP размера кадра."""
    out = fd / 'layers'
    out.mkdir(exist_ok=True)
    cmd = [sys.executable, str(ROOT / 'tools' / 'build_building_layers.py'), '--src', str(find_img(fd, fid)), '--bg', str(find_img(fd, fid + '_bg')),
           '--spec', str(fd / 'layers.json'), '--out', str(out), '--models', str(models)]
    r = run(cmd)
    if r.returncode:
        raise SystemExit('СТОП: сборка слоёв упала (код %d) — текст ошибки выше' % r.returncode)
    from PIL import Image
    for suf in ('_sunset', '_night'):
        p = find_img(fd, fid + suf)
        if p:
            Image.open(p).convert('RGB').resize(tuple(size), Image.LANCZOS).save(out / (fid + suf + '.webp'), quality=90, method=6)
    return cmd


# ---------------------------------------------------------------- стадия 3: кадр
def measure_sky(env_path, color_path):
    """Числа неба по маске окружения (R — небо): end — где небо кончается (доля высоты), ref — яркость неба на рисунке,
    band — полоса для облаков и шоу. Сверено на Кукурузнике: кадр 1 end 0.543 / ref 0.863 (в файле 0.55 / 0.866), кадр 5 0.265 / 0.93 (0.28 / 0.932)."""
    import numpy as np
    from PIL import Image
    env = np.asarray(Image.open(env_path).convert('RGB'), dtype=np.float32) / 255
    sky = env[..., 0] > 0.5
    H = sky.shape[0]
    share = sky.mean(1)
    below = np.nonzero(share < 0.5)[0]
    end = float(below[0]) / H if len(below) else 1.0
    lum = np.asarray(Image.open(color_path).convert('L'), dtype=np.float32) / 255
    ref = float(lum[sky].mean()) if sky.any() else 0.85
    end = round(min(max(end, 0.05), 0.95), 3)
    return {'ref': round(ref, 3), 'end': end, 'band': [round(max(0.02, 0.08 * end), 3), round(0.62 * end, 3)], 'clouds': 3 if end > 0.4 else 2}


def frame_template(b, fid, sky, has_sunset, has_night):
    vis = bp.visible_frames(b) or b['frames']
    f0 = vis[0]
    fr = {'name': fid, 'night': has_night, 'sunset': has_sunset, 'crop': [0, 0, 1, 1], 'flag': None,
          'cloudShadow': f0.get('cloudShadow', 0.12), 'wind': f0.get('wind', 1), 'sky': sky, 'hotspots': [],
          'nightLamps': [], 'nightHalo': f0.get('nightHalo', 1), 'lamps': [], 'sun': copy.deepcopy(f0['sun']), 'life': copy.deepcopy(f0['life'])}
    return fr


def check_frame(bd, b, fid, fr, rep, root):
    """frame.json против схемы здания (как будто кадр уже в building.json и виден) + требования стандарта."""
    st = '3. кадр'
    b2 = copy.deepcopy(b)
    if any(f.get('name') == fid for f in b2['frames']):
        rep.add(st, 'err', 'кадр %s уже есть в building.json' % fid)
        return False
    f2 = copy.deepcopy(fr)
    f2.pop('hidden', None)
    b2['frames'].append(f2)
    n = len(b2['frames'])
    rel = str(bd.relative_to(root))
    errs = building_schema.validate(rel, b2, root)
    mine = 'кадр %d (%s)' % (n, fid)
    errs = [e for e in errs if not (mine in e and ': нет ' in e)]   # файлы слоёв кадра проверяются по layers/, а не по frames/
    for e in errs:
        rep.add(st, 'err', 'frame.json: ' + e.split(mine, 1)[-1].lstrip(': ') if mine in e else 'frame.json: ' + e)
    hs = fr.get('hotspots') if isinstance(fr.get('hotspots'), list) else []
    if not hs:
        rep.add(st, 'todo', 'точки: 0 — поставить 3–4 (key из facts: %s)' % ', '.join(b.get('facts', {}).keys()))
    elif not 3 <= len(hs) <= 4:
        rep.add(st, 'warn', 'точек %d — по стандарту 3–4' % len(hs))
    if not fr.get('parade'):
        rep.add(st, 'warn', 'шоу нет ("parade") — цель: шоу на каждом кадре (planes, drones, heli, fireworks, balloons)')
    for k, what in (('sunset', 'закат процедурный'), ('night', 'ночь процедурная')):
        if fr.get(k, True) is False:
            rep.add(st, 'warn', '%s ("%s": false) — до рекламы нужна картинка' % (what, k))
    if fr.get('night', True) is not False and not fr.get('nightLamps'):
        rep.add(st, 'todo', 'фонари ночной картинки (nightLamps) не расставлены')
    if not errs:
        rep.add(st, 'ok', 'frame.json проходит проверку настроек здания (building_schema)')
    return not errs


# ---------------------------------------------------------------- скриншот
def preview(bd, b, fid, fr, fd, out_png, root):
    """Временная копия: здание с этим кадром первым и видимым → бета-страница → скриншот 390×844 (node + puppeteer)."""
    tmp = Path(tempfile.mkdtemp(prefix='chka-frame-'))
    try:
        rel = str(bd.relative_to(root))
        shutil.copyfile(Path(root) / 'CNAME', tmp / 'CNAME')
        shutil.copytree(Path(root) / 'assets', tmp / 'assets')
        shutil.copytree(bd, tmp / rel, ignore=shutil.ignore_patterns('source', 'report', 'refs', 'gallery-source'))
        for f in (fd / 'layers').glob('*.webp'):
            shutil.copyfile(f, tmp / rel / 'frames' / f.name)
        b2 = copy.deepcopy(b)
        f2 = copy.deepcopy(fr)
        f2.pop('hidden', None)
        b2['frames'] = [f2] + b2['frames']
        if fr.get('parade'):
            for f in b2['frames'][1:]:
                f.pop('parade', None)
        (tmp / rel / 'building.json').write_text(json.dumps(b2, ensure_ascii=False, indent=1), encoding='utf-8')
        bp.build_beta(tmp, [rel], root=tmp)
        url_path = 'beta/%s/' % rel
        import functools
        import http.server
        handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(tmp))
        handler.log_message = lambda *a, **k: None
        srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        try:
            out_png.parent.mkdir(parents=True, exist_ok=True)
            r = subprocess.run(['node', str(ROOT / 'tools' / 'new_frame_shot.mjs'), 'http://127.0.0.1:%d/%s' % (srv.server_address[1], url_path), str(out_png)],
                               cwd=str(ROOT), capture_output=True, text=True, timeout=180)
        finally:
            srv.shutdown()
        return r.returncode == 0, (r.stdout + r.stderr).strip()[-400:]
    except FileNotFoundError as e:
        return False, 'нет программы: %s' % e
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


# ---------------------------------------------------------------- --add
def insert_frame(text, fr):
    """building.json как текст: кадр — в конец списка frames, остальные байты файла не меняются."""
    m = re.search(r'"frames"\s*:\s*\[', text)
    if not m:
        raise SystemExit('СТОП: в building.json нет списка "frames"')
    _, end = json.JSONDecoder().raw_decode(text, m.end() - 1)   # end — сразу после «]»
    close = end - 1
    before = text[:close].rstrip()
    trailing = text[len(before):close]                          # перенос и отступ перед «]»
    first = text.find('{', m.end())
    line_start = text.rfind('\n', 0, first) + 1
    pad = text[line_start:first] if text[line_start:first].strip() == '' else '    '
    body = re.sub(r'\[\s*([-0-9.eE]+(?:,\s*[-0-9.eE]+)*)\s*\]', lambda q: '[' + ', '.join(x.strip() for x in q.group(1).split(',')) + ']',
                  json.dumps(fr, ensure_ascii=False, indent=2)).replace('\n', '\n' + pad)   # числа в строку: [0.8, 0.11]
    return before + ',\n' + pad + body + trailing + text[close:]


def add_frame(bd, fid, fr, fd, root):
    frames = bd / 'frames'
    have = [f.name for f in (fd / 'layers').glob('*.webp') if (frames / f.name).exists()]
    if have:
        raise SystemExit('СТОП: в %s уже есть %s — не перезаписываю' % (frames.relative_to(root), ', '.join(have)))
    f2 = dict(fr, hidden=True)
    if f2.get('parade'):
        f2.pop('parade')   # схема: парад на скрытом кадре запрещён — вернуть вместе со снятием hidden
    bj = bd / 'building.json'
    old = bj.read_text(encoding='utf-8')
    new = insert_frame(old, f2)
    b = json.loads(new)
    errs = building_schema.validate(str(bd.relative_to(root)), b, root)
    if errs:
        raise SystemExit('СТОП: после вставки кадра building.json не проходит проверку:\n  • ' + '\n  • '.join(errs))
    for f in sorted((fd / 'layers').glob('*.webp')):
        shutil.copyfile(f, frames / f.name)
    bj.write_text(new, encoding='utf-8')
    return f2


# ---------------------------------------------------------------- главное
def run(slug, fid, check=False, add=False, models=None, online=False, shots=True, root=None, fetch=None, runner=subprocess.run):
    """Стадии по порядку. Без --check — останавливается на первой незакрытой стадии (дальше не собирает);
    с --check — ничего не пишет и показывает состояние всех стадий, какие можно проверить."""
    if check and add:
        raise SystemExit('СТОП: --add и --check вместе нельзя')
    root = Path(root or ROOT)
    bd = building_dir(slug, root)
    if not re.fullmatch(r'[A-Za-z0-9_\-]+', fid):
        raise SystemExit('СТОП: имя кадра %r — латиница, цифры, _ и - (например %s_2)' % (fid, slug))
    b = bp.load_building(str(bd.relative_to(root)), root)
    size = list(b['look']['frameSize'])
    fd = frame_dir(bd, fid)
    rep, wrote = Report(), []
    done = lambda: finish(rep, wrote, bd, fid, check)
    blocked = lambda st: any(i[0] == st and i[1] in ('err', 'todo') for i in rep.items)
    if any(f.get('name') == fid for f in b['frames']):
        rep.add('3. кадр', 'ok', 'кадр %s уже в building.json — станку делать нечего' % fid)
        return done()
    if b.get('live'):
        rep.add('здание', 'ok', '%s — живое здание (/%s/): до --add и снятия hidden живая страница не меняется' % (slug, slug))
    # 0. источник
    pp = fd / 'passport.json'
    if not pp.is_file():
        if check:
            rep.add('0. источник', 'todo', 'нет source/%s/passport.json — запусти без --check: появится шаблон' % fid)
            return done()
        fd.mkdir(parents=True, exist_ok=True)
        t = copy.deepcopy(PASSPORT_TEMPLATE)
        t['frame'] = fid
        pp.write_text(json.dumps(t, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        wrote.append(pp)
        rep.add('0. источник', 'todo', 'создан шаблон source/%s/passport.json — заполнить по чек-листу (шаг 0) и отдать Нареку' % fid)
        return done()
    try:
        passport = json.loads(pp.read_text(encoding='utf-8'))
    except json.JSONDecodeError as e:
        rep.add('0. источник', 'err', 'passport.json не читается (строка %d): %s' % (e.lineno, e.msg))
        return done()
    check_passport(passport, fid, rep, fetch=(fetch or pastvu_fetch) if online else None)
    if blocked('0. источник') and not check:
        return done()                                    # без честного источника не рисуем и не собираем
    # 1. основа
    drawn = check_drawings(fd, fid, size, rep)
    # 2. слои
    mdir = models_dir(models)
    tools_ok = check_tools(rep, mdir)
    if not (fd / 'layers.json').is_file() and not check and drawn:
        base = bd / 'layers.json'
        t = json.loads(base.read_text(encoding='utf-8')) if base.is_file() else {}
        t.update(name=fid, size=size)
        t['cutout'] = dict(t.get('cutout') or {}, region=[])
        t.pop('add', None)
        t['cutout'].pop('add', None)
        t['window_boxes'] = []
        (fd / 'layers.json').write_text(json.dumps(t, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        wrote.append(fd / 'layers.json')
    spec = check_layers_spec(fd, fid, size, rep)
    frf = fd / 'frame.json'
    fr = None
    if frf.is_file():
        try:
            fr = json.loads(frf.read_text(encoding='utf-8'))
        except json.JSONDecodeError as e:
            rep.add('3. кадр', 'err', 'frame.json не читается (строка %d): %s' % (e.lineno, e.msg))
            return done()
    missing = built_layers(fd, fid, fr)
    core = [m for m in missing if not m.endswith(('_sunset.webp', '_night.webp'))]
    if core and drawn and spec and tools_ok and not check:
        build_layers(fd, fid, size, mdir, run=runner)
        missing = built_layers(fd, fid, fr)
        core = [m for m in missing if not m.endswith(('_sunset.webp', '_night.webp'))]
        if not core:
            rep.add('2. слои', 'ok', 'слои собраны в source/%s/layers/' % fid)
    if core:
        rep.add('2. слои', 'todo', 'нет слоёв (source/%s/layers/): %s' % (fid, ', '.join(core)))
        if fr is not None:
            check_frame(bd, b, fid, fr, rep, root)       # схему frame.json можно проверить и без слоёв
        return done()
    if not [i for i in rep.items if i[0] == '2. слои' and i[2].startswith('слои собраны')]:
        rep.add('2. слои', 'ok', 'слои на месте (source/%s/layers/)' % fid)
    # 3. кадр
    sky = measure_sky(fd / 'layers' / (fid + '_env.webp'), fd / 'layers' / (fid + '.webp'))
    if fr is None:
        if check:
            rep.add('3. кадр', 'todo', 'нет frame.json; замер неба: %s' % json.dumps(sky))
            return done()
        fr = frame_template(b, fid, sky, bool(find_img(fd, fid + '_sunset')), bool(find_img(fd, fid + '_night')))
        frf.write_text(json.dumps(fr, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        wrote.append(frf)
        rep.add('3. кадр', 'ok', 'создан frame.json, небо по замеру: %s' % json.dumps(sky))
        missing = built_layers(fd, fid, fr)
    else:
        rep.add('3. кадр', 'ok', 'замер неба для сверки: %s; в frame.json: %s' % (json.dumps(sky), json.dumps(fr.get('sky'))))
    for m in missing:
        rep.add('2. слои', 'err', 'frame.json ждёт %s, а в layers/ его нет — положить картинку или поставить false' % m)
    frame_ok = check_frame(bd, b, fid, fr, rep, root) and not missing
    # 4. скриншот
    if shots and not check and frame_ok:
        png = bd / 'report' / fid / 'day-390x844.png'
        ok, log = preview(bd, b, fid, fr, fd, png, root)
        if ok:
            wrote.append(png)
            rep.add('4. скриншот', 'ok', str(png.relative_to(root)))
        else:
            rep.add('4. скриншот', 'warn', 'не снят (%s) — нужен node + Chrome (puppeteer); на Маке — в обычном Терминале' % log.replace('\n', ' ')[-160:])
    # 5. в здание
    if add:
        stop = [i for i in rep.items if i[1] == 'err' or (i[1] == 'todo' and i[0] in ('0. источник', '1. основа', '2. слои'))]
        if stop:
            raise SystemExit('СТОП: кадр не готов к --add:\n' + '\n'.join('  %s %s %s' % (NOTE[k], s, m) for s, k, m in stop))
        add_frame(bd, fid, fr, fd, root)
        wrote.append(bd / 'building.json')
        rep.add('5. в здание', 'ok', 'слои в %s/frames/, кадр в building.json скрытым (hidden: true); снять hidden — решение Нарека' % bd.relative_to(root))
    return done()


def finish(rep, wrote, bd, fid, check):
    if not check:
        d = bd / 'report' / fid
        d.mkdir(parents=True, exist_ok=True)
        (d / 'check.md').write_text('# Кадр %s — состояние станка\n\n```\n%s\n```\n' % (fid, rep.text()), encoding='utf-8')
    rep.wrote = wrote
    return rep


def main(argv=None):
    ap = argparse.ArgumentParser(description='Станок: новый кадр здания (docs/NEW-FRAME-CHECKLIST.md)')
    ap.add_argument('slug', help='здание: папка tests/<здание>')
    ap.add_argument('frame', help='имя кадра латиницей, например lenin_2')
    ap.add_argument('--check', action='store_true', help='только проверки, ничего не пишет')
    ap.add_argument('--add', action='store_true', help='готовый кадр — в frames/ и building.json скрытым')
    ap.add_argument('--models', help='папка с моделями (по умолчанию $CHKA_MODELS или ~/Documents/chka-kitchen/models)')
    ap.add_argument('--online', action='store_true', help='сверить снимки pastvu с паспортом по сети')
    ap.add_argument('--no-shots', action='store_true', help='без скриншотов')
    a = ap.parse_args(argv)
    rep = run(a.slug, a.frame, check=a.check, add=a.add, models=a.models, online=a.online, shots=not a.no_shots)
    print('Станок: %s / %s%s' % (a.slug, a.frame, ' (--check: ничего не записано)' if a.check else ''))
    print(rep.text())
    for p in getattr(rep, 'wrote', []):
        print('записано: %s' % Path(p).relative_to(ROOT) if str(p).startswith(str(ROOT)) else p)
    errs = rep.errors()
    print('\nИТОГ: %s' % ('ошибок нет' if not errs else 'ОШИБОК %d' % len(errs)))
    return 1 if errs else 0


if __name__ == '__main__':
    sys.exit(main())
