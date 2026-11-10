#!/usr/bin/env node
// stanok_look — эталонные снимки здания для прогона П0 станка (docs/STANOK.md §2.4 п.1, §7 П0). Первая версия будущего `stanok look`.
// Для каждой страницы здания: каждый кадр × 5 состояний (День, Закат, Ночь, Снег, Дождь) × 3 наклона, телефон 390×844,
// виртуальное время (шаг 32 мс) и зафиксированная случайность (как tools/check_site.mjs), адрес ?still=1&perf=0.
// Снег и дождь — днём (кнопки осадков), закат и ночь — без осадков.
// Наклоны: (-1,-1), (0,0), (1,1) — оба крайних по обеим осям (на y=1 включается приближение).
// Итог: <out>/<страница>/f<N>-<состояние>-t<L|C|R>.png и <out>/<страница>/shots.json (sha256 каждого PNG).
// Использование: node stanok_look.mjs --site DIR --page kukuruznik --out DIR --chrome PATH [--frames 0,1] [--states day,snow] [--tilts C]
import puppeteer from 'puppeteer-core';
import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const opt = { states: ['day', 'snow', 'rain', 'sunset', 'night'], tilts: ['L', 'C', 'R'], chrome: process.env.CHKA_CHROME || '/usr/bin/google-chrome' };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i], val = () => argv[++i];
  if (a === '--site') opt.site = path.resolve(val());
  else if (a === '--page') opt.page = val().replace(/^\/+|\/+$/g, '');
  else if (a === '--out') opt.out = path.resolve(val());
  else if (a === '--chrome') opt.chrome = val();
  else if (a === '--frames') opt.frames = val().split(',').map(Number);
  else if (a === '--states') opt.states = val().split(',');
  else if (a === '--tilts') opt.tilts = val().split(',');
  else { console.error('неизвестный параметр', a); process.exit(2); }
}
if (!opt.site || !opt.page || !opt.out) { console.error('нужны --site, --page, --out'); process.exit(2); }
const TILT = { L: [-1, -1], C: [0, 0], R: [1, 1] };
const VP = { width: 390, height: 844 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(0).padStart(4)}с]`, ...a);
const hashSeed = (s) => { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.webm': 'video/webm', '.svg': 'image/svg+xml', '.txt': 'text/plain' };
function serve(root) {   // как GitHub Pages (check_site.mjs)
  const srv = http.createServer((q, r) => {
    const p = decodeURIComponent(q.url.split('?')[0]);
    let f = path.join(root, p);
    if (!f.startsWith(root)) { r.writeHead(403); r.end(); return; }
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) {
      if (!p.endsWith('/')) { r.writeHead(301, { Location: p + '/' + (q.url.includes('?') ? '?' + q.url.split('?')[1] : '') }); r.end(); return; }
      f = path.join(f, 'index.html');
    }
    if (!fs.existsSync(f)) { r.writeHead(404, { 'Content-Type': MIME['.html'] }); r.end('not found'); return; }
    const size = fs.statSync(f).size, type = MIME[path.extname(f).toLowerCase()] || 'application/octet-stream', rg = /bytes=(\d*)-(\d*)/.exec(q.headers.range || '');
    if (rg) {   // Range — видео синемаграфа
      const s = rg[1] ? +rg[1] : 0, e = rg[2] ? Math.min(+rg[2], size - 1) : size - 1;
      r.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${s}-${e}/${size}`, 'Accept-Ranges': 'bytes', 'Content-Length': e - s + 1, 'Cache-Control': 'no-store' });
      fs.createReadStream(f, { start: s, end: e }).pipe(r);
      return;
    }
    r.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' });
    fs.createReadStream(f).pipe(r);
  });
  return new Promise((res) => srv.listen(0, '127.0.0.1', () => res({ port: srv.address().port, close: () => srv.close() })));
}

