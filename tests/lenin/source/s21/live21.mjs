#!/usr/bin/env node
// s21: GIF живых мест (motionVideo людей) в НАСТОЯЩЕМ рендере Chrome, телефон 390×844 (dsf 1 = css px iPhone), 10 с.
// node tests/lenin/source/s21/live21.mjs --site DIR --out DIR --place lenin_3:540,880,764,1006[,day|night] [--place …] [--secs 10] [--fps 4]
// Для каждого места: кадр здания → ждём видео в текстуре → снимки рамки места каждые 1/fps с (по настоящим часам) → PNG;
// GIF собирается ffmpeg-ом снаружи. Плюс fps страницы за 5 с (requestAnimationFrame) и ошибки JS.
import puppeteer from 'puppeteer';
import http from 'http'; import fs from 'fs'; import path from 'path';
const a = process.argv.slice(2), opt = { places: [], secs: 10, fps: 4, renderer: 'swiftshader' };
for (let i = 0; i < a.length; i++) { const v = () => a[++i];
  if (a[i] === '--site') opt.site = path.resolve(v()); else if (a[i] === '--out') opt.out = path.resolve(v());
  else if (a[i] === '--place') opt.places.push(v()); else if (a[i] === '--secs') opt.secs = +v(); else if (a[i] === '--fps') opt.fps = +v();
  else if (a[i] === '--query') opt.query = v(); else if (a[i] === '--start') opt.start = +v(); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.webm': 'video/webm', '.webmanifest': 'application/manifest+json', '.css': 'text/css' };
const srv = http.createServer((q, r) => { const p = decodeURIComponent(q.url.split('?')[0]); let f = path.join(opt.site, p);
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (!fs.existsSync(f)) { r.writeHead(404); r.end(); return; }
  const size = fs.statSync(f).size, type = MIME[path.extname(f)] || 'application/octet-stream', m = /bytes=(\d*)-(\d*)/.exec(q.headers.range || '');
  if (m) { const s = m[1] ? +m[1] : 0, e = m[2] ? +m[2] : size - 1; r.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${s}-${e}/${size}`, 'Accept-Ranges': 'bytes', 'Content-Length': e - s + 1 }); fs.createReadStream(f, { start: s, end: e }).pipe(r); return; }
  r.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes' }); fs.createReadStream(f).pipe(r); });
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${srv.address().port}/beta/tests/lenin/?perf=0&still=1${opt.query || ''}`;
const browser = await puppeteer.launch({ headless: 'new', executablePath: process.env.CHROME_PATH, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--hide-scrollbars'] });
const problems = [], res = { url, places: [] };
const killer = setTimeout(() => { console.error('СТОП по времени'); process.exit(2); }, 600000);
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => problems.push('pageerror: ' + String(e.message).slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error') problems.push('console.error: ' + m.text().slice(0, 200)); });
  page.on('response', (r) => { if (r.status() >= 400) problems.push('HTTP ' + r.status() + ' ' + r.url()); });
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  for (let i = 0; i < 480; i++) { if (await page.evaluate(() => document.documentElement.getAttribute('data-loaded') === 'all' && !document.getElementById('stage').classList.contains('loading')).catch(() => false)) break; await sleep(250); }
  await page.evaluate(() => { const w = document.getElementById('welcome'); if (w) w.remove(); });
  await page.mouse.click(5, 400).catch(() => {});   // жест (видео iOS-путь)
  const names = await page.evaluate(() => (typeof CONFIG !== 'undefined' ? (CONFIG.SCENE || []).map((s, i) => ((CONFIG.FRAMES[i] || {}).color || '').replace(/^.*\//, '').replace(/\.webp.*$/, '')) : []));
  const n = names.length;
  const goto_ = async (f) => { for (let g = 0; g < 12; g++) { const cur = await page.evaluate(() => window.__viewer.frame()); if (cur === f) break;
      await page.keyboard.press(((f - cur) + n) % n <= n / 2 ? 'ArrowRight' : 'ArrowLeft'); await sleep(200);
      for (let k = 0; k < 80 && (await page.evaluate(() => window.__viewer.fading())); k++) await sleep(100); } await sleep(1500); };
  for (const spec of opt.places) {
    const [nm, box, tod = 'day'] = spec.split(':').length > 2 ? [spec.split(':')[0], spec.split(':')[1], spec.split(':')[2]] : [...spec.split(':'), 'day'];
    const [x0, y0, x1, y1] = box.split(',').map(Number), f = names.indexOf(nm);
    if (f < 0) { problems.push('нет кадра ' + nm + ' в ' + names.join(',')); continue; }
    const want = tod === 'night' ? 1 : 0;
    await page.evaluate((t) => { const b = document.querySelector('#todSeg [data-tod=' + t + ']'); if (b) b.click(); }, tod);
    for (let k = 0; k < 100; k++) { const v = await page.evaluate(() => window.__viewer.tod.night); if (Math.abs(v - want) < 0.001) break; await sleep(100); }
    await goto_(f);
    const r = await page.evaluate((fi, x0, y0, x1, y1) => { const e = window.__viewer.entry(fi), W = 768, H = 1365;
      const p = window.__viewer.project(e, x0 / W, y0 / H, 0.5), q = window.__viewer.project(e, x1 / W, y1 / H, 0.5); return [p[0], p[1], q[0], q[1]]; }, f, x0, y0, x1, y1);
    const clip = { x: Math.max(0, Math.floor(r[0]) - 6), y: Math.max(0, Math.floor(r[1]) - 6) }; clip.width = Math.min(390 - clip.x, Math.ceil(r[2] - r[0]) + 12); clip.height = Math.min(844 - clip.y, Math.ceil(r[3] - r[1]) + 12);
    const dir = path.join(opt.out, `${nm}_${tod}`); fs.mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: path.join(opt.out, `${nm}_${tod}_full.png`) });
    // облачный Chrome рисует ~1–2 к/с: время ролика ставим сами (__mvFreeze: движок не запускает play, текстура — с currentTime)
    await page.evaluate(() => { window.__mvFreeze = true; });
    const t0 = Date.now(); let k = 0, fails = 0;
    while (k < opt.secs * opt.fps && fails < 2) {
      const vt = (opt.start || 0) + k / opt.fps;
      await page.evaluate((nm, vt) => new Promise((ok) => { const vs = [...document.querySelectorAll('video')].filter((v) => (v.currentSrc || '').includes(nm + '_motion'));
        if (!vs.length) return ok(0); let left = vs.length; const done = () => { if (--left <= 0) requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => ok(1)))); };
        vs.forEach((v) => { v.pause(); if (Math.abs(v.currentTime - vt) < 0.01) return done(); v.addEventListener('seeked', done, { once: true }); v.currentTime = vt; }); setTimeout(() => ok(2), 4000); }), nm, vt);
      try { await Promise.race([page.screenshot({ path: path.join(dir, String(k).padStart(3, '0') + '.png'), clip }), sleep(8000).then(() => { throw new Error('screenshot timeout'); })]); }
      catch (e) { fails++; problems.push(nm + ' снимок: ' + e.message); }
      k++;
    }
    await page.evaluate(() => { window.__mvFreeze = false; });
    const vstate = await page.evaluate(() => [...document.querySelectorAll('video')].map((v) => ({ src: (v.currentSrc || '').replace(/^.*\//, ''), t: +v.currentTime.toFixed(2), paused: v.paused, rs: v.readyState })));
    res.places.push({ frame: nm, f, tod, box_frame: [x0, y0, x1, y1], box_css: r.map((z) => +z.toFixed(1)), css_per_frame_px: +((r[2] - r[0]) / (x1 - x0)).toFixed(3), shots: k, wall_s: (Date.now() - t0) / 1000, videos: vstate });
  }
  res.fps = await page.evaluate(() => new Promise((ok) => { let c = 0; const t0 = performance.now(); (function s() { c++; if (performance.now() - t0 < 5000) requestAnimationFrame(s); else ok(+(c / 5).toFixed(1)); })(); }));
} finally { await browser.close().catch(() => {}); srv.close(); }
res.problems = problems; fs.writeFileSync(path.join(opt.out, 'live21.json'), JSON.stringify(res, null, 1)); console.log(JSON.stringify(res, null, 1));
clearTimeout(killer); process.exit(0);
