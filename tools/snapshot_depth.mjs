// Снимки просмотрщика test-assets/depth.html для safe-change.
//   node tools/snapshot_depth.mjs before   -> docs/snapshots/depth-before/
//   node tools/snapshot_depth.mjs after    -> docs/snapshots/depth-after/ + сравнение с before
// Время виртуальное: requestAnimationFrame/performance.now крутит сам скрипт
// (__advance), CSS-анимации выключены — ракурсы воспроизводимы кадр в кадр.
// Сервер должен стоять на :8080 из корня репозитория.
import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

const stage = process.argv[2] || 'before';
const URL = process.env.DEPTH_URL || 'http://localhost:8080/test-assets/depth.html';
const root = process.cwd();
const dir = (s) => path.join(root, `docs/snapshots/depth-${s}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function capture() {
  fs.mkdirSync(dir(stage), { recursive: true });
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
  });
  const page = await browser.newPage();

  await page.evaluateOnNewDocument(() => {
    let vt = 10000;
    let q = [];
    performance.now = () => vt;
    window.requestAnimationFrame = (cb) => { q.push(cb); return q.length; };
    window.__advance = (ms) => {
      const n = Math.ceil(ms / 16);
      for (let i = 0; i < n; i++) {
        vt += 16;
        const cbs = q; q = [];
        cbs.forEach((cb) => cb(vt));
      }
    };
    const st = document.createElement('style');
    st.textContent = '*,*::before,*::after{animation:none!important;transition:none!important}';
    document.addEventListener('DOMContentLoaded', () => document.head.appendChild(st));
  });

  const advance = (ms) => page.evaluate((m) => window.__advance(m), ms);
  async function waitLoaded() {
    for (let i = 0; i < 900; i++) {
      await advance(100);
      const ok = await page.evaluate(() => !document.getElementById('stage').classList.contains('loading'));
      if (ok) return;
      await sleep(100);
    }
    throw new Error('viewer did not finish loading');
  }
  async function waitAll() {   // закат, ночь и остальные кадры догружаются в фоне
    for (let i = 0; i < 900; i++) {
      if (await page.evaluate(() => document.documentElement.getAttribute('data-loaded') === 'all')) return;
      await advance(100); await sleep(100);
    }
  }
  async function goToFrame(i) {
    const cur = () => page.evaluate(() => Array.from(document.querySelectorAll('#dots span')).findIndex((s) => s.classList.contains('on')));
    for (let guard = 0; guard < 12 && (await cur()) !== i; guard++) {
      const before = await cur();
      await page.click('#nextBtn');
      for (let k = 0; k < 80 && (await cur()) === before; k++) { await advance(100); await sleep(50); }
    }
    await advance(600);
    await sleep(300);
  }
  async function shot(name) {
    await advance(1000); // сглаживание наклона доезжает до цели
    await sleep(200);
    await page.screenshot({ path: path.join(dir(stage), name + '.png') });
    console.log('captured', name);
  }
  async function tiltAt(fx, fy, w, h) {
    await page.mouse.move(w * fx, h * fy);
    await advance(50);
  }

  const W = 390, H = 844;
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
  await waitLoaded();
  await waitAll();
  // Старая версия показывает карточку гироскопа на весь экран — закрываем её,
  // чтобы снимки сравнивали именно картинку.
  await page.evaluate(() => {
    const skip = document.getElementById('gyroSkip');
    if (skip) skip.click();
    const b = document.getElementById('build-version'); if (b) b.style.display = 'none';
    const w = document.getElementById('welcome'); if (w) w.remove(); // приветствие (v8) не должно попадать в кадры
    const pb = document.querySelector('.p-build'); if (pb) pb.style.visibility = 'hidden';
  });
  await advance(400); await sleep(400);

  // 6 кадров при одном и том же наклоне (правый-верхний угол)
  for (let i = 0; i < 6; i++) {
    await goToFrame(i);
    await tiltAt(0.85, 0.3, W, H);
    await shot(`frame_${i}`);
  }
  // Крайние наклоны на кадре 1: видно объём и края
  await goToFrame(1);
  await tiltAt(0.02, 0.5, W, H); await shot('tilt_left');
  await tiltAt(0.98, 0.5, W, H); await shot('tilt_right');
  await tiltAt(0.5, 0.98, W, H); await shot('tilt_down');
  await tiltAt(0.5, 0.5, W, H);  await shot('center');

  // Телефон: шторка меню (есть только с v5)
  if (await page.$('#panelBtn')) {
    await page.click('#panelBtn'); await advance(600); await sleep(300);
    await shot('sheet_open');
    await page.click('#scrim'); await advance(600); await sleep(200);
  }

  // Десктоп (с v5 — панель слева) + время суток
  await page.setViewport({ width: 1400, height: 900, deviceScaleFactor: 1 });
  await advance(200); await sleep(300);
  await tiltAt(0.7, 0.5, 1400, 900);
  await shot('desktop');
  // карточка подсказки при наведении на первую точку
  const dotPos = await page.evaluate(() => { const d = document.querySelector('.hs-dot'); if (!d) return null; const r = d.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  if (dotPos) {
    await page.mouse.move(dotPos.x, dotPos.y); await advance(700); await sleep(300);
    await shot('desktop_hint');
    await page.mouse.move(dotPos.x + 250, dotPos.y + 150); await advance(1500); await sleep(200);
  }
  if (await page.$('#todSeg')) {
    for (const t of ['night', 'sunset']) {
      await page.click(`#todSeg [data-tod=${t}]`); await advance(t === 'night' ? 6800 : 3200); await sleep(300);
      await shot('desktop_' + t);
    }
    await page.click('#todSeg [data-tod=day]'); await advance(6800);
  }

  // Ночь и закат на каждом кадре (телефон)
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  await advance(300); await sleep(300);
  if (await page.$('#todSeg')) {
    await page.evaluate(() => document.querySelector('#todSeg [data-tod=night]').click());
    await advance(6800);
    for (let i = 0; i < 6; i++) { await goToFrame(i); await tiltAt(0.5, 0.5, W, H); await shot(`night_${i}`); }
    await page.evaluate(() => document.querySelector('#todSeg [data-tod=sunset]').click());
    await advance(6800);
    await goToFrame(0); await tiltAt(0.5, 0.5, W, H); await shot('sunset_0');
  }

  await browser.close();
}

function compare() {
  const files = fs.readdirSync(dir('before')).filter((f) => f.endsWith('.png'));
  fs.mkdirSync(dir('diff'), { recursive: true });
  for (const f of files) {
    const a = path.join(dir('before'), f), b = path.join(dir('after'), f);
    if (!fs.existsSync(b)) { console.log(`[!] no after for ${f}`); continue; }
    const i1 = PNG.sync.read(fs.readFileSync(a)), i2 = PNG.sync.read(fs.readFileSync(b));
    if (i1.width !== i2.width || i1.height !== i2.height) { console.log(`${f}: size differs`); continue; }
    const diff = new PNG({ width: i1.width, height: i1.height });
    const n = pixelmatch(i1.data, i2.data, diff.data, i1.width, i1.height, { threshold: 0.1 });
    console.log(`${f}: ${(n / (i1.width * i1.height) * 100).toFixed(3)}% diff`);
    fs.writeFileSync(path.join(dir('diff'), f), PNG.sync.write(diff));
  }
}

if (stage === 'compare') compare();
else capture().then(() => { console.log(stage + ' capture complete'); if (stage === 'after') compare(); });
