// Частота кадров: эмуляция телефона, реальный GPU (ANGLE Metal), замедление CPU ×4 (или CPU=N). День, закат, ночь (с живыми деталями).
//   node tools/fps_check.mjs [url]     по умолчанию http://localhost:8081/beta/
import puppeteer from 'puppeteer';
const URL = process.argv[2] || 'http://localhost:8081/beta/';
const CPU = +(process.env.CPU || 4);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await puppeteer.launch({ headless: 'new', args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu'] });
const p = await b.newPage();
await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const c = await p.createCDPSession(); await c.send('Emulation.setCPUThrottlingRate', { rate: CPU });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto(URL, { waitUntil: 'load', timeout: 120000 });
for (let i = 0; i < 400; i++) { if (await p.evaluate(() => document.documentElement.getAttribute('data-loaded') === 'all' && window.Details)) break; await sleep(500); }
await p.evaluate(() => { const w = document.getElementById('welcome'); if (w) w.remove(); });
async function fps(tag) {
  const r = await p.evaluate(() => new Promise((res) => { let n = 0, t0 = performance.now(), worst = 0, last = t0; (function f(t) { n++; worst = Math.max(worst, t - last); last = t; if (t - t0 < 5000) requestAnimationFrame(f); else res({ fps: n * 1000 / (t - t0), worst }); })(t0); }));
  console.log(tag.padEnd(34), 'fps', r.fps.toFixed(1), ' самый долгий кадр', Math.round(r.worst), 'мс');
  return r.fps;
}
console.log('CPU ×' + CPU + ', эмуляция телефона, реальный GPU');
await fps('день, кадр 1 (детали включены)');
await p.evaluate(() => { ['birds', 'plane', 'butterfly'].forEach((k) => Details.test(k, 0.4)); });
await fps('день + 3 живые детали одновременно');
await p.click('#panelBtn'); await sleep(600); await p.click('#todSeg [data-tod=night]'); await p.click('#scrim'); await sleep(7500);
await p.evaluate(() => { ['plane', 'moths', 'winlight'].forEach((k) => Details.test(k, 0.4)); });
await fps('ночь, кадр 1 + 3 детали');
await p.evaluate(() => { document.getElementById('nextBtn').click(); }); await sleep(2500);
await fps('ночь, кадр 2 (после перехода)');
console.log('ошибки:', errs);
await b.close();
