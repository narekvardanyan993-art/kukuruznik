// Заход 18: + dog {k, at, rate} — включить ролик набора k и поставить его на секунду at (rate — почти стоп), tap:true — настоящий тап по собаке (центр hit), tapOut — тап мимо, hover — курсор над собакой; tod 'sunset'.
// Снимки Погос-Петроса 390x844 (облако, swiftshader; заход 15 — шоу-видео; заход 17 — q: доп. параметры адреса, напр. &hour=8 — страница перезагружается). node snap15.js <siteRoot> <outDir> <plan.json> (заход 13: precip none|rain|snow, hot — открыть точку N, язык ru)
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
  fs.readFile(f, (e, d) => {
    if (e) { s.writeHead(404); s.end(); return; }
    const ct = MIME[path.extname(f)] || 'application/octet-stream', rg = /bytes=(\d*)-(\d*)/.exec(q.headers.range || '');   // заход 15: Range — без него видео не перематывается (seekable пуст)
    if (rg) { const a = rg[1] ? +rg[1] : 0, b = rg[2] ? +rg[2] : d.length - 1; s.writeHead(206, { 'content-type': ct, 'accept-ranges': 'bytes', 'content-range': `bytes ${a}-${b}/${d.length}`, 'content-length': b - a + 1 }); s.end(d.subarray(a, b + 1)); return; }
    s.writeHead(200, { 'content-type': ct, 'accept-ranges': 'bytes', 'content-length': d.length }); s.end(d);
  });
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
  let loaded = false, curQ = '';
  async function load() {
    await page.goto(`http://127.0.0.1:${port}/beta/tests/pogos-petros/?perf=0&still=1${process.env.Q || ''}${curQ}`, { waitUntil: 'load', timeout: 90000 });
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
    for (let k = 0; k < 100; k++) { const v = await page.evaluate(() => [window.__viewer.tod.night, window.__viewer.tod.sun]); if (t === 'night' ? v[0] >= 0.999 : (t === 'sunset' ? v[1] >= 0.999 && v[0] <= 0.001 : v[0] <= 0.001 && v[1] <= 0.001)) break; await sleep(100); }
    await sleep(500);
  }
  let curTod = 'day', curSnow = 'none', curWind = 0;
  for (const s of plan) {
    try {
      if ((s.q || '') !== curQ) { curQ = s.q || ''; loaded = false; }
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
        let sv = null;   // заход 15: ждать, пока видео-шоу встанет на секунду заморозки и кадр видео ляжет в текстуру
        for (let k = 0; k < 80; k++) { sv = await page.evaluate((f) => window.__viewer.showv ? window.__viewer.showv(f) : null, s.frame); if (!sv || (sv.vis > 0 && sv.vT === sv.ct && sv.rs >= 2 && (s.vt == null || Math.abs(sv.ct - s.vt) < 0.06))) break; await sleep(250); }
        log('showv', s.name, JSON.stringify(sv));
      }
      if (s.dog || s.tap || s.tapOut || s.hover) {
        let st = null;
        for (let k = 0; k < 120; k++) { st = await page.evaluate(() => window.__viewer.dog()); if (st && st.k > 0.95 && st.fresh) break; await sleep(250); }
        log('dog0', s.name, JSON.stringify(st));
        if (s.hover) {
          const h = st.hit, cx = (h[0] + h[2]) / 2, cy = (h[1] + h[3]) / 2;
          await page.mouse.move(cx, cy); await sleep(300); const c1 = await page.evaluate(() => document.getElementById('stage').style.cursor);
          await page.mouse.move(195, 120); await sleep(300); const c2 = await page.evaluate(() => document.getElementById('stage').style.cursor);
          log('hover', JSON.stringify({ overDog: c1, sky: c2 })); fs.writeFileSync(path.join(out, 'hover.json'), JSON.stringify({ overDog: c1, sky: c2, hit: h }));
        }
        if (s.tapOut) { await page.touchscreen.tap(195, 150); await sleep(800); const a = await page.evaluate(() => window.__viewer.dog()); log('tapOut', JSON.stringify(a)); fs.writeFileSync(path.join(out, 'tapout.json'), JSON.stringify({ before: st.cur, after: a.cur })); }
        if (s.tap) { const h = st.hit; await page.touchscreen.tap((h[0] + h[2]) / 2, (h[1] + h[3]) / 2); for (let k = 0; k < 60; k++) { const a = await page.evaluate(() => window.__viewer.dog()); if (a.cur && a.cur.indexOf('tap') >= 0 && a.fresh) break; await sleep(200); } }
        if (s.dog) await page.evaluate((k) => window.__viewer.dogPlay(window.__viewer.frame(), k), s.dog.k);
        if (s.dog || s.tap) {
          const at = (s.dog && s.dog.at) || s.tapAt || 2;
          for (let k = 0; k < 160; k++) { const a = await page.evaluate(() => window.__viewer.dog()); if (a.fresh && a.ct >= at - 0.4) break; await sleep(150); }
          await page.evaluate(([at]) => { const d = window.__viewer.dog(); document.querySelectorAll('video').forEach((v) => { if (d.cur && v.currentSrc.indexOf(d.cur.replace('.mp4', '')) >= 0) { v.currentTime = at; v.playbackRate = 0.0625; } }); }, [at]);
          await sleep(2500);
        }
        st = await page.evaluate(() => window.__viewer.dog()); log('dog', s.name, JSON.stringify(st)); fs.writeFileSync(path.join(out, s.name + '_dog.json'), JSON.stringify(st));
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
