#!/usr/bin/env node
// Ленин на текущем движке ≈ эталон e1.36 (07.11.2026, урок pp-26). Сцена Ленина (телефон 390×844) снимается в двух копиях сайта
// одним и тем же браузером и виртуальным временем (как check_site): A — эталон (движок e1.36 и страница Ленина с main до релиза e1.54),
// B — кандидат (страница Ленина, собранная сейчас build_live, + рабочий движок engine/). Снимки: день кадры 1–5, ночь кадры 1–5, снег днём на кадре 1.
// Любой пиксель с разницей больше NOISE_DELTA — отличие; больше NOISE_PX таких пикселей на снимке — КРАСНЫЙ.
// Интерфейс телефона (нижняя панель, заголовок, подпись, бирка/табличка e1.55) скрыт в обоих снимках — сравниваем только сцену (zv2: UI на телефоне поменяли намеренно).
// --selftest: дополнительно кандидат с подменённой ночью (в шейдере ночная картинка × 0.8 — так выглядела бы регрессия «матовой ночи»)
// обязан дать КРАСНЫЙ на ночном снимке; если не дал — проверка сломана (КРАСНЫЙ).
// Использование: node tools/lenin_look.mjs --a DIR --b DIR [--out DIR] [--shots day-f0,night-f0] [--selftest] [--chrome PATH]
// Код выхода: 0 — как эталон, 1 — отличие/сломано, 2 — нет Chrome (проверка не прогнана).
import puppeteer from 'puppeteer';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { PNG } from 'pngjs';

const NOISE_DELTA = 24, NOISE_PX = 40;   // шум растеризации: на swiftshader и Metal снимки двух копий совпадают побайтно; запас — на сглаживание краёв
const ALL_SHOTS = ['day-f0', 'day-f1', 'day-f2', 'day-f3', 'day-f4', 'night-f0', 'night-f1', 'night-f2', 'night-f3', 'night-f4', 'snow-f0'];
const TAMPER = ["c = mix(c, cn, uNightMix);", "c = mix(c, cn * 0.8, uNightMix);"];
const opt = { shots: ALL_SHOTS, selftest: false, chrome: process.env.CHKA_CHROME || null, out: path.join(os.tmpdir(), 'chka-lenin-look') };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i], val = () => argv[++i];
  if (a === '--a') opt.a = path.resolve(val());
  else if (a === '--b') opt.b = path.resolve(val());
  else if (a === '--out') opt.out = path.resolve(val());
  else if (a === '--shots') opt.shots = val().split(',').filter(Boolean);
  else if (a === '--selftest') opt.selftest = true;
  else if (a === '--chrome') opt.chrome = val();
  else { console.error('неизвестный параметр', a); process.exit(1); }
}
if (!opt.a || !opt.b) { console.error('нужны --a и --b'); process.exit(1); }
fs.mkdirSync(opt.out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hashSeed = (s) => { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

// Виртуальное время и случайность — как в check_site.mjs (INIT_SCRIPT), без открытки и искр.
const INIT = () => {
  let vt = 10000, q = [];
  window.__mvFreeze = true;
  performance.now = () => vt;
  window.requestAnimationFrame = (cb) => { q.push(cb); return q.length; };
  window.cancelAnimationFrame = () => {};
  window.__advance = (ms) => { const n = Math.ceil(ms / 16); for (let i = 0; i < n; i++) { vt += 16; const c = q; q = []; c.forEach((cb) => cb(vt)); } };
  let s = 12345;
  window.__seed = (n) => { s = n | 0; };
  Math.random = () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const st = document.createElement('style');
  st.textContent = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}.p-build,#build-version,#bottomBar,#barTitle,#frameCap,#infoTag,#infoPlaque{visibility:hidden!important}';
  document.addEventListener('DOMContentLoaded', () => document.head.appendChild(st));
};

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.webm': 'video/webm', '.svg': 'image/svg+xml', '.txt': 'text/plain' };
function serve(root, tamper) {   // как GitHub Pages + Range (видео синемаграфа); tamper — подмена строки в engine/viewer.js (только --selftest)
  const srv = http.createServer((q, r) => {
    const p = decodeURIComponent(q.url.split('?')[0]);
    let f = path.join(root, p);
    if (!f.startsWith(root)) { r.writeHead(403); r.end(); return; }
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) {
      if (!p.endsWith('/')) { r.writeHead(301, { Location: p + '/' }); r.end(); return; }
      f = path.join(f, 'index.html');
    }
    if (!fs.existsSync(f)) { r.writeHead(404); r.end('not found'); return; }
    const ct = MIME[path.extname(f).toLowerCase()] || 'application/octet-stream';
    if (tamper && p === '/engine/viewer.js') {
      const t = fs.readFileSync(f, 'utf8');
      if (!t.includes(tamper[0])) { r.writeHead(500); r.end('tamper anchor missing'); srv.tamperMissing = true; return; }
      r.writeHead(200, { 'Content-Type': ct, 'Cache-Control': 'no-store' }); r.end(t.replace(tamper[0], tamper[1])); return;
    }
    const size = fs.statSync(f).size, rg = q.headers.range;
    if (rg) {
      const m = /bytes=(\d*)-(\d*)/.exec(rg), s = +m[1] || 0, e = m[2] ? +m[2] : size - 1;
      r.writeHead(206, { 'Content-Type': ct, 'Content-Range': `bytes ${s}-${e}/${size}`, 'Accept-Ranges': 'bytes', 'Content-Length': e - s + 1 });
      fs.createReadStream(f, { start: s, end: e }).pipe(r); return;
    }
    r.writeHead(200, { 'Content-Type': ct, 'Cache-Control': 'no-store', 'Accept-Ranges': 'bytes', 'Content-Length': size });
    fs.createReadStream(f).pipe(r);
  });
  return new Promise((res) => srv.listen(0, '127.0.0.1', () => res({ srv, origin: 'http://127.0.0.1:' + srv.address().port })));
}

