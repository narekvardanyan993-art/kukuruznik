// s11: node report.mjs <base url> <outdir>  — день/ночь каждого кадра, ленты 12 с B и G (каждые 0,5 с), состояние клипов
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
async function seek(p, pat, t) {   // видео (по части имени файла) на время t, на паузе; ждём, пока кадр уйдёт в текстуру
  return p.evaluate(async ([pat, t]) => {
    let v = null;
    for (let k = 0; k < 60 && !v; k++) { v = [...document.querySelectorAll('video')].find((x) => (x.currentSrc || '').includes(pat)); if (!v) await new Promise((r) => setTimeout(r, 150)); }
    if (!v) return 'no video ' + pat;
    for (let k = 0; k < 100 && (v.readyState < 2 || !isFinite(v.duration)); k++) await new Promise((r) => setTimeout(r, 100));
    t = Math.min(t, v.duration - 0.05);
    for (let a = 0; a < 3 && Math.abs(v.currentTime - t) > 0.03; a++) {
      await new Promise((r) => { const to = setTimeout(r, 3000); v.addEventListener('seeked', () => { clearTimeout(to); r(); }, { once: true }); v.currentTime = t; });
    }
    await new Promise((r) => setTimeout(r, 450));
    return (v.currentSrc || '').split('/').pop() + '@' + v.currentTime.toFixed(2);
  }, [pat, t]);
}
const log = [];
const p = await open('?perf=0');
for (let f = 0; f < 5; f++) {
  await go(p, f);
  log.push(NAMES[f] + ' day: ' + await seek(p, FILES[f] + '_motion_1', 4.0) + ' ' + JSON.stringify(await p.evaluate((f) => window.__viewer.mvState(f), f)));
  await p.screenshot({ path: `${out}/day_${NAMES[f]}.png` });
}
for (const f of [1, 4]) {   // ленты 12 с, каждые 0,5 с
  await go(p, f);
  for (let k = 0; k < 24; k++) {
    log.push(NAMES[f] + ' strip ' + k + ': ' + await seek(p, FILES[f] + '_motion_1', k * 0.5));
    await p.screenshot({ path: `${out}/strip_${NAMES[f]}_${String(k).padStart(2, '0')}.png` });
  }
}
await p.evaluate(() => { const bt = document.querySelector('#todSeg button[data-tod=night]'); bt && bt.click(); });
await p.waitForTimeout(7000);
for (let f = 0; f < 5; f++) {
  await go(p, f);
  await p.waitForTimeout(1500);
  const st = await p.evaluate((f) => window.__viewer.mvState(f), f);
  if (st.night) log.push(NAMES[f] + ' night: ' + await seek(p, FILES[f] + '_motion_n1', 4.0));
  log.push(NAMES[f] + ' night state ' + JSON.stringify(await p.evaluate((f) => window.__viewer.mvState(f), f)));
  await p.screenshot({ path: `${out}/night_${NAMES[f]}.png` });
}
console.log(log.join('\n')); console.log('errs', JSON.stringify(p.__errs.slice(0, 6)), JSON.stringify(await p.evaluate(() => window.__viewer.errors())));
await b.close();
