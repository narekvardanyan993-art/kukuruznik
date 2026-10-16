// Проверка «открытки в сторис» (e1.27) — общая часть для tools/check_site.mjs (прогулка) и tools/check_card_phone.mjs (быстрая проверка одной страницы).
//
// Телефон (эмуляция: pointer coarse + касание): открытка уходит через navigator.share с файлом JPEG 1080×1920 — как на iPhone. У настоящего Chrome
// на Mac navigator.share есть, но в проверке он открывал бы системное окно или отклонялся (нет настоящего окна) — и открытка «не сохранялась»
// (check_site 15.10.2026: «открытка не сохранилась (нет картинки за 20 с)»). Поэтому share и canShare подменяются ДО загрузки страницы
// перехватчиком SHARE_HOOK: он запоминает файл и отвечает «готово». Что файл — JPEG 1080×1920, проверяет phoneCardStep (красное, если файла нет
// за 20 с или он не тот). ПК: share не подменяется — скачивание PNG, прежний путь (в check_site, без изменений).

// Выполняется в странице (evaluateOnNewDocument) — только телефон.
export const SHARE_HOOK = () => {
  window.__shares = [];
  const put = (k, v) => { try { Object.defineProperty(Navigator.prototype, k, { value: v, configurable: true, writable: true }); } catch (e) {} };
  put('canShare', (d) => !!(d && d.files && d.files.length));
  put('share', (d) => { window.__shares.push({ file: (d && d.files && d.files[0]) || null, n: d && d.files ? d.files.length : 0 }); return Promise.resolve(); });
};

// Выполняется в странице (evaluateOnNewDocument) — все страницы проверки. Открытка рисует зерно и износ штемпеля от зерна Date.now() (postcard.js) —
// без подмены открытки двух прогонов одного и того же сайта разные пиксель в пиксель и сравнение «как сейчас / кандидат» краснело бы всегда.
// Подменяем Date.now ТОЛЬКО для вызова из postcard.js (по стеку); остальной код страницы получает настоящее время.
export const CARD_DETERMINISM = () => {
  const dn = Date.now.bind(Date);
  Date.now = function () { try { if (/postcard\.js/.test(new Error().stack || '')) return 1789000000000; } catch (e) {} return dn(); };
};

// e1.28 (9б-1): «Открытка» открывает окно (body.card-open), открытку отдаёт кнопка #cardGo в окне. У страниц e1.27 нажатие #cardBtn отдаёт
// открытку сразу — окна нет. cardTapSave: нажать #cardBtn; если за ≤3 с открылось окно — дождаться, пока «Сохранить» встанет на место (шторка
// в облачном Chrome доезжает секундами: два одинаковых замера подряд, урок s26), и нажать её. Иначе — путь e1.27 (открытка уже ушла/уходит).
export async function cardTapSave(page, { click, sleep, openMs = 3000 }) {
  await page.evaluate(() => { window.__cardSheet = null; });
  await click('#cardBtn');
  let open = false;
  for (let i = 0; i < openMs / 150 && !open; i++) {
    open = await page.evaluate(() => document.body.classList.contains('card-open'));
    if (open) break;
    if (await page.evaluate(() => !!((window.__shares && window.__shares.length) || window.__download))) return { sheet: false };
    await sleep(150);
  }
  if (!open) return { sheet: false };
  let prev = null;
  for (let i = 0; i < 60; i++) {
    const r = await page.evaluate(() => { const b = document.getElementById('cardGo'); if (!b) return null; const q = b.getBoundingClientRect(); return [q.x, q.y, q.width, q.height].map(Math.round).join(','); });
    if (r && r === prev) break;
    prev = r; await sleep(200);
  }
  await click('#cardGo');
  return { sheet: true };
}
// закрыть окно открытки после шага (иначе затемнение окна перехватит следующие нажатия прогулки)
export async function cardSheetClose(page, sleep) {
  if (await page.evaluate(() => { if (!document.body.classList.contains('card-open')) return false; const b = document.getElementById('cardCfgClose'); if (b) b.click(); return true; })) await sleep(600);
}

