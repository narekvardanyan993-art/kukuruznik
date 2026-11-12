#!/usr/bin/env node
// stanok_g1 — гейт G1 «ветер» страницы e2 (docs/STANOK.md §6, §4.3): кроны качаются, а фон за ними стоит.
//   node tools/stanok_g1.mjs --site DIR --page PAGE --out DIR [--frames 0,1] [--query break=wind-smear] --chrome PATH
// Окно 540×960 (9:16), dsf 1, адрес ?vt=1&ui=0&still=1 (время идёт только через __e2.advance). Для каждого кадра с ветром (effects.wind.on) в день
// сняты 60 моментов с шагом 0,33 с виртуального времени (20 с — больше порыва gustS). В каждый момент кадр рисуется дважды в ТОТ ЖЕ миг: с ветром и с
// выключенным ветром (?off=wind) — всё остальное (облака, небо) у двух снимков одинаково, разница — только от ветра.
// Маска кроны — из файла кроны станка (<кадр>_crown.png), расширенная на maxPx + 4 пикселя кадра и перенесённая на экран тем же ходом, каким
// движок кладёт кадр на экран (__e2.project). Проверки:
//   вне кроны   — вне расширенной маски не изменился ни один пиксель (≤ OUT_MAX): фон не тянется за кроной, трава, стены и небо стоят, сдвиг не больше потолка;
//   внутри      — крона на самом деле качается: в какой-то момент изменилось не меньше MOVE_MIN пикселей кроны (иначе ветра нет);
//   потолок     — сдвиг кроны, измеренный по картинке (на сколько пикселей сдвинутая картинка «без ветра» лучше всего совпадает с «с ветром» внутри маски),
//                 не больше maxPx кадра (в пикселях экрана — через масштаб кадра) + запас CAP_TOL;
//   гладкость   — вторая разность сдвига по соседним моментам (0,33 с) не больше SMOOTH_MAX от потолка: качание плавное, без скачков и мигания;
//   кадр        — нет ошибок JS и 404; ветер включён в движке (fx wind: on, amount 1).
// Итог: OUT/g1.json (числа и проблемы) и OUT/wind_<кадр>.png — лист: без ветра | в самый сильный момент с ветром | где изменилось (красным — вне кроны).
// Код выхода 0 — проблем нет, 1 — есть.
import puppeteer from 'puppeteer-core';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { PNG } from 'pngjs';

