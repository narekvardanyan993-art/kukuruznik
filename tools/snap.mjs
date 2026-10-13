#!/usr/bin/env node
// Быстрые НАСТОЯЩИЕ снимки здания в Chrome (s19, 14.10.2026) — то, что видит браузер, а не Python-имитация движка.
//
// В отличие от tools/check_site.mjs здесь НЕ подменяется время: страница живёт по настоящим часам (видео, фигуры, ветер),
// поэтому снимки не воспроизводимы кадр в кадр — это инструмент «посмотреть глазами», а не проверка перед публикацией.
// Браузер запускается с теми же флагами, что у check_site (GPU Metal на Маке, swiftshader в облаке).
//
// Что снимает (телефон 390×844): каждый кадр днём и ночью — <tod>-f<N>.png; для движения — два снимка дня с паузой
// (--gap, 3 с): day-f<N>-m0.png / -m1.png и day-f<N>-motion.png (второй снимок, красным — где картинка изменилась),
// и замер по рамкам фигур кадра (figures): сколько пикселей поменялось внутри каждой фигуры. Итог — summary.md / summary.json.
// Камера на время снимков стоит (?still=1: без «дыхания»), детали не выключаются по fps (?perf=0).
//
// Использование (из корня репозитория, обычный Терминал):
//   node tools/snap.mjs                         # собрать бету из рабочей папки во временную папку и снять Ленина
//   node tools/snap.mjs --page beta/tests/lenin/ --frames 0,4 --tods day
//   node tools/snap.mjs --site DIR              # уже собранный сайт (корень с beta/)
//   node tools/snap.mjs --url https://chka.am/beta/tests/lenin/   # живой адрес
//   --out DIR (по умолчанию ~/Documents/chka-kitchen/_снимки/<время>)  --gap 3000  --no-motion  --dsf 1|2
//   --renderer metal|swiftshader  --chrome PATH (свой Chrome/Chromium)  --timeout 170 (секунд на всё, потом выход с кодом 2)
// Код выхода: 0 — снято, 1 — снято, но на странице были ошибки, 2 — не смогло отработать.
import puppeteer from 'puppeteer';
import { PNG } from 'pngjs';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KITCHEN = path.join(os.homedir(), 'Documents', 'chka-kitchen');
const T0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(0).padStart(4)}с]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- аргументы ----------
const opt = { page: 'beta/tests/lenin/', gap: 3000, motion: true, dsf: 1, timeout: 170, renderer: os.platform() === 'darwin' ? 'metal' : 'swiftshader', tods: ['day', 'night'] };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i], val = () => argv[++i];
  if (a === '--site') opt.site = path.resolve(val());
  else if (a === '--page') opt.page = val().replace(/^\/+/, '');
  else if (a === '--url') opt.url = val();
  else if (a === '--out') opt.out = path.resolve(val());
  else if (a === '--frames') opt.frames = val().split(',').map(Number);
  else if (a === '--tods') opt.tods = val().split(',');
  else if (a === '--gap') opt.gap = +val();
  else if (a === '--no-motion') opt.motion = false;
  else if (a === '--dsf') opt.dsf = +val();
  else if (a === '--renderer') opt.renderer = val();
  else if (a === '--chrome') opt.chrome = val();
  else if (a === '--timeout') opt.timeout = +val();
  else if (a === '-h' || a === '--help') { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 19).map((l) => l.replace(/^\/\/ ?/, '')).join('\n')); process.exit(0); }
  else { console.error('неизвестный параметр', a); process.exit(2); }
}
const stamp = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 19).replace(/[:T]/g, '-');
const OUT = opt.out || path.join(fs.existsSync(KITCHEN) ? path.join(KITCHEN, '_снимки') : path.join(os.tmpdir(), 'chka-snap'), stamp);
fs.mkdirSync(OUT, { recursive: true });

const killer = setTimeout(() => { console.error(`СТОП: дольше ${opt.timeout} с — снимки не закончены (что успело — в ${OUT})`); process.exit(2); }, opt.timeout * 1000);

