#!/usr/bin/env node
// s26: образцы открыток «в сторис» НАСТОЯЩИМ рендером Chrome (не имитацией): оба здания × hy/ru/en × день/ночь/снег × с плёнкой и без.
// Плюс проверки: безопасные зоны (что нарисовано поверх кадра — только внутри зоны), кнопка одним нажатием (share вызван в том же
// жесте — navigator.userActivation.isActive), «скачивание PNG» без Web Share (как на ПК и в check_site), окно «Настроить», ошибки JS.
//   node tests/lenin/report/s26/postcards.mjs --out DIR [--site DIR] [--only lenin|kukuruznik]
// Сайт: дерево origin/main + build_pages --beta-only из рабочей папки (как tools/snap.mjs). Время настоящее, ?perf=0&still=1.
import puppeteer from 'puppeteer';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T0 = Date.now(); const log = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(0).padStart(4)}с]`, ...a);
const opt = { out: null, site: null, only: null };
for (let i = 2; i < process.argv.length; i++) { const a = process.argv[i]; if (a === '--out') opt.out = path.resolve(process.argv[++i]); else if (a === '--site') opt.site = path.resolve(process.argv[++i]); else if (a === '--only') opt.only = process.argv[++i]; }
if (!opt.out) { console.error('--out DIR'); process.exit(2); }
fs.mkdirSync(opt.out, { recursive: true });

function buildSite() {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'chka-s26-site-'));
  const commit = spawnSync('git', ['-C', ROOT, 'rev-parse', 'origin/main^{commit}'], { encoding: 'utf8' }).stdout.trim();
  const ar = spawnSync('git', ['-C', ROOT, 'archive', commit, '--', '.', ':(exclude)docs', ':(exclude)tools', ':(exclude)src', ':(exclude)engine3d', ':(exclude)test-assets', ':(exclude)beta'], { maxBuffer: 1 << 30 });
  spawnSync('tar', ['-x', '-C', dest], { input: ar.stdout, maxBuffer: 1 << 30 });
  const b = spawnSync('python3', [path.join(ROOT, 'tools', 'build_pages.py'), '--site', dest, '--beta-only'], { encoding: 'utf8' });
  if (b.status !== 0) throw new Error('build_pages: ' + (b.stderr || b.stdout).slice(-600));
  return dest;
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.webm': 'video/webm', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' };
function serve(root) {
  const srv = http.createServer((q, r) => {
    const p = decodeURIComponent(q.url.split('?')[0]); let f = path.join(root, p);
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
    if (!fs.existsSync(f)) { r.writeHead(404); r.end(); return; }
    const size = fs.statSync(f).size, type = MIME[path.extname(f).toLowerCase()] || 'application/octet-stream';
    const m = /bytes=(\d*)-(\d*)/.exec(q.headers.range || '');
    if (m) { const s = m[1] ? +m[1] : 0, e = m[2] ? +m[2] : size - 1; r.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${s}-${e}/${size}`, 'Accept-Ranges': 'bytes', 'Content-Length': e - s + 1 }); fs.createReadStream(f, { start: s, end: e }).pipe(r); return; }
    r.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Cache-Control': 'no-store' }); fs.createReadStream(f).pipe(r);
  });
  return new Promise((res) => srv.listen(0, '127.0.0.1', () => res({ port: srv.address().port, close: () => srv.close() })));
}

const B = [{ id: 'lenin', page: 'beta/tests/lenin/', frames: { day: 0, night: 1, snow: 3 } }, { id: 'kukuruznik', page: 'beta/kukuruznik/', frames: { day: 0, night: 2, snow: 4 } }].filter((b) => !opt.only || b.id === opt.only);
const LANGS = ['hy', 'ru', 'en'];
const LINE = { hy: 'Այստեղ հանդիպեցին ծնողներս', ru: 'Здесь познакомились мои родители', en: 'My parents met here' };
const result = { date: new Date().toISOString(), buildings: {}, problems: [] };