async function capture(browser, root, tag, shots, tamper) {
  const S = await serve(root, tamper);
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 200)));
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await page.evaluateOnNewDocument(INIT);
  const adv = (ms) => page.evaluate((m) => window.__advance(m), ms);
  const seed = (s) => page.evaluate((v) => window.__seed(v), hashSeed('lenin-look|' + s));
  const gpuDone = () => page.evaluate(() => { const c = document.getElementById('gl'); const g = c && (c.getContext('webgl') || c.getContext('experimental-webgl')); if (g) { g.finish(); const px = new Uint8Array(4); g.readPixels(0, 0, 1, 1, g.RGBA, g.UNSIGNED_BYTE, px); } });
  const out = {};
  try {
    await page.goto(S.origin + '/lenin/', { waitUntil: 'load', timeout: 90000 });
    let ok = false;
    for (let i = 0; i < 720 && !ok; i++) { ok = await page.evaluate(() => document.documentElement.getAttribute('data-loaded') === 'all' && !!window.Details && !!window.__viewer && !document.getElementById('stage').classList.contains('loading')).catch(() => false); if (!ok) await sleep(250); }
    if (!ok) throw new Error('просмотрщик не загрузился за 3 мин');
    await page.evaluate(() => { const w = document.getElementById('welcome'); if (w) w.remove(); });
    const n = await page.evaluate(() => document.querySelectorAll('#dots span').length);
    const goto_ = async (f) => {
      let cur = await page.evaluate(() => window.__viewer.frame()), g = 0;
      while (cur !== f && g++ < 12) {
        await seed('go' + f);
        await page.keyboard.press(((f - cur) + n) % n <= n / 2 ? 'ArrowRight' : 'ArrowLeft');
        for (let k = 0; k < 60; k++) { await adv(100); if (!(await page.evaluate(() => window.__viewer.fading()))) break; }
        cur = await page.evaluate(() => window.__viewer.frame());
      }
      await adv(900);
    };
    const snap = async (name) => {
      for (let k = 0; k < 50 && (await page.evaluate(() => !!(window.__viewer.mvBusy && window.__viewer.mvBusy()))); k++) { await sleep(100); await adv(16); }
      await gpuDone(); await sleep(60);
      const file = path.join(opt.out, `${tag}-${name}.png`);
      await page.screenshot({ path: file });
      out[name] = file;
    };
    await seed('start'); await adv(3000);
    const want = new Set(shots);
    for (const tod of ['day', 'night']) {
      const fr = shots.filter((s) => s.startsWith(tod + '-')).map((s) => +s.split('-f')[1]);
      if (!fr.length) continue;
      if (tod === 'night') { await seed('tod-night'); await page.evaluate(() => document.querySelector('#todSeg [data-tod=night]').click()); await adv(4200); }
      for (const f of fr) { await goto_(f); await seed(`shot-${tod}-${f}`); await adv(600); await snap(`${tod}-f${f}`); }
    }
    const snow = shots.filter((s) => s.startsWith('snow-')).map((s) => +s.split('-f')[1]);
    if (snow.length) {
      await seed('tod-day'); await page.evaluate(() => document.querySelector('#todSeg [data-tod=day]').click()); await adv(4500);
      await seed('snow'); await page.evaluate(() => { const b = document.querySelector('#precipSeg [data-precip=snow]'); if (b) b.click(); }); await adv(14000);
      for (const f of snow) { await goto_(f); await seed(`shot-snow-${f}`); await adv(600); await snap(`snow-f${f}`); }
    }
    void want;
  } finally {
    await ctx.close().catch(() => {});
    S.srv.close();
  }
  if (S.srv.tamperMissing) throw new Error('selftest: в engine/viewer.js нет строки ночи «' + TAMPER[0] + '» — обнови TAMPER в lenin_look.mjs');
  return { out, errs };
}