// ---------- сайт: своя сборка беты во временной папке (как у check_site: дерево origin/main + build_pages --beta-only) ----------
function buildLocalSite() {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'chka-snap-site-'));
  const commit = spawnSync('git', ['-C', ROOT, 'rev-parse', 'origin/main^{commit}'], { encoding: 'utf8' }).stdout.trim();
  if (!commit) throw new Error('нет origin/main (git fetch origin main)');
  const ar = spawnSync('git', ['-C', ROOT, 'archive', commit, '--', '.', ':(exclude)docs', ':(exclude)tools', ':(exclude)src', ':(exclude)engine3d', ':(exclude)test-assets', ':(exclude)beta'], { maxBuffer: 1 << 30 });
  if (ar.status !== 0) throw new Error('git archive: ' + ar.stderr);
  const tar = spawnSync('tar', ['-x', '-C', dest], { input: ar.stdout, maxBuffer: 1 << 30 });
  if (tar.status !== 0) throw new Error('tar: ' + tar.stderr);
  const b = spawnSync('python3', [path.join(ROOT, 'tools', 'build_pages.py'), '--site', dest, '--beta-only'], { encoding: 'utf8' });
  if (b.status !== 0) throw new Error('build_pages: ' + (b.stderr || b.stdout).slice(-600));
  return dest;
}

