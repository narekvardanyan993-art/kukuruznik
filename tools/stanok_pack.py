#!/usr/bin/env python3
"""Станок: пакет здания buildings-next/<slug>/ → заготовка здания (init), гейт пакета (check --story), список шагов (status).

Пакет — четыре файла (buildings-next/RUNBOOK.md §8) + CHECKLIST.md: story.md (паспорт, факты, запретные зоны), frames.md (кадры и герои),
prompts.md (запросы Gemini и Veo), sources.md (источники с id). Истина остаётся в пакете; в work/<slug>/ уходят копии story.md и sources.md.

  check --story <slug>   гейт пакета: файлы на месте, чек-лист пройден (1–24 «да», вердикт ПРОХОДИТ), 5–6 кадров (дальний и крупный),
                         на кадре ≥ 2 изюминки с дождём и снегом, у фактов и кадров источники из sources.md, дневной запрос на каждый кадр,
                         запросы ночи, подложки и зимы, в папке нет почт и картинок
  init <slug>            гейт пакета → tests/<slug>/building.e2.json (заготовка format 2), zones.json, папки work/<slug>/, список шагов
  status <slug>          что сделано и какой шаг следующий (считается по файлам; пишет work/<slug>/STEPS.md)
"""
import json
import re
import shutil
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PACKS = ROOT / 'buildings-next'
PACK_FILES = ('story.md', 'frames.md', 'prompts.md', 'sources.md')
SRC_ID = re.compile(r'\b[ФОПТ]\d+\b')
FRAME_SIZE = [768, 1365]


def _section(text, head_re):
    """Текст раздела «## …» до следующего «## »."""
    m = re.search(r'^##\s+' + head_re + r'.*$', text, re.M)
    if not m:
        return ''
    n = re.search(r'^##\s', text[m.end():], re.M)
    return text[m.end():m.end() + n.start()] if n else text[m.end():]


def _rows(table_text):
    out = []
    for line in table_text.splitlines():
        if line.startswith('|') and not re.match(r'^\|\s*-', line):
            out.append([c.strip() for c in line.strip().strip('|').split('|')])
    return out


