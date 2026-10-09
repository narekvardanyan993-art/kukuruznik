#!/usr/bin/env node
// Защитная проверка сайта перед публикацией (docs/ENGINE-PLAN.md, п.7).
//
// Берёт две копии сайта — «как сейчас» (origin/main, распакованный во временную папку вне репозитория)
// и «кандидат» — и сравнивает их снимки:
//   • каждое здание с просмотрщиком (kukuruznik/, beta/, beta/<имя>/, любая папка с index.html, где есть id="stage"):
//     каждый кадр × день/закат/ночь × телефон 390×844 и ПК 1440×900, плюс парад и «живые детали» (принудительно);
//   • прогулка по кликам (телефон и ПК): заставка уходит (≤15 с) и все кадры загружаются (≤45 с) — две отдельные метрики, панель открывается/закрывается, карточка точки-подсказки,
//     языки hy/ru/en, кнопка парада (на кадре 2 не срабатывает, на кадре 1 — парад), сохранение открытки (сама картинка);
//   • страницы: главная, about.html и history.html каждого здания (вверху и целиком);
//   • СТРОГОЕ попиксельное сравнение: любой отличающийся пиксель — различие. Два исключения, оба с объяснением в отчёте:
//       – ПК, области панели и миниатюр (их рамки записываются в каждый снимок): шум растеризации Chrome на краях кнопок и
//         миниатюр, до NOISE_PX пикселей с разницей до NOISE_DELTA из 255 — в допуске; вне этих областей — ноль;
//       – обычные страницы Chrome рисует при каждой загрузке в одном из нескольких устойчивых вариантов (углы картинок со скруглением);
//         поэтому «как на сайте» снимается 3 раза, а снимок кандидата должен ПОБАЙТНО совпасть с одним из этих вариантов
//         (кандидат при несовпадении переснимается до 5 раз). Допуска по пикселям на страницах нет;
//   • fps (эмуляция телефона, процессор ×4, реальный GPU): день, день+детали, ночь+детали, ночь кадр 2;
//   • ошибки в консоли и файлы, которые не загрузились (404 и любые ≥400).
//   • шапка каждой страницы в сыром HTML (так её видят соцсети): заголовок, описание, превью og:/twitter:, canonical, robots, значки —
//     строго без изменений (прочие теги шапки только показываются в отчёте); картинка превью должна лежать на сайте.
// Время подменено (requestAnimationFrame/performance.now крутит сам скрипт), случайность зафиксирована — снимки
// воспроизводимы кадр в кадр. Логика и картинки сайта не меняются: проверка только читает.
//
// Использование:
//   node tools/check_site.mjs                                      # сайт против самого себя (origin/main × 2)
//   node tools/check_site.mjs --candidate DIR [--allow-change beta]   # DIR — корень сайта-кандидата
//   node tools/check_site.mjs --candidate-ref REF                   # кандидат = git-ref (тег, ветка)
//   node tools/check_site.mjs --save-baseline v12.1 [--ref TAG]     # снять эталон (в ~/Documents/chka-kitchen/_эталоны/)
//   node tools/check_site.mjs --baseline v12.1 --candidate DIR      # сравнивать не с живым сайтом, а с эталоном
//   параметры: --only id,id  --viewports phone,pc  --tods day,night  --frames 0,1  --no-fps  --no-walk  --out DIR  --renderer metal|swiftshader
//   --compare-as B=A[,B=A]  — цель кандидата B сравнивать с целью A живого сайта (например beta/kukuruznik=kukuruznik:
//                           бета-Кукурузник должен совпасть с живым). Такая пара строгая, даже если B попадает под --allow-change,
//                           кроме случая, когда B указан в --allow-change дословно;
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
// Допуск на шум растеризации Chrome — ТОЛЬКО внутри областей панели и миниатюр на ПК (рамки записываются в снимок в момент съёмки).
// Измерено по повторным прогонам одного и того же сайта: шум там до 109 пикселей с разницей до 48 из 255. Вне этих областей — строгий ноль.
const NOISE_PX = 200, NOISE_DELTA = 60, REGION_PAD = 6;
const WELCOME_MAX_S = 15;   // заставка (приветствие) должна уйти — это видит человек
const LOADED_MAX_S = 45;    // все кадры загружены — идёт в фоне; Кукурузнику (5 кадров) нужно ~20 с, на медленном Mac — ~31 с
const PAGE_ATTEMPTS_A = 3, PAGE_ATTEMPTS_B = 5;
const VIEWER_RETRIES_B = 2;   // просмотрщик кандидата: если снимок вне областей допуска не совпал — переснять весь проход ещё до 2 раз (Chrome изредка по-другому растрирует мелкие детали, например край точки-подсказки)   // обычные страницы: сколько раз снимать «как на сайте» (варианты Chrome) и сколько раз переснимать кандидата
const VIEWPORTS = { phone: { width: 390, height: 844 }, pc: { width: 1440, height: 900 } };
const TODS = ['day', 'sunset', 'night'];
const WALK_LANGS = ['hy', 'ru', 'en'];
const EVENTS = { day: ['birds', 'plane', 'cranes'], sunset: ['birds', 'cranes'], night: ['plane', 'moths'] };  // «живые детали», показываем принудительно
const SKIP_DIRS = new Set(['assets', 'docs', 'tools', 'node_modules', 'src', 'engine3d', 'test-assets', 'fonts', 'frames']);

// ---------- аргументы ----------
const argv = process.argv.slice(2);
const opt = { renderer: 'metal', fps: true, walk: true, structure: true };
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
  else if (a === '--no-walk') opt.walk = false;
  else if (a === '--no-structure') opt.structure = false;
  else if (a === '--compare-as') opt.pairs = (opt.pairs || []).concat(val().split(',').filter(Boolean).map((x) => { const [b, a] = x.split('='); if (!a || !b) { console.error('--compare-as: нужно B=A'); process.exit(2); } return { b, a }; }));
  else if (a === '--out') opt.out = path.resolve(val());
  else if (a === '--renderer') opt.renderer = val();
  else if (a === '--known') opt.known = path.resolve(val());
  else if (a === '--ignore-env') opt.ignoreEnv = true;
  else if (a === '-h' || a === '--help') { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 43).map((l) => l.replace(/^\/\/ ?/, '')).join('\n')); process.exit(0); }
  else { console.error('неизвестный параметр', a); process.exit(2); }
}
opt.allow = opt.allow || [];
opt.pairs = opt.pairs || [];
const pairFor = (bId) => opt.pairs.find((p) => p.b === bId);
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
  const walkBeta = (dir, depth) => {   // beta/<здание>, beta/tests/<здание>, beta/tests/local/<здание>: любая папка с просмотрщиком
    for (const x of fs.readdirSync(path.join(root, dir), { withFileTypes: true }).filter((e) => e.isDirectory() && !SKIP_DIRS.has(e.name) && e.name !== 'engine').map((e) => e.name).sort()) {
      addDir(`${dir}/${x}`);
      if (depth < 3) walkBeta(`${dir}/${x}`, depth + 1);
    }
  };
  for (const d of dirs) {
    addDir(d);
    if (d === 'beta') walkBeta(d, 1);
  }
  return targets.filter((t) => !opt.only || opt.only.some((o) => t.id === o || t.id.startsWith(o + '/') || opt.pairs.some((p) => p.b === t.id && (p.a === o || p.a.startsWith(o + '/')))));
}

