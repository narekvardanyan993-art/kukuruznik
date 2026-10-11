// лента G: 20 снимков с шагом 0,5 с ИГРОВОГО времени (часы страницы на паузе, Playwright clock.runFor) — swiftshader слишком медленный для реального времени
import { chromium } from 'playwright';
const [base, out] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(String(e.message)));
await p.clock.install();
await p.goto(base + '?perf=0', { waitUntil: 'load' });
for (let i = 0; i < 40; i++) { await p.clock.runFor(250); await p.waitForTimeout(150); }
for (let g = 0; g < 8 && (await p.evaluate(() => window.__viewer.frame())) !== 4; g++) {
  await p.keyboard.press('ArrowRight');
  for (let i = 0; i < 16; i++) { await p.clock.runFor(250); await p.waitForTimeout(120); }
}
for (let i = 0; i < 20; i++) { await p.clock.runFor(250); await p.waitForTimeout(100); }
console.log('frame', await p.evaluate(() => window.__viewer.frame()));
const nowF = await p.evaluate(() => Date.now()); await p.clock.pauseAt(nowF + 500); await p.waitForTimeout(500);
const t0 = await p.evaluate(() => performance.now());
for (let k = 0; k < 20; k++) {
  if (k) for (let s = 0; s < 10; s++) await p.clock.runFor(50);   // 0,5 с по 50 мс — движок считает шаг ≤ 0,1 с
  await p.screenshot({ path: `${out}/strip_G_${String(k).padStart(2, '0')}.png` });
}
console.log('page time', ((await p.evaluate(() => performance.now())) - t0) / 1000, 's; errs', JSON.stringify(errs.slice(0, 5)));
await b.close();
