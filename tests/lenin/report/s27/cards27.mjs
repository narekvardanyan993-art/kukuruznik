#!/usr/bin/env node
// s27: размещение штемпеля и таблички относительно здания/памятника — НАСТОЯЩИЙ рендер Chrome, до/после на одном и том же кадре.
// «До» — postcard.js из HEAD (s26: только занятость кадра), «после» — рабочая папка (карта слоя здания). Кадр один (захват с экрана),
// меняется только функция compose. Что здание на самом деле нарисовано — из второго кадра с погашенным слоем здания (текстура 1×1
// прозрачная): разность двух кадров = силуэт, который видит глаз (не наша же карта).
//   node tests/lenin/report/s27/cards27.mjs --out DIR [--only lenin|kukuruznik] [--cases kukuruznik:night:2,lenin:day:3]
import puppeteer from 'puppeteer';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T0 = Date.now(); const log = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(0).padStart(4)}с]`, ...a);
const opt = { out: null, only: null, cases: null };
for (let i = 2; i < process.argv.length; i++) { const a = process.argv[i]; if (a === '--out') opt.out = path.resolve(process.argv[++i]); else if (a === '--only') opt.only = process.argv[++i]; else if (a === '--cases') opt.cases = process.argv[++i].split(',').map((c) => { const [b, s, f] = c.split(':'); return { b, s, f: +f }; }); }
if (!opt.out) { console.error('--out DIR'); process.exit(2); }
fs.mkdirSync(opt.out, { recursive: true });

function buildSite() {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'chka-s27-site-'));
  const commit = spawnSync('git', ['-C', ROOT, 'rev-parse', 'origin/main^{commit}'], { encoding: 'utf8' }).stdout.trim();
  const ar = spawnSync('git', ['-C', ROOT, 'archive', commit, '--', '.', ':(exclude)docs', ':(exclude)tools', ':(exclude)src', ':(exclude)engine3d', ':(exclude)test-assets', ':(exclude)beta'], { maxBuffer: 1 << 30 });
  spawnSync('tar', ['-x', '-C', dest], { input: ar.stdout, maxBuffer: 1 << 30 });
  const b = spawnSync('python3', [path.join(ROOT, 'tools', 'build_pages.py'), '--site', dest, '--beta-only'], { encoding: 'utf8' });
  if (b.status !== 0) throw new Error('build_pages: ' + (b.stderr || b.stdout).slice(-600));
  return dest;
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.webm': 'video/webm', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' };
function serve(root) {
  const srv = http.createServer((q, r) => {
    const p = decodeURIComponent(q.url.split('?')[0]); let f = path.join(root, p);
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
    if (!fs.existsSync(f)) { r.writeHead(404); r.end(); return; }
    const size = fs.statSync(f).size, type = MIME[path.extname(f).toLowerCase()] || 'application/octet-stream';
    const m = /bytes=(\d*)-(\d*)/.exec(q.headers.range || '');
    if (m) { const s = m[1] ? +m[1] : 0, e = m[2] ? +m[2] : size - 1; r.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${s}-${e}/${size}`, 'Accept-Ranges': 'bytes', 'Content-Length': e - s + 1 }); fs.createReadStream(f, { start: s, end: e }).pipe(r); return; }
    r.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Cache-Control': 'no-store' }); fs.createReadStream(f).pipe(r);
  });
  return new Promise((res) => srv.listen(0, '127.0.0.1', () => res({ port: srv.address().port, close: () => srv.close() })));
}
const oldSrc = spawnSync('git', ['-C', ROOT, 'show', 'HEAD:engine/postcard.js'], { encoding: 'utf8', maxBuffer: 1 << 26 }).stdout.replace('window.ChkaPostcard = ', 'window.ChkaPostcardOld = ');
if (!/ChkaPostcardOld/.test(oldSrc)) throw new Error('postcard.js из HEAD не найден');

