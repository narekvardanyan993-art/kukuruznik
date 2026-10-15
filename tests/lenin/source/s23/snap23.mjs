#!/usr/bin/env node
// s23: настоящие снимки Chrome (облако: swiftshader) — сильный ветер на 5 кадрах и таймлайн снега. Запуск из корня репозитория:
//   node tests/lenin/source/s23/snap23.mjs <site> <out> wind [--frames=0,1,2,3,4] [--steps=100]
//   node tests/lenin/source/s23/snap23.mjs <site> <out> snow
// wind — для каждого кадра: снимок «тихо» (ref.png), затем буря: 10 с виртуального времени по 100 мс (NNN.png) + timeline.json;
//        map.json — экранные координаты углов кадра (для перевода маски деревьев в пиксели экрана)
// snow — снег включён: накопление 16 с, потом выключен: таяние 36 с (замер покрытия каждые ~0,5 с настоящего времени)
import puppeteer from 'puppeteer';
import http from 'http';
import fs from 'fs';
import path from 'path';

const [site, out, mode] = process.argv.slice(2);
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith('--' + k + '=')); return a ? a.split('=')[1] : d; };
const FRS = arg('frames', '0,1,2,3,4').split(',').map(Number), STEPS = +arg('steps', 100), DPR = +arg('dpr', 1);
fs.mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T0 = Date.now(); const log = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(0)}s]`, ...a);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.webm': 'video/webm', '.css': 'text/css' };
const srv = http.createServer((q, r) => {
  const p = decodeURIComponent(q.url.split('?')[0]); let f = path.join(site, p);
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (!fs.existsSync(f)) { r.writeHead(404); r.end(); return; }
  const size = fs.statSync(f).size, type = MIME[path.extname(f)] || 'application/octet-stream';
  const m = /bytes=(\d*)-(\d*)/.exec(q.headers.range || '');
  if (m) { const s = m[1] ? +m[1] : 0, e = m[2] ? +m[2] : size - 1; r.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${s}-${e}/${size}`, 'Accept-Ranges': 'bytes', 'Content-Length': e - s + 1 }); fs.createReadStream(f, { start: s, end: e }).pipe(r); return; }
  r.writeHead(200, { 'Content-Type': type, 'Content-Length': size }); fs.createReadStream(f).pipe(r);
});
await new Promise((res) => srv.listen(0, '127.0.0.1', res));
const port = srv.address().port;
const browser = await puppeteer.launch({ headless: 'new', executablePath: process.env.CHROME_PATH, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required', '--disable-features=CanvasNoise'] });
const problems = [];
const page = await browser.newPage();
page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' || /\[chka\]/.test(m.text())) problems.push('console: ' + m.text().slice(0, 300)); });
await page.evaluateOnNewDocument(() => {
  const realNow = performance.now.bind(performance), realRaf = window.requestAnimationFrame.bind(window);
  window.__vt = { on: false, t: 0, q: [] };
  performance.now = () => (window.__vt.on ? window.__vt.t : realNow());
  window.requestAnimationFrame = (cb) => { if (window.__vt.on) { window.__vt.q.push(cb); return 1; } return realRaf((ts) => cb(window.__vt.on ? window.__vt.t : ts)); };
  window.__vtStart = () => { window.__vt.t = realNow(); window.__vt.on = true; };
  window.__vtStep = (ms) => { window.__vt.t += ms; const q = window.__vt.q; window.__vt.q = []; q.forEach((cb) => { try { cb(window.__vt.t); } catch (e) { console.error(e); } }); };
  window.__vtStop = () => { window.__vt.on = false; const q = window.__vt.q; window.__vt.q = []; q.forEach((cb) => requestAnimationFrame(cb)); };
});
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: DPR, isMobile: true, hasTouch: true });
await page.goto(`http://127.0.0.1:${port}/beta/tests/lenin/?perf=0&still=1`, { waitUntil: 'load', timeout: 60000 });
for (let i = 0; i < 480; i++) {
  const ok = await page.evaluate(() => document.documentElement.getAttribute('data-loaded') === 'all').catch(() => false);
  if (ok) break; await sleep(250);
}
log('loaded');
await page.evaluate(() => { const w = document.getElementById('welcome'); if (w) w.remove(); });
const res = { problems };
const goto_ = async (f) => {
  for (let g = 0; g < 12; g++) {
    const cur = await page.evaluate(() => window.__viewer.frame()); if (cur === f) break;
    await page.keyboard.press('ArrowRight'); await sleep(150);
    for (let k = 0; k < 80 && (await page.evaluate(() => window.__viewer.fading())); k++) await sleep(100);
  }
  await sleep(1800);
  return page.evaluate(() => window.__viewer.frame());
};
const W = () => page.evaluate(() => { const w = window.__viewer.weather(); return { cover: +w.cover.toFixed(4), snowLin: +(w.snowLin || 0).toFixed(4), snow: +w.cur[3].toFixed(3), gust: +(w.gust || 0).toFixed(3), lean: +(w.lean || 0).toFixed(3), wind: +w.wind.toFixed(2), windEff: +(w.windEff || 0).toFixed(2) }; });
let fails = 0;
const shot = async (p) => {
  try { await Promise.race([page.screenshot({ path: p }), sleep(30000).then(() => { throw new Error('screenshot timeout'); })]); }
  catch (e) { fails++; problems.push('shot: ' + e.message); if (fails >= 2) throw new Error('2 failed screenshots — stop'); }
};
if (mode === 'wind') {
  for (const FR of FRS) {
    const got = await goto_(FR); if (got !== FR) problems.push(`frame ${FR}: landed on ${got}`);
    const dir = path.join(out, `f${FR + 1}`); fs.mkdirSync(dir, { recursive: true });
    await page.evaluate(() => window.__vtStart()); await page.evaluate(() => window.__vtStep(100));
    await shot(path.join(dir, 'ref.png'));
    const map = await page.evaluate((fr) => { const e = window.__viewer.entry(fr); const P = (u, v, d) => window.__viewer.project(e, u, v, d); return { a0: P(0, 0, 0), a1: P(1, 1, 0), b0: P(0, 0, 1), b1: P(1, 1, 1), crop: e.crop || null }; }, FR);
    fs.writeFileSync(path.join(dir, 'map.json'), JSON.stringify(map));
    await page.evaluate(() => { window.__vtStop(); const b = document.getElementById('windBtn'); b.click(); b.click(); });   // буря
    await page.evaluate(() => window.__vtStart());
    for (let k = 0; k < 40; k++) await page.evaluate(() => window.__vtStep(100));   // 4 с разгона
    if (process.argv.includes('--leaves')) await page.evaluate(() => { window.__viewer.weather().gRise = window.__vt.t; });   // для снимка листьев: стайка сейчас
    const tl = [];
    for (let i = 0; i < STEPS; i++) {
      await page.evaluate(() => window.__vtStep(100));
      tl.push({ i, t: +(i * 0.1).toFixed(1), ...(await W()) });
      await shot(path.join(dir, String(i).padStart(3, '0') + '.png'));
    }
    fs.writeFileSync(path.join(dir, 'timeline.json'), JSON.stringify(tl));
    await page.evaluate(() => { window.__vtStop(); const b = document.getElementById('windBtn'); b.click(); });   // буря -> тихо
    await sleep(1500);
    log('frame', FR + 1, 'shots', STEPS, 'max gust', Math.max(...tl.map((x) => x.gust)));
  }
  res.errors = await page.evaluate(() => window.__viewer.errors());
} else if (mode === 'snow') {
  // настоящее время (виртуальное во время загрузки ночных картинок роняет WebGL-контекст облачного Chrome — и у старого движка):
  // накопление и таяние считаются от часов (шаг до 1 с), поэтому 2 кадра/с облака замер не искажают
  const tl = async (arr, t0, ms) => { while (Date.now() - t0 < ms) { arr.push({ t: +((Date.now() - t0) / 1000).toFixed(2), ...(await W()) }); await sleep(400); } };
  res.acc = []; res.melt = [];
  await page.evaluate(() => document.querySelector('#precipSeg [data-precip=snow]').click());
  await tl(res.acc, Date.now(), 16000);
  await shot(path.join(out, 'snow-full.png'));
  await page.evaluate(() => document.querySelector('#precipSeg [data-precip=none]').click());
  await tl(res.melt, Date.now(), 36000);
  res.errors = await page.evaluate(() => window.__viewer.errors());
}
fs.writeFileSync(path.join(out, `${mode}.json`), JSON.stringify(res, null, 1));
log('done, problems', problems.length, problems.slice(0, 5).join(' | '));
await browser.close(); srv.close();
process.exit(0);