// ---------- шапка страницы как её видят соцсети (сырой HTML, без JS): заголовок, описание, превью og:/twitter:, canonical, значки ----------
// Превью в TikTok/Telegram/Facebook строится из сырого HTML — поэтому сравнивается файл, а не DOM после скриптов.
// Строго сравниваются ключи из HEAD_STRICT (и все og:*, twitter:*); остальные теги шапки — только показываются в отчёте, если изменились.
const HEAD_STRICT = ['lang', 'title', 'meta:description', 'meta:robots', 'meta:googlebot', 'meta:theme-color', 'meta:viewport', 'meta:viewer-version', 'link:canonical', 'link:icon', 'link:apple-touch-icon'];
const headStrict = (k) => HEAD_STRICT.includes(k) || /^meta:(og|twitter):/.test(k);
function readHead(root, t) {
  const f = path.join(root, t.url.replace(/\/$/, '/index.html'));
  if (!fs.existsSync(f)) return null;
  const html = fs.readFileSync(f, 'utf8'), end = html.search(/<\/head>/i);
  const head = (end < 0 ? html : html.slice(0, end)).replace(/<!--[\s\S]*?-->/g, '');
  const attr = (tag, n) => { const m = tag.match(new RegExp(`\\s${n}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i')); return m ? (m[2] ?? m[3]) : null; };
  const out = {}, add = (k, v) => { out[k] = k in out ? out[k] + ' | ' + v : v; };
  const lang = html.match(/<html[^>]*>/i); if (lang) add('lang', attr(lang[0], 'lang') || '');
  const title = head.match(/<title>([\s\S]*?)<\/title>/i); if (title) add('title', title[1].trim());
  for (const m of head.matchAll(/<meta\b[^>]*>/gi)) { const k = attr(m[0], 'name') || attr(m[0], 'property'); if (k) add('meta:' + k, attr(m[0], 'content') || ''); }
  for (const m of head.matchAll(/<link\b[^>]*>/gi)) { const k = attr(m[0], 'rel'); if (k && k !== 'preload' && k !== 'stylesheet') add('link:' + k, attr(m[0], 'href') || ''); }
  return out;
}
// картинка превью (og:image / twitter:image) должна лежать на сайте: https://chka.am/<путь> -> файл в корне копии сайта
function checkPreviewImages(root, head) {
  const bad = [];
  for (const k of ['meta:og:image', 'meta:twitter:image']) {
    const u = head && head[k]; if (!u) continue;
    const m = u.match(/^https:\/\/chka\.am\/(.*)$/);
    if (!m || !fs.existsSync(path.join(root, decodeURIComponent(m[1])))) bad.push({ type: 'превью', msg: `${k} → ${u}: файла нет на сайте` });
  }
  return bad;
}

// ---------- страница с подменённым временем ----------
const INIT_SCRIPT = () => {
  let vt = 10000, q = [];
  window.__mvFreeze = true;   // e1.14: видео синемаграфа стоит на первом кадре — снимки повторяемы
  performance.now = () => vt;
  window.requestAnimationFrame = (cb) => { q.push(cb); return q.length; };
  window.cancelAnimationFrame = () => {};
  window.__advance = (ms) => { const n = Math.ceil(ms / 16); for (let i = 0; i < n; i++) { vt += 16; const c = q; q = []; c.forEach((cb) => cb(vt)); } };
  let s = 12345;
  window.__seed = (n) => { s = n | 0; };
  Math.random = () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  // открытка: картинку, которую страница отдаёт на скачивание, запоминаем для сравнения; сам файл не скачивается
  const oc = URL.createObjectURL;
  URL.createObjectURL = function (b) { try { if (b instanceof Blob && /^image\//.test(b.type)) window.__lastImageBlob = b; } catch (e) {} return oc.apply(this, arguments); };
  const ac = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { if (this.download && /^blob:/.test(this.href)) { window.__download = { name: this.download }; return; } return ac.apply(this, arguments); };
  const st = document.createElement('style');
  st.textContent = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}.p-build,#build-version{visibility:hidden!important}';
  if (!window.__keepAnimations) document.addEventListener('DOMContentLoaded', () => document.head.appendChild(st));
  window.__freezeAnimations = () => { if (!st.isConnected) document.head.appendChild(st); };
};
// Перед каждым снимком: (1) раскладка и шрифты — после смены языка нужные шрифты подгружаются в фоне по реальному времени,
// и снимок попадал то до, то после (строки сдвигаются на доли пикселя); (2) стена из букв на ПК перестраивается по РЕАЛЬНОМУ таймеру
// (0.3–1 с после смены классов/размеров, wall.js) — перестраиваем её сейчас тем же кодом (window.__wallRelayout), если она уже показана.
// Обе копии сайта снимаются одинаково; сравнение не ослабляется.
const settleDom = (page) => page.evaluate(async () => {
  const wait = (pr, ms) => Promise.race([pr, new Promise((r) => setTimeout(r, ms))]);   // не зависнуть, если шрифт так и не догрузился
  void document.body.offsetHeight;
  if (document.fonts) { await wait(document.fonts.ready, 3000); for (let i = 0; i < 40 && document.fonts.status !== 'loaded'; i++) await new Promise((r) => setTimeout(r, 50)); }
  const w = document.getElementById('wall');
  if (window.__wallRelayout && w && w.classList.contains('on')) window.__wallRelayout();
});
const hashSeed = (s) => { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

async function newPage(browser, origin, vp, { virtual = true, mobile = false, dsf = 1, keepAnimations = false } = {}) {
  const ctx = await browser.createBrowserContext();   // своя сессия: язык, свёрнутая панель и т.п. не переходят из снимка в снимок
  const page = await ctx.newPage();
  const problems = [];
  let external = 0;
  const isLocal = (u) => u.startsWith(origin) || u.startsWith('data:') || u.startsWith('blob:') || u.startsWith('about:');
  page.on('pageerror', (e) => problems.push({ type: 'ошибка страницы', msg: String(e.message).slice(0, 300) }));
  page.on('console', (m) => { if (m.type() === 'error') { const u = (m.location() || {}).url || ''; if (!u || isLocal(u)) problems.push({ type: 'console.error', msg: m.text().slice(0, 300), url: u.replace(origin, '') }); } });
  page.on('response', (r) => { if (r.status() >= 400 && isLocal(r.url())) problems.push({ type: 'HTTP ' + r.status(), msg: r.url().replace(origin, '') }); });
  page.on('requestfailed', (r) => { if (!isLocal(r.url())) { external++; return; }   // внешние адреса (шрифты Google и т.п.) браузер не резолвит (см. --host-resolver-rules): без них снимки не зависят от сети
    if (!/ERR_ABORTED/.test((r.failure() || {}).errorText || '')) problems.push({ type: 'не загрузился', msg: r.url().replace(origin, '') + ' ' + ((r.failure() || {}).errorText || '') }); });
  await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: dsf, isMobile: mobile, hasTouch: mobile });
  if (keepAnimations) await page.evaluateOnNewDocument(() => { window.__keepAnimations = true; });
  if (virtual) await page.evaluateOnNewDocument(INIT_SCRIPT);
  return { page, problems, get external() { return external; }, close: () => ctx.close().catch(() => {}) };
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
// Рамки областей, где допускается шум растеризации (только ПК): панель и миниатюры, с запасом REGION_PAD под тень/обводку.
const noiseRegions = (page, vpName) => vpName !== 'pc' ? Promise.resolve([]) : page.evaluate((pad) => {
  const out = [], W = innerWidth, H = innerHeight;
  const add = (sel, label) => {
    const e = document.querySelector(sel); if (!e) return;
    const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden') return;
    const r = e.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return;
    const box = [Math.max(0, Math.floor(r.left) - pad), Math.max(0, Math.floor(r.top) - pad), Math.min(W - 1, Math.ceil(r.right) + pad), Math.min(H - 1, Math.ceil(r.bottom) + pad)];
    if (box[2] > box[0] && box[3] > box[1]) out.push({ label, box });
  };
  add('#panel', 'панель'); add('#thumbs', 'миниатюры');
  return out;
}, REGION_PAD);
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
    for (let k = 0; k < 50 && (await page.evaluate(() => !!(window.__viewer && window.__viewer.mvBusy && window.__viewer.mvBusy()))); k++) { await sleep(100); await adv(16); }   // e1.14: видео синемаграфа текущего кадра уже в текстуре
    await settleDom(page); await gpuDone(); await sleep(60);
    const regions = await noiseRegions(page, vpName);
    const buf = await page.screenshot({ type: 'png' });
    fs.writeFileSync(path.join(outDir, name + '.png'), buf);
    shots[name] = { sha: shotSha(buf), bytes: buf.length, regions };
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
        if (tod === 'night') {   // e1.13: кадры перехода в ночь (закат → ночь) — регрессия «комиксной» ночи видна именно в переходе
          for (const ms of [700, 1400, 2100, 2800]) { await adv(700); await snap(`night-trans-${ms}`); }
          await adv(1400);
        } else await adv(3400);
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
    if (todNames.includes('day') && todNames.includes('night')) {   // e1.13: переход день → ночь на первом кадре
      await goto_(frames[0]);
      await seed('d2n'); await page.evaluate(() => document.querySelector('#todSeg [data-tod=day]').click()); await adv(4500);
      await page.evaluate(() => document.querySelector('#todSeg [data-tod=night]').click());
      for (const ms of [500, 1000, 1500, 2000, 3000, 4500]) { await adv(ms === 3000 ? 1000 : ms === 4500 ? 1500 : 500); await snap(`day2night-${ms}`); }
    }
  } catch (e) {
    problems.push({ type: 'сбой проверки', msg: e.message.slice(0, 300) });
  }
  const ext = P.external;
  await P.close();
  return { shots, problems, external: ext };
}

// ---------- прогулка по кликам ----------
// Приветствие идёт по реальным таймерам (минимум 3 с + дорисовка буквы): ждём, пока оно само уйдёт, и только потом
// замораживаем CSS-анимации и снимаем. Дальше всё — клики мышью/пальцем, как у зрителя.
async function captureWalk(browser, origin, target, vpName, outDir) {
  const vp = VIEWPORTS[vpName], phone = vpName === 'phone';
  const P = await newPage(browser, origin, vp, { mobile: phone, keepAnimations: true });
  const { page, problems } = P;
  const shots = {};
  const adv = (ms) => page.evaluate((m) => window.__advance(m), ms);
  const seed = (s) => page.evaluate((v) => window.__seed(v), hashSeed(`${target.id}|walk|${vpName}|${s}`));
  const gpuDone = () => page.evaluate(() => { const c = document.getElementById('gl'); const g = c && (c.getContext('webgl') || c.getContext('experimental-webgl')); if (g) { g.finish(); const px = new Uint8Array(4); g.readPixels(0, 0, 1, 1, g.RGBA, g.UNSIGNED_BYTE, px); } });
  const snap = async (name) => {
    await seed('snap-' + name); await adv(700); for (let k = 0; k < 50 && (await page.evaluate(() => !!(window.__viewer && window.__viewer.mvBusy && window.__viewer.mvBusy()))); k++) { await sleep(100); await adv(16); } await settleDom(page); await gpuDone(); await sleep(60);
    const regions = await noiseRegions(page, vpName);
    const buf = await page.screenshot({ type: 'png' });
    fs.writeFileSync(path.join(outDir, name + '.png'), buf);
    shots[name] = { sha: shotSha(buf), bytes: buf.length, regions };
  };
  const click = async (sel) => { await page.waitForSelector(sel, { visible: true, timeout: 5000 }); await page.click(sel); await adv(900); if (!(await page.$('#stage'))) throw new Error('после нажатия на ' + sel + ' открылась другая страница: ' + page.url()); };
  const openSheet = async () => { if (phone && !(await page.evaluate(() => document.body.classList.contains('sheet-open')))) await click('#panelBtn'); };
  // шторку закрывает нажатие на затемнение ВЫШЕ шторки (в центре экрана лежит сама шторка — нажатие попало бы в её кнопки)
  const closeSheet = async () => { if (phone && (await page.evaluate(() => document.body.classList.contains('sheet-open')))) { await page.mouse.click(vp.width / 2, 40); await adv(900); } };
  const goFrame = async (f) => {
    for (let g = 0; g < 12 && (await page.evaluate(() => window.__viewer.frame())) !== f; g++) {
      await page.keyboard.press('ArrowRight');
      for (let k = 0; k < 60; k++) { await adv(100); if (!(await page.evaluate(() => window.__viewer.fading()))) break; }
    }
    await adv(900);
  };
  try {
    const t0 = Date.now();
    await page.goto(origin + target.url, { waitUntil: 'load', timeout: 60000 });
    // две разные метрики: «заставка ушла» (то, что видит человек) и «все кадры загружены» (фон; у Кукурузника 5 кадров — ~20 с)
    let goneMs = null, loadedMs = null;
    for (let i = 0; i < LOADED_MAX_S * 4; i++) {
      const st = await page.evaluate(() => { const w = document.getElementById('welcome'); return { gone: !w || w.hidden, loaded: document.documentElement.getAttribute('data-loaded') === 'all' && !!window.Details }; });
      if (st.gone && goneMs == null) goneMs = Date.now() - t0;
      if (st.loaded && loadedMs == null) loadedMs = Date.now() - t0;
      if (goneMs != null && loadedMs != null) break;
      if (goneMs == null && Date.now() - t0 > WELCOME_MAX_S * 1000) break;
      await sleep(250);
    }
    if (goneMs == null) throw new Error(`заставка не ушла за ${WELCOME_MAX_S} с`);
    if (loadedMs == null) throw new Error(`кадры не загрузились за ${LOADED_MAX_S} с (заставка ушла за ${(goneMs / 1000).toFixed(1)} с)`);
    const welcomeMs = { gone: goneMs, loaded: loadedMs };
    await page.evaluate(() => window.__freezeAnimations());
    await page.evaluate(() => document.fonts && document.fonts.ready);
    await sleep(phone ? 600 : 3000);   // демо-наклон после приветствия (таймер 250 мс); на ПК — стена из букв и «перо» панели
    await settleImages(page);
    await seed('after-welcome'); await adv(3000);   // демо-наклон (1.5 с) проходит и возвращается
    await snap('walk-1-after-welcome');
    // панель: телефон — шторка, ПК — свернуть/развернуть
    if (phone) { await click('#panelBtn'); await snap('walk-2-sheet-open'); await closeSheet(); await snap('walk-3-sheet-closed'); }
    else { await click('#panelBtn'); await snap('walk-2-panel-collapsed'); await click('#panelBtn'); await snap('walk-3-panel-open'); }
    // карточка точки-подсказки
    const dot = await page.$('.hs-dot.show, .hs-ring.show');   // e1.13: точки «обводка» = .hs-ring
    if (dot) {
      await dot.click(); await adv(900); await snap('walk-4-hint-open');
      await click('#hsBack'); await snap('walk-5-hint-closed');
    } else problems.push({ type: 'прогулка', msg: 'нет точки-подсказки на первом кадре' });
    // языки
    for (const l of WALK_LANGS) {
      await openSheet();
      await click(`#langSeg [data-lang=${l}]`);
      if (phone && l === 'hy') await snap('walk-6-lang-hy-sheet');
      await closeSheet();
      await snap(`walk-7-lang-${l}`);
    }
    // парад: на другом кадре кнопка погашена и не срабатывает; на кадре парада (PARADE_FRAME из настроек здания; у старых страниц — первый) — парад
    const flag = phone ? '#flagBtnB' : '#flagBtnP';
    const pf = await page.evaluate(() => (window.CONFIG && CONFIG.PARADE_FRAME != null) ? CONFIG.PARADE_FRAME : 0);
    const nFr = await page.evaluate(() => document.querySelectorAll('#dots span').length);
    // e1.3: парад может быть на нескольких кадрах (PARADE_STYLES); «погашенную» кнопку проверяем на кадре без парада, если такой есть
    const ps = await page.evaluate((n) => (window.CONFIG && CONFIG.PARADE_STYLES) || null, nFr);
    const offFr = ps ? ps.findIndex((x) => !x) : (pf + 1) % nFr;
    if (pf >= 0) {
    if (offFr >= 0) {
    await goFrame(offFr);
    await page.evaluate((s) => document.querySelector(s).click(), flag);   // кнопка погашена (pointer-events: none) — нажимаем программно: ничего не должно начаться
    await adv(2000);
    if (await page.evaluate(() => window.Details && window.Details.paradeBusy && window.Details.paradeBusy())) problems.push({ type: 'прогулка', msg: 'парад начался не на своём кадре' });
    await snap('walk-8-flag-off-frame2');
    }
    await goFrame(pf);
    await seed('parade'); await click(flag); await adv(4300); await snap('walk-9-parade');
    await adv(16000);
    } else if (await page.evaluate((s) => { const b = document.querySelector(s); return b && !b.hidden; }, flag)) problems.push({ type: 'прогулка', msg: 'у здания нет парада, а кнопка видна' });
    // открытка
    await openSheet();
    await page.evaluate(() => { window.__lastImageBlob = null; window.__download = null; });
    await click('#cardBtn');
    let got = null;
    for (let i = 0; i < 100 && !got; i++) { await sleep(200);   // картинка ~1000×1750 кодируется в PNG в фоне — бывает дольше 6 с
      got = await page.evaluate(() => window.__lastImageBlob && window.__download ? true : null); }
    if (!got) problems.push({ type: 'прогулка', msg: 'открытка не сохранилась (нет картинки за 20 с): ' + JSON.stringify(await page.evaluate(() => ({ blob: !!window.__lastImageBlob, dl: window.__download, btn: (() => { const b = document.getElementById('cardBtn'); return b ? { hidden: b.hidden, r: b.getBoundingClientRect().toJSON() } : null; })() }))) });
    else {
      const r = await page.evaluate(() => new Promise((res) => { const fr = new FileReader(); fr.onload = () => res({ b64: String(fr.result).split(',')[1], name: window.__download.name }); fr.readAsDataURL(window.__lastImageBlob); }));
      const buf = Buffer.from(r.b64, 'base64');
      fs.writeFileSync(path.join(outDir, 'walk-10-postcard.png'), buf);
      shots['walk-10-postcard'] = { sha: shotSha(PNG.sync.read(buf).data), bytes: buf.length, regions: [], file: r.name };
    }
    await closeSheet();
    shots._welcomeMs = welcomeMs;
  } catch (e) {
    problems.push({ type: 'сбой прогулки', msg: e.message.slice(0, 300) });
  }
  const ms = shots._welcomeMs; delete shots._welcomeMs;
  const ext = P.external;
  await P.close();
  return { shots, problems, external: ext, welcomeMs: ms };
}

// ---------- проверка структуры здания (настройки == то, что на странице) ----------
// Для КАЖДОГО просмотрщика: точки-подсказки на каждом кадре = числу в настройках; кнопка парада только на своём кадре (нет парада — нет кнопки);
// кадр без закатной/ночной картинки закатом и ночью не ломается и не пустой; у тестовых зданий (…/tests/…) нигде — ни в тексте, ни в подписях,
// ни на одном языке — нет слов «Кукурузник / Կուկուռուզնիկ / Kukuruznik». Ссылки и адреса файлов (kukuruznik/frames/…) не считаются — это не текст.
const FORBIDDEN = /кукуруз|kukuruz|կուկուռ/i;
async function checkStructure(browser, origin, target) {
  const P = await newPage(browser, origin, VIEWPORTS.phone, { mobile: true });
  const { page, problems } = P;
  const bad = (msg) => problems.push({ type: 'структура', msg, vp: 'structure' });
  const adv = (ms) => page.evaluate((m) => window.__advance(m), ms);
  const info = { frames: 0, dots: [], parade: [], texts: 0 };
  try {
    await page.goto(origin + target.url, { waitUntil: 'load', timeout: 60000 });
    await waitViewerLoaded(page, target.id);
    await page.evaluate(() => { const w = document.getElementById('welcome'); if (w) w.remove(); });
    await page.evaluate(() => document.fonts && document.fonts.ready);
    await adv(3000);
    const cfg = await page.evaluate(() => ({ hs: CONFIG.HOTSPOTS.map((h) => h.length), pf: CONFIG.PARADE_FRAME, ps: CONFIG.PARADE_STYLES || null, langs: CONFIG.LANGS, night: CONFIG.FRAMES.map((f) => !!f.night), sunset: CONFIG.FRAMES.map((f) => !!f.sunset), n: CONFIG.FRAMES.length }));
    info.frames = cfg.n;
    const goFrame = async (f) => {
      for (let g = 0; g < 12 && (await page.evaluate(() => window.__viewer.frame())) !== f; g++) {
        await page.keyboard.press('ArrowRight');
        for (let k = 0; k < 60; k++) { await adv(100); if (!(await page.evaluate(() => window.__viewer.fading()))) break; }
      }
      await adv(900);
    };
    const nDots = await page.evaluate(() => document.querySelectorAll('#dots span').length);
    if (nDots !== cfg.n) bad(`точек-индикаторов кадров ${nDots}, а кадров в настройках ${cfg.n}`);
    // точки-подсказки и кнопка парада по кадрам
    for (let i = 0; i < cfg.n; i++) {
      await goFrame(i);
      const st = await page.evaluate(() => ({
        shown: document.querySelectorAll('#hotspots .hs-dot.show, #hotspots .hs-ring.show').length, total: document.querySelectorAll('#hotspots .hs-dot, #hotspots .hs-ring').length,
        flags: ['flagBtnB', 'flagBtnP'].map((id) => { const b = document.getElementById(id); return b ? { hidden: b.hidden, off: b.classList.contains('off-frame') } : null; }) }));
      info.dots.push(st.shown);
      if (st.shown !== cfg.hs[i] || st.total !== cfg.hs[i]) bad(`кадр ${i + 1}: точек-подсказок на странице ${st.shown} (всего в разметке ${st.total}), в настройках ${cfg.hs[i]}`);
      const onFrame = cfg.ps ? !!cfg.ps[i] : cfg.pf === i;
      for (const [k, fl] of st.flags.entries()) {
        const nm = k === 0 ? '#flagBtnB' : '#flagBtnP';
        if (!fl) { bad(`нет кнопки парада ${nm} в разметке`); continue; }
        if (cfg.pf < 0 && !fl.hidden) bad(`кадр ${i + 1}: у здания нет парада, а кнопка ${nm} есть`);
        if (cfg.pf >= 0 && fl.hidden) bad(`кадр ${i + 1}: у здания есть парад, а кнопка ${nm} скрыта совсем`);
        if (cfg.pf >= 0 && !fl.hidden && (fl.off === onFrame)) bad(`кадр ${i + 1}: кнопка парада ${nm} ${onFrame ? 'погашена на кадре парада' : 'горит не на кадре парада'}`);
      }
      info.parade.push(cfg.pf < 0 ? 'нет' : (onFrame ? 'горит' : 'погашена'));
    }
    // запретные слова у тестовых зданий (все языки): текст страницы, подписи, заголовок, мета, тексты из настроек
    if (/\/tests\//.test(target.url)) {
      for (const l of cfg.langs) {
        await page.evaluate((lg) => document.querySelector('#langSeg [data-lang=' + lg + ']').click(), l);
        await adv(300);
        const found = await page.evaluate((src) => {
          const re = new RegExp(src, 'i'), out = [];
          const chk = (t, where) => { if (t && re.test(t)) out.push(where + ': ' + String(t).trim().slice(0, 80)); };
          chk(document.title, 'title');
          const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          while (w.nextNode()) { const p = w.currentNode.parentElement; if (p && !/^(SCRIPT|STYLE)$/.test(p.tagName)) chk(w.currentNode.nodeValue, 'текст'); }
          document.querySelectorAll('[aria-label],[title],[alt],[placeholder]').forEach((e) => ['aria-label', 'title', 'alt', 'placeholder'].forEach((a) => chk(e.getAttribute(a), a)));
          document.querySelectorAll('meta[content]').forEach((m) => chk(m.getAttribute('content'), 'meta ' + (m.getAttribute('name') || m.getAttribute('property'))));
          const walk = (o, path) => { if (typeof o === 'string') chk(o, path); else if (o && typeof o === 'object') for (const k in o) walk(o[k], path + '.' + k); };
          walk({ I18N: CONFIG.I18N, UI_I18N: CONFIG.UI_I18N }, 'CONFIG');
          return out;
        }, FORBIDDEN.source);
        info.texts++;
        for (const f of found) bad(`язык ${l}: найдено слово, привязанное к другому зданию — ${f}`);
      }
    }
    // закат и ночь у кадров без своей картинки: не ломаются и не пустые
    await page.evaluate((l) => document.querySelector('#langSeg [data-lang=hy]').click(), null);
    for (const [tod, key, ms] of [['sunset', 'sunset', 3400], ['night', 'night', 4200]]) {
      const missing = cfg[key].map((has, i) => (has ? -1 : i)).filter((i) => i >= 0);
      if (!missing.length) continue;
      await page.evaluate((t) => document.querySelector('#todSeg [data-tod=' + t + ']').click(), tod);
      await adv(ms);
      for (const i of missing) {
        await goFrame(i);
        await adv(1200);
        const png = PNG.sync.read(await page.screenshot({ type: 'png' }));
        let lit = 0, sum = 0, sum2 = 0; const N = png.width * png.height;
        for (let k = 0; k < png.data.length; k += 4) { const y = 0.299 * png.data[k] + 0.587 * png.data[k + 1] + 0.114 * png.data[k + 2]; sum += y; sum2 += y * y; if (y > 15) lit++; }
        const mean = sum / N, sd = Math.sqrt(Math.max(0, sum2 / N - mean * mean));
        info[`${tod}-без-картинки`] = (info[`${tod}-без-картинки`] || []).concat(i + 1);
        if (lit / N < 0.08 || sd < 8) bad(`кадр ${i + 1} без картинки (${tod}): вид пустой или чёрный (светлых пикселей ${(100 * lit / N).toFixed(1)}%, разброс ${sd.toFixed(1)})`);
      }
      await page.evaluate(() => document.querySelector('#todSeg [data-tod=day]').click()); await adv(4500);
    }
  } catch (e) {
    bad('сбой проверки структуры: ' + e.message.slice(0, 200));
  }
  await P.close();
  return { problems, info };
}

// ---------- снимки обычных страниц (главная, about, history) ----------
async function capturePageOnce(browser, origin, target, vpName) {
  const vp = VIEWPORTS[vpName];
  const P = await newPage(browser, origin, vp, { mobile: vpName === 'phone' });
  const { page, problems } = P;
  const bufs = {};
  const adv = (ms) => page.evaluate((m) => window.__advance(m), ms);
  try {
    await page.goto(origin + target.url, { waitUntil: 'load', timeout: 60000 });
    await page.evaluate(() => document.fonts && document.fonts.ready);
    await page.evaluate((s) => window.__seed(s), hashSeed(target.id + vpName));
    await sleep(2500); await adv(2000); await settleImages(page);   // 2.5 с: у страниц есть реальные таймеры 0.7–1.35 с (разлёт стопки, параллакс, подсказки слайдера) — снимаем после них
    const h = await page.evaluate(() => document.documentElement.scrollHeight);   // сначала проходим страницу до низа: «проявление при прокрутке» срабатывает у всех элементов,
    for (let y = 0; y < h; y += vp.height * 0.7) { await page.evaluate((yy) => window.scrollTo(0, yy), y); await sleep(120); await adv(300); }   // а не только у тех, что на границе экрана
    await page.evaluate(() => window.scrollTo(0, 0)); await sleep(300); await adv(800); await settleImages(page); await sleep(1200);
    bufs.top = await page.screenshot({ type: 'png' });
    bufs.full = await page.screenshot({ type: 'png', fullPage: true });
  } catch (e) {
    problems.push({ type: 'сбой проверки', msg: e.message.slice(0, 300) });
  }
  const ext = P.external;
  await P.close();
  return { bufs, problems, external: ext };
}

// Обычная страница: Chrome рисует её при каждой загрузке в одном из нескольких устойчивых вариантов. «Как на сайте» снимаем
// PAGE_ATTEMPTS_A раз и помним все варианты (файлы name~<sha>.png). Кандидата снимаем, пока каждый его снимок побайтно не совпадёт
// с одним из вариантов (не больше PAGE_ATTEMPTS_B раз). guide — снимки «как на сайте» (для кандидата), null — снимаем «как на сайте».
async function capturePage(browser, origin, target, vpName, outDir, guide) {
  const shots = {}, problems = [];
  let external = 0;
  const tries = guide ? PAGE_ATTEMPTS_B : PAGE_ATTEMPTS_A;
  for (let k = 0; k < tries; k++) {
    const r = await capturePageOnce(browser, origin, target, vpName);
    external += r.external;
    if (k === 0) problems.push(...r.problems);
    for (const [name, buf] of Object.entries(r.bufs)) {
      const sha = shotSha(buf);
      const cur = shots[name];
      if (!cur) { fs.writeFileSync(path.join(outDir, name + '.png'), buf); shots[name] = { sha, bytes: buf.length, variants: [sha], counts: { [sha]: 1 }, attempts: 1 }; }
      else {
        cur.attempts++;
        if (!guide) {   // «как на сайте»: копим варианты
          cur.counts[sha] = (cur.counts[sha] || 0) + 1;
          if (!cur.variants.includes(sha)) { cur.variants.push(sha); fs.writeFileSync(path.join(outDir, `${name}~${sha}.png`), buf); }
        } else if (!(guide[name] || []).includes(cur.sha) && (guide[name] || []).includes(sha)) {   // кандидат: нашёлся совпадающий вариант
          fs.writeFileSync(path.join(outDir, name + '.png'), buf); cur.sha = sha; cur.bytes = buf.length;
        }
      }
    }
    if (guide && Object.keys(shots).every((n) => (guide[n] || []).includes(shots[n].sha))) break;
  }
  return { shots, problems, external };
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
  await P.close();
  return { fps: out, problems };
}

// ---------- сравнение ----------
function readPng(f) { return PNG.sync.read(fs.readFileSync(f)); }
// Сравнение: строгое вне областей допуска; внутри (панель и миниатюры на ПК) — шум до NOISE_PX пикселей с разницей до NOISE_DELTA.
function comparePair(fa, fb, fdiff, regions) {
  const A = readPng(fa), B = readPng(fb);
  if (A.width !== B.width || A.height !== B.height) return { diff: -1, note: `размер ${A.width}×${A.height} → ${B.width}×${B.height}` };
  const w = A.width, R = regions || [];
  const inR = (x, y) => R.some((r) => x >= r.box[0] && x <= r.box[2] && y >= r.box[1] && y <= r.box[3]);
  const st = { out: { n: 0, md: 0, box: [1e9, 1e9, -1, -1] }, in: { n: 0, md: 0, box: [1e9, 1e9, -1, -1] } };
  for (let i = 0, p = 0; i < A.data.length; i += 4, p++) {
    if (A.data[i] !== B.data[i] || A.data[i + 1] !== B.data[i + 1] || A.data[i + 2] !== B.data[i + 2] || A.data[i + 3] !== B.data[i + 3]) {
      const x = p % w, y = (p / w) | 0, s = R.length && inR(x, y) ? st.in : st.out;
      s.n++;
      s.md = Math.max(s.md, Math.abs(A.data[i] - B.data[i]), Math.abs(A.data[i + 1] - B.data[i + 1]), Math.abs(A.data[i + 2] - B.data[i + 2]));
      if (x < s.box[0]) s.box[0] = x; if (y < s.box[1]) s.box[1] = y; if (x > s.box[2]) s.box[2] = x; if (y > s.box[3]) s.box[3] = y;
    }
  }
  const n = st.out.n + st.in.n;
  if (!n) return { diff: 0 };
  const D = new PNG({ width: w, height: A.height });
  pixelmatch(A.data, B.data, D.data, w, A.height, { threshold: 0, alpha: 0.35, diffColor: [255, 0, 60] });
  for (const r of R) {   // рамки областей допуска — синим
    const [x0, y0, x1, y1] = r.box;
    const dot = (x, y) => { if (x < 0 || y < 0 || x >= w || y >= A.height) return; const o = (y * w + x) * 4; D.data[o] = 30; D.data[o + 1] = 90; D.data[o + 2] = 255; D.data[o + 3] = 255; };
    for (let x = x0; x <= x1; x++) { dot(x, y0); dot(x, y1); }
    for (let y = y0; y <= y1; y++) { dot(x0, y); dot(x1, y); }
  }
  fs.mkdirSync(path.dirname(fdiff), { recursive: true });
  fs.writeFileSync(fdiff, PNG.sync.write(D));
  const all = st.out.n ? st.out : st.in;
  return { diff: n, pct: n / (w * A.height) * 100, box: all.box, maxDelta: Math.max(st.out.md, st.in.md), outside: st.out, inside: st.in,
    noise: st.out.n === 0 && st.in.n > 0 && st.in.n <= NOISE_PX && st.in.md <= NOISE_DELTA };
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
  // --disable-features=CanvasNoise: Chrome (защита от отпечатков) подмешивает СЛУЧАЙНЫЙ шум в чтение холста, на котором рисовали текст/фигуры
  // (открытка: fillText → toBlob) — у двух прогонов одного и того же сайта открытка разная. Это свойство браузера, не сайта.
  // --disable-partial-raster: без него Chrome перерисовывает только изменившуюся часть плитки поверх старой — итог зависит от того, какие
  // промежуточные состояния успели нарисоваться в реальном времени (кольцо флага, скруглённые углы миниатюр «гуляют» на 1–10 из 255).
  const common = ['--disable-features=CanvasNoise', '--disable-partial-raster', '--run-all-compositor-stages-before-draw', '--disable-new-content-rendering-timeout', '--disable-threaded-animation', '--disable-threaded-scrolling', '--disable-checker-imaging', '--disable-image-animation-resync', '--disable-gpu-rasterization', '--hide-scrollbars', '--disable-lcd-text', '--font-render-hinting=none', '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1'];   // DOM (панель, точки-подсказки, страницы) растрируется программно; WebGL-холст просмотрщика — на GPU
  const gl = await puppeteer.launch({ headless: 'new', args: [...chromeArgs, ...common] });
  const sw = await puppeteer.launch({ headless: 'new', args: ['--disable-gpu', ...common] });
  return { gl, sw };
}
async function runSite(label, root, targets, outBase, guideRes, guideDir) {
  const browsers = await launchBrowsers();
  const srv = await serve(root);
  const origin = `http://127.0.0.1:${srv.port}`;
  const res = {};
  try {
    for (const t of targets) {
      res[t.id] = { kind: t.kind, shots: {}, problems: [], external: 0, fps: null, head: readHead(root, t) };
      res[t.id].problems.push(...checkPreviewImages(root, res[t.id].head).map((p) => ({ ...p, vp: 'шапка' })));
      for (const vpName of vpNames) {
        const dir = path.join(outBase, t.id.replace(/\//g, '__'), vpName);
        fs.mkdirSync(dir, { recursive: true });
        let r;
        if (t.kind === 'viewer') {
          const pass = async (d) => {
            const x = await captureViewer(browsers.gl, origin, t, vpName, d);
            if (opt.walk) {
              const w = await captureWalk(browsers.gl, origin, t, vpName, d);
              Object.assign(x.shots, w.shots); x.problems.push(...w.problems); x.external += w.external; x.welcomeMs = w.welcomeMs;
            }
            return x;
          };
          r = await pass(dir);
          res[t.id].welcomeMs = Object.assign(res[t.id].welcomeMs || {}, { [vpName]: r.welcomeMs });
          // кандидат: снимки, не совпавшие с «как на сайте» вне областей допуска, переснимаем (весь проход) до VIEWER_RETRIES_B раз;
          // засчитывается только совпадение по тем же правилам — настоящая разница повторится и останется
          const aId = (pairFor(t.id) || { a: t.id }).a, g = guideRes && guideRes[aId];
          if (g && g.kind === 'viewer') {
            const matches = (name, file, shot) => {
              const as = g.shots[`${vpName}/${name}`]; if (!as) return true;
              if (as.sha === shot.sha) return true;
              const c = comparePair(path.join(guideDir, aId.replace(/\//g, '__'), vpName, name + '.png'), file, path.join(os.tmpdir(), 'chka-check-retry-diff.png'), [...(as.regions || []), ...(shot.regions || [])]);
              return c.diff === 0 || c.noise;
            };
            let bad = Object.keys(r.shots).filter((n) => !matches(n, path.join(dir, n + '.png'), r.shots[n]));
            for (let k = 0; k < VIEWER_RETRIES_B && bad.length; k++) {
              log(`${label} · ${t.id} · ${vpName}: не совпали ${bad.length} (${bad.slice(0, 3).join(', ')}) — пересъёмка ${k + 1}/${VIEWER_RETRIES_B}`);
              const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chka-check-retry-'));
              const x = await pass(tmp);
              bad = bad.filter((n) => {
                if (!x.shots[n] || !matches(n, path.join(tmp, n + '.png'), x.shots[n])) return true;
                fs.copyFileSync(path.join(tmp, n + '.png'), path.join(dir, n + '.png')); r.shots[n] = x.shots[n]; r.retried = (r.retried || 0) + 1; return false;
              });
              fs.rmSync(tmp, { recursive: true, force: true });
            }
            if (r.retried) res[t.id].retried = (res[t.id].retried || 0) + r.retried;
          }
        } else {
          let guide = null;
          if (guideRes) {   // варианты «как на сайте» для этой страницы
            const g = guideRes[(pairFor(t.id) || { a: t.id }).a];
            guide = {};
            if (g) for (const [key, v] of Object.entries(g.shots)) { const [vp, name] = key.split('/'); if (vp === vpName) guide[name] = v.variants || [v.sha]; }
          }
          r = await capturePage(browsers.sw, origin, t, vpName, dir, guide);
        }
        for (const [k, v] of Object.entries(r.shots)) res[t.id].shots[`${vpName}/${k}`] = v;
        res[t.id].problems.push(...r.problems.map((p) => ({ ...p, vp: vpName })));
        res[t.id].external += r.external;
        log(`${label} · ${t.id} · ${vpName}: ${Object.keys(r.shots).length} снимков` + (r.problems.length ? `, проблем: ${r.problems.length} — ${r.problems.slice(0, 3).map((x) => x.type + ': ' + x.msg).join('; ')}` : ''));
      }
    }
    if (opt.structure) {
      for (const t of targets.filter((x) => x.kind === 'viewer')) {
        const r = await checkStructure(browsers.gl, origin, t);
        res[t.id].problems.push(...r.problems);
        res[t.id].structure = r.info;
        log(`${label} · ${t.id} · структура: кадров ${r.info.frames}, точек по кадрам [${r.info.dots.join(',')}], парад [${r.info.parade.join(',')}]` + (r.problems.length ? `, ПРОБЛЕМ: ${r.problems.length}` : ', без проблем'));
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
<p class="hint">Клик по картинке «стало» на секунду показывает «было» (мигание). Красное на третьей картинке — отличающиеся пиксели, синие рамки — области допуска.</p>
<h2>Где действует допуск</h2><p>Сравнение строгое: любой отличающийся пиксель — различие. Исключения:</p><ul>
<li><b>ПК, панель и миниатюры</b> (рамка элемента + ${REGION_PAD} px на тень): шум растеризации Chrome до ${NOISE_PX} пикселей с разницей до ${NOISE_DELTA} из 255 — в допуске, если ВНЕ этих рамок отличий нет.${R.regions.length ? ' В этом прогоне допуск сработал в областях:<br>' + R.regions.map(esc).join('<br>') : ' В этом прогоне допуск не понадобился.'}</li>
<li><b>Обычные страницы</b> (главная, about, history): Chrome при каждой загрузке рисует их в одном из нескольких устойчивых вариантов; «как на сайте» снимается ${PAGE_ATTEMPTS_A} раза, снимок кандидата должен побайтно совпасть с одним из вариантов (пересъёмка до ${PAGE_ATTEMPTS_B} раз). Допуска по пикселям нет.</li></ul>`;
  h += `<h2>Итог</h2><table><tr><th>Цель</th><th>Снимков</th><th>Отличаются</th><th>Шум в панели (в допуске)</th><th>Ошибки/404</th><th>fps</th><th>Итог</th></tr>`;
  for (const [id, t] of Object.entries(R.targets)) h += `<tr><td>${esc(id)}</td><td>${t.total}</td><td>${t.changed}</td><td>${t.noise || 0}</td><td>${t.problems.length}</td><td>${t.fpsNote || '—'}</td><td>${badge(t.status)}</td></tr>`;
  h += '</table>';
  if (R.failures.length) h += `<h2>Что не так</h2><ul>${R.failures.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>`;
  for (const [id, t] of Object.entries(R.targets)) {
    h += `<h2>${esc(id)} ${badge(t.status)}</h2>`;
    if (t.retried) h += `<p>Пересъёмка кандидата: ${t.retried} снимков совпали побайтно со второго/третьего прохода (разовая дрожь растеризации Chrome).</p>`;
    if (t.welcome) h += `<p>Приветствие: ${Object.entries(t.welcome).filter(([, v]) => v).map(([k, v]) => `${k} — заставка ушла ${(v.gone / 1000).toFixed(1)} с, кадры загружены ${(v.loaded / 1000).toFixed(1)} с`).join('; ')}</p>`;
    if (t.head && t.head.length) h += `<h3>Шапка страницы (сырой HTML: превью в соцсетях, значки)</h3><table><tr><th>тег</th><th>было</th><th>стало</th><th></th></tr>` + t.head.map((d) => `<tr><td>${esc(d.k)}</td><td>${esc(d.a ?? '—')}</td><td>${esc(d.b ?? '—')}</td><td>${d.strict ? badge('fail') : badge('info')}</td></tr>`).join('') + '</table>';
    else if (t.head) h += `<p>Шапка страницы (превью в соцсетях, заголовок, canonical, значки) — без изменений.</p>`;
    if (t.headNote) h += `<p>${esc(t.headNote)}</p>`;
    if (t.problems.length) h += `<h3>Ошибки и 404 (кандидат)</h3><pre>${esc(t.problems.map((p) => `${p.vp}: ${p.type}: ${p.msg}${p.known ? '   [известная: ' + p.known + ']' : ''}`).join('\n'))}</pre>`;
    if (t.fps) { h += `<h3>fps (телефон, процессор ×4)</h3><table><tr><th>сценарий</th><th>было</th><th>стало</th><th></th></tr>` + Object.entries(t.fps).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v.a == null ? '—' : v.a}</td><td>${v.b}</td><td>${v.bad ? badge('fail') : ''}</td></tr>`).join('') + '</table>'; }
    const ch = t.list.filter((s) => s.diff !== 0 && !s.noise), noise = t.list.filter((s) => s.noise), same = t.list.filter((s) => s.diff === 0);
    if (ch.length) {
      h += `<h3>Отличаются: ${ch.length}</h3>`;
      for (const s of ch) {
        const where = s.diff < 0 ? esc(s.note) : `${s.diff} пикс. (${s.pct.toFixed(3)}%)` + (s.outside && s.outside.n ? `, вне областей допуска ${s.outside.n} пикс., где: x ${s.outside.box[0]}–${s.outside.box[2]}, y ${s.outside.box[1]}–${s.outside.box[3]}, разница до ${s.outside.md}` : '') + (s.inside && s.inside.n ? `; в областях допуска ${s.inside.n} пикс., разница до ${s.inside.md}` : '');
        h += `<div class="shot ${t.allowed ? '' : 'bad'}"><h4>${esc(s.name)} — ${where}</h4><div class="row">` +
          `<figure><img src="${rel('A', ...s.fileA)}" loading="lazy"><figcaption>было</figcaption></figure>` +
          `<figure><img class="flip" data-a="${rel('A', ...s.fileA)}" src="${rel('B', ...s.fileB)}" data-b="${rel('B', ...s.fileB)}" loading="lazy"><figcaption>стало</figcaption></figure>` +
          (s.diff > 0 ? `<figure><img src="${rel('diff', ...s.fileB)}" loading="lazy"><figcaption>разница</figcaption></figure>` : '') + `</div></div>`;
      }
    }
    if (noise.length) h += `<details open><summary>Шум в панели/миниатюрах на ПК (в допуске, вне рамок — ноль): ${noise.length}</summary>` + noise.map((s) => `<div class="shot"><h4>${esc(s.name)} — ${s.diff} пикс., разница до ${s.maxDelta}; области: ${esc((s.regions || []).map((r) => `${r.label} x ${r.box[0]}–${r.box[2]}, y ${r.box[1]}–${r.box[3]}`).join('; '))}</h4><div class="row"><figure><img src="${rel('diff', ...s.fileB)}" loading="lazy"><figcaption>разница (синее — рамки допуска)</figcaption></figure></div></div>`).join('') + '</details>';
    if (same.length) {
      h += `<details><summary>Без различий: ${same.length}</summary>` + same.map((s) => `<div class="shot phone"><h4>${esc(s.name)}${s.variant ? ` (вариант Chrome №${s.variant})` : ''}</h4><img src="${rel('B', ...s.fileB)}" loading="lazy"></div>`).join('') + '</details>';
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
    if (baseManifest) {   // картинки эталона — в папку отчёта (с ними сравнивается кандидат и они показываются в отчёте)
      for (const t of tA) {
        const src = path.join(BASE_ROOT, opt.baseline, t.id.replace(/\//g, '__')), dst = path.join(out, 'A', t.id.replace(/\//g, '__'));
        if (fs.existsSync(src)) fs.cpSync(src, dst, { recursive: true });
      }
    }
    const resB = await runSite('B', bRoot, tB, path.join(out, 'B'), resA, path.join(out, 'A'));

    const R = { when: new Date().toLocaleString('ru-RU'), aLabel, bLabel, env, targets: {}, failures: [], totalShots: 0, ok: true, seconds: 0, out };
    const fail = (m) => { R.failures.push(m); R.ok = false; };
    // что с чем сравниваем: цель кандидата — с той же целью «как на сайте» или с парой из --compare-as
    const rows = [];
    for (const id of [...new Set([...Object.keys(resA), ...Object.keys(resB)])]) {
      const pr = pairFor(id);
      if (pr && resB[id]) rows.push({ label: `${id} ⇄ ${pr.a}`, aId: pr.a, bId: id, allowed: opt.allow.includes(id) });
      else rows.push({ label: id, aId: id, bId: id, allowed: opt.allow.some((x) => id === x || id.startsWith(x + '/')) });
    }
    const regionSet = new Set();
    for (const row of rows) {
      const a = resA[row.aId], b = resB[row.bId], id = row.label;
      const allowed = row.allowed;
      const T = { list: [], total: 0, changed: 0, problems: [], allowed, status: 'ok', fps: null, noise: 0, variantHits: 0 };
      R.targets[id] = T;
      if (!b) { T.status = allowed ? 'changed' : 'fail'; if (!allowed) fail(`${id}: есть на сайте, но пропала у кандидата`); continue; }
      if (!a) { T.status = 'new'; }
      if (b.welcomeMs) T.welcome = b.welcomeMs;
      if (b.retried) T.retried = b.retried;
      const keys = [...new Set([...Object.keys(a ? a.shots : {}), ...Object.keys(b.shots)])].sort();
      for (const key of keys) {
        const [vp, name] = key.split('/');
        const fileA = [row.aId.replace(/\//g, '__'), vp, name + '.png'], fileB = [row.bId.replace(/\//g, '__'), vp, name + '.png'];
        const item = { name: key, fileA, fileB };
        const as = a && a.shots[key], bs = b.shots[key];
        if (!a) { item.diff = 0; }
        else if (!as) { item.diff = -1; item.note = 'нового снимка не было раньше'; }
        else if (!bs) { item.diff = -1; item.note = 'снимок пропал у кандидата'; }
        else if ((as.variants || [as.sha]).includes(bs.sha)) { item.diff = 0; if (as.variants && as.variants.length > 1) { item.variant = as.variants.indexOf(bs.sha) + 1; T.variantHits++; } }
        else {
          const regions = [...(as.regions || []), ...(bs.regions || [])];
          Object.assign(item, comparePair(path.join(out, 'A', ...fileA), path.join(out, 'B', ...fileB), path.join(out, 'diff', ...fileB), regions));
          item.regions = regions;
          if (item.noise) { T.noise++; regions.forEach((r) => regionSet.add(`${vp}: ${r.label} x ${r.box[0]}–${r.box[2]}, y ${r.box[1]}–${r.box[3]}`)); }
        }
        T.list.push(item); T.total++; if (item.diff === 0) R.exact = (R.exact || 0) + 1;
        if (item.diff !== 0 && !item.noise) T.changed++;
      }
      R.totalShots += T.total;
      if (a && T.changed) { if (allowed) T.status = 'changed'; else { T.status = 'fail'; fail(`${id}: отличаются ${T.changed} из ${T.total} снимков (${T.list.filter((s) => s.diff !== 0 && !s.noise).slice(0, 4).map((s) => s.name).join(', ')}${T.changed > 4 ? '…' : ''})`); } }
      for (const p of b.problems) {   // ошибки и 404
        const k = isKnown(known, row.bId, p);
        T.problems.push({ ...p, known: k ? k.reason || 'да' : null });
        if (!k) { T.status = 'fail'; fail(`${id} (${p.vp}): ${p.type}: ${p.msg}`); }
      }
      if (a && a.head && b.head && row.aId === row.bId && !allowed) {   // шапка (превью в соцсетях): строго; прочие теги шапки — в отчёт
        T.head = [];
        for (const k of [...new Set([...Object.keys(a.head), ...Object.keys(b.head)])].sort()) {
          if (a.head[k] === b.head[k]) continue;
          const strict = headStrict(k);
          T.head.push({ k, a: a.head[k], b: b.head[k], strict });
          if (strict) { T.status = 'fail'; fail(`${id}: шапка/превью изменились — ${k}: «${a.head[k] ?? '—'}» → «${b.head[k] ?? '—'}»`); }
        }
      } else if (a && !allowed && row.aId === row.bId && (!a.head || !b.head)) T.headNote = a.head ? 'шапка кандидата не прочитана' : 'в эталоне нет шапки (снят старой версией проверки) — шапка не сравнивалась';
      if (b.fps) {   // fps
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
    R.regions = [...regionSet].sort();
    R.seconds = Math.round((Date.now() - T0) / 1000);
    writeReport(out, R);
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ ok: R.ok, failures: R.failures, aLabel, bLabel, env, totalShots: R.totalShots, exact: R.exact || 0, regions: R.regions, seconds: R.seconds, targets: Object.fromEntries(Object.entries(R.targets).map(([k, v]) => [k, { status: v.status, total: v.total, changed: v.changed, problems: v.problems.length }])) }, null, 1));
    log(R.ok ? 'ЗЕЛЁНАЯ' : 'КРАСНАЯ');
    for (const [id, t] of Object.entries(R.targets)) log(`  ${id.padEnd(30)} ${t.status.padEnd(8)} снимков ${t.total}, отличаются ${t.changed}${t.noise ? ` (+${t.noise} шум в панели)` : ''}, проблем ${t.problems.length}${t.fpsNote ? ', fps ' + t.fpsNote : ''}${t.retried ? `, переснято и совпало ${t.retried}` : ''}${t.welcome ? ', заставка/кадры ' + Object.entries(t.welcome).filter(([, v]) => v).map(([k, v]) => `${k} ${(v.gone / 1000).toFixed(1)}/${(v.loaded / 1000).toFixed(1)} с`).join(' / ') : ''}`);
    for (const [id, t] of Object.entries(R.targets)) for (const d of (t.head || []).filter((x) => !x.strict)) log(`  шапка ${id}: ${d.k}: «${d.a ?? '—'}» → «${d.b ?? '—'}» (не превью — только в отчёт)`);
    for (const [id, t] of Object.entries(R.targets)) if (t.headNote) log(`  шапка ${id}: ${t.headNote}`);
    for (const f of R.failures) log('  ✗ ' + f);
    log(`снимков ${R.totalShots}, из них побайтно совпали ${R.exact || 0} (у страниц — с одним из вариантов Chrome: ${Object.values(R.targets).reduce((n, t) => n + (t.variantHits || 0), 0)}), шум в панели ПК (в допуске) ${Object.values(R.targets).reduce((n, t) => n + (t.noise || 0), 0)}, время ${R.seconds} с`);
    for (const r of R.regions) log('  область допуска: ' + r);
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