def read_pack(slug, root=None):
    """Читает пакет. Возвращает словарь: files, names, frames, facts, ids, zones, checklist, verdict, prompts. Ошибок не поднимает —
    чего нет, того нет (судит gate_pack)."""
    d = Path(root or PACKS) / slug
    P = {'slug': slug, 'dir': d, 'files': {}, 'names': {}, 'frames': [], 'facts': [], 'ids': set(), 'zones': [], 'checklist': {}, 'verdict': '', 'prompts': {}}
    for fn in PACK_FILES + ('CHECKLIST.md',):
        if (d / fn).is_file():
            P['files'][fn] = (d / fn).read_text(encoding='utf-8')
    story, frames, prompts, sources, chk = (P['files'].get(k, '') for k in PACK_FILES + ('CHECKLIST.md',))
    # --- story.md
    for r in _rows(_section(story, r'0\.')):
        if len(r) >= 2 and r[0].startswith('Название'):
            parts = [re.sub(r'\s*\(.*?\)\s*', '', x).strip() for x in r[1].split(' / ')]
            if len(parts) == 3:
                P['names'] = dict(zip(('hy', 'ru', 'en'), parts))
    for r in _rows(_section(story, r'2\.')):
        if r and re.fullmatch(r'\d+', r[0]) and len(r) >= 3:
            P['facts'].append({'n': int(r[0]), 'text': r[1], 'sources': SRC_ID.findall(r[2]), 'status': r[3] if len(r) > 3 else ''})
    z = _section(story, r'6\.').strip()
    P['zones'] = [x.strip(' .') for x in re.split(r'[;\n]', z) if x.strip(' .')]
    P['show'] = bool(_section(story, r'5\.').strip())
    # --- sources.md
    for r in _rows(sources):
        if r and re.fullmatch(r'[ФОПТ]\d+', r[0]):
            P['ids'].add(r[0])
    # --- frames.md
    summary = {r[0]: r for r in _rows(_section(frames, 'Сводка')) if r and re.fullmatch(r'[a-z]', r[0])}
    for m in re.finditer(r'^##\s+Кадр\s+([a-z])\s+—\s+(.*)$', frames, re.M):
        key, title = m.group(1), m.group(2).strip()
        n = re.search(r'^##\s', frames[m.end():], re.M)
        body = frames[m.end():m.end() + n.start()] if n else frames[m.end():]
        row = summary.get(key, [])
        kind_cell = row[2] if len(row) > 2 else ''
        heroes = []
        for h in re.finditer(r'\*\*Изюминка\s+\d+\s*(★)?\s*—\s*(.+?)\.\*\*(.*)', body):
            t = h.group(3)
            heroes.append({'name': h.group(2).strip(), 'star': bool(h.group(1)), 'rain': 'дождь' in t.lower(), 'snow': 'снег' in t.lower(),
                           'any': bool(re.search(r'в люб(ое время|ую погоду)', t.lower()))})     # огонь, свет: одинаков в любую погоду — сказано прямо
        if not heroes:                                            # запасной кадр: «**Изюминки:** а (…); б (…)»
            hm = re.search(r'\*\*Изюминки:\*\*(.*)', body)
            if hm:
                heroes = [{'name': x.split('(')[0].strip(), 'star': False, 'rain': 'дождь' in x.lower(), 'snow': 'снег' in x.lower()} for x in hm.group(1).split(';') if x.strip()]
        src = re.search(r'\*\*Источники:\*\*(.*)', body)
        wind = re.search(r'\*\*Ветер:\*\*\s*(\S+)', body)
        spots = re.search(r'\*\*Места надписей:\*\*\s*(.*)', body)
        P['frames'].append({'key': key, 'title': re.sub(r'\s*\(запасной.*$', '', title).strip(), 'spare': 'запасн' in title or 'запасн' in kind_cell,
                            'kind': (re.match(r'\s*(wide|close|interior)', kind_cell) or [None, ''])[1], 'far': 'дальн' in kind_cell,
                            'sources': SRC_ID.findall(src.group(1)) if src else [], 'heroes': heroes, 'wind': bool(wind and wind.group(1).startswith('есть')),
                            'show': len(row) > 6 and row[6].lower().startswith('да'), 'spots': spots.group(1).strip() if spots else '',
                            'night': (re.search(r'\*\*Ночь:\*\*\s*(.*)', body) or [None, ''])[1].strip()})
    # --- prompts.md
    day = _section(prompts, r'1\.')
    P['prompts'] = {'day': set(re.findall(r'^###\s+([a-z])\s+—', day, re.M)),
                    'night': bool(re.search(r'^##\s+\d+\.\s+Ночь', prompts, re.M)), 'bg': bool(re.search(r'^##\s+\d+\.\s+Подложка', prompts, re.M)),
                    'winter': bool(re.search(r'^##\s+\d+\.\s+Зима', prompts, re.M))}
    # --- CHECKLIST.md
    for m in re.finditer(r'^(\d+)\.\s+\[( |x|X)\]', chk, re.M):
        P['checklist'][int(m.group(1))] = m.group(2).lower() == 'x'
    v = re.search(r'Вердикт:\s*\*\*(.+?)\*\*', chk)
    P['verdict'] = v.group(1).strip() if v else ''
    return P


