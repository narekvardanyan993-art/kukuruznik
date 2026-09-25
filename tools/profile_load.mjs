// Профиль загрузки: эмуляция телефона, Slow 3G и замедление CPU ×4. Считает длинные задачи (>50 мс) главного потока
// за время приветствия (от старта до «коснись, чтобы начать») и потом, пока догружается остальное.
//   node tools/profile_load.mjs [url] [cpu]      по умолчанию http://localhost:8081/beta/ и ×4; реальный GPU (ANGLE Metal); GPU=swiftshader — программный рендер, он медленнее телефона
import puppeteer from 'puppeteer';
const URL = process.argv[2] || 'http://localhost:8081/beta/';
const CPU = +(process.argv[3] || 4);
const b = await puppeteer.launch({ headless: 'new', args: process.env.GPU === 'swiftshader' ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu'] });
const p = await b.newPage();
await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const c = await p.createCDPSession();
await c.send('Network.enable'); await c.send('Network.setCacheDisabled', { cacheDisabled: true });
await c.send('Network.emulateNetworkConditions', { offline: false, latency: 400, downloadThroughput: 500 * 1024 / 8, uploadThroughput: 500 * 1024 / 8 });
await c.send('Emulation.setCPUThrottlingRate', { rate: CPU });
await p.evaluateOnNewDocument(() => {
  window.__lt = []; window.__t0 = performance.now(); window.__marks = {};
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: 'longtask', buffered: true });
  const mo = new MutationObserver(() => {
    const w = document.getElementById('welcome'), s = document.getElementById('stage');
    if (w && !window.__marks.welcome) window.__marks.welcome = Math.round(performance.now());
    if (w && w.classList.contains('ready') && !window.__marks.ready) window.__marks.ready = Math.round(performance.now());
    if (s && !s.classList.contains('loading') && !window.__marks.stage) window.__marks.stage = Math.round(performance.now());
  });
  document.addEventListener('DOMContentLoaded', () => mo.observe(document.documentElement, { subtree: true, attributes: true, childList: true }));
  window.addEventListener('DOMContentLoaded', () => { window.__marks.dcl = Math.round(performance.now()); });
});
await p.evaluateOnNewDocument(() => localStorage.setItem('chka-lang', 'hy'));
const t0 = Date.now();
await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
const snap = async (name) => p.screenshot({ path: '/tmp/ft/prof_' + name + '.png' });
await new Promise((r) => setTimeout(r, 1500)); await snap('1_5s');
for (let i = 0; i < 400; i++) {
  const st = await p.evaluate(() => [window.__marks.ready, document.documentElement.getAttribute('data-loaded')]).catch(() => [null, null]);
  if (st[0]) break; await new Promise((r) => setTimeout(r, 500));
}
const res = await p.evaluate(() => ({ marks: window.__marks, lt: window.__lt, now: Math.round(performance.now()) }));
await snap('ready');
const readyAt = res.marks.ready || res.now;
const during = res.lt.filter(([s]) => s < readyAt);
console.log('CPU ×' + CPU + ', Slow 3G (500 Кбит/с, 400 мс)');
console.log('метки, мс:', JSON.stringify(res.marks));
console.log('за время приветствия (до готовности), длинных задач >50 мс:', during.length, during.length ? JSON.stringify(during) : '');
console.log('самая длинная за это время:', during.reduce((m, [, d]) => Math.max(m, d), 0), 'мс');
// потом — пока догружается остальное
await new Promise((r) => setTimeout(r, 4000));
for (let i = 0; i < 600; i++) {
  if (await p.evaluate(() => document.documentElement.getAttribute('data-loaded') === 'all').catch(() => false)) break;
  await new Promise((r) => setTimeout(r, 1000));
}
const res2 = await p.evaluate(() => ({ lt: window.__lt, now: Math.round(performance.now()), loaded: document.documentElement.getAttribute('data-loaded') }));
const after = res2.lt.filter(([s]) => s >= readyAt);
console.log('после готовности (фоновая догрузка кадров, заката, ночи), длинных задач:', after.length, ' самая длинная:', after.reduce((m, [, d]) => Math.max(m, d), 0), 'мс; всё загружено на', res2.now, 'мс, состояние:', res2.loaded);
await b.close();
