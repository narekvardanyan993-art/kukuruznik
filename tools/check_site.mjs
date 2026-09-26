#!/usr/bin/env node
// Защитная проверка сайта перед публикацией (docs/ENGINE-PLAN.md, п.7).
//
// Берёт две копии сайта — «как сейчас» (origin/main, распакованный во временную папку вне репозитория)
// и «кандидат» — и сравнивает их снимки:
//   • каждое здание с просмотрщиком (kukuruznik/, beta/, beta/<имя>/, любая папка с building.json и id="stage" в index.html):
//     каждый кадр × день/закат/ночь × телефон 390×844 и ПК 1440×900, плюс парад и «живые детали» (принудительно);
//   • страницы: главная, about.html и history.html каждого здания (вверху и целиком);
//   • попиксельное сравнение с рамкой «где» и картинкой-разницей. Допуск только на шум растеризации Chrome: не больше 200 пикселей с разницей каналов не больше 60 из 255
//     (телефонная раскладка и картинка просмотрщика воспроизводятся до пикселя, DOM-панель на ПК и обычные страницы — с шумом на краях; см. NOISE_PX ниже). Всё, что больше, — различие;
//   • fps (эмуляция телефона, процессор ×4, реальный GPU): день, день+детали, ночь+детали, ночь кадр 2;
//   • ошибки в консоли и файлы, которые не загрузились (404 и любые ≥400).
// Время подменено (requestAnimationFrame/performance.now крутит сам скрипт), случайность зафиксирована — снимки
// воспроизводимы кадр в кадр. Логика и картинки сайта не меняются: проверка только читает.
//
// Использование:
//   node tools/check_site.mjs                                      # сайт против самого себя (origin/main × 2)
//   node tools/check_site.mjs --candidate DIR [--allow-change beta]   # DIR — корень сайта-кандидата
//   node tools/check_site.mjs --candidate-ref REF                   # кандидат = git-ref (тег, ветка)
//   node tools/check_site.mjs --save-baseline v12.1 [--ref TAG]     # снять эталон (в ~/Documents/chka-kitchen/_эталоны/)
//   node tools/check_site.mjs --baseline v12.1 --candidate DIR      # сравнивать не с живым сайтом, а с эталоном
//   параметры: --only id,id  --viewports phone,pc  --tods day,night  --frames 0,1  --no-fps  --out DIR  --renderer metal|swiftshader
//   --allow-change ID,ID  — для этих целей различия картинок допустимы (показываются в отчёте, не проваливают);
//                           ошибки, 404 и fps проверяются всегда. Пусто = ноль различий везде.
//   --known FILE          — список известных проблем (по умолчанию tools/check_site.known.json)
// Код выхода: 0 — зелёная, 1 — красная, 2 — сама проверка не смогла отработать.
import puppeteer from 'puppeteer';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KITCHEN = path.join(os.homedir(), 'Documents', 'chka-kitchen');
const OUT_ROOT = fs.existsSync(KITCHEN) ? path.join(KITCHEN, '_проверки') : path.join(os.tmpdir(), 'chka-check');
const BASE_ROOT = fs.existsSync(KITCHEN) ? path.join(KITCHEN, '_эталоны') : path.join(os.tmpdir(), 'chka-check-baselines');
const KEEP_RUNS = 5;                 // сколько последних прогонов держать в папке проверок
const FPS_MIN = 50, FPS_DROP = 0.10; // порог fps: не ниже 50 и не хуже прежнего больше чем на 10%
// Допуск на шум растеризации Chrome. Картинка просмотрщика (WebGL) и телефонная раскладка воспроизводятся до пикселя, но DOM-панель на ПК и обычные страницы
// (главная, about, history) выходят от прогона к прогону в двух вариантах: краевые пиксели кнопок, миниатюр, теней — до ~110 пикселей с разницей до ~21 из 255.
// Поэтому различие в пределах «не больше NOISE_PX пикселей И разница каналов не больше NOISE_DELTA» считается шумом (показывается в отчёте отдельно, не проваливает).
// Реальная правка (сдвиг элемента, цвет, текст, картинка) даёт либо разницу в десятки-сотни уровней на краях, либо тысячи пикселей — сюда не попадает.
const NOISE_PX = 200, NOISE_DELTA = 60;   // измерено по 29 шумовым различиям из повторных прогонов одного и того же сайта: максимум 109 пикселей и 48 из 255; взят запас примерно вдвое
const isNoise = (d, md) => d > 0 && d <= NOISE_PX && md <= NOISE_DELTA;
const VIEWPORTS = { phone: { width: 390, height: 844 }, pc: { width: 1440, height: 900 } };
const TODS = ['day', 'sunset', 'night'];
const EVENTS = { day: ['birds', 'plane', 'cranes'], sunset: ['birds', 'cranes'], night: ['plane', 'moths'] };  // «живые детали», показываем принудительно
const SKIP_DIRS = new Set(['assets', 'docs', 'tools', 'node_modules', 'src', 'engine3d', 'test-assets', 'fonts', 'frames']);

