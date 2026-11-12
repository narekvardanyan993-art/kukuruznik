#!/usr/bin/env node
// stanok_g7 — гейт G7 «кнопки» страницы e2 (docs/STANOK.md §6): каждый кадр, НАСТОЯЩИЙ тап по кнопке → виртуальное время → снимок.
//   node tools/stanok_g7.mjs --site DIR --page PAGE --out DIR [--frames 0,1] [--buttons day,sunset,night,snow,rain] [--query break=tod] --chrome PATH
// Телефон 390×844, dsf 1, адрес ?vt=1 (время идёт только через __e2.advance; снаружи ничего не подменяется). Интерфейс виден — тап настоящий.
// Проверки (у каждой в самопроверке tools/stanok.py есть красный случай):
//   все кнопки  — нет ошибок JS и 404; кадр не пустой; состояние изменилось как надо.
//   «Закат»     — теплее дня.
//   «Ночь»      — темнее дня; окна сначала погашены, зажигаются ПО ОДНОМУ (не разом), все за ≤ 6 с; конечное состояние — ровно ночной рисунок
//                 (0 отличий от сцены без эффекта lights); мерцание — только в пятнах огней, мягкое, по огню целиком (без клеток).
//   небо (в «Дне») — тени облаков видны, только темнят и не гуще своей силы, край мягкий, на небо не ложатся, плывут по часам движка;
//                 облака рисунка плывут только в своём прямоугольнике; интерьер и минимальная ступень (?tier=min) — без теней.
//   «Дождь», «Снег» — частицы есть и на экране стоят там, где их считает движок; в начале они входят сверху или из-за края (середина
//                 кадра не «заселяется» из ниоткуда); садятся на свои поверхности, а не летят сквозь; дождь — мокрое темнее, после
//                 дождя радуга (если у кадра есть её рисунок); снег — белого больше и ложится сверху вниз; кадр без погоды (интерьер) —
//                 ни частиц, ни перемен.
// изюминки   — на каждом снимке листа: каждая видна (не пропала, ≥ 90 % в экране), кнопки её не закрывают (эффект actors).
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
  const st = fs.statSync(f), type = MIME[path.extname(f).toLowerCase()] || 'application/octet-stream', rg = q.headers.range;   // Range (206): без него ролик героя не перематывается
  if (rg) { const m = /bytes=(\d*)-(\d*)/.exec(rg), a = m[1] ? +m[1] : 0, b = m[2] ? Math.min(+m[2], st.size - 1) : st.size - 1; r.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${a}-${b}/${st.size}`, 'Accept-Ranges': 'bytes', 'Content-Length': b - a + 1, 'Cache-Control': 'no-store' }); fs.createReadStream(f, { start: a, end: b }).pipe(r); return; }
  r.writeHead(200, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': st.size, 'Cache-Control': 'no-store' });
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
  const cfg = await page.evaluate(() => ({ n: window.E2_BUILDING.frames.length, names: window.E2_BUILDING.frames.map((f) => f.name), kinds: window.E2_BUILDING.frames.map((f) => f.kind), fx: window.E2_BUILDING.effects, wx: window.E2_BUILDING.frames.map((f) => f.effects.weather || null), sky: window.E2_BUILDING.frames.map((f) => f.effects.sky || null), tier: window.__e2.state().tier, version: window.__e2.version }));
  result.engine = cfg.version;
  // бюджет кадра (docs/STANOK.md §5.1): выборок текстур на пиксель в собранном шейдере — не больше бюджета схемы; текстур — сколько даёт телефон
  const bud = await page.evaluate(() => ({ b: window.E2_BUILDING.budget || null, s: window.__e2.state().stats }));
  result.budget = bud;
  if (bud.b && bud.s.lookups > bud.b.lookups) result.problems.push('бюджет: в шейдере сцены ' + bud.s.lookups + ' выборок текстур на пиксель, бюджет ' + bud.b.lookups);
  if (bud.s.units > 16) result.problems.push('бюджет: шейдеру нужно ' + bud.s.units + ' текстур, у телефона 16');
  const frames = (opt.frames ? opt.frames.split(',').map(Number) : [...Array(cfg.n).keys()]).filter((f) => f < cfg.n);
  await page.evaluate(() => window.__e2.off('breath', true));   // камера не «дышит»: иначе любые два снимка отличаются всем кадром
  // герои (actors) и ветер (wind) — своё движение: замеры неба, огней и погоды идут без них (ветер проверяет G1, героев — G10 и снимки листа)
  await page.evaluate(() => { window.__e2.off('actors', true); window.__e2.off('wind', true); });
  await page.evaluate(() => window.__e2.off('skymove', true));  // небо стоит (тени облаков видны, но не плывут): иначе замеры огней и погоды тонут в движении теней; движение неба меряет свой раздел
  await adv(1000);
  for (const f of frames) {
    const F = { frame: f, name: cfg.names[f], kind: cfg.kinds[f], problems: [], m: {} }, bad = (t) => F.problems.push(t);
    const sheets = [];
    if ((await page.evaluate(() => window.__e2.state().frame)) !== f) {
      await page.evaluate((i) => window.__e2.go(i), f);
      for (let k = 0; k < 60; k++) { await adv(100); if (!(await page.evaluate(() => window.__e2.state().fading))) break; }
      if ((await page.evaluate(() => window.__e2.state().frame)) !== f) { bad('кадр не открылся'); result.frames.push(F); continue; }
    }
    // изюминки (эффект actors) на каждом снимке листа: видны (не пропали, не за краем экрана) и кнопки их не закрывают
    const heroes = async (label) => {
      const d = await page.evaluate(() => window.__e2.fx('actors'));
      if (!d || !d.actors.length) return;
      const ui = await page.evaluate(() => Array.prototype.filter.call(document.querySelectorAll('#bar button'), (b) => b.offsetParent !== null).map((b) => { const r = b.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom, b.textContent.trim() || b.getAttribute('aria-label')]; }));
      const s = await shot();
      F.m.heroes = F.m.heroes || {};
      for (const A of d.actors.filter((q) => q.emotion)) {
        const r = A.figure || A.rect, a = await page.evaluate((u, v) => window.__e2.project(u, v, 0.5), r[0], r[1]), b = await page.evaluate((u, v) => window.__e2.project(u, v, 0.5), r[2], r[3]);
        const box = [a[0], a[1], b[0], b[1]];
        // сколько героя в экране — по точкам его маски, а не по рамке (рамка маски захватывает и неподвижное рядом: край скамейки у кромки)
        const inS = await page.evaluate((P, w, h) => { let n = 0; for (const q of P) { const p = window.__e2.project(q[0], q[1], 0.5); if (p[0] >= 0 && p[0] < w && p[1] >= 0 && p[1] < h) n++; } return P.length ? n / P.length : 0; }, A.pts || [], W, H);
        const cover = ui.filter((q) => q[0] < box[2] && q[2] > box[0] && q[1] < box[3] && q[3] > box[1]).map((q) => q[4]);
        const st = stats(s, box);
        (F.m.heroes[A.id] = F.m.heroes[A.id] || {})[label] = { kind: A.kind, w: A.w, inScreen: r3(inS), sd: r3(st.sd), cover };
        if (cover.length) bad(label + ': кнопки закрывают изюминку «' + A.id + '» (' + cover.join(', ') + ')');
        if (inS < 0.9) bad(label + ': изюминка «' + A.id + '» за краем экрана (в экране ' + (100 * inS).toFixed(0) + ' % точек её маски)');
        if ((A.kind === 'clip' || A.kind === 'image') ? A.w < 0.5 : A.kind !== 'drawing') bad(label + ': изюминка «' + A.id + '» пропала (' + A.kind + ', вес ' + A.w + ')');
        else if (st.sd < 0.03) bad(label + ': на месте изюминки «' + A.id + '» пусто');
      }
    };
    const settle = async () => { for (let k = 0; k < 400; k++) { const p = await page.evaluate(() => { window.__e2.redraw(); return window.__e2.pending(); }); if (!p) return; await sleep(25); } };
    const sheet = async (label) => {   // лист — с героями (их ролики встали на свой кадр); после снимка герои снова выключены
      await page.evaluate(() => { window.__e2.off('actors', false); window.__e2.off('wind', false); window.__e2.redraw(); }); await settle();
      sheets.push({ label, png: PNG.sync.read(await page.screenshot({ type: 'png' })) }); await heroes(label);
      await page.evaluate(() => { window.__e2.off('actors', true); window.__e2.off('wind', true); window.__e2.redraw(); });
    };
    // ---------- «День» ----------
    if (!(await tap('[data-tod=day]'))) bad('нет кнопки «День»');
    await adv(9000);
    const day = await shot(), sDay = stats(day);
    F.m.day = { lum: r3(sDay.lum), warm: r3(sDay.warm), sd: r3(sDay.sd) };
    if (sDay.sd < 0.04) bad('«День»: кадр пустой (разброс яркости ' + sDay.sd.toFixed(3) + ')');
    if (BUTTONS.includes('day')) await sheet('День');
    // ---------- небо: тени облаков и плывущие облака рисунка (эффект sky) ----------
    if (BUTTONS.includes('day') && cfg.sky[f] && (await page.evaluate(() => window.__e2.fx('sky')))) {
      cfg.tier = await page.evaluate(() => window.__e2.state().tier);   // ступень читается здесь, а не при загрузке: до первого тика движок отвечает «full» (находка П2)
      const M = F.m.sky = {}, SK = cfg.sky[f], C = cfg.fx.sky.clouds, allowed = SK.shadow > 0 && cfg.tier !== 'min';
      const pair = async () => {   // один и тот же момент: с тенями облаков и без них
        const full = await shot();
        const r = await page.evaluate(`(() => { window.__e2.off('clouds', true); window.__e2.redraw(); const p = window.__e2.pixels(); window.__e2.off('clouds', false); window.__e2.redraw(); return { w: p.w, h: p.h, data: (${b64})(p.data) }; })()`);
        const buf = Buffer.from(r.data, 'base64'), flip = Buffer.alloc(buf.length), row = r.w * 4;
        for (let y = 0; y < r.h; y++) buf.copy(flip, y * row, (r.h - 1 - y) * row, (r.h - y) * row);
        return { full, bare: { w: r.w, h: r.h, d: flip } };
      };
      await page.evaluate(() => window.__e2.off('skymove', false));
      await adv(64);
      const A = await pair(), info = await page.evaluate(() => window.__e2.fx('sky'));
      // карта неба кадра (клетки 0..255) → точки экрана: 1 — глубоко в небе, −1 — глубоко не в небе, 0 — у границы (не судим)
      const p0 = await page.evaluate(() => window.__e2.project(0, 0, 0.5)), p1 = await page.evaluate(() => window.__e2.project(1, 1, 0.5)), mp = info.map;
      const zone = new Int8Array(W * H);
      if (mp) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const cx = Math.floor((x + 0.5 - p0[0]) / (p1[0] - p0[0]) * mp.w), cy = Math.floor((y + 0.5 - p0[1]) / (p1[1] - p0[1]) * mp.h);
        if (cx < 1 || cy < 1 || cx >= mp.w - 1 || cy >= mp.h - 1) continue;
        let mn = 255, mx = 0;
        for (let j = -1; j <= 1; j++) for (let i2 = -1; i2 <= 1; i2++) { const v = mp.d[(cy + j) * mp.w + cx + i2]; if (v < mn) mn = v; if (v > mx) mx = v; }
        zone[y * W + x] = mn >= 250 ? 1 : (mx <= 5 ? -1 : 0);
      }
      const dA = diff(A.full, A.bare);
      M.allowed = allowed; M.changedPx = dA.over; M.k = r3(info.k);
      if (!allowed) {
        if (dA.over > 0) bad(cfg.tier === 'min' ? 'небо: на минимальной ступени тени облаков должны быть выключены (отличается ' + dA.over + ' px)' : 'небо: тени облаков там, где их быть не должно (интерьер или shadow: 0): отличается ' + dA.over + ' px');
      } else {
        // тень: только темнее, не гуще своей силы, край мягкий, на небе её нет
        let dark = 0, bright = 0, thick = 0, skyPx = 0, skyHit = 0, gnd = 0, steps = 0, hardSteps = 0, minR = 1;
        const K = SK.shadow + 0.02, ratio = new Float32Array(W * H).fill(-1);
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4, a = lumAt(A.full, i), b = lumAt(A.bare, i), z = zone[y * W + x];
          if (A.full.d[i] > A.bare.d[i] + 1 || A.full.d[i + 1] > A.bare.d[i + 1] + 1 || A.full.d[i + 2] > A.bare.d[i + 2] + 1) bright++;
          if (b - a > 2.5 / 255) dark++;
          if (z === 1) { skyPx++; if (Math.abs(b - a) > 2.5 / 255) skyHit++; }
          if (b > 0.3) { const r = a / b; if (r < minR) minR = r; if (r < 1 - K - 4 / 255 / b) thick++; if (z === -1 && b > 0.45) { ratio[y * W + x] = r; gnd++; } }
        }
        for (let y = 0; y < H; y++) for (let x = 1; x < W; x++) { const r0 = ratio[y * W + x - 1], r1 = ratio[y * W + x]; if (r0 < 0 || r1 < 0) continue; steps++; if (Math.abs(r1 - r0) > 0.05) hardSteps++; }
        M.dark = r3(dark / (W * H)); M.minRatio = r3(minR); M.thick = thick; M.skyPx = skyPx; M.skyHit = skyHit; M.hardSteps = [hardSteps, steps];
        if (dark < 0.03 * W * H) bad('небо: теней облаков не видно (темнее без них только ' + (100 * dark / (W * H)).toFixed(1) + ' % экрана)');
        if (bright > 20) bad('небо: тень облаков местами светлее кадра без неё (' + bright + ' px)');
        if (thick > 20) bad('небо: тень облаков гуще заданной силы ' + SK.shadow + ' (самое тёмное место — ×' + minR.toFixed(2) + ', таких точек ' + thick + ')');
        if (steps > 2000 && hardSteps > 0.002 * steps) bad('небо: край тени облаков резкий (скачков яркости между соседними точками ' + hardSteps + ' из ' + steps + ')');
        if (skyPx >= 400 && skyHit > 0.01 * skyPx) bad('небо: тень облаков лежит на небе (' + skyHit + ' px из ' + skyPx + ' в глубине неба)');
        // движение: через 8 с тени лежат иначе (по часам движка)
        await adv(8000 - 32);
        const B = await pair();
        let moved = 0, n = 0;
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          if (zone[y * W + x] === 1) continue;
          const i = (y * W + x) * 4; n++;
          if (Math.abs((lumAt(A.bare, i) - lumAt(A.full, i)) - (lumAt(B.bare, i) - lumAt(B.full, i))) > 2.5 / 255) moved++;
        }
        M.moved = r3(n ? moved / n : 0);
        if (moved < 0.02 * n) bad('небо: тени облаков стоят (за 8 с изменилось ' + (100 * moved / Math.max(1, n)).toFixed(1) + ' % точек земли и стен)');
        // облака рисунка плывут — только в своём прямоугольнике неба; без drift сцена под тенями неподвижна
        const yBox = SK.drift ? p0[1] + (p1[1] - p0[1]) * SK.drift.box[3] + 3 : -1;
        const dIn = diff(A.bare, B.bare, (x, y) => y < yBox), dOut = diff(A.bare, B.bare, (x, y) => y >= yBox);
        M.drift = { on: !!SK.drift, insidePx: dIn.over, outsidePx: dOut.over };
        if (SK.drift && dIn.over < 50) bad('небо: облака рисунка не плывут (за 8 с в прямоугольнике неба изменилось ' + dIn.over + ' px)');
        if (dOut.over > 0) bad('небо: без теней сцена под небом должна стоять, а изменилось ' + dOut.over + ' px вне прямоугольника неба (движение мимо эффекта)');
      }
      await page.evaluate(() => window.__e2.off('skymove', true));
      await adv(64);
    }
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
    // Сцена без частиц И без теней облаков — для сравнений «до/после погоды» (снег лёг, мокрое темнее, сверху вниз). Тени облаков между
    // двумя снимками успевают уплыть, а под тучами они гуще: на крупном плане (кадр F Погоса) тень съедала всё «белое» снега, и гейт писал
    // «снег не лёг», хотя снег лежал (находка П2, e2.0.4). Сами тени проверяет раздел «небо».
    const sceneBare = async () => {
      const r = await page.evaluate(`(() => { const k = ['precip', 'rainbow', 'clouds']; k.forEach((n) => window.__e2.off(n, true)); window.__e2.redraw(); const p = window.__e2.pixels(); k.forEach((n) => window.__e2.off(n, false)); window.__e2.redraw(); return { w: p.w, h: p.h, data: (${b64})(p.data) }; })()`);
      const buf = Buffer.from(r.data, 'base64'), flip = Buffer.alloc(buf.length), row = r.w * 4;
      for (let y = 0; y < r.h; y++) buf.copy(flip, y * row, (r.h - 1 - y) * row, (r.h - y) * row);
      return { w: r.w, h: r.h, d: flip };
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
        const baseBare = await sceneBare();                            // он же без теней облаков — для сравнений «до/после погоды»
        if (!(await tap(`[data-wx=${kind}]`))) { bad('нет кнопки ' + nm); continue; }
        w0 = await wxInfo();
        if (w0.kind !== kind) { bad(nm + ': кнопка не работает (погода не включилась)'); continue; }
        const allowed = !!(cfg.wx[f] && cfg.wx[f][kind]);      // по настройкам кадра, а не по словам движка: интерьер — никогда
        M.allowed = allowed;
        if (!allowed) {     // кадр без погоды (интерьер): ни частиц, ни перемен в сцене
          await adv(SETTLE.rain);
          const w = await wxInfo(), now = await sceneBare(), d = diff(baseBare, now);     // без теней облаков: они плывут и на кадре без погоды
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
        if (kind === 'snow') { await adv(4200 - EARLY.snow); mid = await sceneBare(); }
        await adv(SETTLE[kind] - (kind === 'snow' ? 4232 : EARLY.rain));
        // 2) установилось: частицы есть, и на экране они там, где говорит движок
        const pr = await scenePair(), bare = await sceneBare(); w = await wxInfo();
        const P = w.parts[kind], vis = P.filter((q) => q[7] > -5 && q[7] < W + 5 && q[8] > -5 && q[8] < H + 5);
        M.parts = P.length; M.onScreen = vis.length;
        if (vis.length < 8) bad(nm + ': частиц нет (на экране ' + vis.length + ')');
        if (bud.b && P.length > bud.b.particles[0]) bad(nm + ': частиц ' + P.length + ' — больше бюджета ' + bud.b.particles[0]);
        const R = kind === 'snow' ? 9 : 22, near = (x, y) => vis.some((q) => Math.abs(x - q[7]) <= R && y - q[8] <= R && q[8] - y <= (kind === 'snow' ? R : 34));
        const dp = diff(pr.full, pr.scene), dOut = diff(pr.full, pr.scene, (x, y) => !near(x, y));
        M.partPx = dp.over; M.partPxOutside = dOut.over;
        if (vis.length >= 8 && dp.over < 30) bad(nm + ': частицы не видны на экране (отличается ' + dp.over + ' px)');
        if (dp.over >= 30 && dOut.over > 0.05 * dp.over) bad(nm + ': частицы на экране не там, где их считает движок (' + dOut.over + ' px из ' + dp.over + ' вне частиц)');
        // 3) сцена: дождь — мокрое темнее; снег — белого больше (если у кадра есть маска снега)
        const sB = stats(baseBare, [0, H * 0.5, W, H]), sS = stats(bare, [0, H * 0.5, W, H]);
        M.sceneLum = [r3(sB.lum), r3(sS.lum)]; M.white = [r3(stats(baseBare).white), r3(stats(bare).white)];
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
                const i = (y * W + x) * 4, g1 = lumAt(bare, i) - lumAt(baseBare, i);
                if (g1 < 0.12) continue;
                zone[0]++; zone[1] += Math.min(1, Math.max(0, (lumAt(mid, i) - lumAt(baseBare, i)) / g1));
              }
            }
            const pt = acc.top[0] ? acc.top[1] / acc.top[0] : 0, pb = acc.bottom[0] ? acc.bottom[1] / acc.bottom[0] : 0;
            M.topDown = { topPx: acc.top[0], top: r3(pt), bottomPx: acc.bottom[0], bottom: r3(pb) };
            if (acc.top[0] >= 300 && acc.bottom[0] >= 300 && pt < pb + 0.1) bad(nm + ': снег ложится не сверху вниз (через 4 с верх кадра набрал ' + (100 * pt).toFixed(0) + ' % своего снега, низ — ' + (100 * pb).toFixed(0) + ' %)');
          }
        }
        await sheet(kind === 'rain' ? 'Дождь' : 'Снег');
        // 4) посадка: частица гаснет на своей поверхности, а не летит сквозь кадр (по часам: серия моментов). Линию поверхности гейт
        //    считает сам по карте посадки кадра (столбец и глубина частицы), а не верит той, что запомнил движок.
        const land = await page.evaluate((i) => { const L = window.E2.Frames.get(i).land; return L ? { w: L.w, z: L.z, d: Array.from(L.d) } : null; }, f);
        const lineOf = (u, z) => { if (!land || u < 0 || u >= 1) return 9; const d = land.d[Math.min(land.z - 1, Math.floor(z * land.z)) * land.w + Math.floor(u * land.w)]; return d === 255 ? 9 : d / 255; };
        let through = 0, landed = 0, roof = 0;
        for (let k = 0; k < 12; k++) {
          await adv(kind === 'snow' ? 256 : 64);
          (await wxInfo()).parts[kind].forEach((q) => { if ((q[5] < 8 && q[2] > q[5] + 0.012) || (q[6] === 0 && q[2] > lineOf(q[1], q[3]) + 0.02)) through++; if (q[6] >= 1 && q[5] < 8) { landed++; if (Math.abs(q[9] - q[5]) < 0.012) roof++; } });
        }
        M.through = through; M.landed = landed; M.roof = roof;     // roof — погасли на линии крыш (первая поверхность сверху в своём столбце), а не долетели до земли
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