// Шаг «открытка» телефонной прогулки. page — страница с SHARE_HOOK; click(sel) — нажатие (у check_site с виртуальным временем); sleep(ms).
// Возвращает { problems: [{type, msg}], png?: Buffer (что ушло в share, после JPEG), size?, name? }.
export async function phoneCardStep(page, { click, sleep, shareMs = 20000, fontsMs = 10000 }) {   // shareMs/fontsMs — пределы ожидания (в проверке сайта — 20 и 10 с; короче — только в самопроверке)
  const problems = [], out = { problems };
  const P = (msg) => problems.push({ type: 'прогулка', msg });
  // Шрифты открытки грузятся заранее, в простое: если нажать раньше, страница честно покажет плашку «готово» вместо share (второй тап) —
  // ждём (как человек, тапнувший не сразу), но не вечно: не догрузились — это тоже ошибка («заранее» не сработало).
  let fontsOk = false;
  for (let i = 0; i < fontsMs / 250 && !(fontsOk = await page.evaluate(() => !window.__card || window.__card.fontsReady())); i++) await sleep(250);
  if (!fontsOk) P(`шрифты открытки не догрузились заранее (за ${fontsMs / 1000} с): на телефоне вместо share будет плашка «готово»`);
  // карта здания для обхода памятника грузится в простое (до ~6 с после загрузки); ждём её (≤10 с), чтобы открытка двух копий сайта не зависела от того, успела ли она
  await page.evaluate(() => (window.__card && window.__card.bldLoad ? window.__card.bldLoad() : null));
  await page.evaluate(() => { window.__shares = []; window.__lastImageBlob = null; window.__download = null; });
  const tap = await cardTapSave(page, { click, sleep });
  out.sheet = tap.sheet;
  let sh = 0;
  for (let i = 0; i < shareMs / 200 && !sh; i++) { await sleep(200); sh = await page.evaluate(() => window.__shares.length); }
  if (!sh) {
    const d = await page.evaluate(() => ({ shares: window.__shares.length, dl: window.__download, blob: !!window.__lastImageBlob, toast: !!document.getElementById('cardToast') && document.getElementById('cardToast').classList.contains('on'), sheet: document.body.classList.contains('card-open'), share: typeof navigator.share, coarse: matchMedia('(pointer: coarse)').matches, fonts: window.__card ? window.__card.fontsReady() : null, btn: (() => { const b = document.getElementById('cardBtn'); return b ? { hidden: b.hidden, r: b.getBoundingClientRect().toJSON() } : null; })() }));
    P(`открытка не ушла в share (нет файла за ${shareMs / 1000} с): ` + JSON.stringify(d));
    return out;
  }
  await sleep(300);   // второго вызова share от одного нажатия быть не должно
  const r = await page.evaluate(async () => {
    const s = window.__shares, f = s[0].file;
    if (!f) return { n: s.length, nofile: true };
    const bm = await createImageBitmap(f), c = document.createElement('canvas'); c.width = bm.width; c.height = bm.height; c.getContext('2d').drawImage(bm, 0, 0);
    return { n: s.length, type: f.type, size: f.size, name: f.name, w: bm.width, h: bm.height, png: c.toDataURL('image/png').split(',')[1] };
  });
  if (r.nofile) { P('share вызван без файла'); return out; }
  if (r.type !== 'image/jpeg') P(`открытка в share: тип ${r.type}, нужен image/jpeg`);
  if (r.w !== 1080 || r.h !== 1920) P(`открытка в share: ${r.w}×${r.h}, нужно 1080×1920`);
  if (r.n !== 1) P(`одно нажатие вызвало share ${r.n} раз(а)`);
  out.png = Buffer.from(r.png, 'base64'); out.size = r.size; out.name = r.name;
  return out;
}