def gate_pack(slug, root=None):
    """Гейт пакета (S1, check --story). Возвращает список проблем (пустой — зелёный)."""
    P = read_pack(slug, root)
    d, probs = P['dir'], []
    if not d.is_dir():
        return ['нет папки пакета %s' % d]
    for fn in PACK_FILES + ('CHECKLIST.md',):
        if fn not in P['files']:
            probs.append('в пакете нет файла %s' % fn)
    if probs:
        return probs
    bad = [n for n in range(1, 25) if not P['checklist'].get(n)]
    if bad:
        probs.append('чек-лист: стоп-пункты не «да»: %s' % ', '.join(map(str, bad)))
    if P['verdict'] != 'ПРОХОДИТ':
        probs.append('чек-лист: вердикт «%s», нужен «ПРОХОДИТ»' % (P['verdict'] or 'не записан'))
    main = [f for f in P['frames'] if not f['spare']]
    if not 5 <= len(main) <= 6:
        probs.append('кадров %d, нужно 5–6 (без запасного)' % len(main))
    if not any(f['kind'] == 'close' for f in main):
        probs.append('нет крупного кадра (kind: close)')
    if not any(f['far'] for f in main):
        probs.append('нет дальнего кадра (в сводке frames.md: «wide, дальний»)')
    for f in main:
        tag = 'кадр %s' % f['key']
        if f['kind'] not in ('wide', 'close', 'interior'):
            probs.append('%s: в сводке нет kind (wide | close | interior)' % tag)
        if len(f['heroes']) < 2:
            probs.append('%s: изюминок %d, нужно не меньше двух' % (tag, len(f['heroes'])))
        for h in f['heroes']:
            miss = [w for w, k in (('дождь', 'rain'), ('снег', 'snow')) if not h[k]]
            if miss and f['kind'] != 'interior' and not h.get('any'):
                probs.append('%s, изюминка «%s»: не сказано, что она делает в %s' % (tag, h['name'], ' и '.join(miss)))
        if not f['sources']:
            probs.append('%s: нет строки «Источники» с id из sources.md' % tag)
        for i in f['sources']:
            if i not in P['ids']:
                probs.append('%s: источник %s не найден в sources.md' % (tag, i))
        if f['key'] not in P['prompts']['day']:
            probs.append('%s: в prompts.md нет дневного запроса («### %s — …» в разделе «1. День»)' % (tag, f['key']))
    if sum(1 for f in main for h in f['heroes'] if h['star']) < 2:
        probs.append('героев первой волны (★) меньше двух — зданию нужны ≥ 2 изюминки с роликом')
    if not 4 <= len(P['facts']) <= 6:
        probs.append('фактов %d, нужно 4–6' % len(P['facts']))
    for q in P['facts']:
        if not q['sources']:
            probs.append('факт %d: нет источника' % q['n'])
        for i in q['sources']:
            if i not in P['ids']:
                probs.append('факт %d: источник %s не найден в sources.md' % (q['n'], i))
    for k, ru in (('night', 'ночи'), ('bg', 'подложки'), ('winter', 'зимы')):
        if not P['prompts'][k]:
            probs.append('в prompts.md нет раздела запросов %s' % ru)
    if not P['show']:
        probs.append('в story.md нет сценария «до и после» (раздел 5)')
    if not P['zones']:
        probs.append('в story.md нет запретных зон для надписей (раздел 6)')
    if not P['names']:
        probs.append('в паспорте story.md нет строки «Название hy / ru / en» из трёх частей')
    for fn, text in P['files'].items():
        if re.search(r'[\w.+-]+@[\w-]+\.[a-z]{2,}', text):
            probs.append('%s: в пакете почтовый адрес — пакет идёт в публичный репозиторий' % fn)
    pics = [p.name for p in d.iterdir() if p.suffix.lower() in ('.jpg', '.jpeg', '.png', '.webp', '.gif')]
    if pics:
        probs.append('в пакете картинки (%s) — фото лежат в work/<slug>/ref/, не в git' % ', '.join(pics[:3]))
    return probs


def selftest_pack(slug, root=None):
    """Красные случаи гейта пакета: каждая поломка копии пакета обязана дать свою проблему."""
    src = Path(root or PACKS) / slug

    def broken(fn, edit):
        tmp = Path(tempfile.mkdtemp(prefix='stanok-pack-'))
        shutil.copytree(src, tmp / slug)
        p = tmp / slug / fn
        if edit is None:
            shutil.move(str(p), str(tmp / (fn + '.gone')))
        else:
            t = p.read_text(encoding='utf-8')
            t2 = edit(t)
            if t2 == t:
                return None
            p.write_text(t2, encoding='utf-8')
        return gate_pack(slug, tmp)
    cases = [('нет prompts.md', 'prompts.md', None, 'нет файла prompts.md'),
             ('в чек-листе пункт 17 не «да»', 'CHECKLIST.md', lambda t: t.replace('17. [x]', '17. [ ]', 1), 'стоп-пункты'),
             ('вердикт «НЕ ПРОХОДИТ»', 'CHECKLIST.md', lambda t: t.replace('**ПРОХОДИТ**', '**НЕ ПРОХОДИТ**', 1), 'вердикт'),
             ('на кадре a одна изюминка', 'frames.md', lambda t: re.sub(r'\*\*Изюминка 2[^\n]*\n', '', t, count=1), 'изюминок 1'),
             ('у изюминки нет снега', 'frames.md', lambda t: re.sub(r'(\*\*Изюминка 1[^\n]*?)Снег:', r'\1Зимой:', t, count=1, flags=re.S), 'снег'),
             ('факт без источника', 'story.md', lambda t: re.sub(r'^(\| 1 \|[^|]*\|)[^|]*\|', r'\1 — |', t, count=1, flags=re.M), 'факт 1: нет источника'),
             ('у кадра b нет дневного запроса', 'prompts.md', lambda t: re.sub(r'^### b — ', '### б — ', t, count=1, flags=re.M), 'нет дневного запроса'),
             ('источник кадра не из sources.md', 'frames.md', lambda t: t.replace('**Источники:** главный ', '**Источники:** главный Ф99, ', 1), 'Ф99'),
             ('в пакете почта', 'story.md', lambda t: t + '\nписать: someone@example.com\n', 'почтовый адрес')]
    res = []
    for title, fn, edit, expect in cases:
        probs = broken(fn, edit)
        if probs is None:
            res.append(('пакет', title + ' — ПРОПУЩЕНО: в пакете нет такого места', None))
        else:
            res.append(('пакет', title, any(expect in q for q in probs)))
    return res


