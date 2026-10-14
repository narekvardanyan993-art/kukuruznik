#!/usr/bin/env node
// s22: настоящие снимки Chrome для снега и ветра (облако: swiftshader). Запуск из корня репозитория (нужен puppeteer):
//   node tests/lenin/source/s22/snap22.mjs <site> <out> shader|snow|wind [--frame=N]
// shader — исходники шейдеров страницы Кукурузника (перехват shaderSource) -> <out>/shader.json (сравнить старый/новый движок)
// snow   — Ленин: снег включён, замер накопления 44 с, снимки 5 кадров день/ночь, потом снег выключен — замер таяния 30 с
// rainfog — Ленин: дождь и туман днём, кадры 1/3/5 (для заметок)
// wind   — Ленин, кадр N (0..4): буря без снега и метель, снимки экрана ~11 с подряд -> <out>/wind-*/NNN.png + timeline.json (для GIF)
import puppeteer from 'puppeteer';
import http from 'http';
import fs from 'fs';
import path from 'path';

const [site, out, mode] = process.argv.slice(2);
const FR = (process.argv.find((a) => a.startsWith('--frame=')) || '--frame=1').slice(8) | 0;
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
  window.__shaders = [];
  const hook = (P) => { const o = P.shaderSource; P.shaderSource = function (sh, src) { window.__shaders.push(src); return o.call(this, sh, src); }; };
  hook(WebGLRenderingContext.prototype); if (window.WebGL2RenderingContext) hook(WebGL2RenderingContext.prototype);
  // виртуальное время для GIF: облачный Chrome рисует ~2 кадра/с, поэтому кадры GIF снимаются шагами часов страницы (100 мс),
  // а не по настоящим часам — движение на GIF такое, каким его считает движок при 10 кадрах/с
  const realNow = performance.now.bind(performance), realRaf = window.requestAnimationFrame.bind(window);
  window.__vt = { on: false, t: 0, q: [] };
  performance.now = () => (window.__vt.on ? window.__vt.t : realNow());
  window.requestAnimationFrame = (cb) => { if (window.__vt.on) { window.__vt.q.push(cb); return 1; } return realRaf((ts) => cb(window.__vt.on ? window.__vt.t : ts)); };
  window.__vtStart = () => { window.__vt.t = realNow(); window.__vt.on = true; };
  window.__vtStep = (ms) => { window.__vt.t += ms; const q = window.__vt.q; window.__vt.q = []; q.forEach((cb) => { try { cb(window.__vt.t); } catch (e) { console.error(e); } }); };
});
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
const pg = mode === 'shader' ? 'beta/kukuruznik/' : 'beta/tests/lenin/';
await page.goto(`http://127.0.0.1:${port}/${pg}?perf=0&still=1`, { waitUntil: 'load', timeout: 60000 });
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
};
const W = () => page.evaluate(() => { const w = window.__viewer.weather(); return { cover: +w.cover.toFixed(4), snow: +w.cur[3].toFixed(3), gust: +(w.gust || 0).toFixed(3), lean: +(w.lean || 0).toFixed(3), wind: +w.wind.toFixed(2), windEff: +(w.windEff || 0).toFixed(2) }; });
if (mode === 'shader') {
  await sleep(3000);
  res.shaders = await page.evaluate(() => window.__shaders);
} else if (mode === 'snow') {
  await page.evaluate(() => document.querySelector('#precipSeg [data-precip=snow]').click());
  const t1 = Date.now(); res.acc = [];
  if (process.argv.includes('--force')) await page.evaluate(() => { const w = window.__viewer.weather(); w.cover = 1; w.snowLin = 1; });   // старый движок в облаке копит медленно (шаг ограничен 0,1 с при 2 fps) — для «до» сразу полный снег
  while (Date.now() - t1 < 44000) { res.acc.push({ t: +((Date.now() - t1) / 1000).toFixed(1), ...(await W()) }); await sleep(2000); }
  log('accumulated', JSON.stringify(res.acc.at(-1)));
  for (const tod of ['day', 'night']) {
    if (tod === 'night') {
      await page.evaluate(() => document.querySelector('#todSeg [data-tod=night]').click());
      for (let k = 0; k < 120; k++) { if ((await page.evaluate(() => window.__viewer.tod.night)) >= 0.999) break; await sleep(100); }
      await sleep(800);
    }
    for (let f = 0; f < 5; f++) { await goto_(f); await page.screenshot({ path: path.join(out, `snow-${tod}-f${f + 1}.png`) }); log('shot', tod, f + 1); }
  }
  await page.evaluate(() => document.querySelector('#precipSeg [data-precip=none]').click());
  const t2 = Date.now(); res.melt = [];
  while (Date.now() - t2 < 30000) { res.melt.push({ t: +((Date.now() - t2) / 1000).toFixed(1), ...(await W()) }); await sleep(2000); }
} else if (mode === 'rainfog') {   // для report/s22/weather.md: как сейчас выглядят дождь и туман (не меняются в s22)
  for (const [kind, sel] of [['rain', '#precipSeg [data-precip=rain]'], ['fog', '#wxChips [data-wx=fog]']]) {
    await page.evaluate((q) => document.querySelector(q).click(), sel);
    await sleep(9000);
    for (const f of [0, 2, 4]) { await goto_(f); await page.screenshot({ path: path.join(out, `${kind}-day-f${f + 1}.png`) }); }
    await page.evaluate((q) => document.querySelector(q).click(), kind === 'rain' ? '#precipSeg [data-precip=none]' : sel);
    await sleep(5000);
  }
} else if (mode === 'wind') {
  await goto_(FR);
  await page.evaluate(() => { const b = document.getElementById('windBtn'); b.click(); b.click(); });   // буря
  await sleep(4000);
  for (const kind of ['gale', 'blizzard']) {
    if (kind === 'blizzard') { await page.evaluate(() => document.querySelector('#precipSeg [data-precip=snow]').click()); await sleep(6000); }
    const dir = path.join(out, `wind-${kind}-f${FR + 1}`); fs.mkdirSync(dir, { recursive: true });
    const tl = []; let i = 0;
    await page.evaluate(() => window.__vtStart());
    for (; i < 100; i++) {   // 10 с по 100 мс
      await page.evaluate(() => window.__vtStep(100));
      const w = await W();
      await page.screenshot({ path: path.join(dir, String(i).padStart(3, '0') + '.png') });
      tl.push({ i, t: +(i * 0.1).toFixed(1), ...w });
    }
    await page.evaluate(() => { window.__vt.on = false; const q = window.__vt.q; window.__vt.q = []; q.forEach((cb) => requestAnimationFrame(cb)); });
    fs.writeFileSync(path.join(dir, 'timeline.json'), JSON.stringify(tl));
    log(kind, 'frames', i);
  }
  res.scale = await page.evaluate((fr) => { const e = window.__viewer.entry(fr); const a = window.__viewer.project(e, 0, 0.5, 0.5), b = window.__viewer.project(e, 1, 0.5, 0.5); return { cssPerFrameW: b[0] - a[0] }; }, FR);
}
fs.writeFileSync(path.join(out, `${mode}.json`), JSON.stringify(res, null, 1));
log('done, problems', problems.length, problems.slice(0, 5).join(' | '));
await browser.close(); srv.close();
process.exit(0);
