// Снимок дневного кадра 1 в рамке-паспарту для картинки-превью (tools/make_og.py). Сервер :8080 из корня репозитория.
//   node tools/og_shot.mjs [файл.png]     по умолчанию /tmp/og-frame.png
import puppeteer from 'puppeteer';
const out = process.argv[2] || '/tmp/og-frame.png';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await puppeteer.launch({ headless: 'new', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage();
await p.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);   // без живых деталей: чистая картинка
await p.setViewport({ width: 1700, height: 1200, deviceScaleFactor: 2 });
await p.goto('http://localhost:8080/test-assets/depth.html?perf=0', { waitUntil: 'domcontentloaded' });
for (let i = 0; i < 200; i++) { if (await p.evaluate(() => { const w = document.getElementById('welcome'); return w && w.hidden; })) break; await sleep(300); }
await sleep(1500);
await p.evaluate(() => { document.querySelectorAll('.hs-dot, .nav-side').forEach((d) => d.style.display = 'none'); });
const el = await p.$('#frame');
await el.screenshot({ path: out });
await b.close();