# ---------------------------------------------------------------- init
def frame_prefix(slug):
    return slug.split('-')[-1].replace('_', '')


def skeleton(P, spare=False):
    """Заготовка building.e2.json из пакета: кадры, названия, виды; числа неба, файлы и герои придут с шагами layers и actor."""
    pre = frame_prefix(P['slug'])
    frames = []
    for f in P['frames']:
        if f['spare'] and not spare:
            continue
        fx = {'tod': {'sky': {}, 'sun': None}}
        if f['wind']:
            fx['wind'] = {'on': True}
        frames.append({'name': '%s_%s' % (pre, f['key']), 'kind': f['kind'] or 'wide', 'caption': {k: f['title'] for k in ('ru',)}, 'effects': fx})
    todo = ['рисунки: кадры ещё не нарисованы (stanok status %s)' % P['slug'], 'effects.tod.sky.end и sun каждого кадра — после stanok layers',
            'effects.actors — после stanok actor (изюминки: %s)' % '; '.join('%s: %s' % (f['key'], ', '.join(('★ ' if h['star'] else '') + h['name'] for h in f['heroes'])) for f in P['frames'] if not f['spare'] or spare),
            'effects.show — после stanok show (кадры: %s)' % (', '.join(f['key'] for f in P['frames'] if f['show']) or 'нет'),
            'caption hy и en, text — после вычитки (черновики в buildings-next/%s/story.md)' % P['slug']]
    return {'format': 2, 'id': P['slug'], 'source': 'buildings-next/%s/ (пакет здания, stanok init)' % P['slug'], 'notYet': todo,
            'text': {'title': P['names']}, 'look': {'frameSize': FRAME_SIZE, 'sunSide': 'left'}, 'effects': {}, 'frames': frames}