const B = { lenin: { page: 'beta/tests/lenin/', n: 0 }, kukuruznik: { page: 'beta/kukuruznik/', n: 0 } };
const LINE = { hy: 'Այստեղ հանդիպեցին ծնողներս', ru: 'Здесь познакомились мои родители', en: 'My parents met here' };
const result = { date: new Date().toISOString(), cases: [], problems: [] };
const root = buildSite();
const srv = await serve(root);
const browser = await puppeteer.launch({ headless: 'new', executablePath: process.env.CHROME_PATH, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--hide-scrollbars'] });
const save = (name, dataUrl) => fs.writeFileSync(path.join(opt.out, name), Buffer.from(dataUrl.split(',')[1], 'base64'));

for (const id of Object.keys(B).filter((b) => !opt.only || b === opt.only)) {
  const want = opt.cases ? opt.cases.filter((c) => c.b === id) : null;
  if (want && !want.length) continue;
  const page = await browser.newPage(); const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + String(e.message).slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text().slice(0, 200)); });
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.goto(`http://127.0.0.1:${srv.port}/${B[id].page}?perf=0&still=1`, { waitUntil: 'load', timeout: 60000 });
  for (let i = 0; i < 400; i++) { if (await page.evaluate(() => document.documentElement.getAttribute('data-loaded') === 'all' && !document.getElementById('stage').classList.contains('loading')).catch(() => false)) break; await sleep(250); }
  await page.evaluate(() => { const w = document.getElementById('welcome'); if (w) w.remove(); });
  await page.evaluate(oldSrc);
  await page.evaluate(() => window.__card.fontsLoad());
  await page.evaluate(() => window.__card.bldLoad());
  const nFr = await page.evaluate(() => document.querySelectorAll('#dots span').length);
  log(id, 'загружено, кадров', nFr);
  const click = (sel) => page.evaluate((s) => document.querySelector(s).click(), sel);
  const goto_ = async (f) => {
    for (let g = 0; g < 12; g++) { const cur = await page.evaluate(() => window.__viewer.frame()); if (cur === f) break; await page.keyboard.press(((f - cur) + nFr) % nFr <= nFr / 2 ? 'ArrowRight' : 'ArrowLeft'); await sleep(150); for (let k = 0; k < 60 && (await page.evaluate(() => window.__viewer.fading())); k++) await sleep(100); }
    for (let k = 0; k < 40 && (await page.evaluate(() => !!(window.__viewer.mvBusy && window.__viewer.mvBusy()))); k++) await sleep(100);
    await sleep(900);
  };
  const cases = want || ['day', 'night'].flatMap((s) => Array.from({ length: nFr }, (_, f) => ({ b: id, s, f })));
  let cur = 'day';
  for (const c of cases) {
    if (c.s !== cur) {
      if (c.s === 'night') { await click('#todSeg [data-tod=night]'); for (let k = 0; k < 120; k++) { if (await page.evaluate(() => window.__viewer.tod.night >= 0.999)) break; await sleep(100); } }
      else { await click('#todSeg [data-tod=day]'); await sleep(4500); }
      cur = c.s; await sleep(800);
    }
    await goto_(c.f);
    await page.evaluate(() => window.__card.bldLoad());
    const variants = [{ lang: 'hy', line: '' }];
    if (want) variants.push({ lang: 'ru', line: LINE.ru });
    for (const v of variants) {
      const tag = `${id}-${c.s}-f${c.f}-${v.lang}${v.line ? '-line' : ''}`;
      const r = await page.evaluate(async (o) => {
        const mk = (compose) => { const keep = ChkaPostcard.compose; ChkaPostcard.compose = compose; try { return window.__card.make(Object.assign({ film: false, grain: false, png: true, src: true, seed: 27, date: '2026-10-16T12:00:00' }, o)); } finally { ChkaPostcard.compose = keep; } };
        const after = mk(ChkaPostcard.compose), before = mk(ChkaPostcardOld.compose);
        // здание, как нарисовано: тот же кадр со слоем здания, заменённым прозрачной текстурой 1×1
        const e = window.__viewer.entry(window.__viewer.frame()), cv = document.getElementById('gl'), gl = cv.getContext('webgl') || cv.getContext('experimental-webgl');
        const keepTex = e.bldTex, t = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        e.bldTex = t;
        let nb = null; try { nb = window.__card.make(Object.assign({ film: false, grain: false, png: true, src: true, seed: 27, date: '2026-10-16T12:00:00' }, o)).src; } finally { e.bldTex = keepTex; }
        const m = window.__card.mask();
        return { after: after.url, before: before.url, src: after.src, nb: nb, boxesAfter: after.boxes, boxesBefore: before.boxes, mask: m ? btoa(String.fromCharCode.apply(null, m)) : null };
      }, v);
      save(`${tag}-after.png`, r.after); save(`${tag}-before.png`, r.before); save(`${tag}-src.png`, r.src); save(`${tag}-nobld.png`, r.nb);
      if (r.mask) fs.writeFileSync(path.join(opt.out, `${tag}-mask.b64`), r.mask);
      result.cases.push({ tag, b: id, state: c.s, frame: c.f, lang: v.lang, line: v.line, boxesAfter: r.boxesAfter, boxesBefore: r.boxesBefore, haveMask: !!r.mask });
      log(tag, 'готово', r.boxesAfter && r.boxesAfter.bld && JSON.stringify(r.boxesAfter.bld), r.boxesAfter && r.boxesAfter.plaque && r.boxesAfter.plaque.compact ? 'компакт' : '');
    }
  }
  result[id + '_errors'] = errors;
  await page.close();
}
await browser.close(); srv.close();
fs.writeFileSync(path.join(opt.out, 'result.json'), JSON.stringify(result, null, 1));
log('готово →', opt.out);
