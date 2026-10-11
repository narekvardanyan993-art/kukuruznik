// s13: node strip.mjs <base url> <outdir> <кадр 0..4> <имя> — лента 10 с (20 снимков по 0,5 с ИГРОВОГО времени): часы страницы на паузе
// (Playwright clock), видео синемаграфа заморожено (__mvFreeze) и ставится на то же время — swiftshader медленнее реального времени.
import { chromium } from 'playwright';
const [base, out, fi, nm] = process.argv.slice(2); const F = +fi;
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
await ctx.addInitScript(() => { window.__mvFreeze = true; });
const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(String(e.message)));
await p.clock.install();
await p.goto(base + '?perf=0', { waitUntil: 'load' });
for (let i = 0; i < 40; i++) { await p.clock.runFor(250); await p.waitForTimeout(150); }
for (let g = 0; g < 8 && (await p.evaluate(() => window.__viewer.frame())) !== F; g++) {
  await p.keyboard.press('ArrowRight');
  for (let i = 0; i < 16; i++) { await p.clock.runFor(250); await p.waitForTimeout(120); }
}
for (let i = 0; i < 30; i++) { await p.clock.runFor(250); await p.waitForTimeout(150); }
const PAT = ['lenin_1', 'lenin_2', 'lenin_3', 'lenin_4', 'lenin_6'][F] + '_motion_';
async function seek(t) {   // в странице часы поддельные (setTimeout стоит) — ждём в node реальным временем
  const r = await p.evaluate(([pat, t]) => {
    const v = [...document.querySelectorAll('video')].find((x) => (x.currentSrc || '').includes(pat));
    if (!v || !isFinite(v.duration)) return null;
    v.currentTime = t % (v.duration - 0.05); return 1;
  }, [PAT, t]);
  if (!r) return 'no video';
  for (let k = 0; k < 40; k++) {
    await p.waitForTimeout(100);
    const s = await p.evaluate((pat) => { const v = [...document.querySelectorAll('video')].find((x) => (x.currentSrc || '').includes(pat)); return v && !v.seeking && v.readyState >= 2 ? v.currentSrc.split('/').pop() + '@' + v.currentTime.toFixed(2) : null; }, PAT);
    if (s) return s;
  }
  return 'seek timeout';
}
console.log('frame', await p.evaluate(() => window.__viewer.frame()));
const nowF = await p.evaluate(() => Date.now()); await p.clock.pauseAt(nowF + 500); await p.waitForTimeout(500);
const log = [];
for (let k = 0; k < 20; k++) {
  if (k) for (let s = 0; s < 10; s++) await p.clock.runFor(50);
  log.push(await seek(k * 0.5)); await p.waitForTimeout(300); await p.clock.runFor(16);
  await p.screenshot({ path: `${out}/strip_${nm}_${String(k).padStart(2, '0')}.png` });
}
console.log(log.join(' '), '; errs', JSON.stringify(errs.slice(0, 5)));
await b.close();
