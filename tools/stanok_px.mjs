#!/usr/bin/env node
// stanok_px — пиксели СЦЕНЫ (холст WebGL, без интерфейса) страницы здания: для паритета e2 ↔ e1.62 и гейта G6 (docs/STANOK.md §6).
//   node tools/stanok_px.mjs shoot --engine e1|e2 --site DIR --page PAGE --out DIR [--frames 0,1] [--states day,sunset] [--tilts L,C,R] [--png 1] [--move 1] --chrome PATH
//   node tools/stanok_px.mjs compare DIR_A DIR_B [--delta 3] [--share 0.0005] [--report FILE]
// shoot: телефон 390×844, dsf 1. Пиксели читаются из холста сразу после кадра (gl.readPixels), а не снимком экрана.
//   e1 — страница e1.62: время подменяется снаружи (как tools/stanok_look.mjs), адрес ?still=1&perf=0.
//   e2 — страница e2: адрес ?vt=1&ui=0 (+ still=1, если нет --move 1); снаружи НИЧЕГО не подменяется — время идёт только через __e2.advance.
// compare: пиксель «другой», если любой канал отличается больше delta; набор красный, если у какого-то снимка доля таких пикселей > share.
import puppeteer from 'puppeteer-core';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { PNG } from 'pngjs';

