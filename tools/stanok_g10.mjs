#!/usr/bin/env node
// stanok_g10 — гейт G10 «живость и изюминки» страницы e2 (docs/STANOK.md §4.6, §6): мёртвых кадров нет, герои живут во всех версиях кадра.
//   node tools/stanok_g10.mjs --site DIR --page PAGE --out DIR [--frames 0,1] [--states day,sunset,night,rain,snow] [--query break=actors-sunset] --chrome PATH
// Телефон 390×844, dsf 1, ?vt=1&ui=0: время только через __e2.advance; ролики героев встают на свой момент (ждём __e2.fx('actors').pending = 0).
// Состояние ставится движком (__e2.setTod / setWx; настоящие тапы по кнопкам проверяет G7). Проверки на каждом кадре × состоянии:
//   кадр      — за 5 с виртуального времени изменилось ≥ 2 % экрана телефона (всё движение включено: камера, небо, ветер, огни, осадки, герои);
//   изюминка  — (emotion: true) на телефоне не меньше minFigure высоты экрана (по маске героя); в своём слоте: день и закат — дневной ролик,
//               ночь — ночной ролик или ночной рисунок (media.night: "drawing"), дождь и снег — свой вариант; слот с роликом — герой ЖИВОЙ:
//               в его прямоугольнике за 5 с меняется ≥ 1,5 % точек (не замер, не пропал); «drawing» — на месте героя ровно ночной рисунок
//               (без следов дневного ролика: та же картинка, что с ?off=actors) и он не пустой;
//   тап       — у героя с hit: настоящий тап пальцем по месту → идёт ролик тапа.
// Итог: OUT/g10.json и OUT/g10_<кадр>.png (лист: столбец на состояние, кусок экрана с героями). Код выхода 0 — проблем нет, 1 — есть.
import puppeteer from 'puppeteer-core';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { PNG } from 'pngjs';

