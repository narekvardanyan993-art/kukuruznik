// s14: node life_grid.mjs <base url> <outdir> <day|night> — «живость» 3×3: по каждому кадру 16 снимков за 15 с ИГРОВОГО времени
// «Дыхание» камеры на время замера выключено (сдвигает всю картинку — «живыми» становятся все ячейки). (часы страницы на паузе — Playwright clock, видео синемаграфа заморожено __mvFreeze и ставится на то же время: swiftshader медленнее
// реального). Интерфейс (кнопки, точки-подсказки, подписи) скрыт — меряется только картинка и холсты жизни. Таблицу считает life_grid.py.
import { chromium } from 'playwright';
const [base, out, mode, only] = process.argv.slice(2);   // only — буквы кадров (например AD), по умолчанию все
const NAMES = ['A', 'B', 'C', 'D', 'G'], FILES = ['lenin_1', 'lenin_2', 'lenin_3', 'lenin_4', 'lenin_6'];
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
await ctx.addInitScript(() => { window.__mvFreeze = true; });
const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(String(e.message)));
await p.clock.install();
await p.goto(base + '?perf=0', { waitUntil: 'load' });
const run = async (n, ms = 250, w = 140) => { for (let i = 0; i < n; i++) { await p.clock.runFor(ms); await p.waitForTimeout(w); } };
await run(40);
if (mode === 'night') { await p.evaluate(() => { const bt = document.querySelector('#todSeg button[data-tod=night]'); bt && bt.click(); }); await run(48); }
async function seek(pat, t) {
  const r = await p.evaluate(([pat, t]) => { const v = [...document.querySelectorAll('video')].find((x) => (x.currentSrc || '').includes(pat)); if (!v || !isFinite(v.duration)) return null; v.currentTime = t % (v.duration - 0.05); return 1; }, [pat, t]);
  if (!r) return 'no video';
  for (let k = 0; k < 40; k++) { await p.waitForTimeout(100); const s = await p.evaluate((pat) => { const v = [...document.querySelectorAll('video')].find((x) => (x.currentSrc || '').includes(pat)); return v && !v.seeking && v.readyState >= 2 ? v.currentTime.toFixed(2) : null; }, pat); if (s) return s; }
  return 'seek timeout';
}
const log = [];
for (let F = 0; F < 5; F++) {
  if (only && !only.includes(NAMES[F])) continue;
  for (let g = 0; g < 8 && (await p.evaluate(() => window.__viewer.frame())) !== F; g++) { await p.keyboard.press('ArrowRight'); await run(16, 250, 120); }
  await run(30);
  await p.evaluate(() => { window.CONFIG.BREATH_AMPLITUDE = 0; }); await run(8);   // «дыхание» камеры (сдвиг всей картинки) не считаем — меряем жизнь в кадре
  await p.evaluate(() => { document.querySelectorAll('body *').forEach((e) => { e.style.visibility = 'hidden'; }); document.querySelectorAll('canvas').forEach((c) => { c.style.visibility = 'visible'; }); });
  const pat = FILES[F] + '_motion_';
  for (let k = 0; k < 16; k++) {
    if (k) for (let s = 0; s < 20; s++) await p.clock.runFor(50);
    const sv = await seek(pat, k); await p.waitForTimeout(250); await p.clock.runFor(16);
    await p.screenshot({ path: `${out}/${mode}_${NAMES[F]}_${String(k).padStart(2, '0')}.png` });
    if (k === 0 || k === 15) log.push(`${mode} ${NAMES[F]} t${k}: video ${sv}`);
  }
  await p.evaluate(() => { document.querySelectorAll('body *').forEach((e) => { e.style.visibility = ''; }); });
}
console.log(log.join('\n'), '\nerrs', JSON.stringify(errs.slice(0, 5)));
await b.close();
