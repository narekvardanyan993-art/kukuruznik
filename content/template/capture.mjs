#!/usr/bin/env node
// capture.mjs — снимает «живые» куски сайта chka.am покадрово по виртуальному времени (как tools/stanok_look.mjs)
// и складывает JPEG-кадры для сборки ролика (content/template/build.py).
// Использование: node capture.mjs --site DIR --shots shots.json --out DIR [--chrome PATH]
// shots.json: [{ id, page, frame, tod, precip, dur, fps, ui, tilt:[[t,x,y],...], events:[{at, do, val}], show:[t0,t1], speed }]
//   events: do = tod (day|sunset|night) | precip (none|snow|rain) | card (открыть открытку) | click (CSS-селектор)
//   show: [t0, t1] — шоу кадра «заморожено» и проходит от t0 до t1 секунд за dur; speed — сколько виртуальных мс на 1 мс ролика.
import puppeteer from 'puppeteer-core';
import http from 'http';
import fs from 'fs';
import path from 'path';

const opt = { chrome: process.env.CHKA_CHROME || '/usr/bin/google-chrome', w: 540, h: 960, dpr: 2, only: null };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i], val = () => argv[++i];
  if (a === '--site') opt.site = path.resolve(val());
  else if (a === '--shots') opt.shots = path.resolve(val());
  else if (a === '--out') opt.out = path.resolve(val());
  else if (a === '--chrome') opt.chrome = val();
  else if (a === '--dpr') opt.dpr = +val();
  else if (a === '--only') opt.only = val().split(',');
  else { console.error('неизвестный параметр', a); process.exit(2); }
}
if (!opt.site || !opt.shots || !opt.out) { console.error('нужны --site, --shots, --out'); process.exit(2); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(0).padStart(4)}с]`, ...a);

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.webm': 'video/webm', '.svg': 'image/svg+xml', '.txt': 'text/plain' };
function serve(root) {   // как GitHub Pages, с Range для видео
  const srv = http.createServer((q, r) => {
    const p = decodeURIComponent(q.url.split('?')[0]);
    let f = path.join(root, p);
    if (!f.startsWith(root)) { r.writeHead(403); r.end(); return; }
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) {
      if (!p.endsWith('/')) { r.writeHead(301, { Location: p + '/' + (q.url.includes('?') ? '?' + q.url.split('?')[1] : '') }); r.end(); return; }
      f = path.join(f, 'index.html');
    }
    if (!fs.existsSync(f)) { r.writeHead(404); r.end('not found'); return; }
    const size = fs.statSync(f).size, type = MIME[path.extname(f).toLowerCase()] || 'application/octet-stream', rg = /bytes=(\d*)-(\d*)/.exec(q.headers.range || '');
    if (rg) {
      const s = rg[1] ? +rg[1] : 0, e = rg[2] ? Math.min(+rg[2], size - 1) : size - 1;
      r.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${s}-${e}/${size}`, 'Accept-Ranges': 'bytes', 'Content-Length': e - s + 1 });
      fs.createReadStream(f, { start: s, end: e }).pipe(r); return;
    }
    r.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes' });
    fs.createReadStream(f).pipe(r);
  });
  return new Promise((res) => srv.listen(0, '127.0.0.1', () => res({ port: srv.address().port, close: () => srv.close() })));
}

// Виртуальное время — как INIT_SCRIPT в tools/stanok_look.mjs; видео не играют сами (шоу ставит их на нужную секунду).
const INIT_SCRIPT = () => {
  let vt = 10000, q = [];
  window.__mvFreeze = true;
  HTMLMediaElement.prototype.play = function () { try { this.pause(); } catch (e) {} return Promise.resolve(); };
  performance.now = () => vt;
  window.requestAnimationFrame = (cb) => { q.push(cb); return q.length; };
  window.cancelAnimationFrame = () => {};
  window.__advance = (ms, step) => { const n = Math.max(1, Math.round(ms / (step || 32))), d = ms / n; for (let i = 0; i < n; i++) { vt += d; const c = q; q = []; c.forEach((cb) => cb(vt)); } };
  let s = 12345;
  Math.random = () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const st = document.createElement('style');
  st.textContent = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}.p-build,#build-version{visibility:hidden!important}';
  document.addEventListener('DOMContentLoaded', () => document.head.appendChild(st));
};