const argv = process.argv.slice(2), opt = {};
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) { opt[argv[i].slice(2)] = argv[i + 1]; i++; }
const site = path.resolve(opt.site), page_ = opt.page.replace(/^\/+|\/+$/g, ''), out = path.resolve(opt.out);
const W = 540, H = 960, DELTA = 6, N = +(opt.n || 60), STEP = 330;   // окно 9:16 — кадр виден целиком, без обрезки «cover» (на iPhone края кадра обрезаны, а гейт должен видеть крону целиком)
const OUT_MAX = 12, MOVE_MIN = 25, MOVE_FRAC = 0.04, SMOOTH_MAX = 0.35, CAP_TOL = 1.0;   // CAP_TOL — запас измерения сдвига, пикселей экрана (шаг поиска 0,25)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg' };
const srv = http.createServer((q, r) => {
  const p = decodeURIComponent(q.url.split('?')[0]); let f = path.join(site, p);
  if (!f.startsWith(site)) { r.writeHead(403); r.end(); return; }
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (!fs.existsSync(f)) { r.writeHead(404); r.end('not found'); return; }
  const st = fs.statSync(f), type = MIME[path.extname(f).toLowerCase()] || 'application/octet-stream', rg = q.headers.range;   // Range (206): без него ролик героя не перематывается
  if (rg) { const m = /bytes=(\d*)-(\d*)/.exec(rg), a = m[1] ? +m[1] : 0, b = m[2] ? Math.min(+m[2], st.size - 1) : st.size - 1; r.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${a}-${b}/${st.size}`, 'Accept-Ranges': 'bytes', 'Content-Length': b - a + 1, 'Cache-Control': 'no-store' }); fs.createReadStream(f, { start: a, end: b }).pipe(r); return; }
  r.writeHead(200, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': st.size, 'Cache-Control': 'no-store' });
  fs.createReadStream(f).pipe(r);
});
await new Promise((res) => srv.listen(0, '127.0.0.1', res));
const origin = 'http://127.0.0.1:' + srv.address().port;

// расширить маску квадратом радиуса r (две скользящие суммы)
function dilate(m, w, h, r) {
  const t = new Uint8Array(w * h), o = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const s = new Int32Array(w + 1);
    for (let x = 0; x < w; x++) s[x + 1] = s[x] + (m[y * w + x] ? 1 : 0);
    for (let x = 0; x < w; x++) t[y * w + x] = s[Math.min(w, x + r + 1)] - s[Math.max(0, x - r)] > 0 ? 1 : 0;
  }
  for (let x = 0; x < w; x++) {
    const s = new Int32Array(h + 1);
    for (let y = 0; y < h; y++) s[y + 1] = s[y] + t[y * w + x];
    for (let y = 0; y < h; y++) o[y * w + x] = s[Math.min(h, y + r + 1)] - s[Math.max(0, y - r)] > 0 ? 1 : 0;
  }
  return o;
}

const browser = await puppeteer.launch({ executablePath: opt.chrome, headless: 'new', protocolTimeout: 900000, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--hide-scrollbars', '--disable-features=CanvasNoise'] });
const page = await browser.newPage();
const problems = [], report = { page: page_, query: opt.query || '', delta: DELTA, frames: [] };
page.on('pageerror', (e) => problems.push('ошибка JS: ' + String(e.message).slice(0, 200)));
page.on('response', (r) => { if (r.status() >= 400 && r.url().startsWith(origin) && !/favicon/.test(r.url())) problems.push('HTTP ' + r.status() + ' ' + r.url().replace(origin, '')); });
await page.setViewport({ width: W, height: H, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
fs.mkdirSync(out, { recursive: true });
const b64 = `(px) => { let s = ''; const C = 0x8000; for (let i = 0; i < px.length; i += C) s += String.fromCharCode.apply(null, px.subarray(i, i + C)); return btoa(s); }`;
const adv = (ms) => page.evaluate((m) => window.__e2.advance(m), ms);
try {
  await page.goto(`${origin}/${page_}/?vt=1&ui=0&still=1${opt.query ? '&' + opt.query : ''}`, { waitUntil: 'load', timeout: 60000 });
  for (let i = 0; i < 960; i++) { const s = await page.evaluate(() => document.documentElement.getAttribute('data-e2')).catch(() => null); if (s === 'all') break; if (s === 'error' || i === 959) throw new Error('e2: страница не загрузилась (data-e2=' + s + ')'); await sleep(250); }
  const cfg = await page.evaluate(() => window.E2_BUILDING);
  const want = opt.frames ? opt.frames.split(',').map(Number) : null;
  const list = cfg.frames.map((f, i) => [f, i]).filter(([f, i]) => f.effects.wind && f.effects.wind.on && (!want || want.includes(i)));
  if (!list.length) problems.push('ни у одного кадра нет ветра (effects.wind.on) — G1 нечего проверять');
  const maxPx = cfg.effects.wind.maxPx, FWd = cfg.look.frameSize[0], FHd = cfg.look.frameSize[1];
  await adv(3000);
  for (const [f, i] of list) {
    const tag = 'кадр ' + (i + 1) + ' (' + f.name + ')', R = { idx: i, name: f.name };
    report.frames.push(R);
    if ((await page.evaluate(() => window.__e2.state().frame)) !== i) {
      await page.evaluate((k) => window.__e2.go(k), i);
      for (let k = 0; k < 60; k++) { await adv(100); if (!(await page.evaluate(() => window.__e2.state().fading))) break; }
    }
    await page.evaluate(() => { window.__e2.setWx('none'); window.__e2.setTod('day'); window.__e2.tilt(0, 0); window.__e2.off('wind', false); });
    await adv(3500);
    const fxs = await page.evaluate(() => window.__e2.fx('wind'));
    R.fx = fxs;
    if (!fxs || !fxs.on) { problems.push(tag + ': движок не загрузил крону кадра (fx wind: on = false) — ветра нет'); continue; }
    // маска кроны: файл станка → пиксели с разностью → расширить на maxPx + 4 → на экран
    const crownFile = path.join(site, page_, f.files.crown.split('?')[0]);
    const png = PNG.sync.read(fs.readFileSync(crownFile)), cw = png.width, ch = png.height, core = new Uint8Array(cw * ch);
    let corePx = 0;
    for (let q = 0; q < cw * ch; q++) { const d = Math.max(Math.abs(png.data[q * 4] - 128), Math.abs(png.data[q * 4 + 1] - 128), Math.abs(png.data[q * 4 + 2] - 128)); if (d > 2) { core[q] = 1; corePx++; } }
    const wide = dilate(core, cw, ch, Math.ceil(maxPx) + 4);
    const pr = await page.evaluate(() => { const a = window.__e2.project(0, 0, 0.5), b = window.__e2.project(1, 1, 0.5); return [a[0], a[1], b[0] - a[0], b[1] - a[1]]; });
    const mWide = new Uint8Array(W * H), mCore = new Uint8Array(W * H);   // строки снизу вверх, как отдаёт readPixels
    let areaCore = 0, areaWide = 0;
    for (let Y = 0; Y < H; Y++) for (let X = 0; X < W; X++) {
      const u = (X + 0.5 - pr[0]) / pr[2], v = (Y + 0.5 - pr[1]) / pr[3];
      if (u < 0 || u >= 1 || v < 0 || v >= 1) continue;
      const q = Math.floor(v * ch) * cw + Math.floor(u * cw), o = (H - 1 - Y) * W + X;
      if (wide[q]) { mWide[o] = 1; areaWide++; }
      if (core[q]) { mCore[o] = 1; areaCore++; }
    }
    R.crownPxFrame = corePx; R.areaCore = areaCore; R.areaWide = areaWide;
    if (areaCore < 20) { problems.push(tag + ': маска кроны на экране пуста (' + areaCore + ' пикс.) — станок не нашёл крону'); continue; }
    const res = await page.evaluate(async (wideB64, coreB64, n, step, delta, W_, H_, dmax) => {
      const dec = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
      const wide = dec(wideB64), core = dec(coreB64), px = W_ * H_ * 4, rows = [], idx = [];
      for (let q = 0; q < W_ * H_; q++) if (wide[q]) idx.push(q);
      let best = { m: -1, k: -1, on: null, off: null };
      const mk = (a) => new Uint8Array(a);
      const lum = (a, p) => 0.299 * a[p] + 0.587 * a[p + 1] + 0.114 * a[p + 2];
      for (let k = 0; k < n; k++) {
        window.__e2.advance(step, 32);
        window.__e2.off('wind', false); window.__e2.redraw();
        const on = mk(window.__e2.pixels().data);
        window.__e2.off('wind', true); window.__e2.redraw();
        const off = mk(window.__e2.pixels().data);
        window.__e2.off('wind', false);
        let out = 0, moved = 0, sum = 0, cnt = 0;
        for (let p = 0, q = 0; p < px; p += 4, q++) {
          const d = Math.max(Math.abs(on[p] - off[p]), Math.abs(on[p + 1] - off[p + 1]), Math.abs(on[p + 2] - off[p + 2]));
          if (!wide[q]) { if (d > delta) out++; continue; }
          cnt++; sum += d; if (d > delta) moved++;
        }
        // сдвиг по x (пиксели экрана): какой сдвиг картинки «без ветра» лучше всего совпадает с «с ветром» внутри маски
        let bd = 0, be = Infinity;
        for (let d = -dmax; d <= dmax + 1e-9; d += 0.25) {
          let e = 0, c = 0;
          for (let j = 0; j < idx.length; j++) {
            const q = idx[j], x = q % W_, xs = x - d;
            if (xs < 0 || xs > W_ - 1.001) continue;
            const x0 = Math.floor(xs), f = xs - x0, r = q - x;
            e += Math.abs(lum(on, q * 4) - (lum(off, (r + x0) * 4) * (1 - f) + lum(off, (r + x0 + 1) * 4) * f)); c++;
          }
          e = c ? e / c : Infinity;
          if (e < be - 1e-9 || (Math.abs(e - be) <= 1e-9 && Math.abs(d) < Math.abs(bd))) { be = e; bd = d; }
        }
        const m = sum / cnt;
        rows.push([out, moved, m, bd]);
        if (m > best.m) best = { m, k, on, off };
      }
      const flat = (a) => { let s = ''; const C = 0x8000; for (let i = 0; i < a.length; i += C) s += String.fromCharCode.apply(null, a.subarray(i, i + C)); return btoa(s); };
      return { rows, bestK: best.k, on: flat(best.on), off: flat(best.off) };
    }, Buffer.from(mWide).toString('base64'), Buffer.from(mCore).toString('base64'), N, STEP, DELTA, W, H, Math.ceil(maxPx * Math.abs(pr[2]) / FWd * 3 + 4));
    const outMax = Math.max(...res.rows.map((r) => r[0])), movedMax = Math.max(...res.rows.map((r) => r[1])), mMax = Math.max(...res.rows.map((r) => r[2]));
    const sh = res.rows.map((r) => r[3]);
    const perFrame = Math.abs(pr[2]) / FWd,   // пикселей экрана на пиксель кадра (pr[2] — ширина кадра на экране)
      capS = maxPx * perFrame;
    const shiftMax = Math.max(...sh.map(Math.abs));
    let dd = 0; for (let k = 1; k < sh.length - 1; k++) dd = Math.max(dd, Math.abs(sh[k + 1] - 2 * sh[k] + sh[k - 1]));
    const smooth = dd / capS;
    Object.assign(R, { outMax, movedMax, mMax: +mMax.toFixed(3), shiftMaxFramePx: +(shiftMax / perFrame).toFixed(2), capFramePx: maxPx, smooth: +smooth.toFixed(3), bestK: res.bestK, shifts: sh });
    if (outMax > OUT_MAX) problems.push(`${tag}: вне кроны (дальше ${Math.ceil(maxPx) + 4} пикселей кадра от неё) изменилось до ${outMax} пикселей (допуск ${OUT_MAX}): фон тянется за кроной или крона ушла дальше потолка maxPx = ${maxPx}`);
    if (shiftMax > capS + CAP_TOL) problems.push(`${tag}: крона уходит дальше потолка: сдвиг ${(shiftMax / perFrame).toFixed(1)} пикселей кадра, потолок maxPx = ${maxPx}`);
    if (movedMax < Math.max(MOVE_MIN, MOVE_FRAC * areaCore)) problems.push(`${tag}: крона не качается: за 20 с изменилось не больше ${movedMax} пикселей кроны (нужно ≥ ${Math.round(Math.max(MOVE_MIN, MOVE_FRAC * areaCore))}) — ветра нет`);
    else if (smooth > SMOOTH_MAX) problems.push(`${tag}: качание дёрганое: вторая разность сдвига за 0,33 с — ${(smooth * 100).toFixed(0)} % потолка (допуск ${SMOOTH_MAX * 100} %)`);
    // лист: без ветра | с ветром в самый сильный момент | где изменилось (красным — вне кроны)
    const on = Buffer.from(res.on, 'base64'), off = Buffer.from(res.off, 'base64'), sheet = new PNG({ width: W * 3, height: H });
    for (let Y = 0; Y < H; Y++) for (let X = 0; X < W; X++) {
      const s = ((H - 1 - Y) * W + X) * 4, q = (H - 1 - Y) * W + X;
      const d = Math.max(Math.abs(on[s] - off[s]), Math.abs(on[s + 1] - off[s + 1]), Math.abs(on[s + 2] - off[s + 2]));
      const put = (c, r, g, b) => { const o = (Y * W * 3 + c * W + X) * 4; sheet.data[o] = r; sheet.data[o + 1] = g; sheet.data[o + 2] = b; sheet.data[o + 3] = 255; };
      put(0, off[s], off[s + 1], off[s + 2]); put(1, on[s], on[s + 1], on[s + 2]);
      if (d > DELTA) { if (mWide[q]) put(2, 255, 255, 255); else put(2, 255, 0, 0); } else put(2, mWide[q] ? 70 : 0, mWide[q] ? 70 : 0, mWide[q] ? 90 : 0);
    }
    const sp = 'wind_' + f.name + '.png';
    fs.writeFileSync(path.join(out, sp), PNG.sync.write(sheet)); R.sheet = sp;
  }
  const errs = await page.evaluate(() => window.__e2.errors());
  if (errs.length) problems.push('ошибки движка: ' + errs.slice(0, 3).map((e) => JSON.stringify(e).slice(0, 160)).join('; '));
} catch (e) { problems.push('fatal: ' + e.message); }
report.problems = problems;
fs.writeFileSync(path.join(out, 'g1.json'), JSON.stringify(report, null, 1));
console.log(problems.length ? 'G1 КРАСНЫЙ:\n - ' + problems.join('\n - ') : 'G1 зелёный: ' + report.frames.map((r) => `${r.name} out=${r.outMax} moved=${r.movedMax} shift=${r.shiftMaxFramePx}px(≤${r.capFramePx}) smooth=${r.smooth}`).join('; '));
await browser.close(); srv.close();
process.exit(problems.length ? 1 : 0);
