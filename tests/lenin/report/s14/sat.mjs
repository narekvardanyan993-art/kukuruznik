// s14: насыщенность G — видео / ?cine=0 / видео со сдвигом цвета «как на iPhone» (gamma 1.15, saturation 0.75, +3 % яркости) + калибровка
import { chromium } from 'playwright';
import fs from 'fs';
const [base, out, shifted] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required'] });
async function shot(name, q, shift) {
  const ctx = await b.newContext({ viewport:{width:390,height:844}, deviceScaleFactor:1, isMobile:true, hasTouch:true });
  await ctx.addInitScript(() => { window.__mvFreeze = true; });
  const p = await ctx.newPage();
  if (shift) await p.route('**/lenin_6_motion_1.webm', (r) => r.fulfill({ status: 200, contentType: 'video/webm', body: fs.readFileSync(shifted) }));
  await p.goto(base + '?perf=0' + q, { waitUntil: 'load' }); await p.waitForTimeout(8000);
  for (let g = 0; g < 8 && (await p.evaluate(() => window.__viewer.frame())) !== 4; g++) { await p.keyboard.press('ArrowRight'); await p.waitForTimeout(2600); }
  await p.waitForTimeout(3000);
  await p.evaluate(async () => { const v = [...document.querySelectorAll('video')].find((x) => (x.currentSrc || '').includes('lenin_6_motion')); if (v) { v.currentTime = 4; await new Promise((r) => setTimeout(r, 1200)); } });
  await p.evaluate(() => { document.querySelectorAll('body *').forEach((e) => { e.style.visibility = 'hidden'; }); const g = document.querySelector('canvas'); g.style.visibility = 'visible'; });
  await p.waitForTimeout(800);
  await p.screenshot({ path: `${out}/G_${name}.png` });
  console.log(name, JSON.stringify(await p.evaluate(() => window.__mvCal || null)));
  await ctx.close();
}
const only = process.argv[5];
if (!only) { await shot('video', '', false); await shot('nocine', '&cine=0', false); await shot('shifted_cal', '', true); }
else await shot(only, '', true);
await b.close();
