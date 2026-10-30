// Снимки Погос-Петроса 390x844 (облако, swiftshader). node snap13.js <siteRoot> <outDir> <plan.json> (заход 13: precip none|rain|snow, hot — открыть точку N, язык ru)
// plan: [{name, frame, tod:'day'|'night', snow:bool, wind:0|1|2, show:sec|null, wait:ms, pose:[[k,j]...]}]
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const [root, out, planF] = process.argv.slice(2);
const plan = JSON.parse(fs.readFileSync(planF, 'utf8'));
fs.mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T0 = Date.now(); const log = (...a) => console.log(((Date.now() - T0) / 1000).toFixed(0) + 's', ...a);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.css': 'text/css', '.mp4': 'video/mp4', '.webm': 'video/webm', '.svg': 'image/svg+xml' };
const srv = http.createServer((q, s) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(root, p);
  fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); s.end(); return; } s.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); s.end(d); });
}).listen(0);
(async () => {
  const port = srv.address().port;
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, locale: 'ru-RU' });
  await ctx.addInitScript(() => { try { localStorage.setItem('chka-lang', 'ru'); } catch (e) {} });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror ' + e.message.slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console ' + m.text().slice(0, 200)); });
  let loaded = false;
  async function load() {
    await page.goto(`http://127.0.0.1:${port}/beta/tests/pogos-petros/?perf=0&still=1' + (process.env.Q || '') + '`, { waitUntil: 'load', timeout: 90000 });
    for (let i = 0; i < 480; i++) {
      const ok = await page.evaluate(() => document.documentElement.getAttribute('data-loaded') === 'all' && !document.getElementById('stage').classList.contains('loading')).catch(() => false);
      if (ok) break; await sleep(250);
    }
    await page.evaluate(() => { const w = document.getElementById('welcome'); if (w) w.remove(); });
    await sleep(800); loaded = true;
  }
  async function goFrame(f) {
    const n = await page.evaluate(() => document.querySelectorAll('#dots span').length);
    for (let g = 0; g < 12; g++) {
      const cur = await page.evaluate(() => window.__viewer.frame()); if (cur === f) break;
      await page.keyboard.press(((f - cur) + n) % n <= n / 2 ? 'ArrowRight' : 'ArrowLeft');
      await sleep(200);
      for (let k = 0; k < 80 && (await page.evaluate(() => window.__viewer.fading())); k++) await sleep(100);
    }
    await sleep(600);
  }
  async function setTod(t) {
    await page.evaluate((t) => { const b = document.querySelector('#todSeg [data-tod=' + t + ']'); if (b) b.click(); }, t);
    for (let k = 0; k < 100; k++) { const v = await page.evaluate(() => window.__viewer.tod.night); if (t === 'night' ? v >= 0.999 : v <= 0.001) break; await sleep(100); }
    await sleep(500);
  }
  let curTod = 'day', curSnow = 'none', curWind = 0;
  for (const s of plan) {
    try {
      if (!loaded || s.reload) { await load(); curTod = 'day'; curSnow = 'none'; curWind = 0; }
      await goFrame(s.frame);
      const tod = s.tod || 'day'; if (tod !== curTod) { await setTod(tod); curTod = tod; }
      const pr = s.precip || (s.snow ? 'snow' : 'none'); if (pr !== curSnow) { await page.evaluate((pr) => { const b = document.querySelector('#precipSeg [data-precip=' + pr + ']'); if (b) b.click(); }, pr); curSnow = pr; await sleep(s.wxWait || 9000); }
      if (s.hot != null) { await sleep(800); await page.evaluate((k) => { const d = document.querySelectorAll('#hotspots .hs-dot')[k]; if (d) d.click(); }, s.hot); await sleep(1500); }
      const wd = s.wind || 0; while (curWind !== wd) { await page.evaluate(() => document.getElementById('windBtn').click()); curWind = (curWind + 1) % 3; }
      if (s.pose) for (const [k, j] of s.pose) await page.evaluate(([fi, k, j]) => window.__viewer.pose(fi, k, j), [s.frame, k, j]);
      if (s.show != null) {
        const ok = await page.evaluate(() => window.Details.paradeBusy() || window.Details.parade(function () {}, 'fx'));
        await page.evaluate((sec) => window.Details.paradeFreeze(sec), s.show);
        if (!ok) errs.push('show not started ' + s.name);
      }
      await sleep(s.wait || 1200);
      await page.screenshot({ path: path.join(out, s.name + '.png'), timeout: 120000 });
      log('shot', s.name);
      if (s.hot != null) { await page.evaluate(() => { const b = document.getElementById('hsBack'); if (b) b.click(); }); await sleep(600); }
      if (s.show != null && s.endShow) { await page.evaluate(() => { window.Details.paradeFreeze(null); window.Details.paradeStop(); }); await sleep(1500); }
    } catch (e) { errs.push('shot ' + s.name + ': ' + e.message.slice(0, 200)); log('ERR', s.name, e.message.slice(0, 200)); }
  }
  fs.writeFileSync(path.join(out, 'errors.json'), JSON.stringify(errs, null, 1));
  log('errors', errs.length, errs.slice(0, 5));
  await browser.close(); srv.close();
})();
