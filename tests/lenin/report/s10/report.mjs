// node report.mjs <base url> <outdir>
import { chromium } from 'playwright';
import fs from 'fs';
const [base, out] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const NAMES = ['A', 'B', 'C', 'D', 'G'], FILES = ['lenin_1', 'lenin_2', 'lenin_3', 'lenin_4', 'lenin_6'];
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
async function open(q) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ctx.addInitScript(() => { window.__mvFreeze = true; });
  const p = await ctx.newPage();
  p.__errs = []; p.on('pageerror', (e) => p.__errs.push(String(e.message)));
  await p.goto(base + q, { waitUntil: 'load' }); await p.waitForTimeout(9000);
  return p;
}
async function go(p, f) {
  for (let g = 0; g < 12 && (await p.evaluate(() => window.__viewer.frame())) !== f; g++) {
    await p.keyboard.press('ArrowRight'); await p.waitForTimeout(400);
    for (let k = 0; k < 40 && (await p.evaluate(() => window.__viewer.fading())); k++) await p.waitForTimeout(150);
  }
  for (let k = 0; k < 80 && (await p.evaluate(() => !!window.__viewer.mvBusy())); k++) await p.waitForTimeout(150);
  await p.waitForTimeout(800);
}
async function seek(p, file, t) {   // видео кадра на время t (пауза), ждём, пока кадр уйдёт в текстуру
  return p.evaluate(async ([file, t]) => {
    const v = [...document.querySelectorAll('video')].find((x) => (x.currentSrc || '').includes(file + '_motion'));
    if (!v) return 'no video';
    if (t === 'next') { v.dispatchEvent(new Event('ended')); await new Promise((r) => setTimeout(r, 200)); v.pause(); for (let k = 0; k < 50 && v.readyState < 2; k++) await new Promise((r) => setTimeout(r, 100)); return (v.currentSrc || '').split('/').pop(); }
    for (let k = 0; k < 100 && (v.readyState < 2 || !isFinite(v.duration)); k++) await new Promise((r) => setTimeout(r, 100));
    for (let a = 0; a < 3 && Math.abs(v.currentTime - t) > 0.03; a++) {
      await new Promise((r) => { const to = setTimeout(r, 3000); v.addEventListener('seeked', () => { clearTimeout(to); r(); }, { once: true }); v.currentTime = t; });
    }
    await new Promise((r) => setTimeout(r, 450));
    return (v.currentSrc || '').split('/').pop() + '@' + v.currentTime.toFixed(2);
  }, [file, t]);
}
const log = [];
const p = await open('?perf=0');
for (let f = 0; f < 5; f++) {
  await go(p, f);
  log.push(NAMES[f] + ' day: ' + await seek(p, FILES[f], 3.5));
  await p.screenshot({ path: `${out}/day_${NAMES[f]}.png` });
  if (NAMES[f] === 'G') { log.push('G t3.5 for side-by-side'); await p.screenshot({ path: `${out}/G_video.png` }); }
}
// ленты 10 с через стык петли: B и A, каждые 0,5 с (видео на паузе, время задаём)
for (const f of [1, 0]) {
  await go(p, f);
  const file = FILES[f], nm = NAMES[f];
  const dur = await p.evaluate((file) => { const v = [...document.querySelectorAll('video')].find((x) => (x.currentSrc || '').includes(file + '_motion')); return v ? v.duration : 0; }, file);
  let t = Math.max(0, dur - 5), i = 0, seam = false;
  for (let k = 0; k < 20; k++) {
    if (t >= dur - 0.02 && !seam) { log.push(nm + ' seam → ' + await seek(p, file, 'next')); seam = true; t = 0; }
    log.push(nm + ' strip ' + k + ': ' + await seek(p, file, Math.min(t, dur - 0.04)));
    await p.screenshot({ path: `${out}/strip_${nm}_${String(k).padStart(2, '0')}.png` });
    t += 0.5;
  }
}
const q = await open('?perf=0&cine=0');
await go(q, 4); await q.screenshot({ path: `${out}/G_nocine.png` });
console.log(log.join('\n')); console.log('errs', JSON.stringify(p.__errs.concat(q.__errs).slice(0, 6)));
await b.close();
