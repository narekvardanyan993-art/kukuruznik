#!/usr/bin/env python3
"""Локальный сервер, похожий на GitHub Pages: текст сжимается gzip (html, js, svg, css, json), кэш выключен.

  python3 tools/dev_gzip_server.py [порт] [папка]     # по умолчанию 8081 и текущая папка
Нужен, чтобы проверять загрузку при медленной сети: размер передачи считается как в проде.
"""
import gzip
import os
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

TEXT = ('.html', '.js', '.svg', '.css', '.json', '.txt')


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def do_GET(self):
        path = self.translate_path(self.path.split('?')[0])
        if os.path.isdir(path):
            path = os.path.join(path, 'index.html')
        if path.endswith(TEXT) and os.path.isfile(path) and 'gzip' in self.headers.get('Accept-Encoding', ''):
            data = gzip.compress(open(path, 'rb').read(), 6)
            self.send_response(200)
            self.send_header('Content-Type', self.guess_type(path))
            self.send_header('Content-Encoding', 'gzip')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        else:
            super().do_GET()

    def log_message(self, *a):
        pass


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8081
    root = sys.argv[2] if len(sys.argv) > 2 else os.getcwd()
    ThreadingHTTPServer(('', port), partial(Handler, directory=root)).serve_forever()