// Виртуальное время — копия INIT_SCRIPT из tools/check_site.mjs (без открытки и искр парада).
const INIT_SCRIPT = () => {
  let vt = 10000, q = [];
  window.__mvFreeze = true;
  const vplay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () { try { this.pause(); if (this.currentTime) this.currentTime = 0; } catch (e) {} return Promise.resolve(); };
  window.__realVideoPlay = vplay;
  performance.now = () => vt;
  window.requestAnimationFrame = (cb) => { q.push(cb); return q.length; };
  window.cancelAnimationFrame = () => {};
  // шаг 32 мс (движок режет dt до 64 мс): вдвое меньше кадров в программном WebGL
  window.__advance = (ms) => { const n = Math.ceil(ms / 32); for (let i = 0; i < n; i++) { vt += 32; const c = q; q = []; c.forEach((cb) => cb(vt)); } };
  let s = 12345;
  window.__seed = (n) => { s = n | 0; };
  Math.random = () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const st = document.createElement('style');
  st.textContent = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}.p-build,#build-version{visibility:hidden!important}';
  document.addEventListener('DOMContentLoaded', () => document.head.appendChild(st));
};
const settleDom = (page) => page.evaluate(async () => {
  const wait = (pr, ms) => Promise.race([pr, new Promise((r) => setTimeout(r, ms))]);
  void document.body.offsetHeight;
  if (document.fonts) { await wait(document.fonts.ready, 3000); for (let i = 0; i < 40 && document.fonts.status !== 'loaded'; i++) await new Promise((r) => setTimeout(r, 50)); }
});
const settleImages = (page) => page.evaluate(async () => {
  document.querySelectorAll('img[loading=lazy]').forEach((i) => { i.loading = 'eager'; });
  const t0 = Date.now();
  while (Date.now() - t0 < 6000 && [...document.images].some((i) => (i.currentSrc || i.src) && !i.complete)) await new Promise((r) => setTimeout(r, 100));
});