// Один шаг времени + сборка кадра из холстов сцены (#gl, #fxCanvas, #wxCanvas …) в ТОМ ЖЕ вызове: снимок экрана в программном
// WebGL стоит 15–50 с, чтение холстов — доли секунды (lessons §12: перерисовать и прочитать WebGL одним evaluate).
const GRAB = (ms, ui, step) => {
  window.__advance(ms, step);
  if (ui) return null;
  const dpr = window.devicePixelRatio || 1, W = Math.round(innerWidth * dpr), H = Math.round(innerHeight * dpr);
  const out = window.__grabCv || (window.__grabCv = document.createElement('canvas'));
  out.width = W; out.height = H;
  const c = out.getContext('2d');
  c.fillStyle = '#f3ead8'; c.fillRect(0, 0, W, H);
  const list = [...document.querySelectorAll('#stage canvas, body > canvas')].filter((cv) => {
    const st = getComputedStyle(cv); return st.display !== 'none' && st.visibility !== 'hidden' && +st.opacity > 0.01 && cv.width > 2;
  });
  for (const cv of list) {
    const r = cv.getBoundingClientRect(), st = getComputedStyle(cv);
    c.globalAlpha = +st.opacity;
    try { c.drawImage(cv, r.left * dpr, r.top * dpr, r.width * dpr, r.height * dpr); } catch (e) {}
  }
  c.globalAlpha = 1;
  return out.toDataURL('image/jpeg', 0.92);
};
const lerpKeys = (keys, t) => {   // [[t,x,y],...] с плавным ходом между ключами
  if (!keys || !keys.length) return [0, 0];
  if (t <= keys[0][0]) return [keys[0][1], keys[0][2]];
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) {
      const a = keys[i - 1], b = keys[i], u = (t - a[0]) / Math.max(1e-6, b[0] - a[0]), e = u * u * (3 - 2 * u);
      return [a[1] + (b[1] - a[1]) * e, a[2] + (b[2] - a[2]) * e];
    }
  }
  const z = keys[keys.length - 1]; return [z[1], z[2]];
};