const argv = process.argv.slice(2), opt = {};
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) { opt[argv[i].slice(2)] = argv[i + 1]; i++; }
const site = path.resolve(opt.site), page_ = opt.page.replace(/^\/+|\/+$/g, ''), out = path.resolve(opt.out);
const STATES = (opt.states || 'day,sunset,night,rain,snow').split(',');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.mp4': 'video/mp4', '.webm': 'video/webm' };
const srv = http.createServer((q, r) => {     // отдаёт Range (206): без него ролик не перематывается (lessons §4)
  const p = decodeURIComponent(q.url.split('?')[0]); let f = path.join(site, p);
  if (!f.startsWith(site)) { r.writeHead(403); r.end(); return; }
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (!fs.existsSync(f)) { r.writeHead(404); r.end('not found'); return; }
  const st = fs.statSync(f), type = MIME[path.extname(f).toLowerCase()] || 'application/octet-stream', rg = q.headers.range;
  if (rg) {
    const m = /bytes=(\d*)-(\d*)/.exec(rg), a = m[1] ? +m[1] : 0, b = m[2] ? Math.min(+m[2], st.size - 1) : st.size - 1;
    r.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${a}-${b}/${st.size}`, 'Accept-Ranges': 'bytes', 'Content-Length': b - a + 1, 'Cache-Control': 'no-store' });
    fs.createReadStream(f, { start: a, end: b }).pipe(r); return;
  }
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
async function settle() {   // ролики героев встали на свой кадр (реальное ожидание, время движка стоит)
  for (let i = 0; i < 400; i++) {
    const p = await page.evaluate(() => { window.__e2.redraw(); return window.__e2.pending(); });
    if (!p) return true;
    await sleep(25);
  }
  return false;
}
function decode(r) { const buf = Buffer.from(r.data, 'base64'), flip = Buffer.alloc(buf.length), row = r.w * 4; for (let y = 0; y < r.h; y++) buf.copy(flip, y * row, (r.h - 1 - y) * row, (r.h - y) * row); return { w: r.w, h: r.h, d: flip }; }
async function shot() { await settle(); return decode(await page.evaluate(`(() => { window.__e2.redraw(); const p = window.__e2.pixels(); return { w: p.w, h: p.h, data: (${b64})(p.data) }; })()`)); }
async function shotOff() {   // тот же момент без героев
  return decode(await page.evaluate(`(() => { window.__e2.off('actors', true); window.__e2.redraw(); const p = window.__e2.pixels(); window.__e2.off('actors', false); window.__e2.redraw(); return { w: p.w, h: p.h, data: (${b64})(p.data) }; })()`));
}
function changed(a, b, box, thr) {   // доля точек (в box или везде), где канал отличается больше thr
  const x0 = Math.max(0, Math.floor(box ? box[0] : 0)), y0 = Math.max(0, Math.floor(box ? box[1] : 0)), x1 = Math.min(a.w, Math.ceil(box ? box[2] : a.w)), y1 = Math.min(a.h, Math.ceil(box ? box[3] : a.h));
  let n = 0, c = 0, mx = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * a.w + x) * 4, d = Math.max(Math.abs(a.d[i] - b.d[i]), Math.abs(a.d[i + 1] - b.d[i + 1]), Math.abs(a.d[i + 2] - b.d[i + 2]));
    n++; if (d > thr) c++; if (d > mx) mx = d;
  }
  return { n, c, share: n ? c / n : 0, max: mx };
}
function sd(a, box) {
  let n = 0, s = 0, s2 = 0;
  for (let y = Math.max(0, box[1] | 0); y < Math.min(a.h, box[3]); y++) for (let x = Math.max(0, box[0] | 0); x < Math.min(a.w, box[2]); x++) { const i = (y * a.w + x) * 4, v = (0.299 * a.d[i] + 0.587 * a.d[i + 1] + 0.114 * a.d[i + 2]) / 255; n++; s += v; s2 += v * v; }
  return n ? Math.sqrt(Math.max(0, s2 / n - (s / n) * (s / n))) : 0;
}
const r3 = (v) => +v.toFixed(4);
const RU = { day: '«День»', sunset: '«Закат»', night: '«Ночь»', rain: '«Дождь»', snow: '«Снег»' };
const SLOT = { day: 'day', sunset: 'day', night: 'night', rain: 'rain', snow: 'snow' };
const result = { page: page_, query: opt.query || '', states: STATES, frames: [], problems: [] };
try {
  await page.goto(`${origin}/${page_}/?vt=1&ui=0${opt.query ? '&' + opt.query : ''}`, { waitUntil: 'load', timeout: 60000 });
  for (let i = 0; i < 960; i++) {
    const s = await page.evaluate(() => document.documentElement.getAttribute('data-e2')).catch(() => null);
    if (s === 'all') break;
    if (s === 'error' || i === 959) throw new Error('страница не загрузилась: ' + JSON.stringify(await page.evaluate(() => window.E2 ? window.E2.errors : []).catch(() => [])));
    await sleep(250);
  }
  const cfg = await page.evaluate(() => ({ n: window.E2_BUILDING.frames.length, names: window.E2_BUILDING.frames.map((f) => f.name),
    wx: window.E2_BUILDING.frames.map((f) => f.effects.weather || null), actors: window.E2_BUILDING.frames.map((f) => (f.effects.actors || {}).list || []), A: window.E2_BUILDING.effects.actors }));
  const frames = (opt.frames ? opt.frames.split(',').map(Number) : [...Array(cfg.n).keys()]).filter((f) => f < cfg.n);
  await adv(1000);
  const project = async (r) => { const a = await page.evaluate((u, v) => window.__e2.project(u, v, 0.5), r[0], r[1]), b = await page.evaluate((u, v) => window.__e2.project(u, v, 0.5), r[2], r[3]); return [a[0], a[1], b[0], b[1]]; };
  for (const f of frames) {
    const F = { frame: f, name: cfg.names[f], problems: [], m: {} }, bad = (t) => F.problems.push(t), cols = [];
    if ((await page.evaluate(() => window.__e2.state().frame)) !== f) {
      await page.evaluate((i) => window.__e2.go(i), f);
      for (let k = 0; k < 60; k++) { await adv(100); if (!(await page.evaluate(() => window.__e2.state().fading))) break; }
      if ((await page.evaluate(() => window.__e2.state().frame)) !== f) { bad('кадр не открылся'); result.frames.push(F); continue; }
    }
    const wxOn = cfg.wx[f] || {}, heroes = cfg.actors[f].filter((a) => a.emotion);
    const toDay = async () => { await page.evaluate(() => { window.__e2.setWx('none'); window.__e2.setTod('day'); }); await adv(9500); };
    for (const st of STATES) {
      if ((st === 'rain' || st === 'snow') && !wxOn[st]) continue;
      const M = F.m[st] = {};
      if (st === 'day') await toDay();
      if (st === 'sunset') await page.evaluate(() => window.__e2.setTod('sunset'));
      if (st === 'night') await page.evaluate(() => window.__e2.setTod('night'));
      if (st === 'rain' || st === 'snow') { await page.evaluate((k) => window.__e2.setWx(k), st); }
      await adv({ day: 1000, sunset: 3600, night: 12000, rain: 6000, snow: 15000 }[st]);
      const s0 = await shot();
      await adv(1650); const s1 = await shot();
      await adv(1650); const s2 = await shot();
      await adv(1700); const s3 = await shot();
      const live = Math.max(changed(s0, s1, null, 4).share, changed(s0, s2, null, 4).share, changed(s0, s3, null, 4).share);
      M.live = r3(live);
      if (live < 0.02) bad(RU[st] + ': мёртвый кадр — за 5 с изменилось ' + (100 * live).toFixed(2) + ' % экрана (нужно ≥ 2 %)');
      // живость героя меряется БЕЗ соседнего движения (камера «дышит», тени облаков, ветер, огни, частицы осадков — всё это шевелит его
      // прямоугольник и выдало бы замерший ролик за живой): те же 5 с, только герои
      const QUIET = ['breath', 'skymove', 'clouds', 'wind', 'lights', 'precip'];
      await page.evaluate((k) => k.forEach((n) => window.__e2.off(n, true)), QUIET);
      const a0 = await shot(); await adv(1650); const a1 = await shot(); await adv(1650); const a2 = await shot(); await adv(1700); const a3 = await shot();
      await page.evaluate((k) => k.forEach((n) => window.__e2.off(n, false)), QUIET);
      const dbg = await page.evaluate(() => window.__e2.fx('actors'));
      M.heroes = {};
      const boxes = [];
      for (const h of heroes) {
        const A = (dbg && dbg.actors || []).find((q) => q.id === h.id), HM = M.heroes[h.id] = {};
        if (!A) { bad(RU[st] + ': изюминки «' + h.id + '» нет в движке'); continue; }
        const want = SLOT[st], media = h.media[want] !== undefined ? h.media[want] : (want === 'night' ? 'drawing' : (want === 'rain' || want === 'snow' ? h.media.day : undefined));
        const rb = await project(A.rect), fb = A.figure ? await project(A.figure) : rb;
        boxes.push(rb);
        HM.slot = A.slot; HM.cur = A.cur; HM.kind = A.kind; HM.w = A.w; HM.figureH = r3((fb[3] - fb[1]) / H);
        if (HM.figureH < cfg.A.minFigure) bad(RU[st] + ': изюминка «' + h.id + '» мелкая — ' + (100 * HM.figureH).toFixed(1) + ' % высоты экрана (нужно ≥ ' + (100 * cfg.A.minFigure) + ' %)');
        if (A.slot !== want) bad(RU[st] + ': у изюминки «' + h.id + '» слот ' + A.slot + ', а нужен ' + want);
        if (media === 'drawing') {
          const off = await shotOff(), cur = await shot(), d = changed(cur, off, fb, 3), v = sd(cur, fb);
          HM.ghost = d.c; HM.sd = r3(v);
          if (d.c > 0) bad(RU[st] + ': на месте изюминки «' + h.id + '» следы ролика поверх ночного рисунка (' + d.c + ' точек) — призрак');
          if (v < 0.03) bad(RU[st] + ': изюминка «' + h.id + '» пропала — на её месте пусто');
          continue;
        }
        if (!media) { bad(RU[st] + ': у изюминки «' + h.id + '» нет варианта для этого состояния'); continue; }
        if (A.w < 0.5 || !A.cur) { bad(RU[st] + ': изюминка «' + h.id + '» пропала (ролик не идёт, вес ' + A.w + ')'); continue; }
        const cur = await shot(), off = await shotOff(), vis = changed(cur, off, rb, 6);
        const alive = Math.max(changed(a0, a1, rb, 6).share, changed(a0, a2, rb, 6).share, changed(a0, a3, rb, 6).share);
        HM.alive = r3(alive); HM.visible = vis.c;
        if (alive < 0.015) bad(RU[st] + ': изюминка «' + h.id + '» замерла — за 5 с в её прямоугольнике изменилось ' + (100 * alive).toFixed(2) + ' % точек');
      }
      // лист: кусок экрана, где герои
      if (boxes.length) {
        const bx = [Math.min(...boxes.map((b) => b[0])), Math.min(...boxes.map((b) => b[1])), Math.max(...boxes.map((b) => b[2])), Math.max(...boxes.map((b) => b[3]))];
        cols.push({ label: st, s: s3, box: bx.map((v, i) => Math.round(Math.max(0, Math.min(i % 2 ? H : W, v)))) });
      }
    }
    // тап по герою (место hit): настоящий тап пальцем → ролик тапа
    for (const h of heroes.filter((a) => a.hit && a.media.tap)) {
      await toDay();
      const hb = await project(h.hit);
      await page.touchscreen.tap((hb[0] + hb[2]) / 2, (hb[1] + hb[3]) / 2);
      await adv(300);
      const A = (await page.evaluate(() => window.__e2.fx('actors'))).actors.find((q) => q.id === h.id);
      F.m.tap = { [h.id]: { cur: A.cur, tap: A.tap } };
      if (!A.tap || A.cur !== h.media.tap.name) bad('тап по изюминке «' + h.id + '» не работает (идёт ' + A.cur + ', а не ' + h.media.tap.name + ')');
    }
    if (cols.length) {
      const bw = Math.max(...cols.map((c) => c.box[2] - c.box[0])), bh = Math.max(...cols.map((c) => c.box[3] - c.box[1]));
      const png = new PNG({ width: bw * cols.length + 4 * (cols.length - 1), height: bh });
      png.data.fill(255);
      cols.forEach((c, k) => { for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) { const sx = c.box[0] + x, sy = c.box[1] + y; if (sx >= W || sy >= H) continue; const si = (sy * W + sx) * 4, di = (y * png.width + k * (bw + 4) + x) * 4; png.data[di] = c.s.d[si]; png.data[di + 1] = c.s.d[si + 1]; png.data[di + 2] = c.s.d[si + 2]; png.data[di + 3] = 255; } });
      fs.writeFileSync(path.join(out, 'g10_' + cfg.names[f] + '.png'), PNG.sync.write(png));
    }
    await page.evaluate(() => { window.__e2.setWx('none'); window.__e2.setTod('day'); });
    await adv(9500);
    result.frames.push(F);
    F.problems.forEach((p) => result.problems.push('кадр ' + (f + 1) + ' (' + cfg.names[f] + '): ' + p));
  }
} catch (e) {
  result.problems.push('сбой прогона: ' + String(e && e.message || e).slice(0, 300));
}
jsErrors.forEach((e) => result.problems.push(e));
fs.writeFileSync(path.join(out, 'g10.json'), JSON.stringify(result, null, 1));
console.log(result.problems.length ? result.problems.join('\n') : 'G10: проблем нет');
console.log('ИТОГ: кадров ' + result.frames.length + ', проблем ' + result.problems.length);
await browser.close(); srv.close();
process.exit(result.problems.length ? 1 : 0);
