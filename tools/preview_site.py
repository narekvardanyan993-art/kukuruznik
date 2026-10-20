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
  4. сервер без кэша (Cache-Control: no-store), IPv6 + IPv4, слушает всю домашнюю сеть — iPhone в той же Wi-Fi открывает адрес
     «для iPhone»; 404 — страницей сайта 404.html. Старый сервер предпросмотра на том же порту останавливается (s39: из-за него
     /lenin/ давал 404), после запуска скрипт сам открывает все страницы по каждому адресу и пишет итог.
Папка предпросмотра пересобирается с нуля при каждом запуске (это копия, не исходник).
"""
import argparse
import io
import os
import shutil
import signal
import socket
import subprocess
import sys
import tarfile
import threading
import time
import urllib.error
import urllib.request
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


PAGES = ['', 'lenin/', 'lenin/about.html', 'lenin/history.html', 'kukuruznik/', 'kukuruznik/about.html', 'kukuruznik/history.html']


def lan_ip():
    """Адрес Мака в домашней сети (для iPhone): сначала ipconfig (Wi-Fi en0/en1), иначе — выбор интерфейса без отправки пакетов."""
    for ifc in ('en0', 'en1'):
        try:
            ip = subprocess.run(['ipconfig', 'getifaddr', ifc], capture_output=True, text=True, timeout=3).stdout.strip()
            if ip:
                return ip
        except (OSError, subprocess.SubprocessError):
            pass
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


def port_owner(port):
    """Кто уже слушает порт: [(pid, команда)] (через lsof; нет lsof — пусто)."""
    try:
        pids = subprocess.run(['lsof', '-nP', '-iTCP:%d' % port, '-sTCP:LISTEN', '-t'], capture_output=True, text=True, timeout=5).stdout.split()
    except (OSError, subprocess.SubprocessError):
        return []
    out = []
    for pid in sorted(set(pids)):
        try:
            cmd = subprocess.run(['ps', '-o', 'command=', '-p', pid], capture_output=True, text=True, timeout=5).stdout.strip()
        except (OSError, subprocess.SubprocessError):
            cmd = ''
        out.append((int(pid), cmd))
    return out


OUR_SERVERS = ('http.server', 'preview_site.py', 'dev_gzip_server.py')   # старые предпросмотры (s35 preview-hub, start.command) — их можно гасить


def free_port(port):
    """s39: причина «404 у Ленина» — на 8777 ещё работал старый сервер предпросмотра главной (s35, папка preview-hub, где /lenin/ —
    ссылка на tests/lenin без index.html) или start.command (корень репозитория — там тоже нет lenin/). Новый сервер не мог занять порт
    (или занимал только IPv4), и localhost открывал старую папку. Теперь: свой старый сервер на порту — останавливаем; чужой — берём
    следующий свободный порт. Возвращает порт, который можно занять."""
    for p in range(port, port + 20):
        owners = port_owner(p)
        mine = [(pid, cmd) for pid, cmd in owners if any(k in cmd for k in OUR_SERVERS)]
        for pid, cmd in mine:
            print('  на порту %d работал старый сервер предпросмотра (pid %d: %s) — останавливаю' % (p, pid, cmd[:90]))
            try:
                os.kill(pid, signal.SIGTERM)
            except OSError as e:
                print('    не вышло: %s' % e)
        if mine:
            for _ in range(30):
                if not port_owner(p):
                    break
                time.sleep(0.1)
        if not port_owner(p) and can_bind(p):
            if p != port:
                print('  порт %d занят чужой программой — беру %d' % (port, p))
            return p
    raise SystemExit('СТОП: порты %d–%d заняты' % (port, port + 19))


def can_bind(port):
    for fam, host in ((socket.AF_INET6, '::'), (socket.AF_INET, '0.0.0.0')):
        try:
            s = socket.socket(fam, socket.SOCK_STREAM)
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)   # хвосты TIME_WAIT от старого сервера не мешают; живой слушатель — мешает (его ловит lsof выше)
            if fam == socket.AF_INET6:
                s.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
            s.bind((host, port))
            s.close()
            return True
        except OSError:
            continue
    return False


class DualStackServer(ThreadingHTTPServer):
    """Слушает и IPv6, и IPv4 на одном порту: «localhost» в Safari/Chrome часто идёт по IPv6 (::1), iPhone — по IPv4."""
    address_family = socket.AF_INET6
    allow_reuse_address = True   # как у http.server: хвосты TIME_WAIT не мешают; живого слушателя на порту к этому моменту нет (free_port)

    def server_bind(self):
        self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
        super().server_bind()


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def send_error(self, code, message=None, explain=None):
        """404 — страницей сайта 404.html, как на GitHub Pages (она же переводит /lenin, /kukuruznik на их адреса)."""
        nf = Path(self.directory) / '404.html'
        if code == 404 and nf.is_file():
            body = nf.read_bytes()
            self.send_response(404)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            if self.command != 'HEAD':
                self.wfile.write(body)
            return
        super().send_error(code, message, explain)

    def log_message(self, fmt, *args):   # тихо: только ошибки
        if args and str(args[1])[:1] in '45':
            sys.stderr.write('  %s %s\n' % (args[1], args[0]))


def self_check(out, hosts, port):
    """Сам открывает главную и страницы зданий по каждому адресу: 200 и главная — именно из этой папки (не старый сервер)."""
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    want = (Path(out) / 'index.html').read_bytes()
    bad = []
    for host in hosts:
        for pg in PAGES:
            url = 'http://%s:%d/%s' % (host, port, pg)
            try:
                with opener.open(url, timeout=5) as r:
                    body = r.read()
                    if pg == '' and body != want:
                        bad.append('%s — отдаёт НЕ эту папку предпросмотра (старый сервер?)' % url)
            except urllib.error.HTTPError as e:
                bad.append('%s — %d' % (url, e.code))
            except OSError as e:
                bad.append('%s — %s' % (url, e))
    return bad


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
    port = free_port(args.port)
    handler = partial(Handler, directory=args.out)
    try:
        srv = DualStackServer(('::', port), handler)
    except OSError:   # нет IPv6 — только IPv4
        srv = ThreadingHTTPServer(('0.0.0.0', port), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    ip = lan_ip()
    hosts = ['localhost', '127.0.0.1'] + ([ip] if ip else [])
    bad = self_check(args.out, hosts, port)
    print('\nМак:    http://localhost:%d/' % port)
    print('iPhone: %s' % ('http://%s:%d/   (та же Wi-Fi, что у Мака)' % (ip, port) if ip else 'адрес сети не найден — Мак не в Wi-Fi?'))
    print('Страницы: ' + ' · '.join('/' + p for p in PAGES))
    if bad:
        print('\nПРОВЕРКА АДРЕСОВ — ЕСТЬ ОШИБКИ:\n  • ' + '\n  • '.join(bad))
    else:
        print('Проверка адресов: главная, оба здания, их about и history — 200 (%s)' % ', '.join(hosts))
    print('Остановить: Ctrl+C\n', flush=True)
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        srv.shutdown()
        print('\nсервер остановлен')


if __name__ == '__main__':
    main()
