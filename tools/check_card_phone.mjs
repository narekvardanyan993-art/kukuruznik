#!/usr/bin/env node
// Быстрая проверка «открытки в сторис» на телефоне — ОДНА страница, ~1–2 мин (вместо полной check_site на 30 минут).
// Тот же шаг и тот же перехватчик share, что в «прогулке» check_site (tools/card_check.mjs): телефон 390×844, нажатие #cardBtn → в
// navigator.share приходит файл image/jpeg 1080×1920 за 20 с, не больше одного вызова. Красное (код 1) — файла нет или он не тот.
//   node tools/check_card_phone.mjs --build [--page beta/tests/lenin/] [--renderer metal|swiftshader] [--save FILE.png]
//   node tools/check_card_phone.mjs --site DIR  [--page ...]      # DIR — готовый корень сайта (например, кандидат check_site)
// --build: сайт = origin/main + build_pages --beta-only из рабочей папки (как tools/snap.mjs); в облаке Chrome: PUPPETEER_EXECUTABLE_PATH=…
import puppeteer from 'puppeteer';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { SHARE_HOOK, CARD_DETERMINISM, phoneCardStep, cardSheetClose } from './card_check.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T0 = Date.now(); const log = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(0).padStart(4)}с]`, ...a);
const opt = { page: 'beta/tests/lenin/', renderer: 'metal' };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--build') opt.build = true; else if (a === '--site') opt.site = path.resolve(argv[++i]); else if (a === '--page') opt.page = argv[++i];
  else if (a === '--renderer') opt.renderer = argv[++i]; else if (a === '--save') opt.save = path.resolve(argv[++i]);
  else { console.error('неизвестный параметр', a); process.exit(2); }
}
if (!opt.build && !opt.site) { console.error('нужен --build или --site DIR'); process.exit(2); }

function buildSite() {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'chka-card-site-'));
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

const root = opt.site || (log('сборка сайта…'), buildSite());
const srv = await serve(root);
const gpu = opt.renderer === 'swiftshader' ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu'];
const browser = await puppeteer.launch({ headless: 'new', args: [...gpu, '--no-sandbox', '--disable-features=CanvasNoise', '--autoplay-policy=no-user-gesture-required', '--hide-scrollbars', '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1'] });
let problems = [];
try {
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push({ type: 'ошибка страницы', msg: String(e.message).slice(0, 300) }));
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await page.evaluateOnNewDocument(CARD_DETERMINISM);
  await page.evaluateOnNewDocument(SHARE_HOOK);
  await page.goto(`http://127.0.0.1:${srv.port}/${opt.page}?perf=0&still=1`, { waitUntil: 'load', timeout: 60000 });
  for (let i = 0; i < 480 && !(await page.evaluate(() => document.documentElement.getAttribute('data-loaded') === 'all' && !document.getElementById('stage').classList.contains('loading')).catch(() => false)); i++) await sleep(250);
  await page.evaluate(() => { const w = document.getElementById('welcome'); if (w) w.remove(); });
  log('страница загружена');
  if (!(await page.evaluate(() => !!window.ChkaPostcard))) { problems.push({ type: 'прогулка', msg: 'на странице нет открытки в сторис (window.ChkaPostcard)' }); }
  else {
    await page.click('#panelBtn');
    const click = async (sel) => { for (let k = 0; k < 40; k++) { const y = await page.evaluate((s) => { const e = document.querySelector(s); e.scrollIntoView({ block: 'center' }); return e.getBoundingClientRect().top; }, sel); await sleep(250); const y2 = await page.evaluate((s) => document.querySelector(s).getBoundingClientRect().top, sel); if (Math.abs(y - y2) < 0.5 && y2 > 0 && y2 < 800) break; } await page.click(sel); };
    const t = Date.now();
    const cs = await phoneCardStep(page, { click, sleep });
    problems.push(...cs.problems);
    if (cs.png) { log(`share получил ${cs.name}, ${cs.size} байт, ${((Date.now() - t) / 1000).toFixed(1)} с`); if (opt.save) fs.writeFileSync(opt.save, cs.png); }
    // e1.29: второй заход — с «Оборотом»: в share ровно 2 файла (лицо + оборот), оба JPEG 1080×1920
    if (await page.evaluate(() => !!document.getElementById('cardBack'))) {
      await cardSheetClose(page, sleep);
      const t2 = Date.now();
      const cb = await phoneCardStep(page, { click, sleep, back: true });
      problems.push(...cb.problems.map((q) => ({ type: q.type, msg: 'с оборотом: ' + q.msg })));
      if (cb.backPng) { log(`с оборотом: share получил ${cb.name} + ${cb.backName}, ${((Date.now() - t2) / 1000).toFixed(1)} с`); if (opt.save) fs.writeFileSync(opt.save.replace(/\.png$/i, '') + '-back.png', cb.backPng); }
      await page.evaluate(() => { const b = document.getElementById('cardBack'); if (b && b.getAttribute('aria-pressed') === 'true') b.click(); });   // вернуть «без оборота»
    }
  }
  problems.push(...errs);
} finally { await browser.close(); srv.close(); }
if (problems.length) { for (const p of problems) console.log('КРАСНОЕ:', p.type + ':', p.msg); process.exit(1); }
console.log('ЗЕЛЁНАЯ: открытка в share — image/jpeg 1080×1920, один вызов; с оборотом — 2 файла 1080×1920');
