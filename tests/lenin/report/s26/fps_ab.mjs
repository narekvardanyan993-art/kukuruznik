#!/usr/bin/env node
// s26: частота кадров просмотра ДО (движок e1.26) и ПОСЛЕ (e1.27 с открыткой) в одинаковых условиях облачного Chrome (swiftshader — числа
// маленькие и шумные, сравнивать только между собой). Плюс замер ПОСЛЕ того, как открытку сделали (ничего не остаётся работать в фоне).
//   node tests/lenin/report/s26/fps_ab.mjs OLD_SITE NEW_SITE [page]
import puppeteer from 'puppeteer';
import http from 'http';
import fs from 'fs';
import path from 'path';
const [oldSite, newSite, pg = 'beta/tests/lenin/'] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function serve(root) {
  const srv = http.createServer((q, r) => { let f = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html'); if (!fs.existsSync(f)) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.webp': 'image/webp', '.png': 'image/png', '.woff2': 'font/woff2', '.webm': 'video/webm', '.mp4': 'video/mp4', '.json': 'application/json' }[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); });
  return new Promise((res) => srv.listen(0, '127.0.0.1', () => res(srv)));
}
const b = await puppeteer.launch({ headless: 'new', executablePath: process.env.CHROME_PATH, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const out = [];
async function measure(site, tag, card) {
  const srv = await serve(site), p = await b.newPage(), errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await p.goto(`http://127.0.0.1:${srv.address().port}/${pg}?perf=0`, { waitUntil: 'load', timeout: 60000 });
  for (let i = 0; i < 400; i++) { if (await p.evaluate(() => document.documentElement.getAttribute('data-loaded') === 'all')) break; await sleep(250); }
  await p.evaluate(() => { const w = document.getElementById('welcome'); if (w) w.remove(); });
  await sleep(5000);
  if (card) { await p.evaluate(() => window.__card.make({ lang: 'hy', film: true })); await sleep(3000); }
  const r = await p.evaluate(() => new Promise((res) => { let n = 0, t0 = performance.now(), worst = 0, last = t0; (function f(t) { n++; worst = Math.max(worst, t - last); last = t; if (t - t0 < 10000) requestAnimationFrame(f); else res({ fps: +(n * 1000 / (t - t0)).toFixed(2), worstMs: Math.round(worst) }); })(t0); }));
  out.push({ tag, ...r, errors: errs.length });
  console.log(tag.padEnd(28), JSON.stringify(r), 'ошибок', errs.length);
  await p.close(); srv.close();
}
for (let k = 0; k < 2; k++) { await measure(oldSite, 'до (e1.26) #' + (k + 1)); await measure(newSite, 'после (e1.27) #' + (k + 1)); }
await measure(newSite, 'после + открытка сделана', true);
await b.close();
console.log(JSON.stringify(out));