async function main() {
  const common = ['--disable-features=CanvasNoise', '--disable-partial-raster', '--run-all-compositor-stages-before-draw', '--disable-new-content-rendering-timeout', '--disable-threaded-animation', '--disable-threaded-scrolling', '--disable-checker-imaging', '--disable-image-animation-resync', '--disable-gpu-rasterization', '--hide-scrollbars', '--disable-lcd-text', '--font-render-hinting=none', '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1'];
  const gl = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'];
  const srv = await serve(opt.site);
  const origin = 'http://127.0.0.1:' + srv.port;
  const browser = await puppeteer.launch({ executablePath: opt.chrome, headless: 'new', protocolTimeout: 900000, args: [...gl, ...common] });
  const outDir = path.join(opt.out, opt.page.replace(/\//g, '_'));
  fs.mkdirSync(outDir, { recursive: true });
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push('pageerror: ' + String(e.message).slice(0, 200)));
  page.on('response', (r) => { if (r.status() >= 400 && r.url().startsWith(origin)) problems.push('HTTP ' + r.status() + ' ' + r.url().replace(origin, '')); });
  await page.setViewport({ width: VP.width, height: VP.height, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await page.evaluateOnNewDocument(INIT_SCRIPT);
  let advMs = 0, advT = 0;
  const adv = async (ms) => { const t = Date.now(); await page.evaluate((m) => window.__advance(m), ms); advMs += ms; advT += Date.now() - t; };
  const seed = (s) => page.evaluate((v) => window.__seed(v), hashSeed(`${opt.page}|${s}`));
  const gpuDone = () => page.evaluate(() => { const c = document.getElementById('gl'); const g = c && (c.getContext('webgl') || c.getContext('experimental-webgl')); if (g) { g.finish(); const px = new Uint8Array(4); g.readPixels(0, 0, 1, 1, g.RGBA, g.UNSIGNED_BYTE, px); } });
  const shots = {};
  const snap = async (name) => {
    const T = [Date.now()];
    for (let k = 0; k < 50 && (await page.evaluate(() => !!(window.__viewer && window.__viewer.mvBusy && window.__viewer.mvBusy()))); k++) { await sleep(100); await adv(32); }
    T.push(Date.now());
    await settleDom(page); T.push(Date.now());
    await gpuDone(); T.push(Date.now()); await sleep(60);
    const buf = await page.screenshot({ type: 'png' }); T.push(Date.now());
    fs.writeFileSync(path.join(outDir, name + '.png'), buf);
    shots[name + '.png'] = crypto.createHash('sha256').update(buf).digest('hex');
    if (process.env.PROF) log('  snap', name, 'mv', T[1] - T[0], 'dom', T[2] - T[1], 'gpu', T[3] - T[2], 'shot', T[4] - T[3]);
  };
  try {
    await page.goto(`${origin}/${opt.page}/?still=1&perf=0`, { waitUntil: 'load', timeout: 60000 });
    for (let i = 0; i < 960; i++) {   // до 4 минут реального времени; виртуальное стоит
      const ok = await page.evaluate(() => document.documentElement.getAttribute('data-loaded') === 'all' && !!window.Details && !document.getElementById('stage').classList.contains('loading')).catch(() => false);
      if (ok) break;
      if (i === 959) throw new Error('просмотрщик не загрузился за 4 минуты');
      await sleep(250);
    }
    log(opt.page, 'загружен');
    await page.evaluate(() => document.fonts && document.fonts.ready);
    await settleImages(page); await sleep(200);
    await page.evaluate(() => { const w = document.getElementById('welcome'); if (w) w.remove(); });
    const n = await page.evaluate(() => document.querySelectorAll('#dots span').length);
    const frames = (opt.frames || [...Array(n).keys()]).filter((f) => f < n);
    const fading = () => page.evaluate(() => window.__viewer.fading());
    const curFrame = () => page.evaluate(() => window.__viewer.frame());
    const goto_ = async (f) => {
      let cur = await curFrame(), guard = 0;
      while (cur !== f && guard++ < 12) {
        const fwd = ((f - cur) + n) % n <= n / 2;
        await seed(`go${f}`);
        await page.keyboard.press(fwd ? 'ArrowRight' : 'ArrowLeft');
        for (let k = 0; k < 60; k++) { await adv(100); if (!(await fading())) break; }
        cur = await curFrame();
      }
      await adv(600);
    };
    const click = (sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) throw new Error('нет кнопки ' + s); e.click(); }, sel);
    const apply = async (st) => {   // переход в состояние из любого предыдущего
      await seed('state-' + st);
      if (st === 'day') { await click('#todSeg [data-tod=day]'); await click('#precipSeg [data-precip=none]'); }
      else if (st === 'snow') { await click('#todSeg [data-tod=day]'); await click('#precipSeg [data-precip=snow]'); }
      else if (st === 'rain') { await click('#todSeg [data-tod=day]'); await click('#precipSeg [data-precip=rain]'); }
      else if (st === 'sunset') { await click('#precipSeg [data-precip=none]'); await click('#todSeg [data-tod=sunset]'); }
      else if (st === 'night') { await click('#precipSeg [data-precip=none]'); await click('#todSeg [data-tod=night]'); }
      await adv(st === 'night' || st === 'sunset' ? 3200 : 2600);
      if (process.env.PROF) log('  state applied', st);
    };
    await seed('start'); await adv(3000);
    for (const st of opt.states) {
      await apply(st);
      const order = st === 'sunset' || st === 'rain' ? [...frames].reverse() : frames;   // как check_site: проход в обратную сторону, чтобы не листать лишнего
      for (const f of order) {
        await goto_(f);
        for (const t of opt.tilts) {
          await seed(`shot-${st}-${f}-${t}`);
          await page.evaluate((a) => window.__viewer.tilt(a[0], a[1]), TILT[t]);
          await adv(160);
          await snap(`f${f}-${st}-t${t}`);
        }
      }
      log(opt.page, st, 'готово,', Object.keys(shots).length, 'снимков');
    }
  } catch (e) {
    console.error('ОШИБКА', opt.page, e.message);
    problems.push('fatal: ' + e.message);
  }
  const ver = await page.evaluate(() => (document.querySelector('meta[name=engine-version]') || {}).content || null).catch(() => null);
  fs.writeFileSync(path.join(outDir, 'shots.json'), JSON.stringify({ page: opt.page, engineVersion: ver, chrome: await browser.version(), viewport: VP, query: '?still=1&perf=0', problems, shots }, null, 1));
  await browser.close(); srv.close();
  log(opt.page, 'снимков', Object.keys(shots).length, 'проблем', problems.length);
  log('virtual ms', advMs, 'real adv s', (advT / 1000).toFixed(1));
  process.exit(problems.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
