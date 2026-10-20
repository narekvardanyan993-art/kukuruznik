#!/usr/bin/env python3
"""Предпросмотр ВСЕГО сайта так, как он будет выглядеть вживую (s38, 21.10.2026) — смотреть на Маке и на iPhone до публикации.

  python3 tools/preview_site.py                 # собрать в ~/Documents/chka-kitchen/preview и запустить сервер на 8777
  python3 tools/preview_site.py --no-serve      # только собрать
  python3 tools/preview_site.py --port 8080 --out ПАПКА
Остановить сервер: Ctrl+C в этом же окне Терминала.

Как собирается (репозиторий и main не меняются, git не трогается — только чтение):
  1. основа — живой сайт: git archive origin/main (всё, что не трогает ветка, — как на chka.am);
  2. главная из ветки: index.html (+ карточки/стопки живых тестовых зданий из building.json, как в publish_building) и вся папка assets/;
  3. страницы зданий собираются из ветки: движок engine/ ветки, /lenin/ (кадры, about, history, галерея — tools/build_pages.place_live_files),
     /kukuruznik/ (страница движка + kukuruznik/about.html и history.html из ветки);
  4. сервер без кэша (Cache-Control: no-store), слушает всю домашнюю сеть — iPhone в той же Wi-Fi открывает адрес «для iPhone».
Папка предпросмотра пересобирается с нуля при каждом запуске (это копия, не исходник).
"""
import argparse
import io
import os
import shutil
import socket
import subprocess
import sys
import tarfile
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_pages as bp   # noqa: E402

ROOT = bp.ROOT
DEFAULT_OUT = Path.home() / 'Documents' / 'chka-kitchen' / 'preview'
KUK_PAGES = ('about.html', 'history.html')   # страницы Кукурузника вне движка (лежат в ветке как есть)


def git(*args):
    r = subprocess.run(['git', '-C', str(ROOT)] + list(args), capture_output=True)
    if r.returncode:
        raise SystemExit('git %s: %s' % (' '.join(args), r.stderr.decode('utf-8', 'replace').strip()))
    return r.stdout


def build(out, ref):
    out = Path(out)
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    # 1. живой сайт
    with tarfile.open(fileobj=io.BytesIO(git('archive', ref)), mode='r:') as t:
        t.extractall(out, filter='data') if sys.version_info >= (3, 12) else t.extractall(out)
    if not (out / 'CNAME').exists():
        raise SystemExit('%s — не похоже на сайт (нет CNAME)' % ref)
    # 2. главная и стили/скрипты из ветки
    shutil.copytree(ROOT / 'assets', out / 'assets', dirs_exist_ok=True, ignore=shutil.ignore_patterns('source', '.*'))
    hub = (ROOT / 'index.html').read_text(encoding='utf-8')
    tl = bp.test_live_slugs()
    for slug in tl:
        hub = bp.hub_with_card(hub, slug, bp.render_card(slug), bp.render_stack(slug))
    (out / 'index.html').write_text(hub, encoding='utf-8')
    # 3. здания из ветки: файлы тестовых живых зданий (lenin), страницы Кукурузника, движок ветки
    slugs = bp.live_buildings(site=out)   # до place_live_files: та очищает папку здания вместе с index.html
    for slug in tl:
        bp.place_live_files(out, slug)
    for name in KUK_PAGES:
        if (ROOT / 'kukuruznik' / name).is_file():
            shutil.copyfile(ROOT / 'kukuruznik' / name, out / 'kukuruznik' / name)
    shutil.copyfile(ROOT / 'kukuruznik' / 'card.webp', out / 'kukuruznik' / 'card.webp')
    bp.build_live(out, slugs, engine_from=ROOT / 'engine')
    return slugs


def lan_ip():
    """Адрес Мака в домашней сети (для iPhone). Пакет никуда не отправляется — только выбор сетевого интерфейса."""
    for probe in ('192.168.0.1', '10.255.255.255', '8.8.8.8'):
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect((probe, 1))
            ip = s.getsockname()[0]
            s.close()
            if not ip.startswith('127.'):
                return ip
        except OSError:
            pass
    return None


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, fmt, *args):   # тихо: только ошибки
        if args and str(args[1])[:1] in '45':
            sys.stderr.write('  %s %s\n' % (args[1], args[0]))


def main():
    ap = argparse.ArgumentParser(description='Предпросмотр всего сайта из ветки (главная + здания + about/history) с сервером.')
    ap.add_argument('--out', default=str(DEFAULT_OUT), help='папка предпросмотра (пересоздаётся), по умолчанию %s' % DEFAULT_OUT)
    ap.add_argument('--port', type=int, default=8777)
    ap.add_argument('--ref', default='origin/main', help='основа — живой сайт (по умолчанию origin/main)')
    ap.add_argument('--no-serve', action='store_true', help='только собрать, без сервера')
    args = ap.parse_args()
    slugs = build(args.out, args.ref)
    print('Предпросмотр собран: %s' % args.out)
    print('  здания: %s · движок ветки %s' % (', '.join(slugs), bp.engine_version()))
    if args.no_serve:
        return
    ip = lan_ip()
    pages = ['', 'lenin/', 'lenin/about.html', 'lenin/history.html', 'kukuruznik/', 'kukuruznik/about.html', 'kukuruznik/history.html']
    print('\nМак:    http://localhost:%d/' % args.port)
    print('iPhone: %s' % ('http://%s:%d/   (та же Wi-Fi, что у Мака)' % (ip, args.port) if ip else 'адрес сети не найден — Мак не в Wi-Fi?'))
    print('Страницы: ' + ' · '.join('/' + p for p in pages))
    print('Остановить: Ctrl+C\n', flush=True)
    srv = ThreadingHTTPServer(('0.0.0.0', args.port), partial(Handler, directory=args.out))
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print('\nсервер остановлен')


if __name__ == '__main__':
    main()