// ---------- статический сервер (как GitHub Pages) ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8', '.ico': 'image/x-icon', '.mp4': 'video/mp4', '.webm': 'video/webm', '.webmanifest': 'application/manifest+json' };
function serve(root) {
  const srv = http.createServer((q, r) => {
    const p = decodeURIComponent(q.url.split('?')[0]);
    let f = path.join(root, p);
    if (!f.startsWith(root)) { r.writeHead(403); r.end(); return; }
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) {
      if (!p.endsWith('/')) { r.writeHead(301, { Location: p + '/' + (q.url.includes('?') ? '?' + q.url.split('?')[1] : '') }); r.end(); return; }
      f = path.join(f, 'index.html');
    }
    if (!fs.existsSync(f)) { r.writeHead(404); r.end('not found'); return; }
    const size = fs.statSync(f).size, type = MIME[path.extname(f).toLowerCase()] || 'application/octet-stream';
    const m = /bytes=(\d*)-(\d*)/.exec(q.headers.range || '');   // видео синемаграфа просит куски файла
    if (m) {
      const s = m[1] ? +m[1] : 0, e = m[2] ? +m[2] : size - 1;
      r.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${s}-${e}/${size}`, 'Accept-Ranges': 'bytes', 'Content-Length': e - s + 1, 'Cache-Control': 'no-store' });
      fs.createReadStream(f, { start: s, end: e }).pipe(r);
      return;
    }
    r.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' });
    fs.createReadStream(f).pipe(r);
  });
  return new Promise((res) => srv.listen(0, '127.0.0.1', () => res({ port: srv.address().port, close: () => srv.close() })));
}

// ---------- браузер: флаги как у check_site (launchBrowsers), но без подмены времени ----------
async function launch() {
  const gpu = opt.renderer === 'swiftshader' ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu'];
  const common = ['--disable-features=CanvasNoise', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required', '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1'];
  const o = { headless: 'new', args: [...gpu, ...common] };
  if (opt.chrome || process.env.CHROME_PATH) o.executablePath = opt.chrome || process.env.CHROME_PATH;
  if (process.getuid && process.getuid() === 0) o.args.push('--no-sandbox');   // облачный Linux под root
  return puppeteer.launch(o);
}

// ---------- сравнение двух снимков ----------
function readPng(f) { return PNG.sync.read(fs.readFileSync(f)); }
function motionImage(a, b, outF, thr) {
  const o = new PNG({ width: b.width, height: b.height });
  let n = 0;
  for (let i = 0; i < b.data.length; i += 4) {
    const d = Math.max(Math.abs(a.data[i] - b.data[i]), Math.abs(a.data[i + 1] - b.data[i + 1]), Math.abs(a.data[i + 2] - b.data[i + 2]));
    const g = (b.data[i] * 0.3 + b.data[i + 1] * 0.59 + b.data[i + 2] * 0.11) * 0.55;
    if (d > thr) { n++; o.data[i] = 255; o.data[i + 1] = 30; o.data[i + 2] = 30; } else { o.data[i] = o.data[i + 1] = o.data[i + 2] = g; }
    o.data[i + 3] = 255;
  }
  fs.writeFileSync(outF, PNG.sync.write(o));
  return n;
}
function boxStats(a, b, box, thr) {   // box: [x0,y0,x1,y1] css px × dsf
  const W = b.width, H = b.height;
  const x0 = Math.max(0, Math.floor(box[0])), y0 = Math.max(0, Math.floor(box[1])), x1 = Math.min(W - 1, Math.ceil(box[2])), y1 = Math.min(H - 1, Math.ceil(box[3]));
  let n = 0, mx = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = (y * W + x) * 4;
    const d = Math.max(Math.abs(a.data[i] - b.data[i]), Math.abs(a.data[i + 1] - b.data[i + 1]), Math.abs(a.data[i + 2] - b.data[i + 2]));
    if (d > thr) n++;
    if (d > mx) mx = d;
  }
  return { n, mx, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

async function main() {
  let root = null, srv = null, url = opt.url;
  if (!url) {
    root = opt.site || (log('сборка беты из рабочей папки…'), buildLocalSite());
    srv = await serve(root);
    url = `http://127.0.0.1:${srv.port}/${opt.page}`;
  }
  url += (url.includes('?') ? '&' : '?') + 'perf=0&still=1';
  log('страница', url, '| снимки →', OUT);
  const browser = await launch();
  const problems = [];
  const summary = { url, renderer: opt.renderer, date: new Date().toISOString(), shots: [], motion: [], problems };
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => problems.push('ошибка страницы: ' + String(e.message).slice(0, 300)));
    page.on('console', (m) => { if (m.type() === 'error') problems.push('console.error: ' + m.text().slice(0, 300)); });
    page.on('response', (r) => { if (r.status() >= 400 && r.url().startsWith('http://127.0.0.1')) problems.push('HTTP ' + r.status() + ' ' + r.url().replace(/^http:\/\/127\.0\.0\.1:\d+/, '')); });
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: opt.dsf, isMobile: true, hasTouch: true });
    await page.goto(url, { waitUntil: 'load', timeout: 60000 });
    for (let i = 0; i < 360; i++) {   // до 90 с: все кадры загружены
      const ok = await page.evaluate(() => document.documentElement.getAttribute('data-loaded') === 'all' && !document.getElementById('stage').classList.contains('loading')).catch(() => false);
      if (ok) break;
      if (i === 359) throw new Error('страница не загрузилась за 90 с');
      await sleep(250);
    }
    log('загружено');
    await page.evaluate(() => { const w = document.getElementById('welcome'); if (w) w.remove(); });
    await sleep(800);
    const n = await page.evaluate(() => document.querySelectorAll('#dots span').length);
    const frames = (opt.frames || [...Array(n).keys()]).filter((f) => f < n);
    const goto_ = async (f) => {
      for (let guard = 0; guard < 12; guard++) {
        const cur = await page.evaluate(() => window.__viewer.frame());
        if (cur === f) break;
        await page.keyboard.press(((f - cur) + n) % n <= n / 2 ? 'ArrowRight' : 'ArrowLeft');
        await sleep(150);
        for (let k = 0; k < 60 && (await page.evaluate(() => window.__viewer.fading())); k++) await sleep(100);
      }
      for (let k = 0; k < 40 && (await page.evaluate(() => !!(window.__viewer.mvBusy && window.__viewer.mvBusy()))); k++) await sleep(100);   // видео кадра уже в текстуре
      await sleep(700);
    };
    const shot = async (name) => { const f = path.join(OUT, name + '.png'); await page.screenshot({ path: f, type: 'png' }); summary.shots.push(name + '.png'); return f; };
    for (const tod of opt.tods) {
      if (tod !== 'day') {
        await page.evaluate((t) => { const b = document.querySelector('#todSeg [data-tod=' + t + ']'); if (b) b.click(); }, tod);
        for (let k = 0; k < 80; k++) { const v = await page.evaluate(() => window.__viewer.tod.night); if (v >= 0.999) break; await sleep(100); }
        await sleep(600);
      }
      for (const f of frames) {
        await goto_(f);
        const fa = await shot(`${tod}-f${f}`);
        if (tod === 'day' && opt.motion) {
          await sleep(opt.gap);
          const fb = await shot(`${tod}-f${f}-m1`);
          fs.copyFileSync(fa, path.join(OUT, `${tod}-f${f}-m0.png`));
          const A = readPng(fa), B = readPng(fb), thr = 14;
          const all = motionImage(A, B, path.join(OUT, `${tod}-f${f}-motion.png`), thr);
          const boxes = await page.evaluate((fi, dsf) => {   // рамки фигур кадра на экране (камера стоит — глубина не важна)
            const fig = (typeof CONFIG !== 'undefined' && CONFIG.FIGURES && CONFIG.FIGURES[fi] && CONFIG.FIGURES[fi].items) || [];
            const e = window.__viewer.entry(fi);
            return fig.map((it) => { const p = window.__viewer.project(e, it[0], it[1], 0.5), q = window.__viewer.project(e, it[2], it[3], 0.5); return { type: it[4], box: [p[0] * dsf - 2, p[1] * dsf - 2, q[0] * dsf + 2, q[1] * dsf + 2] }; });
          }, f, opt.dsf);
          const per = boxes.map((b) => ({ type: b.type, ...boxStats(A, B, b.box, thr) }));
          const moved = per.filter((p) => p.n > 0).length;
          summary.motion.push({ frame: f, changedPx: all, figures: per.length, moved, per });
          log(`день, кадр ${f + 1}: фигур ${per.length}, сдвинулись за ${opt.gap / 1000} с — ${moved}; пикселей изменилось по кадру ${all}`);
        }
      }
    }
    summary.figState = await page.evaluate(() => (window.__viewer.figs ? window.__viewer.figs() : null)).catch(() => null);
  } finally {
    await browser.close().catch(() => {});
    if (srv) srv.close();
  }
  const md = ['# snap — настоящие снимки Chrome', '', `- страница: ${url}`, `- рендер: ${opt.renderer}`, `- снимков: ${summary.shots.length}`, `- ошибки страницы: ${problems.length ? '' : 'нет'}`]
    .concat(problems.map((p) => '  - ' + p))
    .concat(summary.motion.length ? ['', '## Движение фигур (два снимка дня с паузой ' + opt.gap / 1000 + ' с)', '', '| кадр | фигур | сдвинулись | пикселей в фигурах | по кадру |', '|---|---|---|---|---|']
      .concat(summary.motion.map((m) => `| ${m.frame + 1} | ${m.figures} | ${m.moved} | ${m.per.reduce((s, p) => s + p.n, 0)} | ${m.changedPx} |`)) : [])
    .concat(summary.figState ? ['', 'состояние фигур (движок): ' + JSON.stringify(summary.figState)] : []);
  fs.writeFileSync(path.join(OUT, 'summary.md'), md.join('\n') + '\n');
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 1));
  clearTimeout(killer);
  log(`готово за ${((Date.now() - T0) / 1000).toFixed(0)} с: ${OUT}` + (problems.length ? ` | ошибок страницы: ${problems.length}` : ''));
  if (root && !opt.site) fs.rmSync(root, { recursive: true, force: true });
  process.exit(problems.length ? 1 : 0);
}
main().catch((e) => { console.error('snap не отработал:', e.message); process.exit(2); });
