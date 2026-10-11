// s13: node report.mjs <base url> <outdir> — день/ночь всех 5 кадров (B и G теперь с синемаграфом), ночь живая (ленты B и G — strip.mjs)
import { chromium } from 'playwright';
import fs from 'fs';
const [base, out] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const NAMES = ['A', 'B', 'C', 'D', 'G'], FILES = ['lenin_1', 'lenin_2', 'lenin_3', 'lenin_4', 'lenin_6'];
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
async function open(q, freeze, dpr) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: dpr, isMobile: true, hasTouch: true });
  if (freeze) await ctx.addInitScript(() => { window.__mvFreeze = true; });
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
  for (let k = 0; k < 80 && (await p.evaluate(() => !!(window.__viewer.mvBusy && window.__viewer.mvBusy()))); k++) await p.waitForTimeout(150);
  await p.waitForTimeout(1200);
}
async function seek(p, pat, t) {
  return p.evaluate(async ([pat, t]) => {
    let v = null;
    for (let k = 0; k < 40 && !v; k++) { v = [...document.querySelectorAll('video')].find((x) => (x.currentSrc || '').includes(pat)); if (!v) await new Promise((r) => setTimeout(r, 150)); }
    if (!v) return 'no video ' + pat;
    for (let k = 0; k < 100 && (v.readyState < 2 || !isFinite(v.duration)); k++) await new Promise((r) => setTimeout(r, 100));
    t = Math.min(t, v.duration - 0.05);
    for (let a = 0; a < 3 && Math.abs(v.currentTime - t) > 0.03; a++)
      await new Promise((r) => { const to = setTimeout(r, 3000); v.addEventListener('seeked', () => { clearTimeout(to); r(); }, { once: true }); v.currentTime = t; });
    await new Promise((r) => setTimeout(r, 450));
    return (v.currentSrc || '').split('/').pop() + '@' + v.currentTime.toFixed(2);
  }, [pat, t]);
}
const vids = (p) => p.evaluate(() => [...document.querySelectorAll('video')].map((v) => (v.currentSrc || '').split('/').pop() + '@' + v.currentTime.toFixed(1) + (v.paused ? 'P' : '')).join(' '));
const log = [];
const p = await open('?perf=0', true, 2);
for (let f = 0; f < 5; f++) {
  await go(p, f);
  log.push(NAMES[f] + ' day: ' + await seek(p, FILES[f] + '_motion_1', 4.0) + ' ' + JSON.stringify(await p.evaluate((f) => window.__viewer.mvState ? window.__viewer.mvState(f) : null, f)));
  await p.screenshot({ path: `${out}/day_${NAMES[f]}.png` });
}
await p.evaluate(() => { const bt = document.querySelector('#todSeg button[data-tod=night]'); bt && bt.click(); });
await p.waitForTimeout(7000);
for (let f = 0; f < 5; f++) {
  await go(p, f);
  log.push(NAMES[f] + ' night state ' + JSON.stringify(await p.evaluate((f) => window.__viewer.mvState ? window.__viewer.mvState(f) : null, f)));
  await p.screenshot({ path: `${out}/night_${NAMES[f]}.png` });
  log.push(NAMES[f] + ' windows ' + JSON.stringify(await p.evaluate((f) => { const e = window.__viewer.entry(f); if (!e || !e.wins) return null; const on = e.wins.filter((w) => w.on); const b = on.map((w) => w.bright); return { total: e.wins.length, on: on.length, brightMin: b.length ? Math.min(...b).toFixed(2) : null, brightMax: b.length ? Math.max(...b).toFixed(2) : null, lamps: (e.lamps || []).length }; }, f)));
}
log.push('errs1 ' + JSON.stringify(p.__errs.slice(0, 6)) + ' ' + JSON.stringify(await p.evaluate(() => window.__viewer.errors ? window.__viewer.errors() : null)));
// живая страница (видео не заморожены): ночь — не «замерзает» ли (лента G 10 с — strip.mjs, по часам страницы)
const q = await open('?perf=0', false, 1);
await q.evaluate(() => { const bt = document.querySelector('#todSeg button[data-tod=night]'); bt && bt.click(); });
await q.waitForTimeout(7000);
for (let f = 0; f < 5; f++) {
  await go(q, f);
  for (let k = 0; k < 2; k++) { await q.screenshot({ path: `${out}/alive_night_${NAMES[f]}_${k}.png` }); log.push(NAMES[f] + ' night live ' + k + ': ' + await vids(q)); await q.waitForTimeout(3000); }
}
log.push('errs2 ' + JSON.stringify(q.__errs.slice(0, 6)) + ' ' + JSON.stringify(await q.evaluate(() => window.__viewer.errors ? window.__viewer.errors() : null)));
console.log(log.join('\n'));
await b.close();