function cmp(fa, fb) {
  const a = PNG.sync.read(fs.readFileSync(fa)), b = PNG.sync.read(fs.readFileSync(fb));
  if (a.width !== b.width || a.height !== b.height) return { px: Infinity, max: 255 };
  let px = 0, max = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    const d = Math.max(Math.abs(a.data[i] - b.data[i]), Math.abs(a.data[i + 1] - b.data[i + 1]), Math.abs(a.data[i + 2] - b.data[i + 2]));
    if (d > max) max = d;
    if (d > NOISE_DELTA) px++;
  }
  return { px, max };
}

const T0 = Date.now();
const launch = { headless: 'new', args: [...(os.platform() === 'darwin' ? ['--use-angle=metal', '--enable-gpu'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']), '--ignore-gpu-blocklist', '--disable-features=CanvasNoise', '--hide-scrollbars', '--font-render-hinting=none', '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1'] };
if (opt.chrome) launch.executablePath = opt.chrome;
if (os.platform() === 'linux') launch.args.push('--no-sandbox');
let browser;
try { browser = await puppeteer.launch(launch); } catch (e) { console.log('нет Chrome: ' + String(e.message).split('\n')[0].slice(0, 160)); process.exit(2); }
let red = 0;
try {
  const A = await capture(browser, opt.a, 'A', opt.shots);
  const B = await capture(browser, opt.b, 'B', opt.shots);
  for (const s of opt.shots) {
    if (!A.out[s] || !B.out[s]) { console.log(`ОШИБКА ${s}: снимок не снят`); red++; continue; }
    const r = cmp(A.out[s], B.out[s]), bad = r.px > NOISE_PX;
    red += bad ? 1 : 0;
    console.log(`${bad ? 'ОШИБКА' : 'OK    '} ${s}: пикселей с разницей > ${NOISE_DELTA}: ${r.px} (допуск ${NOISE_PX}), макс. разница ${r.max}`);
  }
  if (B.errs.length) { console.log('ОШИБКА ошибки на странице кандидата: ' + B.errs.slice(0, 3).join(' | ')); red++; }
  if (opt.selftest) {
    const ns = opt.shots.find((s) => s.startsWith('night-')) || 'night-f0';
    if (!A.out[ns]) { const A2 = await capture(browser, opt.a, 'A', [ns]); A.out[ns] = A2.out[ns]; }
    const R = await capture(browser, opt.b, 'R', [ns], TAMPER);
    const r = cmp(A.out[ns], R.out[ns]), caught = r.px > NOISE_PX;
    red += caught ? 0 : 1;
    console.log(`${caught ? 'OK    ' : 'ОШИБКА'} самопроверка: подменённая ночь (× 0.8) ловится на ${ns}: ${r.px} пикселей (нужно > ${NOISE_PX})`);
  }
} catch (e) {
  console.log('ОШИБКА проверка упала: ' + String(e.message).slice(0, 300)); red++;
} finally { await browser.close().catch(() => {}); }
console.log(`итого: ${red ? 'КРАСНЫЙ' : 'как эталон'} за ${((Date.now() - T0) / 1000).toFixed(0)} с; снимки — ${opt.out}`);
process.exit(red ? 1 : 0);
