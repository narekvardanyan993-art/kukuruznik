import { chromium } from 'playwright';
const url = process.argv[2];
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
const p = await ctx.newPage();
const errs = []; p.on('pageerror', (e) => errs.push(String(e.message))); p.on('console', (m) => { if (/chka|video/i.test(m.text())) errs.push(m.text().slice(0, 160)); });
await p.goto(url, { waitUntil: 'load' });
const st = () => p.evaluate(() => { const o = ['f' + (window.__viewer ? window.__viewer.frame() : '-')]; document.querySelectorAll('video').forEach((v) => o.push((v.currentSrc || '').split('/').pop().replace('lenin_', '').replace('_motion', 'm') + '@' + v.currentTime.toFixed(1) + (v.paused ? 'P' : '') + ' rs' + v.readyState)); return o.join(' '); });
const t0 = Date.now(); const log = [];
for (let i = 0; i < 12; i++) { log.push(((Date.now() - t0) / 1000).toFixed(1) + 's ' + await st()); await p.waitForTimeout(1000); }
// to B via tap on the right arrow (touch)
const t1 = Date.now();
await p.keyboard.press('ArrowRight');
for (let i = 0; i < 8; i++) { log.push('B+' + ((Date.now() - t1) / 1000).toFixed(1) + 's ' + await st()); await p.waitForTimeout(700); }
console.log(log.join('\n')); console.log('errs', JSON.stringify(errs.slice(0, 6)));
await b.close();