const argv = process.argv.slice(2), cmd = argv[0], opt = {}, pos = [];
for (let i = 1; i < argv.length; i++) { if (argv[i].startsWith('--')) { opt[argv[i].slice(2)] = argv[i + 1]; i++; } else pos.push(argv[i]); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TILT = { L: [-1, -1], C: [0, 0], R: [1, 1] };
// Сколько виртуального времени ждать после переключения состояния, чтобы оно установилось (сравниваются установившиеся картинки):
// ночь — переход 5,5 с + окна зажигаются по одному 5 с; снег — копится 12 с; дождь — погода проявляется 4 с, а после «Ночи» ещё и день
// возвращается ~9,5 с. Порядок состояний важен: после «Снега» снег тает 30 с, и тает он в e2 иначе, чем в e1.62 (сверху вниз —
// migration-allowed.json, snow-order): сравнивать «Дождь» и «Ночь» ПОСЛЕ «Снега» нельзя — снег идёт последним (night,rain,snow).
const SETTLE = { day: 3200, sunset: 3200, night: 12000, snow: 16000, rain: 12000 };
const WX = { snow: 'snow', rain: 'rain' };

if (cmd === 'compare') {
  const [A, B] = pos, delta = +(opt.delta ?? 3), share = +(opt.share ?? 0.0005);
  const ia = JSON.parse(fs.readFileSync(path.join(A, 'index.json'))), ib = JSON.parse(fs.readFileSync(path.join(B, 'index.json')));
  const rows = []; let bad = 0;
  // --allow FILE — разрешённые отличия здания (migration-allowed.json, docs/STANOK.md §2.4 п.5): записи с rect [x0, y0, x1, y1] (доли экрана
  // снимка) — точки внутри не сравниваются, но считаются (allowed). Запись действует на свои состояния и кадры (frames: "*" — все).
  const allow = opt.allow && fs.existsSync(opt.allow) ? (JSON.parse(fs.readFileSync(opt.allow)).allowed || []).filter((q) => Array.isArray(q.rect)) : [];
  const [SW, SH] = ia.size || [390, 844];
  const rectsFor = (name) => { const m = /^f(\d+)-([a-z]+)-/.exec(name); if (!m) return []; return allow.filter((q) => (q.states || []).includes(m[2]) && (q.frames === '*' || (q.frames || []).includes(+m[1]))).map((q) => [q.rect[0] * SW, q.rect[1] * SH, q.rect[2] * SW, q.rect[3] * SH]); };
  for (const name of ia.shots) {
    if (!ib.shots.includes(name)) { rows.push({ name, missing: true }); bad++; continue; }
    const a = fs.readFileSync(path.join(A, name + '.rgba')), b = fs.readFileSync(path.join(B, name + '.rgba'));
    if (a.length !== b.length) { rows.push({ name, size: [a.length, b.length] }); bad++; continue; }
    let n = 0, mx = 0, sum = 0, allowed = 0;
    const rects = rectsFor(name);
    for (let i = 0; i < a.length; i += 4) {
      const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
      if (rects.length && d > delta) { const x = (i / 4) % SW, y = Math.floor(i / 4 / SW); if (rects.some((r) => x >= r[0] && x < r[2] && y >= r[1] && y < r[3])) { allowed++; continue; } }
      if (d > delta) n++;
      if (d > mx) mx = d;
      sum += d;
    }
    const px = a.length / 4, row = { name, over: n, share: +(n / px).toFixed(6), max: mx, mean: +(sum / px).toFixed(4), red: n / px > share, allowed };
    if (row.red) bad++;
    rows.push(row);
  }
  for (const name of ib.shots) if (!ia.shots.includes(name)) { rows.push({ name, extra: true }); bad++; }
  if (opt.report) fs.writeFileSync(opt.report, JSON.stringify({ delta, share, a: A, b: B, rows }, null, 1));
  for (const r of rows) console.log(r.red || r.missing || r.extra || r.size ? 'КРАСНЫЙ' : 'ок     ', r.name, r.missing ? 'нет во втором наборе' : r.extra ? 'лишний' : r.size ? 'разный размер' : `другие ${r.over} px (${(r.share * 100).toFixed(4)} %), макс ${r.max}, средн ${r.mean}${r.allowed ? `, разрешённых ${r.allowed} px` : ''}`);
  console.log(`ИТОГ: снимков ${rows.length}, красных ${bad} (порог: канал > ${delta}, доля > ${share})`);
  process.exit(bad ? 1 : 0);
}
if (cmd !== 'shoot') { console.error('команды: shoot, compare'); process.exit(2); }

const site = path.resolve(opt.site), page_ = opt.page.replace(/^\/+|\/+$/g, ''), out = path.resolve(opt.out), eng = opt.engine;
const states = (opt.states || 'day').split(','), tilts = (opt.tilts || 'C').split(',');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.webm': 'video/webm', '.svg': 'image/svg+xml' };
const srv = http.createServer((q, r) => {
  const p = decodeURIComponent(q.url.split('?')[0]); let f = path.join(site, p);
  if (!f.startsWith(site)) { r.writeHead(403); r.end(); return; }
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (!fs.existsSync(f)) { r.writeHead(404); r.end('not found'); return; }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(f).pipe(r);
});
await new Promise((res) => srv.listen(0, '127.0.0.1', res));
const origin = 'http://127.0.0.1:' + srv.address().port;

const E1_INIT = () => {   // виртуальное время для e1.62 — как в tools/stanok_look.mjs
  let vt = 10000, q = [];
  window.__mvFreeze = true;
  HTMLMediaElement.prototype.play = function () { try { this.pause(); } catch (e) {} return Promise.resolve(); };
  performance.now = () => vt;
  window.requestAnimationFrame = (cb) => { q.push(cb); return q.length; };
  window.cancelAnimationFrame = () => {};
  window.__advance = (ms) => { const n = Math.ceil(ms / 32); for (let i = 0; i < n; i++) { vt += 32; const c = q; q = []; c.forEach((cb) => cb(vt)); } };
  let s = 12345;
  Math.random = () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
};
const b64 = `(px) => { let s = ''; const C = 0x8000; for (let i = 0; i < px.length; i += C) s += String.fromCharCode.apply(null, px.subarray(i, i + C)); return btoa(s); }`;

const browser = await puppeteer.launch({ executablePath: opt.chrome, headless: 'new', protocolTimeout: 900000, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--hide-scrollbars', '--disable-features=CanvasNoise'] });
const page = await browser.newPage();
const problems = [];
page.on('pageerror', (e) => problems.push('pageerror: ' + String(e.message).slice(0, 200)));
page.on('response', (r) => { if (r.status() >= 400 && r.url().startsWith(origin) && !/favicon/.test(r.url())) problems.push('HTTP ' + r.status() + ' ' + r.url().replace(origin, '')); });
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
fs.mkdirSync(out, { recursive: true });
const shots = []; let info = {};
const save = async (name, r) => {
  const buf = Buffer.from(r.data, 'base64'), flip = Buffer.alloc(buf.length), row = r.w * 4;
  for (let y = 0; y < r.h; y++) buf.copy(flip, y * row, (r.h - 1 - y) * row, (r.h - y) * row);   // readPixels отдаёт строки снизу вверх
  fs.writeFileSync(path.join(out, name + '.rgba'), flip);
  if (opt.png === '1') { const png = new PNG({ width: r.w, height: r.h }); flip.copy(png.data); for (let i = 3; i < png.data.length; i += 4) png.data[i] = 255; fs.writeFileSync(path.join(out, name + '.png'), PNG.sync.write(png)); }
  shots.push(name); info.size = [r.w, r.h];
};
try {
  if (eng === 'e1') {
    await page.evaluateOnNewDocument(E1_INIT);
    await page.goto(`${origin}/${page_}/?still=1&perf=0`, { waitUntil: 'load', timeout: 60000 });
    for (let i = 0; i < 960; i++) { if (await page.evaluate(() => document.documentElement.getAttribute('data-loaded') === 'all' && !!window.Details && !document.getElementById('stage').classList.contains('loading')).catch(() => false)) break; if (i === 959) throw new Error('e1: страница не загрузилась'); await sleep(250); }
    await page.evaluate(() => { const w = document.getElementById('welcome'); if (w) w.remove(); });
    const adv = (ms) => page.evaluate((m) => window.__advance(m), ms);
    const n = await page.evaluate(() => document.querySelectorAll('#dots span').length);
    const frames = (opt.frames ? opt.frames.split(',').map(Number) : [...Array(n).keys()]).filter((f) => f < n);
    await adv(3000);
    for (const st of states) {
      await page.evaluate((s, wx) => {   // как tools/stanok_look.mjs: снег и дождь — днём; закат и ночь — без осадков
        const cl = (q) => { const b = document.querySelector(q); if (b) b.click(); };
        if (wx) { cl('#todSeg [data-tod=day]'); cl('#precipSeg [data-precip=' + wx + ']'); } else { cl('#precipSeg [data-precip=none]'); cl('#todSeg [data-tod=' + s + ']'); }
      }, st, WX[st] || null);
      await adv(+(opt.settle || SETTLE[st] || 3200));
      for (const f of frames) {
        for (let g = 0; g < 12 && (await page.evaluate(() => window.__viewer.frame())) !== f; g++) {
          await page.keyboard.press('ArrowRight');
          for (let k = 0; k < 60; k++) { await adv(100); if (!(await page.evaluate(() => window.__viewer.fading()))) break; }
        }
        await adv(600);
        for (const t of tilts) {
          await page.evaluate((a) => window.__viewer.tilt(a[0], a[1]), TILT[t]);
          await adv(160);
          const r = await page.evaluate(`(() => { window.__advance(32); const c = document.getElementById('gl'), g = c.getContext('webgl') || c.getContext('experimental-webgl'); const px = new Uint8Array(c.width * c.height * 4); g.readPixels(0, 0, c.width, c.height, g.RGBA, g.UNSIGNED_BYTE, px); return { w: c.width, h: c.height, data: (${b64})(px) }; })()`);
          await save(`f${f}-${st}-t${t}`, r);
        }
      }
    }
    info.engine = await page.evaluate(() => (document.querySelector('meta[name=engine-version]') || {}).content || null);
  } else {
    await page.goto(`${origin}/${page_}/?vt=1&ui=0${opt.move === '1' ? '' : '&still=1'}${opt.query ? '&' + opt.query : ''}`, { waitUntil: 'load', timeout: 60000 });
    for (let i = 0; i < 960; i++) { const s = await page.evaluate(() => document.documentElement.getAttribute('data-e2')).catch(() => null); if (s === 'all') break; if (s === 'error' || i === 959) throw new Error('e2: страница не загрузилась: ' + JSON.stringify(await page.evaluate(() => window.E2 ? window.E2.errors : []).catch(() => []))); await sleep(250); }
    const adv = (ms) => page.evaluate((m) => window.__e2.advance(m), ms);
    const n = await page.evaluate(() => window.E2_BUILDING.frames.length);
    const frames = (opt.frames ? opt.frames.split(',').map(Number) : [...Array(n).keys()]).filter((f) => f < n);
    await adv(3000);
    for (const st of states) {
      await page.evaluate((s, wx) => { if (wx) { window.__e2.setTod('day'); window.__e2.setWx(wx); } else { if (window.__e2.setWx) window.__e2.setWx('none'); window.__e2.setTod(s); } }, st, WX[st] || null);
      await adv(+(opt.settle || SETTLE[st] || 3200));
      for (const f of frames) {
        if ((await page.evaluate(() => window.__e2.state().frame)) !== f) {
          await page.evaluate((i) => window.__e2.go(i), f);
          for (let k = 0; k < 60; k++) { await adv(100); if (!(await page.evaluate(() => window.__e2.state().fading))) break; }
        }
        await adv(600);
        for (const t of tilts) {
          await page.evaluate((a) => window.__e2.tilt(a[0], a[1]), TILT[t]);
          await adv(160);
          const r = await page.evaluate(`(() => { window.__e2.advance(32); const p = window.__e2.pixels(); return { w: p.w, h: p.h, data: (${b64})(p.data) }; })()`);
          await save(`f${f}-${st}-t${t}`, r);
        }
      }
    }
    info.engine = await page.evaluate(() => window.__e2.version);
    info.prepCfg = await page.evaluate(() => window.__e2.prepCfg());
    info.errors = await page.evaluate(() => window.__e2.errors());
    info.stats = await page.evaluate(() => window.__e2.state().stats);
  }
} catch (e) { problems.push('fatal: ' + e.message); }
fs.writeFileSync(path.join(out, 'index.json'), JSON.stringify({ page: page_, kind: eng, ...info, problems, shots }, null, 1));
await browser.close(); srv.close();
console.log(`${eng} ${page_}: снимков ${shots.length}, проблем ${problems.length}${problems.length ? ' — ' + problems.slice(0, 3).join('; ') : ''}`);
process.exit(problems.length ? 1 : 0);
