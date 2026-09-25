// Проверка белых краёв: все 6 кадров × день/закат/ночь × 4 крайних наклона (мышь в углах). Считает долю «бумажно-белых»
// пикселей в полосе 2.5% у края картинки. Норма — 0%.
//   node tools/edge_check.mjs        (сервер :8080 из корня репозитория)
import puppeteer from 'puppeteer';
import { PNG } from 'pngjs';
import fs from 'fs';
const URL = process.env.DEPTH_URL || 'http://localhost:8080/test-assets/depth.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ headless: 'new', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.evaluateOnNewDocument(() => {
  let vt = 10000, q = [];
  performance.now = () => vt;
  window.requestAnimationFrame = (cb) => { q.push(cb); return q.length; };
  window.__advance = (ms) => { const n = Math.ceil(ms / 16); for (let i = 0; i < n; i++) { vt += 16; const c = q; q = []; c.forEach((f) => f(vt)); } };
  const st = document.createElement('style');
  st.textContent = '*,*::before,*::after{animation:none!important;transition:none!important}#bottomBar,#hint,#dots,#build-version,.nav-btn,#hotspots,#hsPopup,#panelBtn,#birds,#welcome,#fxCanvas{display:none!important}';
  document.addEventListener('DOMContentLoaded', () => document.head.appendChild(st));
});
const adv = (ms) => page.evaluate((m) => window.__advance(m), ms);
const W = 450, H = 800;
await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
for (let i = 0; i < 900; i++) { await adv(100); if (await page.evaluate(() => document.documentElement.getAttribute('data-loaded') === 'all')) break; await sleep(100); }
await page.evaluate(() => { const w = document.getElementById('welcome'); if (w) w.remove(); });
const corners = [[0.01, 0.01], [0.99, 0.01], [0.01, 0.99], [0.99, 0.99]];
let worst = 0; const rows = [];
async function measure(tag) {
  let w = 0;
  for (const [fx, fy] of corners) {
    await page.mouse.move(W * fx, H * fy); await adv(1500); await sleep(60);
    const buf = await page.screenshot({ encoding: 'binary' });
    const png = PNG.sync.read(buf); let cnt = 0, tot = 0;
    const bx = Math.round(W * 0.025), by = Math.round(H * 0.025);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (x >= bx && x < W - bx && y >= by && y < H - by) continue;
      const o = (y * W + x) * 4, r = png.data[o], g = png.data[o + 1], b = png.data[o + 2];
      tot++; if (Math.min(r, g, b) > 232 && Math.max(r, g, b) - Math.min(r, g, b) < 24) cnt++;
    }
    w = Math.max(w, cnt / tot);
  }
  rows.push(tag + ' ' + (w * 100).toFixed(2) + '%'); worst = Math.max(worst, w);
}
for (const tod of ['day', 'sunset', 'night']) {
  await page.evaluate((k) => document.querySelector('#todSeg [data-tod=' + k + ']').click(), tod);
  await adv(tod === 'day' ? 6800 : 6800);
  for (let i = 0; i < 6; i++) {
    for (let g = 0; g < 12; g++) {
      const cur = await page.evaluate(() => Array.from(document.querySelectorAll('#dots span')).findIndex((s) => s.classList.contains('on')));
      if (cur === i) break;
      await page.evaluate(() => document.getElementById('nextBtn').click()); await adv(1600);
    }
    await adv(600);
    await measure(tod + ' кадр ' + (i + 1));
  }
}
await browser.close();
console.log(rows.join('\n')); console.log('худший край: ' + (worst * 100).toFixed(2) + '%');