async function main() {
  let shots = JSON.parse(fs.readFileSync(opt.shots, 'utf8'));
  if (opt.only) shots = shots.filter((s) => opt.only.includes(s.id));
  const gl = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--hide-scrollbars', '--font-render-hinting=none', '--autoplay-policy=no-user-gesture-required', '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1'];
  const srv = await serve(opt.site);
  const origin = 'http://127.0.0.1:' + srv.port;
  const browser = await puppeteer.launch({ executablePath: opt.chrome, headless: 'new', protocolTimeout: 900000, args: gl });
  let bad = 0;
  for (const S of shots) {
    const dir = path.join(opt.out, S.id);
    if (fs.existsSync(path.join(dir, 'done.json'))) { log(S.id, 'уже снят — пропуск'); continue; }
    fs.mkdirSync(dir, { recursive: true });
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    const problems = [];
    page.on('pageerror', (e) => problems.push('pageerror: ' + String(e.message).slice(0, 160)));
    const VP = (d) => page.setViewport({ width: opt.w, height: opt.h, deviceScaleFactor: d, isMobile: true, hasTouch: true });
    await VP(0.5);   // подготовка (загрузка, листание, отстой) — в малом разрешении: программный WebGL платит за каждый пиксель
    await page.evaluateOnNewDocument(INIT_SCRIPT);
    const adv = (ms) => page.evaluate((m) => window.__advance(m, 64), ms);
    const click = (sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) throw new Error('нет ' + s); e.click(); }, sel);
    try {
      await page.goto(`${origin}/${S.page}/?still=1&perf=0`, { waitUntil: 'load', timeout: 60000 });
      for (let i = 0; i < 960; i++) {
        const ok = await page.evaluate(() => document.documentElement.getAttribute('data-loaded') === 'all' && !!window.Details && !document.getElementById('stage').classList.contains('loading')).catch(() => false);
        if (ok) break;
        if (i === 959) throw new Error('страница не загрузилась за 4 минуты');
        await sleep(250);
      }
      log(S.id, 'загружен');
      await page.evaluate(() => { const w = document.getElementById('welcome'); if (w) w.remove(); });
      await page.evaluate(() => document.fonts && document.fonts.ready);
      await adv(S.pre || 1500);
      // кадр
      const n = await page.evaluate(() => document.querySelectorAll('#dots span').length);
      for (let g = 0; g < 12 && (await page.evaluate(() => window.__viewer.frame())) !== S.frame; g++) {
        const cur = await page.evaluate(() => window.__viewer.frame());
        await page.keyboard.press(((S.frame - cur) + n) % n <= n / 2 ? 'ArrowRight' : 'ArrowLeft');
        for (let k = 0; k < 60; k++) { await adv(100); if (!(await page.evaluate(() => window.__viewer.fading()))) break; }
      }
      if (S.tod && S.tod !== 'day') await click(`#todSeg [data-tod=${S.tod}]`);
      if (S.precip && S.precip !== 'none') await click(`#precipSeg [data-precip=${S.precip}]`);
      await adv(S.settle || 3500);
      await VP(opt.dpr); await adv(300);
      log(S.id, 'готов к съёмке');
      if (!S.ui) await page.evaluate(() => document.body.classList.add('immersive'));
      if (S.card) {   // открытка движка (window.__card.make — та же, что уходит в «Поделиться»), одна картинка
        await page.evaluate(() => Promise.race([Promise.all([window.__card.fontsLoad && window.__card.fontsLoad('en'), window.__card.paperLoad && window.__card.paperLoad(), window.__card.bldLoad && window.__card.bldLoad()]), new Promise((r) => setTimeout(r, 8000))]).catch(() => 0));
        await adv(200);
        const r = await page.evaluate((o) => { window.__advance(32); return window.__card.make(o); }, S.card);
        if (!r || !r.url) throw new Error('открытка не собралась');
        fs.writeFileSync(path.join(dir, 'card.jpg'), Buffer.from(r.url.split(',')[1], 'base64'));
        fs.writeFileSync(path.join(dir, 'done.json'), JSON.stringify({ id: S.id, card: true, problems }, null, 1));
        log(S.id, 'открытка готова');
        await ctx.close(); continue;
      }
      if (S.show) {
        const ok = await page.evaluate(() => window.Details.parade(function () {}, 'fx'));
        if (!ok) problems.push('шоу не запустилось');
      }
      const fps = S.fps || 30, N = Math.round(S.dur * fps), speed = S.speed || 1, ev = (S.events || []).slice().sort((a, b) => a.at - b.at);
      let ei = 0;
      for (let i = 0; i < N; i++) {
        const t = i / fps;
        while (ei < ev.length && ev[ei].at <= t + 1e-6) {
          const e = ev[ei++];
          if (e.do === 'tod') await click(`#todSeg [data-tod=${e.val}]`);
          else if (e.do === 'precip') await click(`#precipSeg [data-precip=${e.val}]`);
          else if (e.do === 'click') await click(e.val);
          else if (e.do === 'immersive') await page.evaluate((v) => document.body.classList.toggle('immersive', !!v), e.val);
        }
        let shot = null; const tq = Date.now();
        const [x, y] = lerpKeys(S.tilt, S.dur ? t / S.dur : 0);
        await page.evaluate((a) => window.__viewer.tilt(a[0], a[1]), [x, y]);
        if (process.env.DBG) log('  tilt', Date.now() - tq);
        if (S.show) {
          const st = S.show[0] + (S.show[1] - S.show[0]) * (N > 1 ? i / (N - 1) : 0);
          await page.evaluate((v) => window.Details.paradeFreeze(v), st);
          await adv(64);
          for (let k = 0; k < 30; k++) {   // видео шоу должно встать на свою секунду
            const busy = await page.evaluate(() => [...document.querySelectorAll('video')].some((v) => v.seeking || (v.src && v.readyState < 2)));
            if (!busy) break; await sleep(50);
          }
          shot = await page.evaluate(GRAB, 32, !!S.ui, 32);
        } else {
          shot = await page.evaluate(GRAB, 1000 / fps * speed, !!S.ui, S.step || 32);
        }
        if (S.ui) shot = 'data:image/jpeg;base64,' + (await page.screenshot({ type: 'jpeg', quality: 92, encoding: 'base64' }));
fs.writeFileSync(path.join(dir, String(i).padStart(4, '0') + '.jpg'), Buffer.from(shot.split(',')[1], 'base64'));
      }
      fs.writeFileSync(path.join(dir, 'done.json'), JSON.stringify({ id: S.id, frames: N, fps, problems }, null, 1));
      log(S.id, 'кадров', N, problems.length ? 'проблемы: ' + problems.join(' | ') : '');
    } catch (e) {
      bad++; console.error('ОШИБКА', S.id, e.message);
    }
    await ctx.close();
  }
  await browser.close(); srv.close();
  process.exit(bad ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
