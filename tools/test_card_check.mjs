#!/usr/bin/env node
// Самопроверка проверки открытки (tools/card_check.mjs): на настоящем Chrome, на крошечной странице-подделке.
//   зелёная — share получает image/jpeg 1080×1920 одним вызовом;
//   красная (проверка НЕ ослаблена) — файла нет / не тот размер / не JPEG / два вызова share / share вызван без файла.
// Запуск: node tools/test_card_check.mjs  (в облаке: PUPPETEER_EXECUTABLE_PATH=…/chrome). Код выхода 0 — всё как должно быть, 2 — нет Chrome (пропуск).
// Пределы ожидания здесь: share — 15 с по событию (подделка сама сообщает «закончила»; красные идут быстро, зелёные не зависят от скорости машины), шрифты/бумага — 0,75 с (красный случай ждёт ровно столько); логика та же, что в боевых проверках.
import puppeteer from 'puppeteer';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { SHARE_HOOK, CARD_DETERMINISM, DOWNLOAD_HOOK, phoneCardStep, desktopCardStep } from './card_check.mjs';
const ENGINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'engine');

// e1.28: нажатие «Открытка» открывает окно (body.card-open) с #cardGo, открытку отдаёт #cardGo; режим legacy — старая страница e1.27 (сразу share).
const PAGE = (mode) => `<!doctype html><meta charset=utf-8><style>#cardGo{display:none}body.card-open #cardGo{display:block}</style><body><button id=cardBtn style="width:120px;height:60px">card</button><button id=cardGo style="width:120px;height:60px">save</button><canvas id=cardPrev width=90 height=160></canvas><canvas id=cardPrevB width=90 height=160></canvas><button id=cardCfgClose>x</button><button id=cardBack aria-pressed=false onclick="this.setAttribute('aria-pressed', this.getAttribute('aria-pressed') === 'true' ? 'false' : 'true')">back</button><script>
window.ChkaPostcard = {}; window.__fake = { clicks: 0, done: false, t0: 0, tShare: 0, err: null };   // журнал подделки: проверка ждёт done (событие), а не гадает паузой
window.__card = { fontsReady: () => ${mode === 'fonts' ? 'false' : 'true'}, paperReady: () => ${mode === 'paper' ? 'false' : 'true'} };
// картинка-подделка: градиент + полосы (не однотонная — «непустая»); flat — однотонная заливка (пустой холст iOS)
// side 'back' — оборот: светлая «бумага» со строками (на лицо не похож); превью окна (#cardPrev / #cardPrevB) рисуются тем же кодом
const paint = (c, flat, side) => { const w = c.width, h = c.height, x = c.getContext('2d');
  if (flat) { x.fillStyle = '#c96'; x.fillRect(0, 0, w, h); return; }
  if (side === 'back') { x.fillStyle = '#efe4c8'; x.fillRect(0, 0, w, h); x.fillStyle = '#4e4a8e'; for (let i = 0; i < 12; i++) x.fillRect(w * 0.1, h * (0.3 + i * 0.04), w * 0.8, h * 0.008); x.fillRect(w * 0.65, h * 0.08, w * 0.25, h * 0.15); return; }
  const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#9cc'); g.addColorStop(1, '#753'); x.fillStyle = g; x.fillRect(0, 0, w, h); x.fillStyle = '#222'; for (let i = 0; i < 40; i++) x.fillRect(((i * 97) % 1080) / 1080 * w, ((i * 211) % 1920) / 1920 * h, w * 0.055, h * 0.016); };
paint(document.getElementById('cardPrev'), false, 'front'); paint(document.getElementById('cardPrevB'), false, 'back');
const mk = (w, h, type, flat, side) => new Promise((res) => { const c = document.createElement('canvas'); c.width = w; c.height = h; paint(c, flat, side);
  c.toBlob((b) => res(new File([b], type === 'image/png' ? 'c.png' : (side === 'back' ? 'c-back.jpg' : 'c.jpg'), { type })), type, 0.9); });
const DESK = ${JSON.stringify(mode)}.startsWith('desk');
const dl = (f, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(f); a.download = name; document.body.appendChild(a); a.click(); a.remove(); };
const sendDesk = async () => {   // e1.36: компьютер — один клик, два скачивания (лицо сразу, оборот через 400 мс)
  const m = ${JSON.stringify(mode)}, withBack = document.getElementById('cardBack').getAttribute('aria-pressed') === 'true';
  const f = await mk(1080, 1920, m === 'desk_png' ? 'image/png' : 'image/jpeg', false, 'front');
  if (m === 'desk_share') { navigator.share && navigator.share({ files: [f] }); }
  dl(f, 'card-front.jpg');
  if (!withBack || m === 'desk_one') return;
  const b = m === 'desk_same' ? f : await mk(1080, 1920, 'image/jpeg', false, 'back');
  await new Promise((r) => setTimeout(r, 400)); dl(b, 'card-back.jpg');
};
let step2 = false;   // e1.35: с оборотом — второе нажатие «Сохранить оборот» (кнопка с классом cc-go2)
const send = async () => { const F = window.__fake; F.t0 = performance.now(); try { await send1(); F.tShare = performance.now(); } catch (e) { F.err = String(e); } finally { F.done = true; } };
const send1 = async () => {
  const m = ${JSON.stringify(mode)};
  if (m === 'none') return;
  if (m === 'nofile') { navigator.share({}); return; }
  const withBack = document.getElementById('cardBack').getAttribute('aria-pressed') === 'true', go = document.getElementById('cardGo');
  if (DESK) { await sendDesk(); return; }
  const mkBack = () => mk(m === 'backsmall' ? 540 : 1080, m === 'backsmall' ? 960 : 1920, 'image/jpeg', m === 'backblank', 'back');
  const mkFront = () => mk(m === 'small' ? 540 : 1080, m === 'small' ? 960 : 1920, m === 'png' ? 'image/png' : 'image/jpeg', m === 'blank', 'front');
  if (step2) { step2 = false; go.classList.remove('cc-go2'); if (m !== 'noback2') navigator.share({ files: [m === 'same' || m === 'swap' ? await mkFront() : await mkBack()] }); return; }   // второе нажатие — оборот (same/swap — ошибки e1.35)
  const f = m === 'swap' ? await mkBack() : await mkFront();
  if (withBack && m === 'legacy2') { navigator.share({ files: [f, await mkBack()] }); return; }   // ≤ e1.34: оба файла одним share
  navigator.share({ files: [f] });
  if (withBack && m !== 'back1') { step2 = true; go.classList.add('cc-go2'); }   // e1.35: лицо ушло — кнопка «Сохранить оборот»
  if (m === 'twice') navigator.share({ files: [f] });
};
document.getElementById('cardBtn').onclick = () => { if (${JSON.stringify(mode)} === 'legacy') { window.__fake.clicks++; send(); } else document.body.classList.add('card-open'); };
document.getElementById('cardGo').onclick = () => { window.__fake.clicks++; if (${JSON.stringify(mode)} !== 'mute') send(); else window.__fake.done = true; };
document.getElementById('cardCfgClose').onclick = () => document.body.classList.remove('card-open');</script>`;
const srv = http.createServer((q, r) => {
  if (q.url.startsWith('/engine/postcard.js')) { r.writeHead(200, { 'Content-Type': 'text/javascript' }); r.end(fs.readFileSync(path.join(ENGINE, 'postcard.js'))); return; }
  if (q.url.startsWith('/determinism')) { r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); r.end('<!doctype html><meta charset=utf-8><script src="/engine/postcard.js"></script>'); return; }
  const mode = (q.url.split('?')[1] || 'ok').replace(/\W/g, ''); r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); r.end(PAGE(mode));
});
await new Promise((res) => srv.listen(0, '127.0.0.1', res));
const port = srv.address().port;
let browser;
try { browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] }); } catch (e) { console.log('ПРОПУЩЕНО: нет Chrome для puppeteer (' + String(e.message).slice(0, 80) + ')'); srv.close(); process.exit(2); }
// CARD_TEST_CPU_SLOWDOWN=4 node tools/test_card_check.mjs — замедлить CPU страниц (как DevTools «CPU: 4× slowdown») и убедиться, что красные дают СВОЮ ошибку
const SLOW = Number(process.env.CARD_TEST_CPU_SLOWDOWN || 1);
if (SLOW > 1) { const np = browser.newPage.bind(browser); browser.newPage = async () => { const pg = await np(); const cdp = await pg.createCDPSession(); await cdp.send('Emulation.setCPUThrottlingRate', { rate: SLOW }); return pg; }; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// e1.33+ (s34): пределы ожидания самопроверки — с запасом, а ждём СОБЫТИЕ: подделка сама ставит __fake.done, когда закончила все свои вызовы share.
// Раньше было жёсткое окно 1,5 с на share: на медленной машине (Mac mini, 8 ГБ) подделка не успевала вызвать share → вместо «файлов 1, нужно 2» / «2 раза»
// приходила «не ушла в share». Красный случай «share не звали вовсе» (mute/none) теперь тоже сразу, по событию done, а не по таймауту.
// Проверка настоящей открытки не менялась: пороги 1080×1920, JPEG, число файлов, 2 вызова — те же; settled в боевые проверки не передаётся.
const SHARE_MS = 15000, FONTS_MS = 750;   // FONTS_MS — красные «шрифты/бумага не догрузились» (там ждём ровно столько и проверяем, что красное есть)
const settledOf = (page) => async () => page.evaluate(() => !!(window.__fake && window.__fake.done));
let reclicks = 0;
// страница-подделка иногда не получает первый клик (окно ещё доезжает) — повторить нажатие «Сохранить», если подделка его не видела (журнал __fake.clicks)
const clickOf = (page) => async (sel) => {
  await page.click(sel);
  if (sel !== '#cardGo') return;
  for (let i = 0; i < 10; i++) { if (await page.evaluate(() => window.__fake.clicks > 0)) return; await sleep(100); }
  reclicks++; await page.click(sel);
};
const cases = [['ok', null], ['legacy', null], ['mute', 'не ушла в share'], ['small', '540×960'], ['png', 'тип image/png'], ['none', 'не ушла в share'], ['nofile', 'без файла'], ['twice', '2 раз'], ['fonts', 'шрифты открытки'], ['paper', 'бумага открытки'], ['blank', 'открытка в share пустая']];   // e1.35: пустой (однотонный) файл = красное   // e1.33: бумага грузится заранее — не успела = красное
let bad = 0;
// e1.29: с оборотом — 2 файла 1080×1920; e1.35: по одному на share, два нажатия (ok), старые страницы — оба сразу (legacy2)
const backCases = [['ok', null], ['legacy2', null], ['back1', 'не стала «Сохранить оборот»'], ['noback2', 'не вызвало share'], ['backsmall', 'оборот в share: 540×960'], ['backblank', 'оборот в share пустая'],
  ['same', 'одна и та же картинка'], ['swap', 'не лицо']];   // e1.36: баг iPhone — оба шага отдали лицо (same); стороны перепутаны (swap)
for (const [mode, want] of backCases) {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(SHARE_HOOK);
  await page.goto(`http://127.0.0.1:${port}/?${mode}`);
  const r = await phoneCardStep(page, { click: clickOf(page), sleep, shareMs: SHARE_MS, fontsMs: FONTS_MS, back: true, settled: settledOf(page) });
  const msgs = r.problems.map((p) => p.msg).join(' | ');
  const ok = want === null ? r.problems.length === 0 && !!r.backPng : r.problems.some((p) => p.msg.includes(want));
  if (!ok) bad++;
  console.log(`${ok ? 'OK   ' : 'ОШИБКА'}  оборот/${mode.padEnd(9)} ${want === null ? 'зелёная (2 файла)' : 'красная «' + want + '»'} — ${msgs.slice(0, 110) || 'без проблем'}`);
  await page.close();
}
for (const [mode, want] of cases) {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(SHARE_HOOK);
  await page.goto(`http://127.0.0.1:${port}/?${mode}`);
  const t = Date.now();
  const r = await phoneCardStep(page, { click: clickOf(page), sleep, shareMs: SHARE_MS, fontsMs: FONTS_MS, settled: settledOf(page) });
  const msgs = r.problems.map((p) => p.msg).join(' | ');
  const ok = want === null ? r.problems.length === 0 && !!r.png : r.problems.some((p) => p.msg.includes(want));
  if (!ok) bad++;
  console.log(`${ok ? 'OK   ' : 'ОШИБКА'}  ${mode.padEnd(6)} ${want === null ? 'зелёная' : 'красная «' + want + '»'} — ${msgs.slice(0, 110) || 'без проблем'} (${((Date.now() - t) / 1000).toFixed(1)} с)`);
  await page.close();
}
// e1.36: компьютер — один клик «Сохранить открытку» = два скачивания card-front.jpg + card-back.jpg (без share, без второго шага)
const deskCases = [['desk_ok', null], ['desk_one', 'скачал 1 файл'], ['desk_same', 'одна и та же картинка'], ['desk_png', 'тип image/png'], ['desk_share', 'вызван navigator.share']];
for (const [mode, want] of deskCases) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument(DOWNLOAD_HOOK);
  await page.evaluateOnNewDocument(() => { window.__shares = []; const put = (k, v) => { try { Object.defineProperty(Navigator.prototype, k, { value: v, configurable: true, writable: true }); } catch (e) {} }; put('share', (d) => { window.__shares.push(d); return Promise.resolve(); }); });
  await page.goto(`http://127.0.0.1:${port}/?${mode}`);
  const r = await desktopCardStep(page, { click: clickOf(page), sleep, back: true, dlMs: SHARE_MS, settled: settledOf(page) });
  const msgs = r.problems.map((p) => p.msg).join(' | ');
  const ok = want === null ? r.problems.length === 0 && !!r.backPng : r.problems.some((p) => p.msg.includes(want));
  if (!ok) bad++;
  console.log(`${ok ? 'OK   ' : 'ОШИБКА'}  компьютер/${mode.padEnd(10)} ${want === null ? 'зелёная (2 скачивания одним кликом)' : 'красная «' + want + '»'} — ${msgs.slice(0, 120) || 'без проблем'}`);
  await page.close();
}
// Открытки двух копий сайта должны совпадать пиксель в пиксель: с CARD_DETERMINISM два compose (без seed) через паузу дают одно и то же; без него — разное
const sameTwice = async (withStub) => {
  const page = await browser.newPage();
  if (withStub) await page.evaluateOnNewDocument(CARD_DETERMINISM);
  await page.goto(`http://127.0.0.1:${port}/determinism`);
  const r = await page.evaluate(async () => {
    const src = document.createElement('canvas'); src.width = 1080; src.height = 1920; const x = src.getContext('2d'); const g = x.createLinearGradient(0, 0, 0, 1920); g.addColorStop(0, '#9cc'); g.addColorStop(1, '#753'); x.fillStyle = g; x.fillRect(0, 0, 1080, 1920);
    const o = { lang: 'ru', name: 'Памятник Ленину', years: '1940–1991', url: 'chka.am/lenin', film: true, date: new Date('2026-10-16T12:00:00') };
    const a = ChkaPostcard.compose(src, Object.assign({}, o)).toDataURL('image/png');
    await new Promise((r) => setTimeout(r, 40));
    const b = ChkaPostcard.compose(src, Object.assign({}, o)).toDataURL('image/png');
    return a === b;
  });
  await page.close();
  return r;
};
for (const [stub, want] of [[true, true], [false, false]]) {
  const got = await sameTwice(stub);
  const ok = got === want; if (!ok) bad++;
  console.log(`${ok ? 'OK   ' : 'ОШИБКА'}  открытка при одинаковых входных данных ${stub ? 'с подменой Date.now (check_site): две копии совпадают' : 'без подмены: «зерно» разное (подмена нужна)'} — ${got ? 'совпали' : 'разные'}`);
}
if (reclicks) console.log(`заметка: повторное нажатие «Сохранить» понадобилось ${reclicks} раз — подделка не увидела первый клик`);
await browser.close(); srv.close();
process.exit(bad ? 1 : 0);