// ---------- аргументы ----------
const argv = process.argv.slice(2);
const opt = { renderer: 'metal', fps: true };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  const val = () => argv[++i];
  if (a === '--candidate') opt.candidate = path.resolve(val());
  else if (a === '--candidate-ref') opt.candidateRef = val();
  else if (a === '--ref') opt.ref = val();
  else if (a === '--baseline') opt.baseline = val();
  else if (a === '--save-baseline') opt.saveBaseline = val();
  else if (a === '--allow-change') opt.allow = val().split(',').filter(Boolean);
  else if (a === '--only') opt.only = val().split(',').filter(Boolean);
  else if (a === '--viewports') opt.viewports = val().split(',');
  else if (a === '--tods') opt.tods = val().split(',');
  else if (a === '--frames') opt.frames = val().split(',').map(Number);
  else if (a === '--no-fps') opt.fps = false;
  else if (a === '--out') opt.out = path.resolve(val());
  else if (a === '--renderer') opt.renderer = val();
  else if (a === '--known') opt.known = path.resolve(val());
  else if (a === '--ignore-env') opt.ignoreEnv = true;
  else if (a === '-h' || a === '--help') { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 30).map((l) => l.replace(/^\/\/ ?/, '')).join('\n')); process.exit(0); }
  else { console.error('неизвестный параметр', a); process.exit(2); }
}
opt.allow = opt.allow || [];
const vpNames = (opt.viewports || Object.keys(VIEWPORTS)).filter((v) => VIEWPORTS[v]);
const todNames = (opt.tods || TODS).filter((t) => TODS.includes(t));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(0).padStart(4)}с]`, ...a);

// ---------- git: копия сайта из ref во временной папке вне репозитория ----------
function git(...args) {
  const r = spawnSync('git', ['-C', ROOT, ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}
function extractRef(ref, dest) {
  if (ref.startsWith('origin/')) git('fetch', 'origin', ref.slice(7));
  const commit = git('rev-parse', ref + '^{commit}');
  const ar = spawnSync('git', ['-C', ROOT, 'archive', commit, '--', '.', ':(exclude)docs', ':(exclude)tools', ':(exclude)src', ':(exclude)engine3d', ':(exclude)test-assets'], { maxBuffer: 1 << 30 });
  if (ar.status !== 0) throw new Error('git archive: ' + ar.stderr);
  const tar = spawnSync('tar', ['-x', '-C', dest], { input: ar.stdout, maxBuffer: 1 << 30 });
  if (tar.status !== 0) throw new Error('tar: ' + tar.stderr);
  return commit;
}

// ---------- статический сервер (как GitHub Pages: 404 на отсутствующее, /dir -> /dir/) ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
function serve(root) {
  const srv = http.createServer((q, r) => {
    const p = decodeURIComponent(q.url.split('?')[0]);
    let f = path.join(root, p);
    if (!f.startsWith(root)) { r.writeHead(403); r.end(); return; }
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) {
      if (!p.endsWith('/')) { r.writeHead(301, { Location: p + '/' + (q.url.includes('?') ? '?' + q.url.split('?')[1] : '') }); r.end(); return; }
      f = path.join(f, 'index.html');
    }
    if (!fs.existsSync(f)) {
      const nf = path.join(root, '404.html');
      r.writeHead(404, { 'Content-Type': MIME['.html'] });
      r.end(fs.existsSync(nf) ? fs.readFileSync(nf) : 'not found');
      return;
    }
    r.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(f).pipe(r);
  });
  return new Promise((res) => srv.listen(0, '127.0.0.1', () => res({ port: srv.address().port, close: () => srv.close() })));
}

// ---------- какие страницы и просмотрщики есть на сайте ----------
function discover(root) {
  const targets = [];
  const has = (p) => fs.existsSync(path.join(root, p));
  const isViewer = (dir) => { const f = path.join(root, dir, 'index.html'); return fs.existsSync(f) && /id="stage"/.test(fs.readFileSync(f, 'utf8')); };
  if (has('index.html')) targets.push({ id: 'hub', kind: 'page', url: '/' });
  const dirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('.') && !SKIP_DIRS.has(d.name)).map((d) => d.name).sort();
  const addDir = (dir) => {
    if (isViewer(dir)) targets.push({ id: dir, kind: 'viewer', url: '/' + dir + '/' });
    for (const pg of ['about', 'history']) if (has(`${dir}/${pg}.html`)) targets.push({ id: `${dir}/${pg}`, kind: 'page', url: `/${dir}/${pg}.html` });
  };
  for (const d of dirs) {
    addDir(d);
    if (d === 'beta') for (const s of fs.readdirSync(path.join(root, d), { withFileTypes: true }).filter((x) => x.isDirectory() && SKIP_DIRS.has(x.name) === false).map((x) => x.name).sort()) addDir(`${d}/${s}`);
  }
  return targets.filter((t) => !opt.only || opt.only.some((o) => t.id === o || t.id.startsWith(o + '/')));
}

// ---------- страница с подменённым временем ----------
const INIT_SCRIPT = () => {
  let vt = 10000, q = [];
  performance.now = () => vt;
  window.requestAnimationFrame = (cb) => { q.push(cb); return q.length; };
  window.cancelAnimationFrame = () => {};
  window.__advance = (ms) => { const n = Math.ceil(ms / 16); for (let i = 0; i < n; i++) { vt += 16; const c = q; q = []; c.forEach((cb) => cb(vt)); } };
  let s = 12345;
  window.__seed = (n) => { s = n | 0; };
  Math.random = () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const st = document.createElement('style');
  st.textContent = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}.p-build,#build-version{visibility:hidden!important}';
  document.addEventListener('DOMContentLoaded', () => document.head.appendChild(st));
};
const hashSeed = (s) => { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

async function newPage(browser, origin, vp, { virtual = true, mobile = false, dsf = 1 } = {}) {
  const page = await browser.newPage();
  const problems = [];
  let external = 0;
  const isLocal = (u) => u.startsWith(origin) || u.startsWith('data:') || u.startsWith('blob:') || u.startsWith('about:');
  page.on('pageerror', (e) => problems.push({ type: 'ошибка страницы', msg: String(e.message).slice(0, 300) }));
  page.on('console', (m) => { if (m.type() === 'error') { const u = (m.location() || {}).url || ''; if (!u || isLocal(u)) problems.push({ type: 'console.error', msg: m.text().slice(0, 300), url: u.replace(origin, '') }); } });
  page.on('response', (r) => { if (r.status() >= 400 && isLocal(r.url())) problems.push({ type: 'HTTP ' + r.status(), msg: r.url().replace(origin, '') }); });
  page.on('requestfailed', (r) => { if (!isLocal(r.url())) { external++; return; }   // внешние адреса (шрифты Google и т.п.) браузер не резолвит (см. --host-resolver-rules): без них снимки не зависят от сети
    if (!/ERR_ABORTED/.test((r.failure() || {}).errorText || '')) problems.push({ type: 'не загрузился', msg: r.url().replace(origin, '') + ' ' + ((r.failure() || {}).errorText || '') }); });
  await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: dsf, isMobile: mobile, hasTouch: mobile });
  if (virtual) await page.evaluateOnNewDocument(INIT_SCRIPT);
  return { page, problems, get external() { return external; } };
}

async function waitViewerLoaded(page, tag) {
  for (let i = 0; i < 480; i++) {   // до 2 минут реального времени; виртуальное время при этом стоит
    const ok = await page.evaluate(() => document.documentElement.getAttribute('data-loaded') === 'all' && !!window.Details && !document.getElementById('stage').classList.contains('loading')).catch(() => false);
    if (ok) return;
    await sleep(250);
  }
  throw new Error(`${tag}: просмотрщик не загрузился за 2 минуты`);
}

// Ленивые картинки (loading=lazy) грузятся по краю экрана и успевают к снимку не всегда — от этого скруглённые углы карточек выходят в двух вариантах.
// Для снимков делаем все картинки обычными и ждём, пока загрузятся и декодируются (одинаково для обеих копий сайта).
const settleImages = (page) => page.evaluate(async () => {
  document.querySelectorAll('img[loading=lazy]').forEach((i) => { i.loading = 'eager'; });
  const t0 = Date.now();
  while (Date.now() - t0 < 6000 && [...document.images].some((i) => (i.currentSrc || i.src) && !i.complete)) await new Promise((r) => setTimeout(r, 100));
  await Promise.race([
    Promise.all([...document.images].filter((i) => i.complete && i.naturalWidth).map((i) => (i.decode ? i.decode().catch(() => {}) : Promise.resolve()))),
    new Promise((r) => setTimeout(r, 2500))
  ]);
});
const shotSha = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);

// ---------- снимки просмотрщика ----------
async function captureViewer(browser, origin, target, vpName, outDir) {
  const vp = VIEWPORTS[vpName];
  const P = await newPage(browser, origin, vp, { mobile: vpName === 'phone' });
  const { page, problems } = P;
  const shots = {};
  const adv = (ms) => page.evaluate((m) => window.__advance(m), ms);
  // Перед снимком ждём, пока GPU разберёт всю очередь кадров (gl.finish): иначе на снимок попадает не последний кадр, а один из предыдущих
  // (другая фаза «дыхания» и ветра) — и мелкие детали на резких краях выходят чуть по-разному от прогона к прогону.
  const gpuDone = () => page.evaluate(() => { const c = document.getElementById('gl'); const g = c && (c.getContext('webgl') || c.getContext('experimental-webgl')); if (g) { g.finish(); const px = new Uint8Array(4); g.readPixels(0, 0, 1, 1, g.RGBA, g.UNSIGNED_BYTE, px); } });
  const snap = async (name) => {
    await gpuDone(); await sleep(60);
    const buf = await page.screenshot({ type: 'png' });
    fs.writeFileSync(path.join(outDir, name + '.png'), buf);
    shots[name] = { sha: shotSha(buf), bytes: buf.length };
  };
  try {
    await page.goto(origin + target.url, { waitUntil: 'load', timeout: 60000 });
    await waitViewerLoaded(page, target.id);
    await page.evaluate(() => document.fonts && document.fonts.ready);
    if (vpName === 'pc') await sleep(3000);   // на ПК есть реальные таймеры (стена из букв, «перо» панели) — снимаем после них
    await settleImages(page); await sleep(200);
    await page.evaluate(() => { const w = document.getElementById('welcome'); if (w) w.remove(); });   // приветствие идёт по реальным таймерам — в снимки не берём (а с ним и демо-наклон)
    const n = await page.evaluate(() => document.querySelectorAll('#dots span').length);
    const frames = (opt.frames || [...Array(n).keys()]).filter((f) => f < n);
    const seed = (s) => page.evaluate((v) => window.__seed(v), hashSeed(`${target.id}|${vpName}|${s}`));
    const fading = () => page.evaluate(() => window.__viewer.fading());
    const curFrame = () => page.evaluate(() => window.__viewer.frame());
    const goto_ = async (f) => {
      let cur = await curFrame(), guard = 0;
      while (cur !== f && guard++ < 12) {
        const fwd = ((f - cur) + n) % n <= n / 2;
        await seed(`go${f}`);
        await page.keyboard.press(fwd ? 'ArrowRight' : 'ArrowLeft');
        for (let k = 0; k < 60; k++) { await adv(100); if (!(await fading())) break; }
        cur = await curFrame();
      }
      await adv(900);
    };
    await seed('start'); await adv(3000);
    // парад (кнопка с флагом; живёт только на своём кадре, обычно первом): середина полёта и растаявшие следы
    if (todNames.includes('day')) {
      const btn = await page.evaluate((v) => { const b = document.querySelector(v === 'pc' ? '#flagBtnP' : '#flagBtnB'); return !!b && !b.hidden && !b.classList.contains('off-frame'); }, vpName);
      if (btn) {
        await seed('parade');
        await page.evaluate((v) => document.querySelector(v === 'pc' ? '#flagBtnP' : '#flagBtnB').click(), vpName);
        await adv(5200); await snap('day-parade-mid');
        await adv(3800); await snap('day-parade-late');
        await adv(12000);
      }
    }
    let first = true;
    for (const tod of todNames) {
      if (tod !== 'day') {
        await seed('tod-' + tod);
        await page.evaluate((t) => document.querySelector('#todSeg [data-tod=' + t + ']').click(), tod);
        await adv(tod === 'sunset' ? 3400 : 4200);
      }
      const order = tod === 'sunset' ? [...frames].reverse() : frames;
      for (const f of order) {
        await goto_(f);
        await seed(`shot-${tod}-${f}`); await adv(600);
        await snap(`${tod}-f${f}`);
        if (vpName === 'phone') {   // живые детали (птицы, самолёт, журавли, мотыльки): принудительно, в середине пути
          await seed(`ev-${tod}-${f}`);
          await page.evaluate((k) => k.forEach((x) => { try { window.Details.test(x, 0.45); } catch (e) {} }), EVENTS[tod]);
          await adv(500);
          await snap(`${tod}-f${f}-events`);
        }
      }
      first = false;
    }
  } catch (e) {
    problems.push({ type: 'сбой проверки', msg: e.message.slice(0, 300) });
  }
  const ext = P.external;
  await page.close();
  return { shots, problems, external: ext };
}

// ---------- снимки обычных страниц (главная, about, history) ----------
async function capturePage(browser, origin, target, vpName, outDir) {
  const vp = VIEWPORTS[vpName];
  const P = await newPage(browser, origin, vp, { mobile: vpName === 'phone' });
  const { page, problems } = P;
  const shots = {};
  const adv = (ms) => page.evaluate((m) => window.__advance(m), ms);
  const snap = async (name, full) => {
    const buf = await page.screenshot({ type: 'png', fullPage: !!full });
    fs.writeFileSync(path.join(outDir, name + '.png'), buf);
    shots[name] = { sha: shotSha(buf), bytes: buf.length };
  };
  try {
    await page.goto(origin + target.url, { waitUntil: 'load', timeout: 60000 });
    await page.evaluate(() => document.fonts && document.fonts.ready);
    await page.evaluate((s) => window.__seed(s), hashSeed(target.id + vpName));
    await sleep(2500); await adv(2000); await settleImages(page);   // 2.5 с: у страниц есть реальные таймеры 0.7–1.35 с (разлёт стопки, параллакс, подсказки слайдера) — снимаем после них
    const h = await page.evaluate(() => document.documentElement.scrollHeight);   // сначала проходим страницу до низа: «проявление при прокрутке» срабатывает у всех элементов,
    for (let y = 0; y < h; y += vp.height * 0.7) { await page.evaluate((yy) => window.scrollTo(0, yy), y); await sleep(120); await adv(300); }   // а не только у тех, что на границе экрана
    await page.evaluate(() => window.scrollTo(0, 0)); await sleep(300); await adv(800); await settleImages(page); await sleep(1200);
    await snap('top');
    await snap('full', true);
  } catch (e) {
    problems.push({ type: 'сбой проверки', msg: e.message.slice(0, 300) });
  }
  const ext = P.external;
  await page.close();
  return { shots, problems, external: ext };
}

// ---------- fps ----------
async function measureFps(browser, origin, target) {
  const vp = VIEWPORTS.phone;
  const P = await newPage(browser, origin, vp, { virtual: false, mobile: true, dsf: 2 });
  const { page, problems } = P;
  const out = {};
  try {
    const c = await page.createCDPSession();
    await c.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await page.goto(origin + target.url, { waitUntil: 'load', timeout: 120000 });
    await waitViewerLoaded(page, target.id);
    await page.evaluate(() => { const w = document.getElementById('welcome'); if (w) w.remove(); });
    const meas = async (tag) => {
      const r = await page.evaluate(() => new Promise((res) => { let n = 0, t0 = performance.now(), worst = 0, last = t0; (function f(t) { n++; worst = Math.max(worst, t - last); last = t; if (t - t0 < 3000) requestAnimationFrame(f); else res({ fps: n * 1000 / (t - t0), worst }); })(t0); }));
      out[tag] = { fps: +r.fps.toFixed(1), worst: Math.round(r.worst) };
    };
    const det = (k) => page.evaluate((a) => a.forEach((x) => { try { window.Details.test(x, 0.4); } catch (e) {} }), k);
    await sleep(1500);
    await meas('день, кадр 1');
    await det(['birds', 'plane', 'butterfly']); await meas('день + 3 детали');
    await page.evaluate(() => document.querySelector('#todSeg [data-tod=night]').click()); await sleep(7500);
    await det(['plane', 'moths', 'winlight']); await meas('ночь, кадр 1 + 3 детали');
    await page.keyboard.press('ArrowRight'); await sleep(2500); await meas('ночь, кадр 2');
  } catch (e) {
    problems.push({ type: 'сбой fps-замера', msg: e.message.slice(0, 300) });
  }
  await page.close();
  return { fps: out, problems };
}

// ---------- сравнение ----------
function readPng(f) { return PNG.sync.read(fs.readFileSync(f)); }
function comparePair(fa, fb, fdiff) {
  const A = readPng(fa), B = readPng(fb);
  if (A.width !== B.width || A.height !== B.height) return { diff: -1, note: `размер ${A.width}×${A.height} → ${B.width}×${B.height}` };
  let n = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, md = 0;
  const w = A.width;
  for (let i = 0, p = 0; i < A.data.length; i += 4, p++) {
    if (A.data[i] !== B.data[i] || A.data[i + 1] !== B.data[i + 1] || A.data[i + 2] !== B.data[i + 2] || A.data[i + 3] !== B.data[i + 3]) {
      n++; const x = p % w, y = (p / w) | 0;
      md = Math.max(md, Math.abs(A.data[i] - B.data[i]), Math.abs(A.data[i + 1] - B.data[i + 1]), Math.abs(A.data[i + 2] - B.data[i + 2]));
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  if (!n) return { diff: 0 };
  const D = new PNG({ width: w, height: A.height });
  pixelmatch(A.data, B.data, D.data, w, A.height, { threshold: 0, alpha: 0.35, diffColor: [255, 0, 60] });
  fs.mkdirSync(path.dirname(fdiff), { recursive: true });
  fs.writeFileSync(fdiff, PNG.sync.write(D));
  return { diff: n, pct: n / (w * A.height) * 100, box: [x0, y0, x1, y1], maxDelta: md };
}

function loadKnown() {
  const f = opt.known || path.join(ROOT, 'tools', 'check_site.known.json');
  if (!fs.existsSync(f)) return [];
  return JSON.parse(fs.readFileSync(f, 'utf8')).known || [];
}
const isKnown = (known, targetId, p) => known.find((k) => (!k.target || k.target === targetId) && (!k.type || k.type === p.type) && (!k.msg || (p.msg || '').includes(k.msg)));

// ---------- прогон одной копии сайта ----------
// Каждая копия сайта снимается в СВОИХ свежих браузерах: если B снимать в браузере, который уже отработал A (и замер fps), память GPU и кэши
// другие, и мелкие детали выходят чуть иначе. Просмотрщик и fps — на GPU; обычные страницы — программная растеризация.
async function launchBrowsers() {
  const chromeArgs = opt.renderer === 'swiftshader' ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu'];
  // Флаги «детерминированного режима» Chrome: все стадии композитора до отрисовки, без асинхронного декодирования картинок (checker imaging),
  // без потоковых анимаций и прокрутки, без тайм-аутов первой отрисовки.
  const common = ['--run-all-compositor-stages-before-draw', '--disable-new-content-rendering-timeout', '--disable-threaded-animation', '--disable-threaded-scrolling', '--disable-checker-imaging', '--disable-image-animation-resync', '--disable-gpu-rasterization', '--hide-scrollbars', '--disable-lcd-text', '--font-render-hinting=none', '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1'];   // DOM (панель, точки-подсказки, страницы) растрируется программно; WebGL-холст просмотрщика — на GPU
  const gl = await puppeteer.launch({ headless: 'new', args: [...chromeArgs, ...common] });
  const sw = await puppeteer.launch({ headless: 'new', args: ['--disable-gpu', ...common] });
  return { gl, sw };
}
async function runSite(label, root, targets, outBase) {
  const browsers = await launchBrowsers();
  const srv = await serve(root);
  const origin = `http://127.0.0.1:${srv.port}`;
  const res = {};
  try {
    for (const t of targets) {
      res[t.id] = { kind: t.kind, shots: {}, problems: [], external: 0, fps: null };
      for (const vpName of vpNames) {
        const dir = path.join(outBase, t.id.replace(/\//g, '__'), vpName);
        fs.mkdirSync(dir, { recursive: true });
        const r = t.kind === 'viewer' ? await captureViewer(browsers.gl, origin, t, vpName, dir) : await capturePage(browsers.sw, origin, t, vpName, dir);
        for (const [k, v] of Object.entries(r.shots)) res[t.id].shots[`${vpName}/${k}`] = v;
        res[t.id].problems.push(...r.problems.map((p) => ({ ...p, vp: vpName })));
        res[t.id].external += r.external;
        log(`${label} · ${t.id} · ${vpName}: ${Object.keys(r.shots).length} снимков` + (r.problems.length ? `, проблем: ${r.problems.length}` : ''));
      }
    }
    if (opt.fps) {
      for (const t of targets.filter((x) => x.kind === 'viewer')) {
        const f = await measureFps(browsers.gl, origin, t);
        res[t.id].fps = f.fps;
        res[t.id].problems.push(...f.problems.map((p) => ({ ...p, vp: 'fps' })));
        log(`${label} · ${t.id} · fps: ` + Object.entries(f.fps).map(([k, v]) => `${k} ${v.fps}`).join(' | '));
      }
    }
  } finally { srv.close(); await browsers.gl.close().catch(() => {}); await browsers.sw.close().catch(() => {}); }
  return res;
}

// ---------- отчёт ----------
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function writeReport(out, R) {
  const rel = (...p) => p.map((x) => encodeURIComponent(x)).join('/');
  const badge = (s) => `<span class="b b-${s}">${{ ok: 'без различий', changed: 'изменения допустимы', fail: 'ПРОВАЛ', new: 'новое', info: 'инфо' }[s] || s}</span>`;
  let h = `<!doctype html><html lang="ru"><meta charset="utf-8"><title>Проверка сайта — ${esc(R.when)}</title><style>
body{font:15px/1.45 -apple-system,Segoe UI,sans-serif;margin:0;background:#f5ecda;color:#2f2a25}main{max-width:1400px;margin:0 auto;padding:24px}
h1{margin:.2em 0}h2{margin:1.6em 0 .4em;border-bottom:2px solid #2f2a25}h3{margin:1em 0 .3em}
.b{display:inline-block;padding:1px 9px;border-radius:9px;font-size:13px;color:#fff}.b-ok{background:#3b7d3b}.b-fail{background:#c0271b}.b-changed{background:#b07a12}.b-new{background:#456}.b-info{background:#789}
table{border-collapse:collapse;margin:.4em 0}td,th{border:1px solid #2f2a2540;padding:3px 9px;text-align:left}
.shot{display:inline-block;vertical-align:top;margin:0 12px 14px 0;background:#fffaf0;border:1px solid #2f2a2540;padding:6px}.shot.bad{border:2px solid #c0271b}
.shot h4{margin:0 0 4px;font-size:13px}.row{display:flex;gap:6px}.row figure{margin:0}.row figcaption{font-size:11px;color:#655}
img{display:block;max-width:100%;height:auto;cursor:pointer}.row img{width:${vpNames.includes('pc') ? 260 : 190}px}.phone img{width:150px}
pre{background:#fffaf0;padding:8px;overflow:auto}.sum{font-size:17px}.hint{color:#655;font-size:13px}
details>summary{cursor:pointer;margin:.5em 0}
</style><main><h1>Проверка сайта ${R.ok ? badge('ok').replace('без различий', 'ЗЕЛЁНАЯ') : badge('fail').replace('ПРОВАЛ', 'КРАСНАЯ')}</h1>
<p class="sum">${esc(R.when)} · «как на сайте»: <b>${esc(R.aLabel)}</b> · кандидат: <b>${esc(R.bLabel)}</b> · снимков ${R.totalShots} · время ${R.seconds} с · ${esc(R.env)}</p>
<p class="hint">Клик по картинке «стало» на секунду показывает «было» (мигание). Красное на третьей картинке — отличающиеся пиксели.</p>`;
  h += `<h2>Итог</h2><table><tr><th>Цель</th><th>Снимков</th><th>Отличаются</th><th>Шум (в допуске)</th><th>Ошибки/404</th><th>fps</th><th>Итог</th></tr>`;
  for (const [id, t] of Object.entries(R.targets)) h += `<tr><td>${esc(id)}</td><td>${t.total}</td><td>${t.changed}</td><td>${t.noise || 0}</td><td>${t.problems.length}</td><td>${t.fpsNote || '—'}</td><td>${badge(t.status)}</td></tr>`;
  h += '</table>';
  if (R.failures.length) h += `<h2>Что не так</h2><ul>${R.failures.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>`;
  for (const [id, t] of Object.entries(R.targets)) {
    h += `<h2>${esc(id)} ${badge(t.status)}</h2>`;
    if (t.problems.length) h += `<h3>Ошибки и 404 (кандидат)</h3><pre>${esc(t.problems.map((p) => `${p.vp}: ${p.type}: ${p.msg}${p.known ? '   [известная: ' + p.known + ']' : ''}`).join('\n'))}</pre>`;
    if (t.fps) { h += `<h3>fps (телефон, процессор ×4)</h3><table><tr><th>сценарий</th><th>было</th><th>стало</th><th></th></tr>` + Object.entries(t.fps).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v.a == null ? '—' : v.a}</td><td>${v.b}</td><td>${v.bad ? badge('fail') : ''}</td></tr>`).join('') + '</table>'; }
    const ch = t.list.filter((s) => s.diff !== 0 && !s.noise), noise = t.list.filter((s) => s.noise), same = t.list.filter((s) => s.diff === 0);
    if (ch.length) {
      h += `<h3>Отличаются: ${ch.length}</h3>`;
      for (const s of ch) {
        h += `<div class="shot ${t.allowed ? '' : 'bad'}"><h4>${esc(s.name)} — ${s.diff < 0 ? esc(s.note) : `${s.diff} пикс. (${s.pct.toFixed(3)}%), где: x ${s.box[0]}–${s.box[2]}, y ${s.box[1]}–${s.box[3]}`}</h4><div class="row">` +
          `<figure><img src="${rel('A', ...s.file)}" loading="lazy"><figcaption>было</figcaption></figure>` +
          `<figure><img class="flip" data-a="${rel('A', ...s.file)}" src="${rel('B', ...s.file)}" data-b="${rel('B', ...s.file)}" loading="lazy"><figcaption>стало</figcaption></figure>` +
          (s.diff > 0 ? `<figure><img src="${rel('diff', ...s.file)}" loading="lazy"><figcaption>разница</figcaption></figure>` : '') + `</div></div>`;
      }
    }
    if (noise.length) h += `<details><summary>Шум растеризации (в допуске: ≤${NOISE_PX} пикс. и разница ≤${NOISE_DELTA} из 255): ${noise.length}</summary><ul>` + noise.map((s) => `<li>${esc(s.name)} — ${s.diff} пикс., макс. разница ${s.maxDelta}</li>`).join('') + '</ul></details>';
    if (same.length) {
      h += `<details><summary>Без различий: ${same.length}</summary>` + same.map((s) => `<div class="shot phone"><h4>${esc(s.name)}</h4><img src="${rel('B', ...s.file)}" loading="lazy"></div>`).join('') + '</details>';
    }
  }
  h += `</main><script>document.querySelectorAll('img.flip').forEach(function(i){i.addEventListener('mousedown',function(){i.src=i.dataset.a});['mouseup','mouseleave'].forEach(function(e){i.addEventListener(e,function(){i.src=i.dataset.b})})})</script></html>`;
  fs.writeFileSync(path.join(out, 'report.html'), h);
}

// ---------- главное ----------
async function main() {
  const known = loadKnown();
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const out = opt.out || path.join(OUT_ROOT, stamp);
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, '.check_site'), '');
  const tmps = [];
  const mk = (n) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), `chka-check-${n}-`)); tmps.push(d); return d; };
  let version;
  try {
    // копии сайта
    let aRoot = null, aLabel, baseManifest = null, aCommit = null;
    if (opt.baseline) {
      const bdir = path.join(BASE_ROOT, opt.baseline);
      if (!fs.existsSync(path.join(bdir, 'manifest.json'))) throw new Error('нет эталона ' + bdir);
      baseManifest = JSON.parse(fs.readFileSync(path.join(bdir, 'manifest.json'), 'utf8'));
      aLabel = `эталон ${opt.baseline} (${baseManifest.ref} ${baseManifest.commit.slice(0, 7)})`;
    } else {
      aRoot = mk('A'); aCommit = extractRef(opt.ref || 'origin/main', aRoot); aLabel = `${opt.ref || 'origin/main'} ${aCommit.slice(0, 7)}`;
    }
    let bRoot, bLabel;
    if (opt.saveBaseline) { bRoot = null; bLabel = '—'; }
    else if (opt.candidate) { bRoot = opt.candidate; bLabel = 'папка ' + bRoot; }
    else if (opt.candidateRef) { bRoot = mk('B'); const c = extractRef(opt.candidateRef, bRoot); bLabel = `${opt.candidateRef} ${c.slice(0, 7)}`; }
    else if (opt.baseline) throw new Error('с --baseline нужен --candidate или --candidate-ref');
    else { bRoot = aRoot; bLabel = aLabel + ' (та же копия, второй независимый прогон)'; }

    log(`A: ${aLabel}`); if (bRoot) log(`B: ${bLabel}`);
    { const tmp = await puppeteer.launch({ headless: 'new' }); version = await tmp.version(); await tmp.close(); }
    const env = `${version}, ${opt.renderer}`;

    const tA = aRoot ? discover(aRoot) : Object.keys(baseManifest.targets).map((id) => ({ id, kind: baseManifest.targets[id].kind })).filter((t) => !opt.only || opt.only.includes(t.id));

    // --- эталон ---
    if (opt.saveBaseline) {
      const bdir = path.join(BASE_ROOT, opt.saveBaseline);
      if (fs.existsSync(bdir)) fs.rmSync(bdir, { recursive: true, force: true });
      fs.mkdirSync(bdir, { recursive: true });
      const resA = await runSite('эталон', aRoot, tA, bdir);
      const manifest = { name: opt.saveBaseline, ref: opt.ref || 'origin/main', commit: aCommit, date: new Date().toISOString(), env, renderer: opt.renderer, viewports: vpNames, tods: todNames, targets: resA };
      fs.writeFileSync(path.join(bdir, 'manifest.json'), JSON.stringify(manifest, null, 1));
      const total = Object.values(resA).reduce((s, t) => s + Object.keys(t.shots).length, 0);
      const bad = Object.values(resA).reduce((s, t) => s + t.problems.length, 0);
      log(`эталон «${opt.saveBaseline}» снят: ${total} снимков → ${bdir}` + (bad ? `; проблем на живом сайте: ${bad}` : ''));
      for (const [id, t] of Object.entries(resA)) for (const p of t.problems) log(`   ${id} ${p.vp}: ${p.type}: ${p.msg}`);
      return 0;
    }
    if (baseManifest && baseManifest.env !== env && !opt.ignoreEnv) throw new Error(`эталон снят в «${baseManifest.env}», сейчас «${env}» — снимки несравнимы. Сними эталон заново (или --ignore-env).`);

    // --- сравнение ---
    const tB = discover(bRoot);
    let resA;
    if (baseManifest) {
      resA = {};
      for (const t of tA) { resA[t.id] = baseManifest.targets[t.id]; }
    } else resA = await runSite('A', aRoot, tA, path.join(out, 'A'));
    const resB = await runSite('B', bRoot, tB, path.join(out, 'B'));
    const aDir = (id, vp, name) => baseManifest ? path.join(BASE_ROOT, opt.baseline, id.replace(/\//g, '__'), vp, name + '.png') : path.join(out, 'A', id.replace(/\//g, '__'), vp, name + '.png');
    if (baseManifest) {   // картинки эталона показываем в отчёте из копии
      for (const t of tA) for (const key of Object.keys(resA[t.id].shots)) { const [vp, name] = key.split('/'); const dst = path.join(out, 'A', t.id.replace(/\//g, '__'), vp, name + '.png'); fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(aDir(t.id, vp, name), dst); }
    }

    const R = { when: new Date().toLocaleString('ru-RU'), aLabel, bLabel, env, targets: {}, failures: [], totalShots: 0, ok: true, seconds: 0, out };
    const fail = (m) => { R.failures.push(m); R.ok = false; };
    const ids = [...new Set([...Object.keys(resA), ...Object.keys(resB)])];
    for (const id of ids) {
      const a = resA[id], b = resB[id];
      const allowed = opt.allow.some((x) => id === x || id.startsWith(x + '/'));
      const T = { list: [], total: 0, changed: 0, problems: [], allowed, status: 'ok', fps: null };
      R.targets[id] = T;
      if (!b) { T.status = allowed ? 'changed' : 'fail'; if (!allowed) fail(`${id}: есть на сайте, но пропала у кандидата`); continue; }
      if (!a) { T.status = 'new'; }
      const keys = [...new Set([...Object.keys(a ? a.shots : {}), ...Object.keys(b.shots)])].sort();
      for (const key of keys) {
        const [vp, name] = key.split('/');
        const file = [id.replace(/\//g, '__'), vp, name + '.png'];
        const item = { name: key, file };
        if (!a) { item.diff = 0; }
        else if (!a.shots[key]) { item.diff = -1; item.note = 'нового снимка не было раньше'; }
        else if (!b.shots[key]) { item.diff = -1; item.note = 'снимок пропал у кандидата'; }
        else if (a.shots[key].sha === b.shots[key].sha) item.diff = 0;
        else Object.assign(item, comparePair(aDir(id, vp, name), path.join(out, 'B', ...file), path.join(out, 'diff', ...file)));
        if (isNoise(item.diff, item.maxDelta)) { item.noise = true; T.noise = (T.noise || 0) + 1; }
        T.list.push(item); T.total++; if (item.diff === 0) R.exact = (R.exact || 0) + 1;
        if (item.diff !== 0 && !item.noise) T.changed++;
      }
      R.totalShots += T.total;
      if (a && T.changed) { if (allowed) T.status = 'changed'; else { T.status = 'fail'; fail(`${id}: отличаются ${T.changed} из ${T.total} снимков (${T.list.filter((s) => s.diff !== 0).slice(0, 4).map((s) => s.name).join(', ')}${T.changed > 4 ? '…' : ''})`); } }
      // ошибки и 404
      for (const p of b.problems) {
        const k = isKnown(known, id, p);
        T.problems.push({ ...p, known: k ? k.reason || 'да' : null });
        if (!k) { T.status = 'fail'; fail(`${id} (${p.vp}): ${p.type}: ${p.msg}`); }
      }
      // fps
      if (b.fps) {
        T.fps = {}; const notes = [];
        for (const [k, v] of Object.entries(b.fps)) {
          const av = a && a.fps && a.fps[k] ? a.fps[k].fps : null;
          const bad = v.fps < FPS_MIN || (av != null && v.fps < av * (1 - FPS_DROP));
          T.fps[k] = { a: av, b: v.fps, bad };
          notes.push(`${v.fps}`);
          if (bad) { T.status = 'fail'; fail(`${id}: fps «${k}» ${v.fps}` + (av != null ? ` (было ${av})` : '') + ` — ниже порога ${FPS_MIN} или хуже прежнего больше чем на ${FPS_DROP * 100}%`); }
        }
        T.fpsNote = notes.join(' / ');
      }
    }
    R.seconds = Math.round((Date.now() - T0) / 1000);
    writeReport(out, R);
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ ok: R.ok, failures: R.failures, aLabel, bLabel, env, totalShots: R.totalShots, seconds: R.seconds, targets: Object.fromEntries(Object.entries(R.targets).map(([k, v]) => [k, { status: v.status, total: v.total, changed: v.changed, problems: v.problems.length }])) }, null, 1));
    log(R.ok ? 'ЗЕЛЁНАЯ' : 'КРАСНАЯ');
    for (const [id, t] of Object.entries(R.targets)) log(`  ${id.padEnd(22)} ${t.status.padEnd(8)} снимков ${t.total}, отличаются ${t.changed}${t.noise ? ` (+${t.noise} в допуске шума)` : ''}, проблем ${t.problems.length}${t.fpsNote ? ', fps ' + t.fpsNote : ''}`);
    for (const f of R.failures) log('  ✗ ' + f);
    log(`снимков ${R.totalShots}, из них побайтно совпали ${R.exact || 0}, в допуске шума ${Object.values(R.targets).reduce((n, t) => n + (t.noise || 0), 0)}, время ${R.seconds} с`);
    log('отчёт: file://' + encodeURI(path.join(out, 'report.html')));
    // старые прогоны убираем (только созданные этой проверкой)
    if (!opt.out && fs.existsSync(OUT_ROOT)) {
      const runs = fs.readdirSync(OUT_ROOT).map((n) => path.join(OUT_ROOT, n)).filter((d) => fs.existsSync(path.join(d, '.check_site'))).sort();
      for (const d of runs.slice(0, Math.max(0, runs.length - KEEP_RUNS))) fs.rmSync(d, { recursive: true, force: true });
    }
    return R.ok ? 0 : 1;
  } finally {
    for (const d of tmps) fs.rmSync(d, { recursive: true, force: true });
  }
}

main().then((c) => process.exit(c), (e) => { console.error('ПРОВЕРКА НЕ СМОГЛА ОТРАБОТАТЬ:', e.message); process.exit(2); });