const root = opt.site || (log('сборка сайта…'), buildSite());
const srv = await serve(root);
const browser = await puppeteer.launch({ headless: 'new', executablePath: process.env.CHROME_PATH, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--hide-scrollbars'] });
const save = (name, dataUrl) => { const f = path.join(opt.out, name); fs.writeFileSync(f, Buffer.from(dataUrl.split(',')[1], 'base64')); return f; };

for (const b of B) {
  const R = result.buildings[b.id] = { cards: [], zones: [], errors: [] };
  const page = await browser.newPage();
  page.on('pageerror', (e) => R.errors.push('pageerror: ' + String(e.message).slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error') R.errors.push('console.error: ' + m.text().slice(0, 200)); });
  // Web Share как на iPhone: запоминаем файл и был ли жест в момент вызова; скачивание — как в check_site (blob + a.download)
  await page.evaluateOnNewDocument(() => {
    window.__shares = []; window.__downloads = [];
    const oc = URL.createObjectURL; URL.createObjectURL = function (x) { try { if (x instanceof Blob) window.__lastBlob = x; } catch (e) {} return oc.apply(this, arguments); };
    const ac = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download && /^blob:/.test(this.href)) { window.__downloads.push({ name: this.download, type: window.__lastBlob && window.__lastBlob.type, size: window.__lastBlob && window.__lastBlob.size }); window.__dlBlob = window.__lastBlob; return; } return ac.apply(this, arguments); };
    document.addEventListener('click', () => { window.__t0 = performance.now(); window.__g0 = !!(navigator.userActivation && navigator.userActivation.isActive); window.__inClick = true; setTimeout(() => { window.__inClick = false; }, 0); }, true);
    if (/[?&]share=1/.test(location.search)) {
      navigator.canShare = (d) => !!(d && d.files && d.files.length);
      navigator.share = (d) => { const f = d.files[0]; window.__shares.push({ name: f.name, type: f.type, size: f.size, gesture: !!(navigator.userActivation && navigator.userActivation.isActive), ms: Math.round(performance.now() - (window.__t0 || 0)), sameTask: !!window.__inClick }); window.__shareFile = f; return Promise.resolve(); };
    }
  });
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const url = `http://127.0.0.1:${srv.port}/${b.page}?perf=0&still=1&share=1`;
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  for (let i = 0; i < 400; i++) { if (await page.evaluate(() => document.documentElement.getAttribute('data-loaded') === 'all' && !document.getElementById('stage').classList.contains('loading')).catch(() => false)) break; await sleep(250); }
  await page.evaluate(() => { const w = document.getElementById('welcome'); if (w) w.remove(); });
  await page.evaluate(() => window.__card.fontsLoad());
  log(b.id, 'загружено');
  const goto_ = async (f) => {
    const n = await page.evaluate(() => document.querySelectorAll('#dots span').length);
    for (let g = 0; g < 12; g++) { const cur = await page.evaluate(() => window.__viewer.frame()); if (cur === f) break; await page.keyboard.press(((f - cur) + n) % n <= n / 2 ? 'ArrowRight' : 'ArrowLeft'); await sleep(150); for (let k = 0; k < 60 && (await page.evaluate(() => window.__viewer.fading())); k++) await sleep(100); }
    for (let k = 0; k < 40 && (await page.evaluate(() => !!(window.__viewer.mvBusy && window.__viewer.mvBusy()))); k++) await sleep(100);
    await sleep(900);
  };
  const click = (sel) => page.evaluate((s) => document.querySelector(s).click(), sel);
  // настоящее нажатие (жест пользователя): ждём, пока шторка/окно доедут (в облачном Chrome CSS-переходы отстают от часов) и элемент стоит на экране
  const tap = async (sel, noClick) => {
    let prev = null;
    for (let k = 0; k < 80; k++) {
      await sleep(250);
      const y = await page.evaluate((s) => { const e = document.querySelector(s); e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return r.top; }, sel);
      if (y > 0 && y < 800 && prev !== null && Math.abs(prev - y) < 0.5) break;
      prev = y;
    }
    if (!noClick) await page.click(sel);
  };
  for (const state of ['day', 'night', 'snow']) {
    if (state === 'night') { await click('#todSeg [data-tod=night]'); for (let k = 0; k < 120; k++) { if (await page.evaluate(() => window.__viewer.tod.night >= 0.999)) break; await sleep(100); } await sleep(800); }
    if (state === 'snow') { await click('#todSeg [data-tod=day]'); await sleep(4500); await click('#precipSeg [data-precip=snow]'); }
    await goto_(b.frames[state]);
    if (state === 'snow') await sleep(14000);   // снег копится ~12 с
    for (const film of [false, true]) for (const lang of LANGS) {
      const line = film && lang === 'ru' ? LINE.ru : (film && lang === 'hy' ? LINE.hy : '');
      const r = await page.evaluate((o) => window.__card.make(o), { lang, film, line, seed: 26, date: '2026-10-16T12:00:00', src: !film && lang === 'hy', png: false });
      if (!r) { result.problems.push(`${b.id} ${state} ${lang}: открытка не собралась`); continue; }
      const name = `${b.id}-${state}-${lang}${film ? '-film' : ''}.jpg`;
      save(name, r.url); R.cards.push({ name, state, lang, film, line });
      if (r.src) save(`_src-${b.id}-${state}.jpg`, r.src);
    }
    // зоны: тот же снимок без зерна и плёнки, PNG — отличие от кадра и есть «что нарисовано поверх»
    const z = await page.evaluate(() => window.__card.make({ lang: 'hy', film: false, line: 'Այստեղ հանդիպեցին ծնողներս', grain: false, src: true, png: true, seed: 26, date: '2026-10-16T12:00:00' }));
    save(`_zone-${b.id}-${state}.png`, z.url); save(`_zone-${b.id}-${state}-src.png`, z.src);
    R.zones.push({ state, boxes: z.boxes });
    log(b.id, state, 'готово');
  }
  // кнопка одним нажатием (телефон с Web Share): share в том же жесте, файл JPEG 1080×1920
  await click('#todSeg [data-tod=day]'); await click('#precipSeg [data-precip=none]'); await sleep(3000);
  await page.click('#panelBtn');
  await tap('#cardBtn'); await sleep(1500);
  R.oneTap = await page.evaluate(() => ({ gestureAtClick: window.__g0, shares: window.__shares.slice(), downloads: window.__downloads.slice(), toast: document.getElementById('cardToast').classList.contains('on') }));
  if (R.oneTap.shares[0]) { const d = await page.evaluate(() => new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(window.__shareFile); })); save(`_onetap-${b.id}.jpg`, d); }
  await page.screenshot({ path: path.join(opt.out, `_panel-${b.id}.png`) });
  // окно «Настроить»: открыть, язык en, своя строка, плёнка, «Сохранить»
  await tap('#cardCfgBtn'); await tap('#cardGo', true); await sleep(1500);
  await page.screenshot({ path: path.join(opt.out, `_cfg-${b.id}-1.png`) });
  await page.click('#cardCfg [data-clang=en]'); await page.click('#cardLine', { clickCount: 3 }); await page.keyboard.type('Grandpa worked here, 1984'); await page.click('#cardFilm'); await sleep(900);
  await page.screenshot({ path: path.join(opt.out, `_cfg-${b.id}-2.png`) });
  await tap('#cardGo'); await sleep(1500);
  R.cfg = await page.evaluate(() => ({ shares: window.__shares.slice(1), stored: localStorage.getItem('chka-card') }));
  if (R.cfg.shares[0]) { const d = await page.evaluate(() => new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(window.__shareFile); })); save(`_cfg-save-${b.id}.jpg`, d); }
  await tap('#cardCfgClose'); await sleep(2500);
  R.cfgClosed = await page.evaluate(() => !document.body.classList.contains('card-open'));
  await page.evaluate(() => localStorage.removeItem('chka-card'));
  await page.close();
  // ПК / без Web Share: скачивание PNG (тот же путь, что проверяет check_site)
  const pc = await browser.newPage();
  pc.on('pageerror', (e) => R.errors.push('pc pageerror: ' + String(e.message).slice(0, 200)));
  await pc.evaluateOnNewDocument(() => { window.__downloads = []; const oc = URL.createObjectURL; URL.createObjectURL = function (x) { if (x instanceof Blob) window.__lastBlob = x; return oc.apply(this, arguments); }; const ac = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download && /^blob:/.test(this.href)) { window.__downloads.push({ name: this.download, type: window.__lastBlob.type, size: window.__lastBlob.size }); window.__dlBlob = window.__lastBlob; return; } return ac.apply(this, arguments); }; });
  await pc.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await pc.goto(`http://127.0.0.1:${srv.port}/${b.page}?perf=0&still=1`, { waitUntil: 'load', timeout: 60000 });
  for (let i = 0; i < 400; i++) { if (await pc.evaluate(() => document.documentElement.getAttribute('data-loaded') === 'all' && !document.getElementById('stage').classList.contains('loading')).catch(() => false)) break; await sleep(250); }
  await pc.evaluate(() => { const w = document.getElementById('welcome'); if (w) w.remove(); });
  await sleep(1500);
  await pc.click('#cardBtn');
  for (let k = 0; k < 50; k++) { if (await pc.evaluate(() => window.__downloads.length)) break; await sleep(200); }
  R.pc = await pc.evaluate(() => window.__downloads.slice());
  if (R.pc[0]) { const d = await pc.evaluate(() => new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(window.__dlBlob); })); save(`_pc-${b.id}.png`, d); }
  await pc.screenshot({ path: path.join(opt.out, `_pc-panel-${b.id}.png`) });
  await pc.close();
  log(b.id, 'кнопки проверены');
}
await browser.close(); srv.close();
fs.writeFileSync(path.join(opt.out, 'result.json'), JSON.stringify(result, null, 1));
log('готово →', opt.out);
