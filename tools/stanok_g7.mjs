#!/usr/bin/env node
// stanok_g7 — гейт G7 «кнопки» страницы e2 (docs/STANOK.md §6): каждый кадр, НАСТОЯЩИЙ тап по кнопке → виртуальное время → снимок.
//   node tools/stanok_g7.mjs --site DIR --page PAGE --out DIR [--frames 0,1] [--buttons day,sunset,night,snow,rain] [--query break=tod] --chrome PATH
// Телефон 390×844, dsf 1, адрес ?vt=1 (время идёт только через __e2.advance; снаружи ничего не подменяется). Интерфейс виден — тап настоящий.
// Проверки (у каждой в самопроверке tools/stanok.py есть красный случай):
//   все кнопки  — нет ошибок JS и 404; кадр не пустой; состояние изменилось как надо.
//   «Закат»     — теплее дня.
//   «Ночь»      — темнее дня; окна сначала погашены, зажигаются ПО ОДНОМУ (не разом), все за ≤ 6 с; конечное состояние — ровно ночной рисунок
//                 (0 отличий от сцены без эффекта lights); мерцание — только в пятнах огней, мягкое, по огню целиком (без клеток).
//   «Дождь», «Снег» — частицы есть и на экране стоят там, где их считает движок; в начале они входят сверху или из-за края (середина
//                 кадра не «заселяется» из ниоткуда); садятся на свои поверхности, а не летят сквозь; дождь — мокрое темнее, после
//                 дождя радуга (если у кадра есть её рисунок); снег — белого больше и ложится сверху вниз; кадр без погоды (интерьер) —
//                 ни частиц, ни перемен.
// Итог: OUT/g7.json (числа и проблемы) и OUT/sheet_<кадр>.png — лист: столбец на кнопку, снимок страницы с интерфейсом.
// Код выхода 0 — проблем нет, 1 — есть.
import puppeteer from 'puppeteer-core';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { PNG } from 'pngjs';

const argv = process.argv.slice(2), opt = {};
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) { opt[argv[i].slice(2)] = argv[i + 1]; i++; }
const site = path.resolve(opt.site), page_ = opt.page.replace(/^\/+|\/+$/g, ''), out = path.resolve(opt.out);
const BUTTONS = (opt.buttons || 'day,sunset,night,snow,rain').split(',');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.mp4': 'video/mp4', '.webm': 'video/webm' };
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
const W = 390, H = 844;

