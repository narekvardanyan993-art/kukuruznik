#!/usr/bin/env node
// Самопроверка проверки открытки (tools/card_check.mjs): на настоящем Chrome, на крошечной странице-подделке.
//   зелёная — share получает image/jpeg 1080×1920 одним вызовом;
//   красная (проверка НЕ ослаблена) — файла нет / не тот размер / не JPEG / два вызова share / share вызван без файла.
// Запуск: node tools/test_card_check.mjs  (в облаке: PUPPETEER_EXECUTABLE_PATH=…/chrome). Код выхода 0 — всё как должно быть, 2 — нет Chrome (пропуск).
// Пределы ожидания здесь короче боевых (1,5 с вместо 20 с и 0,75 с вместо 10 с) — только чтобы красные случаи шли быстро; логика та же.
import puppeteer from 'puppeteer';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { SHARE_HOOK, CARD_DETERMINISM, phoneCardStep } from './card_check.mjs';
const ENGINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'engine');

const PAGE = (mode) => `<!doctype html><meta charset=utf-8><body><button id=cardBtn style="width:120px;height:60px">card</button><script>
window.ChkaPostcard = {}; window.__card = { fontsReady: () => ${mode === 'fonts' ? 'false' : 'true'} };
const mk = (w, h, type) => new Promise((res) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.fillStyle = '#c96'; x.fillRect(0, 0, w, h); c.toBlob((b) => res(new File([b], type === 'image/png' ? 'c.png' : 'c.jpg', { type })), type, 0.9); });
document.getElementById('cardBtn').onclick = async () => {
  const m = ${JSON.stringify(mode)};
  if (m === 'none') return;
  if (m === 'nofile') { navigator.share({}); return; }
  const f = await mk(m === 'small' ? 540 : 1080, m === 'small' ? 960 : 1920, m === 'png' ? 'image/png' : 'image/jpeg');
  navigator.share({ files: [f] });
  if (m === 'twice') navigator.share({ files: [f] });
};</script>`;
const srv = http.createServer((q, r) => {
  if (q.url.startsWith('/engine/postcard.js')) { r.writeHead(200, { 'Content-Type': 'text/javascript' }); r.end(fs.readFileSync(path.join(ENGINE, 'postcard.js'))); return; }
  if (q.url.startsWith('/determinism')) { r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); r.end('<!doctype html><meta charset=utf-8><script src="/engine/postcard.js"></script>'); return; }
  const mode = (q.url.split('?')[1] || 'ok').replace(/\W/g, ''); r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); r.end(PAGE(mode));
});
await new Promise((res) => srv.listen(0, '127.0.0.1', res));
const port = srv.address().port;
let browser;
try { browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] }); } catch (e) { console.log('ПРОПУЩЕНО: нет Chrome для puppeteer (' + String(e.message).slice(0, 80) + ')'); srv.close(); process.exit(2); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cases = [['ok', null], ['small', '540×960'], ['png', 'тип image/png'], ['none', 'не ушла в share'], ['nofile', 'без файла'], ['twice', '2 раз'], ['fonts', 'шрифты открытки']];
let bad = 0;
for (const [mode, want] of cases) {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(SHARE_HOOK);
  await page.goto(`http://127.0.0.1:${port}/?${mode}`);
  const t = Date.now();
  const r = await phoneCardStep(page, { click: (s) => page.click(s), sleep, shareMs: 1500, fontsMs: 750 });
  const msgs = r.problems.map((p) => p.msg).join(' | ');
  const ok = want === null ? r.problems.length === 0 && !!r.png : r.problems.some((p) => p.msg.includes(want));
  if (!ok) bad++;
  console.log(`${ok ? 'OK   ' : 'ОШИБКА'}  ${mode.padEnd(6)} ${want === null ? 'зелёная' : 'красная «' + want + '»'} — ${msgs.slice(0, 110) || 'без проблем'} (${((Date.now() - t) / 1000).toFixed(1)} с)`);
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
await browser.close(); srv.close();
process.exit(bad ? 1 : 0);
