// Ночной лист: все 6 кадров просмотрщика ночью в одной сетке 3×2 с номерами (docs/night-sheet.png).
//   node tools/night_sheet.mjs [выходной.png]
// Сервер должен стоять на :8080 из корня репозитория (python3 -m http.server 8080).
// Время виртуальное, как в tools/snapshot_depth.mjs: картинка воспроизводится кадр в кадр.
import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { PNG } from 'pngjs';

const out = process.argv[2] || 'docs/night-sheet.png';
const URL = process.env.DEPTH_URL || 'http://localhost:8080/test-assets/depth.html';
const W = 450, H = 800, COLS = 3, ROWS = 2;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
});
const page = await browser.newPage();
await page.evaluateOnNewDocument(() => {
  let vt = 10000, q = [];
  performance.now = () => vt;
  window.requestAnimationFrame = (cb) => { q.push(cb); return q.length; };
  window.__advance = (ms) => { const n = Math.ceil(ms / 16); for (let i = 0; i < n; i++) { vt += 16; const c = q; q = []; c.forEach((f) => f(vt)); } };
  const st = document.createElement('style');
  // только сцена: без меню, стрелок, точек, подсказок и меток
  st.textContent = '*,*::before,*::after{animation:none!important;transition:none!important}' +
    '#bottomBar,#hint,#dots,#build-version,.nav-btn,#hotspots,#hsPopup,#panelBtn,#birds,#welcome{display:none!important}';
  document.addEventListener('DOMContentLoaded', () => document.head.appendChild(st));
});
const advance = (ms) => page.evaluate((m) => window.__advance(m), ms);
await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
for (let i = 0; i < 900; i++) {
  await advance(100);
  if (await page.evaluate(() => !document.getElementById('stage').classList.contains('loading'))) break;
  await sleep(100);
}
await advance(400);
await page.evaluate(() => { const w = document.getElementById('welcome'); if (w) w.remove(); });
await page.evaluate(() => document.querySelector('#todSeg [data-tod=night]').click());
await advance(6800);

const tiles = [];
for (let i = 0; i < 6; i++) {
  // переход на кадр i: кнопка «следующий» в панели/стрелка; кадры листаются по кругу
  for (let guard = 0; guard < 12; guard++) {
    const cur = await page.evaluate(() => Array.from(document.querySelectorAll('#dots span')).findIndex((s) => s.classList.contains('on')));
    if (cur === i) break;
    await page.evaluate(() => document.getElementById('nextBtn').click());
    await advance(1600);
  }
  await advance(1500);
  await sleep(150);
  const file = `/tmp/_night_${i}.png`;
  await page.screenshot({ path: file });
  tiles.push(PNG.sync.read(fs.readFileSync(file)));
  console.log('кадр', i);
}
await browser.close();

// сетка с номерами
const PAD = 12, pw = COLS * W + (COLS + 1) * PAD, ph = ROWS * H + (ROWS + 1) * PAD;
const sheet = new PNG({ width: pw, height: ph });
for (let i = 0; i < sheet.data.length; i += 4) { sheet.data[i] = 20; sheet.data[i + 1] = 22; sheet.data[i + 2] = 30; sheet.data[i + 3] = 255; }
// 5×7 пиксельные цифры 1–6
const DIG = {
  1: ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  2: ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  3: ['.###.', '#...#', '....#', '..##.', '....#', '#...#', '.###.'],
  4: ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  5: ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  6: ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.']
};
function blit(t, ox, oy) {
  for (let y = 0; y < t.height; y++) for (let x = 0; x < t.width; x++) {
    const s = (y * t.width + x) * 4, d = ((oy + y) * pw + ox + x) * 4;
    sheet.data[d] = t.data[s]; sheet.data[d + 1] = t.data[s + 1]; sheet.data[d + 2] = t.data[s + 2]; sheet.data[d + 3] = 255;
  }
}
function badge(n, ox, oy) {
  const sc = 4, bw = 5 * sc + 16, bh = 7 * sc + 16;
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    const d = ((oy + y) * pw + ox + x) * 4; sheet.data[d] = 245; sheet.data[d + 1] = 236; sheet.data[d + 2] = 218; sheet.data[d + 3] = 255;
  }
  DIG[n].forEach((row, ry) => [...row].forEach((c, rx) => {
    if (c !== '#') return;
    for (let y = 0; y < sc; y++) for (let x = 0; x < sc; x++) {
      const d = ((oy + 8 + ry * sc + y) * pw + ox + 8 + rx * sc + x) * 4; sheet.data[d] = 47; sheet.data[d + 1] = 42; sheet.data[d + 2] = 37;
    }
  }));
}
tiles.forEach((t, i) => {
  const ox = PAD + (i % COLS) * (W + PAD), oy = PAD + Math.floor(i / COLS) * (H + PAD);
  blit(t, ox, oy);
  badge(i + 1, ox + 12, oy + 12);
});
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, PNG.sync.write(sheet));
console.log('записано', out, pw + '×' + ph);