const browser = await puppeteer.launch({ executablePath: opt.chrome, headless: 'new', protocolTimeout: 900000, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--hide-scrollbars', '--disable-features=CanvasNoise'] });
const page = await browser.newPage();
const jsErrors = [];
page.on('pageerror', (e) => jsErrors.push('ошибка JS: ' + String(e.message).slice(0, 200)));
page.on('response', (r) => { if (r.status() >= 400 && r.url().startsWith(origin) && !/favicon/.test(r.url())) jsErrors.push('HTTP ' + r.status() + ' ' + r.url().replace(origin, '')); });
await page.setViewport({ width: W, height: H, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
fs.mkdirSync(out, { recursive: true });

const b64 = `(px) => { let s = ''; const C = 0x8000; for (let i = 0; i < px.length; i += C) s += String.fromCharCode.apply(null, px.subarray(i, i + C)); return btoa(s); }`;
const adv = (ms) => page.evaluate((m) => window.__e2.advance(m), ms);
async function shot() {   // пиксели сцены (холст WebGL), строки сверху вниз, RGBA
  const r = await page.evaluate(`(() => { window.__e2.advance(32); const p = window.__e2.pixels(); return { w: p.w, h: p.h, data: (${b64})(p.data) }; })()`);
  const buf = Buffer.from(r.data, 'base64'), flip = Buffer.alloc(buf.length), row = r.w * 4;
  for (let y = 0; y < r.h; y++) buf.copy(flip, y * row, (r.h - 1 - y) * row, (r.h - y) * row);
  return { w: r.w, h: r.h, d: flip };
}
async function tap(sel) {   // настоящий тап пальцем по кнопке интерфейса
  const el = await page.$(sel);
  if (!el) return false;
  const bb = await el.boundingBox();
  if (!bb) return false;
  await page.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2);
  return true;
}
const lumAt = (s, i) => (0.299 * s.d[i] + 0.587 * s.d[i + 1] + 0.114 * s.d[i + 2]) / 255;
function stats(s, box) {   // box [x0, y0, x1, y1] в пикселях; среднее: яркость, «тепло» (R − B), разброс яркости, доля «белого»
  const x0 = Math.max(0, Math.floor(box ? box[0] : 0)), y0 = Math.max(0, Math.floor(box ? box[1] : 0)), x1 = Math.min(s.w, Math.ceil(box ? box[2] : s.w)), y1 = Math.min(s.h, Math.ceil(box ? box[3] : s.h));
  let n = 0, l = 0, l2 = 0, wm = 0, wh = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * s.w + x) * 4, v = lumAt(s, i);
    l += v; l2 += v * v; wm += (s.d[i] - s.d[i + 2]) / 255; n++;
    if (s.d[i] > 205 && s.d[i + 1] > 205 && s.d[i + 2] > 205) wh++;
  }
  if (!n) return { n: 0, lum: 0, warm: 0, sd: 0, white: 0 };
  return { n, lum: l / n, warm: wm / n, sd: Math.sqrt(Math.max(0, l2 / n - (l / n) * (l / n))), white: wh / n };
}
function diff(a, b, mask) {   // доля пикселей, где канал отличается больше thr; mask(x, y) → считать ли точку
  let n = 0, over = 0, mx = 0;
  for (let y = 0; y < a.h; y++) for (let x = 0; x < a.w; x++) {
    if (mask && !mask(x, y)) continue;
    const i = (y * a.w + x) * 4, d = Math.max(Math.abs(a.d[i] - b.d[i]), Math.abs(a.d[i + 1] - b.d[i + 1]), Math.abs(a.d[i + 2] - b.d[i + 2]));
    n++; if (d > 3) over++; if (d > mx) mx = d;
  }
  return { n, over, share: n ? over / n : 0, max: mx };
}
const r3 = (v) => +v.toFixed(4);

const result = { page: page_, query: opt.query || '', buttons: BUTTONS, frames: [], problems: [] };
try {
  await page.goto(`${origin}/${page_}/?vt=1${opt.query ? '&' + opt.query : ''}`, { waitUntil: 'load', timeout: 60000 });
  for (let i = 0; i < 960; i++) {
    const s = await page.evaluate(() => document.documentElement.getAttribute('data-e2')).catch(() => null);
    if (s === 'all') break;
    if (s === 'error' || i === 959) throw new Error('страница не загрузилась: ' + JSON.stringify(await page.evaluate(() => window.E2 ? window.E2.errors : []).catch(() => [])));
    await sleep(250);
  }
  const cfg = await page.evaluate(() => ({ n: window.E2_BUILDING.frames.length, names: window.E2_BUILDING.frames.map((f) => f.name), kinds: window.E2_BUILDING.frames.map((f) => f.kind), fx: window.E2_BUILDING.effects, version: window.__e2.version }));
  result.engine = cfg.version;
  const frames = (opt.frames ? opt.frames.split(',').map(Number) : [...Array(cfg.n).keys()]).filter((f) => f < cfg.n);
  await page.evaluate(() => window.__e2.off('breath', true));   // камера не «дышит»: иначе любые два снимка отличаются всем кадром
  await adv(1000);
  for (const f of frames) {
    const F = { frame: f, name: cfg.names[f], kind: cfg.kinds[f], problems: [], m: {} }, bad = (t) => F.problems.push(t);
    const sheets = [];
    if ((await page.evaluate(() => window.__e2.state().frame)) !== f) {
      await page.evaluate((i) => window.__e2.go(i), f);
      for (let k = 0; k < 60; k++) { await adv(100); if (!(await page.evaluate(() => window.__e2.state().fading))) break; }
      if ((await page.evaluate(() => window.__e2.state().frame)) !== f) { bad('кадр не открылся'); result.frames.push(F); continue; }
    }
    const sheet = async (label) => { sheets.push({ label, png: PNG.sync.read(await page.screenshot({ type: 'png' })) }); };
    // ---------- «День» ----------
    if (!(await tap('[data-tod=day]'))) bad('нет кнопки «День»');
    await adv(9000);
    const day = await shot(), sDay = stats(day);
    F.m.day = { lum: r3(sDay.lum), warm: r3(sDay.warm), sd: r3(sDay.sd) };
    if (sDay.sd < 0.04) bad('«День»: кадр пустой (разброс яркости ' + sDay.sd.toFixed(3) + ')');
    if (BUTTONS.includes('day')) await sheet('День');
    // ---------- «Закат» ----------
    if (BUTTONS.includes('sunset')) {
      if (!(await tap('[data-tod=sunset]'))) bad('нет кнопки «Закат»');
      await adv(3400);
      const sun = await shot(), s = stats(sun), d = diff(day, sun);
      F.m.sunset = { lum: r3(s.lum), warm: r3(s.warm), changed: r3(d.share) };
      if (d.share < 0.2) bad('«Закат»: кадр не изменился (отличается ' + (d.share * 100).toFixed(1) + ' % пикселей) — кнопка не работает');
      else if (s.warm < sDay.warm + 0.01) bad('«Закат»: не теплее дня (R−B ' + s.warm.toFixed(3) + ' против ' + sDay.warm.toFixed(3) + ')');
      if (s.sd < 0.04) bad('«Закат»: кадр пустой');
      await sheet('Закат');
    }
    // ---------- «Ночь» ----------
    if (BUTTONS.includes('night')) {
      const L = cfg.fx.lights, turnOn = L ? L.turnOnS : 5;
      if (!(await tap('[data-tod=night]'))) bad('нет кнопки «Ночь»');
      // ждём, пока ночь ляжет и начнётся очередь окон (по состоянию движка, не по секундам на глаз)
      let started = false;
      for (let k = 0; k < 120; k++) { const q = await page.evaluate(() => window.__e2.fx('lights')); if (!q || q.t0 !== null) { started = !!q; break; } await adv(64); }
      const info = await page.evaluate(() => window.__e2.fx('lights'));
      const wins = info && info.frame ? info.frame.list.filter((q) => q[0] === 'window') : [];
      const allL = info && info.frame ? info.frame.list : [];
      const boxOf = async (q, pad) => { const a = await page.evaluate((u, v) => window.__e2.project(u, v, 0.5), q[1], q[2]), b = await page.evaluate((u, v) => window.__e2.project(u, v, 0.5), q[3], q[4]); return [a[0] - pad, a[1] - pad, b[0] + pad, b[1] + pad]; };
      const wb = []; for (const q of wins) wb.push(await boxOf(q, 0));
      const lb = []; for (const q of allL) lb.push(await boxOf(q, 7));
      const STEP = 400, series = [await shot()];
      for (let k = 0; k < Math.ceil((turnOn + 1.2) * 1000 / STEP); k++) { await adv(STEP - 32); series.push(await shot()); }
      await adv(1500);
      const fin = await shot(), sN = stats(fin), dN = diff(day, fin);
      F.m.night = { lum: r3(sN.lum), changed: r3(dN.share), lights: allL.length, windows: wins.length };
      if (dN.share < 0.2) bad('«Ночь»: кадр не изменился (отличается ' + (dN.share * 100).toFixed(1) + ' % пикселей) — кнопка не работает');
      else if (sN.lum > sDay.lum * 0.8) bad('«Ночь»: не темнее дня (яркость ' + sN.lum.toFixed(3) + ' против ' + sDay.lum.toFixed(3) + ')');
      if (sN.sd < 0.03) bad('«Ночь»: кадр пустой');
      await sheet('Ночь');
      if (L && allL.length && !started) bad('«Ночь»: очередь окон не началась');
      if (L && wins.length && started) {
        // окно «горит» на снимке k, если его яркость прошла полпути от погашенного (первый снимок) к конечному
        const m0 = wb.map((b) => stats(series[0], b).lum), m1 = wb.map((b) => stats(fin, b).lum);
        const act = wb.map((b, i) => m1[i] - m0[i] > 0.03);          // окна, у которых «погашено» заметно темнее «горит»
        const nAct = act.filter(Boolean).length;
        F.m.night.dark0 = nAct;
        if (nAct < Math.min(3, wins.length)) bad('«Ночь»: окна не погашены в начале (тёмных на старте ' + nAct + ' из ' + wins.length + ') — зажигать нечего');
        let prev = 0, maxJump = 0, mono = true, tAll = null;
        const lit = [];
        series.forEach((s, k) => {
          let c = 0;
          wb.forEach((b, i) => { if (act[i] && (stats(s, b).lum - m0[i]) / (m1[i] - m0[i]) > 0.5) c++; });
          lit.push(c);
          if (c < prev) mono = false;
          if (c - prev > maxJump) maxJump = c - prev;
          if (c === nAct && tAll === null) tAll = k * STEP / 1000;
          prev = c;
        });
        F.m.night.lit = lit; F.m.night.maxJump = maxJump; F.m.night.allOnS = tAll;
        if (nAct >= 3) {
          if (!mono) bad('«Ночь»: окна зажигаются и гаснут вперемешку (число горящих по снимкам: ' + lit.join(' ') + ')');
          if (maxJump > Math.max(2, Math.ceil(nAct * 0.34))) bad('«Ночь»: окна зажглись разом, а не по одному (за ' + STEP + ' мс зажглось ' + maxJump + ' из ' + nAct + ')');
          if (tAll === null || tAll > 6) bad('«Ночь»: не все окна зажглись за 6 с (число горящих по снимкам: ' + lit.join(' ') + ')');
        }
      }
      if (L && allL.length) {
        // конечное состояние — ровно ночной рисунок: стоп-кадр с огнями против стоп-кадра без эффекта lights
        await page.evaluate(() => window.__e2.still(true)); const a = await shot();
        await page.evaluate(() => window.__e2.off('lights', true)); const b = await shot();
        await page.evaluate(() => { window.__e2.off('lights', false); window.__e2.still(false); });
        const dF = diff(a, b);
        F.m.night.finalDiff = dF.over;
        if (dF.over > 0) bad('«Ночь»: конечное состояние — не ночной рисунок (отличается ' + dF.over + ' px, макс. ' + dF.max + ')');
        // мерцание: только в пятнах огней, мягкое, по огню целиком
        const inL = (x, y) => lb.some((q) => x >= q[0] && x < q[2] && y >= q[1] && y < q[3]);
        const fl = [fin]; for (let k = 0; k < 7; k++) { await adv(1100); fl.push(await shot()); }
        const raw = [];
        let outMax = 0, live = 0, cells = 0, hard = 0;
        for (let k = 1; k < fl.length; k++) outMax = Math.max(outMax, diff(fl[0], fl[k], (x, y) => !inL(x, y)).max);
        // «живое»: пятно огня меняет яркость (середина отношения «стало / было» по ярким точкам ушла от 1)
        lb.forEach((q) => {
          let best = 0, amp = 0;
          for (let k = 1; k < fl.length; k++) {
            const v = [];
            for (let y = Math.max(0, Math.floor(q[1])); y < Math.min(H, Math.ceil(q[3])); y++) for (let x = Math.max(0, Math.floor(q[0])); x < Math.min(W, Math.ceil(q[2])); x++) { const i = (y * W + x) * 4, a0 = lumAt(fl[0], i); if (a0 > 0.35) v.push(lumAt(fl[k], i) / a0); }
            if (v.length < 8) continue;
            v.sort((p, q2) => p - q2);
            best = Math.max(best, Math.abs(v[v.length >> 1] - 1));
            amp = Math.max(amp, Math.abs(v[Math.floor(v.length * 0.02)] - 1), Math.abs(v[Math.floor(v.length * 0.98)] - 1));
          }
          if (best > 0.006) live++;
          if (amp > 0.14) hard++;
        });
        // «клетки»: в сердцевине одного огня (маска станка = 1, файл <кадр>_lights.png) отношение «стало / было» обязано быть ровным —
        // огонь мерцает как целое. Клетки дают пёстрое отношение: разброс заметно больше шума 8 бит.
        const lp = PNG.sync.read(fs.readFileSync(path.join(site, page_, 'frames', cfg.names[f] + '_lights.png')));
        const p0 = await page.evaluate(() => window.__e2.project(0, 0, 0.5)), p1 = await page.evaluate(() => window.__e2.project(1, 1, 0.5));
        const coreOf = new Map();   // номер огня → точки экрана в сердцевине
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          const tx = Math.round((x + 0.5 - p0[0]) / (p1[0] - p0[0]) * lp.width - 0.5), ty = Math.round((y + 0.5 - p0[1]) / (p1[1] - p0[1]) * lp.height - 0.5);
          if (tx < 1 || ty < 1 || tx >= lp.width - 1 || ty >= lp.height - 1) continue;
          const id = lp.data[(ty * lp.width + tx) * 4 + 1];
          if (!id) continue;
          let solid = true;
          for (let j = -1; j <= 1 && solid; j++) for (let i2 = -1; i2 <= 1; i2++) { const o = ((ty + j) * lp.width + tx + i2) * 4; if (lp.data[o] < 250 || lp.data[o + 1] !== id) { solid = false; break; } }
          if (!solid) continue;
          if (!coreOf.has(id)) coreOf.set(id, []);
          coreOf.get(id).push((y * W + x) * 4);
        }
        coreOf.forEach((pts, id) => {
          let isCells = false;
          for (let k = 1; k < fl.length; k++) {
            let n = 0, sum = 0, sum2 = 0;
            for (const i of pts) { const a0 = lumAt(fl[0], i); if (a0 < 0.4) continue; const r = lumAt(fl[k], i) / a0; n++; sum += r; sum2 += r * r; }
            if (n < 16) continue;
            const sd = Math.sqrt(Math.max(0, sum2 / n - (sum / n) * (sum / n)));
            if (sd > 0.008 + 0.35 * Math.abs(sum / n - 1)) isCells = true;   // 0,008 — шум 8 бит; 0,35 — ночное затемнение рисунка неровно усиливает общее мерцание
            raw.push([id, n, +sd.toFixed(4), +(sum / n).toFixed(4)]);
          }
          if (isCells) cells++;
        });
        F.m.night.flicker = { outsideMax: outMax, live, cells, hard }; if (opt.raw) F.m.night.raw = raw;
        if (outMax > 3) bad('«Ночь»: мерцание выходит за пятна огней (вне пятен разница до ' + outMax + ')');
        if (cells > 0) bad('«Ночь»: мерцание пятнами внутри огня, а не по огню целиком («клетки»; огней ' + cells + ')');
        if (hard > 0) bad('«Ночь»: мерцание грубое, больше 14 % яркости (огней ' + hard + ')');
        if (!live) bad('«Ночь»: огни не мерцают (ни одно пятно не меняется)');
      }
    }
    // ---------- weather: «Дождь», «Снег» ----------
    const wxInfo = () => page.evaluate(() => window.__e2.fx('weather'));
    const scenePair = async () => {   // один и тот же момент: с частицами и без них
      const full = await shot();
      // перерисовка и чтение пикселей — одним вызовом: между двумя вызовами браузер успевает показать кадр и очистить холст
      const r = await page.evaluate(`(() => { window.__e2.off('precip', true); window.__e2.off('rainbow', true); window.__e2.redraw(); const p = window.__e2.pixels(); window.__e2.off('precip', false); window.__e2.off('rainbow', false); window.__e2.redraw(); return { w: p.w, h: p.h, data: (${b64})(p.data) }; })()`);
      const buf = Buffer.from(r.data, 'base64'), flip = Buffer.alloc(buf.length), row = r.w * 4;
      for (let y = 0; y < r.h; y++) buf.copy(flip, y * row, (r.h - 1 - y) * row, (r.h - y) * row);
      return { full, scene: { w: r.w, h: r.h, d: flip } };
    };
    const RU = { rain: '«Дождь»', snow: '«Снег»' }, VMAX = { rain: 1.7, snow: 0.15 }, SETTLE = { rain: 6000, snow: 16000 }, EARLY = { rain: 96, snow: 704 };
    if ((BUTTONS.includes('rain') || BUTTONS.includes('snow')) && (await wxInfo())) {
      if (BUTTONS.includes('night') || BUTTONS.includes('sunset')) { await tap('[data-tod=day]'); await adv(9000); }
      for (const kind of ['rain', 'snow']) {
        if (!BUTTONS.includes(kind)) continue;
        const nm = RU[kind], M = F.m[kind] = {};
        let w0 = await wxInfo();
        if (w0.kind !== 'none') { await tap(`[data-wx=${w0.kind}]`); await adv(32000); }
        const base = await shot();                                     // тот же кадр без погоды, прямо перед нажатием
        if (!(await tap(`[data-wx=${kind}]`))) { bad('нет кнопки ' + nm); continue; }
        w0 = await wxInfo();
        if (w0.kind !== kind) { bad(nm + ': кнопка не работает (погода не включилась)'); continue; }
        const allowed = !!(w0.on && w0.on[kind]);
        M.allowed = allowed;
        if (!allowed) {     // кадр без погоды (интерьер): ни частиц, ни перемен в сцене
          await adv(SETTLE.rain);
          const w = await wxInfo(), now = await shot(), d = diff(base, now);
          M.parts = w.parts[kind].length; M.changed = r3(d.share);
          if (w.parts[kind].length > 0 || d.share > 0.002) bad(nm + ': осадки там, где их быть не должно (кадр без погоды — интерьер): частиц ' + w.parts[kind].length + ', изменилось ' + (d.share * 100).toFixed(2) + ' % пикселей');
          await sheet(kind === 'rain' ? 'Дождь' : 'Снег');
          await tap(`[data-wx=${kind}]`); await adv(4500);
          continue;
        }
        // 1) начало: частицы входят сверху или из-за наветренного края — середина кадра не «заселяется» из ниоткуда
        await adv(EARLY[kind]);
        let w = await wxInfo(), el = (w.t - w.spans[kind].on) / 1000, pop = w.parts[kind].filter((q) => q[2] > -w.M + VMAX[kind] * (el + 0.05) + 0.02 && q[1] > 0.03);
        M.early = { t: r3(el), parts: w.parts[kind].length, pop: pop.length };
        if (pop.length) bad(nm + ': частицы появились посреди кадра («из ниоткуда»): ' + pop.length + ' шт. через ' + el.toFixed(2) + ' с после нажатия ниже, чем могли долететь сверху');
        // снег ложится сверху вниз: к этому моменту верх кадра набрал большую долю своего снега, чем низ
        let mid = null;
        if (kind === 'snow') { await adv(4200 - EARLY.snow); mid = (await scenePair()).scene; }
        await adv(SETTLE[kind] - (kind === 'snow' ? 4232 : EARLY.rain));
        // 2) установилось: частицы есть, и на экране они там, где говорит движок
        const pr = await scenePair(); w = await wxInfo();
        const P = w.parts[kind], vis = P.filter((q) => q[7] > -5 && q[7] < W + 5 && q[8] > -5 && q[8] < H + 5);
        M.parts = P.length; M.onScreen = vis.length;
        if (vis.length < 8) bad(nm + ': частиц нет (на экране ' + vis.length + ')');
        const R = kind === 'snow' ? 9 : 22, near = (x, y) => vis.some((q) => Math.abs(x - q[7]) <= R && y - q[8] <= R && q[8] - y <= (kind === 'snow' ? R : 34));
        const dp = diff(pr.full, pr.scene), dOut = diff(pr.full, pr.scene, (x, y) => !near(x, y));
        M.partPx = dp.over; M.partPxOutside = dOut.over;
        if (vis.length >= 8 && dp.over < 30) bad(nm + ': частицы не видны на экране (отличается ' + dp.over + ' px)');
        if (dp.over >= 30 && dOut.over > 0.05 * dp.over) bad(nm + ': частицы на экране не там, где их считает движок (' + dOut.over + ' px из ' + dp.over + ' вне частиц)');
        // 3) сцена: дождь — мокрое темнее; снег — белого больше (если у кадра есть маска снега)
        const sB = stats(base, [0, H * 0.5, W, H]), sS = stats(pr.scene, [0, H * 0.5, W, H]);
        M.sceneLum = [r3(sB.lum), r3(sS.lum)]; M.white = [r3(stats(base).white), r3(stats(pr.scene).white)];
        if (kind === 'rain' && sS.lum > sB.lum * 0.99) bad(nm + ': мокрое не темнее (яркость низа кадра ' + sS.lum.toFixed(3) + ' против ' + sB.lum.toFixed(3) + ' без дождя)');
        if (kind === 'snow' && w.mask) {
          const g = M.white[1] - M.white[0];
          if (g < 0.008) bad(nm + ': снег не лёг (белого ' + M.white[1] + ' против ' + M.white[0] + ' без снега)');
          else if (mid) {
            // «сверху вниз»: точки, которые снег в итоге выбелил; какая доля их снега уже лежит через 4 с. Верх кадра (крыши, карнизы, верх
            // предметов) обязан идти впереди низа (плоскость земли). Небо не мешает: под тучами оно темнеет и в «точки снега» не попадает.
            const acc = { top: [0, 0], bottom: [0, 0] };
            for (let y = 0; y < H; y++) {
              const zone = y < H * 0.55 ? acc.top : (y >= H * 0.7 ? acc.bottom : null);
              if (!zone) continue;
              for (let x = 0; x < W; x++) {
                const i = (y * W + x) * 4, g1 = lumAt(pr.scene, i) - lumAt(base, i);
                if (g1 < 0.12) continue;
                zone[0]++; zone[1] += Math.min(1, Math.max(0, (lumAt(mid, i) - lumAt(base, i)) / g1));
              }
            }
            const pt = acc.top[0] ? acc.top[1] / acc.top[0] : 0, pb = acc.bottom[0] ? acc.bottom[1] / acc.bottom[0] : 0;
            M.topDown = { topPx: acc.top[0], top: r3(pt), bottomPx: acc.bottom[0], bottom: r3(pb) };
            if (acc.top[0] >= 300 && acc.bottom[0] >= 300 && pt < pb + 0.1) bad(nm + ': снег ложится не сверху вниз (через 4 с верх кадра набрал ' + (100 * pt).toFixed(0) + ' % своего снега, низ — ' + (100 * pb).toFixed(0) + ' %)');
          }
        }
        await sheet(kind === 'rain' ? 'Дождь' : 'Снег');
        // 4) посадка: частица гаснет на своей поверхности, а не летит сквозь кадр (по часам: серия моментов)
        let through = 0, landed = 0, roof = 0;
        for (let k = 0; k < 12; k++) {
          await adv(kind === 'snow' ? 256 : 64);
          (await wxInfo()).parts[kind].forEach((q) => { if (q[5] < 8 && q[2] > q[5] + 0.012) through++; if (q[6] >= 1 && q[5] < 8) { landed++; if (q[9] - q[5] > 0.05) roof++; } });
        }
        M.through = through; M.landed = landed; M.roof = roof;     // roof — сели на предмет (линию крыши), а не на землю: частица ближе пролетела бы ниже
        if (through) bad(nm + ': частицы летят сквозь поверхности (ниже своей линии посадки: ' + through + ' наблюдений)');
        else if (!landed) bad(nm + ': ни одна частица не села на поверхность за серию наблюдений');
        else if (kind === 'snow' && F.kind === 'wide' && !roof) bad(nm + ': ни одна снежинка не погасла на линии крыши (все долетели до земли) за серию наблюдений');
        // выключить; после дождя — радуга (если у кадра есть её рисунок)
        await tap(`[data-wx=${kind}]`);
        if (kind === 'rain') {
          await adv(9000);
          const wr = await wxInfo();
          M.rainbow = { has: wr.hasRainbow, a: r3(wr.rainbowA) };
          if (wr.hasRainbow) {
            const a = await shot();
            const rr = await page.evaluate(`(() => { window.__e2.off('rainbow', true); window.__e2.redraw(); const p = window.__e2.pixels(); window.__e2.off('rainbow', false); window.__e2.redraw(); return { w: p.w, h: p.h, data: (${b64})(p.data) }; })()`);
            const buf = Buffer.from(rr.data, 'base64'), flip = Buffer.alloc(buf.length), row = rr.w * 4;
            for (let y = 0; y < rr.h; y++) buf.copy(flip, y * row, (rr.h - 1 - y) * row, (rr.h - y) * row);
            const dr = diff(a, { w: rr.w, h: rr.h, d: flip });
            M.rainbow.px = dr.over;
            if (wr.rainbowA < 0.5 || dr.over < 400) bad(nm + ': радуги после дождя нет (сила ' + wr.rainbowA.toFixed(2) + ', пикселей ' + dr.over + ')');
            await sheet('Радуга');
          }
        } else await adv(32000);     // снег тает 30 с — следующий кадр начинается чистым
      }
    }
    // лист кадра: столбец на кнопку
    if (sheets.length) {
      const png = new PNG({ width: W * sheets.length, height: H });
      sheets.forEach((s, k) => { for (let y = 0; y < H; y++) s.png.data.copy(png.data, (y * png.width + k * W) * 4, y * W * 4, (y + 1) * W * 4); });
      fs.writeFileSync(path.join(out, `sheet_${cfg.names[f]}.png`), PNG.sync.write(png));
      F.sheet = `sheet_${cfg.names[f]}.png`; F.columns = sheets.map((s) => s.label);
    }
    F.errors = await page.evaluate(() => window.__e2.errors());
    F.errors.forEach((e) => bad('ошибка движка: ' + e));
    result.frames.push(F);
  }
} catch (e) { result.problems.push('сбой прогона: ' + e.message); }
jsErrors.forEach((e) => result.problems.push(e));
result.frames.forEach((F) => F.problems.forEach((p) => result.problems.push(`кадр ${F.frame + 1} (${F.name}): ${p}`)));
fs.writeFileSync(path.join(out, 'g7.json'), JSON.stringify(result, null, 1));
await browser.close(); srv.close();
console.log(`G7 ${page_}${opt.query ? ' ?' + opt.query : ''}: кадров ${result.frames.length}, проблем ${result.problems.length}`);
result.problems.slice(0, 20).forEach((p) => console.log('   - ' + p));
process.exit(result.problems.length ? 1 : 0);