def init(slug, force=False, spare=False, root=None, repo=None, quiet=False):
    """Пакет → заготовка здания. Красный гейт пакета — стоп, ничего не пишется. Готовую заготовку не перезаписывает (--force — прежняя
    уходит в work/<slug>/replaced/). Возвращает список созданного."""
    repo = Path(repo or ROOT)
    probs = gate_pack(slug, root)
    if probs:
        raise SystemExit('ОШИБКА init: пакет buildings-next/%s не проходит гейт (stanok.py check --story %s):\n   - %s' % (slug, slug, '\n   - '.join(probs[:20])))
    P = read_pack(slug, root)
    bdir, work = repo / 'tests' / slug, repo / 'work' / slug
    made = []
    cfg = bdir / 'building.e2.json'
    sk = skeleton(P, spare)
    if cfg.is_file() and not force:
        if not quiet:
            print('заготовка уже есть: %s — не трогаю (перезаписать: --force)' % cfg.relative_to(repo))
    else:
        if cfg.is_file():
            (work / 'replaced').mkdir(parents=True, exist_ok=True)
            n = len(list((work / 'replaced').glob('building.e2.*.json'))) + 1
            shutil.copyfile(cfg, work / 'replaced' / ('building.e2.%d.json' % n))
        (bdir / 'frames').mkdir(parents=True, exist_ok=True)
        cfg.write_text(json.dumps(sk, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
        made.append(str(cfg.relative_to(repo)))
    zp = bdir / 'zones.json'
    if not zp.is_file():
        zp.write_text(json.dumps({'about': 'Запретные зоны для надписей и предметов («не на святое»). rect [u0, v0, u1, v1] в долях кадра заполняется '
                                           'после рисунков дня; пока rect: null — зона не сверяется (stanok insert предупреждает).',
                                  'forbidden': [{'frame': '*', 'rect': None, 'why': z} for z in P['zones']]}, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
        made.append(str(zp.relative_to(repo)))
    for sub in ['ref', 'research', 'inserts', 'veo'] + ['masters/' + f['name'] for f in sk['frames']]:
        if not (work / sub).is_dir():
            (work / sub).mkdir(parents=True, exist_ok=True)
            made.append('work/%s/%s/' % (slug, sub))
    for fn in ('story.md', 'sources.md'):                         # RUNBOOK §3: копии; истина — в пакете
        shutil.copyfile(P['dir'] / fn, work / fn)
    steps = status(slug, root=root, repo=repo, quiet=True)
    if not quiet:
        print('init %s: кадров %d (%s), создано: %s' % (slug, len(sk['frames']), ', '.join(f['name'] for f in sk['frames']), ', '.join(made) or 'ничего нового'))
        print(steps['text'])
    return made


# ---------------------------------------------------------------- status: список шагов по файлам
def status(slug, root=None, repo=None, quiet=False):
    """Список шагов здания (docs/STANOK.md §1.2) с отметками по тому, что лежит на диске. Пишет work/<slug>/STEPS.md."""
    repo = Path(repo or ROOT)
    bdir, work = repo / 'tests' / slug, repo / 'work' / slug
    cfg = json.loads((bdir / 'building.e2.json').read_text(encoding='utf-8')) if (bdir / 'building.e2.json').is_file() else None
    names = [f['name'] for f in cfg['frames']] if cfg else []
    fdir = bdir / 'frames'
    pack_ok = (Path(root or PACKS) / slug).is_dir() and not gate_pack(slug, root)
    mark = lambda ok: '✅' if ok else '⬜'
    lines, nxt = ['# %s — шаги станка (считает `stanok.py status %s`; руками не править)' % (slug, slug), ''], None

    def step(code, title, done, total, cmd):
        nonlocal nxt
        ok = total > 0 and done == total
        lines.append('%s %s %s — %d из %d' % (mark(ok), code, title, done, total))
        if not ok and nxt is None:
            nxt = '%s: %s' % (code, cmd)
    lines.append('%s S0–S1 пакет buildings-next/%s проходит гейт' % (mark(pack_ok), slug))
    if not pack_ok and nxt is None:
        nxt = 'S1: python3 tools/stanok.py check --story %s' % slug
    lines.append('%s заготовка tests/%s/building.e2.json' % (mark(bool(cfg)), slug))
    if not cfg and nxt is None:
        nxt = 'init: python3 tools/stanok.py init %s' % slug
    M = lambda n, v: (work / 'masters' / n / (v + '.png')).is_file()
    step('S2', 'рисунки дня приняты (masters/<кадр>/day.png)', sum(M(n, 'day') for n in names), len(names),
         'Gemini Pro по buildings-next/%s/prompts.md §1 → python3 tools/stanok.py intake tests/%s <кадр> day <файл>' % (slug, slug))
    kinds = {f['name']: f.get('kind') for f in (cfg or {}).get('frames', [])}
    need = [(n, v) for n in names for v in ('bg', 'night', 'snow') if not (v in ('bg', 'snow') and kinds[n] == 'interior')]
    step('S3', 'версии приняты (подложка, ночь, зима)', sum(M(n, v) for n, v in need), len(need),
         'Gemini-правка дня в НОВОМ чате с точным файлом → python3 tools/stanok.py intake tests/%s <кадр> bg|night|snow <файл>' % slug)
    L = lambda n: all((fdir / (n + suf)).is_file() for suf in ('.webp', '_depth.webp', '_bg.webp', '_building.webp', '_env.webp', '_night.webp'))
    step('S4', 'слои собраны (frames/)', sum(L(n) for n in names), len(names), 'python3 tools/stanok.py layers tests/%s' % slug)
    heroes = sum(1 for f in (cfg or {}).get('frames', []) for a in ((f.get('effects') or {}).get('actors') or {}).get('list', []) if a.get('emotion'))
    step('S5', 'изюминки с роликом (нужно ≥ 2)', min(heroes, 2), 2, 'Veo по prompts.md §7 → stanok actor (шаг ещё не в станке: П4, пункт 5)')
    jp = work / 'journal.json'
    ins = len(json.loads(jp.read_text(encoding='utf-8')).get('inserts', [])) if jp.is_file() else 0
    lines.append('·  S6 вставок в журнале: %d (python3 tools/stanok.py insert tests/%s <кадр> <правка.png> --box …)' % (ins, slug))
    lines.append('·  S8 сборка и гейты: python3 tools/stanok.py check tests/%s --selftest (после S4)' % slug)
    lines += ['', 'Следующий шаг — ' + (nxt or 'S8: сборка и гейты, затем бета')]
    text = '\n'.join(lines)
    if work.is_dir():
        (work / 'STEPS.md').write_text(text + '\n', encoding='utf-8')
    if not quiet:
        print(text)
    return {'text': text, 'next': nxt}
