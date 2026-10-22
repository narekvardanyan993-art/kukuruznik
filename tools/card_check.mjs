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
  put('share', (d) => { window.__shares.push({ file: (d && d.files && d.files[0]) || null, files: (d && d.files) ? Array.from(d.files) : [], n: d && d.files ? d.files.length : 0 }); return Promise.resolve(); });
};

// Выполняется в странице (evaluateOnNewDocument) — все страницы проверки. Открытка рисует зерно и износ штемпеля от зерна Date.now() (postcard.js) —
// без подмены открытки двух прогонов одного и того же сайта разные пиксель в пиксель и сравнение «как сейчас / кандидат» краснело бы всегда.
// Подменяем Date.now ТОЛЬКО для вызова из postcard.js (по стеку); остальной код страницы получает настоящее время.
export const CARD_DETERMINISM = () => {
  const dn = Date.now.bind(Date);
  Date.now = function () { try { if (/postcard\.js/.test(new Error().stack || '')) return 1789000000000; } catch (e) {} return dn(); };
  // e1.29: зерно окна = время + случайность (ChkaPostcard.seed) — Math.random тоже подменяем только для postcard.js
  const mr = Math.random.bind(Math);
  Math.random = function () { try { if (/postcard\.js/.test(new Error().stack || '')) return 0.4242; } catch (e) {} return mr(); };
};

// e1.28 (9б-1): «Открытка» открывает окно (body.card-open), открытку отдаёт кнопка #cardGo в окне. У страниц e1.27 нажатие #cardBtn отдаёт
// открытку сразу — окна нет. cardTapSave: нажать #cardBtn; если за ≤3 с открылось окно — дождаться, пока «Сохранить» встанет на место (шторка
// в облачном Chrome доезжает секундами: два одинаковых замера подряд, урок s26), и нажать её. Иначе — путь e1.27 (открытка уже ушла/уходит).
export async function cardTapSave(page, { click, sleep, openMs = 3000, back = false }) {   // back — включить «Оборот» в окне (e1.29: 2 файла)
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
  // «Оборот» (e1.29): по умолчанию выкл. — включаем/выключаем кнопкой окна, чтобы шаг не зависел от прошлых настроек страницы
  const want = !!back, has = await page.evaluate(() => { const b = document.getElementById('cardBack'); return b ? b.getAttribute('aria-pressed') === 'true' : null; });
  if (has !== null && has !== want) { await page.evaluate(() => { const b = document.getElementById('cardBack'); b.scrollIntoView({ block: 'center' }); b.click(); }); await sleep(400); }
  await click('#cardGo');
  return { sheet: true, backBtn: has !== null };
}
// закрыть окно открытки после шага (иначе затемнение окна перехватит следующие нажатия прогулки)
export async function cardSheetClose(page, sleep) {
  if (await page.evaluate(() => { if (!document.body.classList.contains('card-open')) return false; const b = document.getElementById('cardCfgClose'); if (b) b.click(); return true; })) await sleep(600);
}

// Шаг «открытка» телефонной прогулки. page — страница с SHARE_HOOK; click(sel) — нажатие (у check_site с виртуальным временем); sleep(ms).
// Возвращает { problems: [{type, msg}], png?: Buffer (что ушло в share, после JPEG), size?, name? }.
export async function phoneCardStep(page, { click, sleep, shareMs = 20000, fontsMs = 10000, back = false, settled = null }) {   // back: с оборотом — ровно 2 файла (лицо + оборот), оба JPEG 1080×1920   // shareMs/fontsMs — пределы ожидания (в проверке сайта — 20 и 10 с; короче — только в самопроверке)
  // settled (только самопроверка, tools/test_card_check.mjs): async () => true, когда страница-подделка закончила все свои вызовы share — ждём это событие вместо фиксированного окна; боевые проверки settled не передают
  const problems = [], out = { problems };
  const P = (msg) => problems.push({ type: 'прогулка', msg });
  // Шрифты открытки грузятся заранее, в простое: если нажать раньше, страница честно покажет плашку «готово» вместо share (второй тап) —
  // ждём (как человек, тапнувший не сразу), но не вечно: не догрузились — это тоже ошибка («заранее» не сработало).
  let fontsOk = false;
  for (let i = 0; i < fontsMs / 250 && !(fontsOk = await page.evaluate(() => !window.__card || window.__card.fontsReady())); i++) await sleep(250);
  if (!fontsOk) P(`шрифты открытки не догрузились заранее (за ${fontsMs / 1000} с): на телефоне вместо share будет плашка «готово»`);
  // e1.33: старая бумага открытки тоже грузится заранее (в простое, после шрифтов); не догрузилась — открытка, снятая сразу после открытия окна,
  // уходит без неё (и у двух копий сайта получается разной). Страницы без paperReady (до e1.33) пропускаются.
  let paperOk = false;
  for (let i = 0; i < fontsMs / 250 && !(paperOk = await page.evaluate(() => !window.__card || !window.__card.paperReady || window.__card.paperReady())); i++) await sleep(250);
  if (!paperOk) P(`бумага открытки не догрузилась заранее (за ${fontsMs / 1000} с): открытка, снятая сразу после открытия окна, уйдёт без неё`);
  // карта здания для обхода памятника грузится в простое (до ~6 с после загрузки); ждём её (≤10 с), чтобы открытка двух копий сайта не зависела от того, успела ли она
  await page.evaluate(() => (window.__card && window.__card.bldLoad ? window.__card.bldLoad() : null));
  await page.evaluate(() => { window.__shares = []; window.__lastImageBlob = null; window.__download = null; });
  const tap = await cardTapSave(page, { click, sleep, back });
  out.sheet = tap.sheet;
  if (back && !tap.backBtn) { P('с оборотом: в окне нет кнопки «Оборот» (#cardBack)'); return out; }
  let sh = 0;
  for (let i = 0; i < shareMs / 200 && !sh; i++) {
    await sleep(200); sh = await page.evaluate(() => window.__shares.length);
    if (!sh && settled && await settled()) { await sleep(200); sh = await page.evaluate(() => window.__shares.length); break; }   // подделка отработала и share не звала — красное сразу, без ожидания таймаута
  }
  if (!sh) {
    const d = await page.evaluate(() => ({ shares: window.__shares.length, dl: window.__download, blob: !!window.__lastImageBlob, toast: !!document.getElementById('cardToast') && document.getElementById('cardToast').classList.contains('on'), sheet: document.body.classList.contains('card-open'), share: typeof navigator.share, coarse: matchMedia('(pointer: coarse)').matches, fake: window.__fake || undefined, fonts: window.__card ? window.__card.fontsReady() : null, btn: (() => { const b = document.getElementById('cardBtn'); return b ? { hidden: b.hidden, r: b.getBoundingClientRect().toJSON() } : null; })() }));
    P(`открытка не ушла в share (${settled ? 'страница-подделка отработала и share не вызвала' : 'нет файла за ' + shareMs / 1000 + ' с'}): ` + JSON.stringify(d));
    return out;
  }
  if (settled) { for (let i = 0; i < shareMs / 200 && !(await settled()); i++) await sleep(200); }   // самопроверка: ждём, пока подделка сделает ВСЕ свои вызовы share (второй вызов «twice»), а не гадаем паузой
  await sleep(300);   // второго вызова share от одного нажатия быть не должно
  const n1 = await page.evaluate(() => window.__shares.length), c1 = await page.evaluate(() => { const s = window.__shares[0]; return s.files && s.files.length ? s.files.length : (s.file ? 1 : 0); });
  // e1.35: с оборотом — два нажатия, по файлу на share (iOS с двумя файлами в одном share сохранял только оборот). После лица кнопка
  // «Сохранить» становится «Сохранить оборот» (#cardGo.cc-go2) — нажимаем её и ждём второй share. Старые страницы (≤ e1.34) отдают 2 файла сразу.
  let n2 = 0;
  if (back && n1 === 1 && c1 === 1) {
    let step2 = false;
    for (let i = 0; i < 25 && !(step2 = await page.evaluate(() => { const b = document.getElementById('cardGo'); return !!b && b.classList.contains('cc-go2'); })); i++) await sleep(200);
    if (!step2) { P('с оборотом: после лица кнопка не стала «Сохранить оборот» (#cardGo.cc-go2) — оборот не сохранить'); return out; }
    if (settled) await page.evaluate(() => { window.__fake.done = false; });
    await click('#cardGo');
    for (let i = 0; i < shareMs / 200 && (n2 = await page.evaluate(() => window.__shares.length)) < 2; i++) {
      await sleep(200);
      if (settled && await settled()) { await sleep(200); n2 = await page.evaluate(() => window.__shares.length); break; }
    }
    if (n2 < 2) { P(`с оборотом: второе нажатие «Сохранить оборот» не вызвало share за ${shareMs / 1000} с`); return out; }
    if (settled) { for (let i = 0; i < shareMs / 200 && !(await settled()); i++) await sleep(200); }
    await sleep(300);
    n2 = await page.evaluate(() => window.__shares.length);
  }
  const r = await page.evaluate(async () => {
    const s = window.__shares, fl = [];
    s.forEach((q) => { const f = (q.files && q.files.length) ? q.files : (q.file ? [q.file] : []); f.forEach((x) => fl.push(x)); });
    if (!fl.length) return { n: s.length, nofile: true };
    // «не пустой»: разброс яркости на уменьшенной копии 108×192 (однотонная заливка / пустой холст iOS — ~0)
    const one = async (f) => { const bm = await createImageBitmap(f), c = document.createElement('canvas'); c.width = bm.width; c.height = bm.height; const x = c.getContext('2d'); x.drawImage(bm, 0, 0);
      const m = document.createElement('canvas'); m.width = 108; m.height = 192; const mx = m.getContext('2d'); mx.drawImage(bm, 0, 0, 108, 192);
      const d = mx.getImageData(0, 0, 108, 192).data; let a = 0, a2 = 0, k = 0; for (let i = 0; i < d.length; i += 4) { const L = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; a += L; a2 += L * L; k++; }
      const sd = Math.sqrt(Math.max(0, a2 / k - (a / k) * (a / k)));
      return { type: f.type, size: f.size, name: f.name, w: bm.width, h: bm.height, sd: +sd.toFixed(2), png: c.toDataURL('image/png').split(',')[1] }; };
    const files = []; for (const f of fl) files.push(await one(f));
    return Object.assign({ n: s.length, count: fl.length, files }, files[0]);
  });
  if (r.nofile) { P('share вызван без файла'); return out; }
  const need = back ? 2 : 1;
  if (r.count !== need) P(`открытка в share: файлов ${r.count}, нужно ${need} (${back ? 'лицо + оборот' : 'без оборота — только лицо'})`);
  const MAXB = 1024 * 1024 * 1.15;   // e1.34: цель ~1 МБ (fileFromCanvas подбирает качество) — запас 15% на счёт JPEG-накладных
  r.files.forEach((f, i) => {
    const what = i ? 'оборот' : 'открытка';
    if (f.type !== 'image/jpeg') P(`${what} в share: тип ${f.type}, нужен image/jpeg`);
    if (f.w !== 1080 || f.h !== 1920) P(`${what} в share: ${f.w}×${f.h}, нужно 1080×1920`);
    if (f.size > MAXB) P(`${what} в share: ${(f.size / 1024 / 1024).toFixed(2)} МБ, нужно ≤ ~1 МБ`);
    if (!(f.sd >= 4)) P(`${what} в share пустая: однотонная картинка (разброс яркости ${f.sd}) — похоже, пустой холст`);   // e1.35: «оба файла непустые»
  });
  const taps = back && n2 ? 2 : 1;
  if (r.n !== taps) P(taps === 1 ? `одно нажатие вызвало share ${r.n} раз(а)` : `два нажатия вызвали share ${r.n} раз(а)`);
  out.png = Buffer.from(r.png, 'base64'); out.size = r.size; out.name = r.name;
  if (r.files[1]) {
    out.backPng = Buffer.from(r.files[1].png, 'base64'); out.backName = r.files[1].name;
    // «оборот не пустой»: не однотонная заливка — доля непохожих друг на друга пикселей (PNG, без декодирования — по сжатому размеру
    // и по байтовой энтропии первых блоков хватает отличить «один цвет» от «рисунок»; порог грубый, но ловит «забыли нарисовать»).
    if (out.backPng.length < 6000) P(`оборот подозрительно лёгкий как PNG (${out.backPng.length} Б) — похоже, пустой лист`);
  }
  return out;
}

// e1.35: окно открытки на НАСТОЯЩЕЙ странице (check_card_phone): (1) в окне нет своего переключателя языка (язык = язык страницы);
// (2) смена опции «Момента» (+ «Праздник», если он есть у кадра) и «Показать» не сбрасывают кадр: и сцена, и снимок открытки — на том
// кадре, где стоял человек (баг iPhone: всё уезжало на кадр 1). frame — номер кадра (не первый). Вызывать при закрытой панели.
export async function cardFrameKeepStep(page, { click, sleep, frame = 1 }) {
  const problems = [], P = (msg) => problems.push({ type: 'прогулка', msg });
  const has = await page.evaluate(() => !!(window.__card && window.__card.state && window.__viewer));
  if (!has) return { problems, skipped: true };
  for (let g = 0; g < 12 && (await page.evaluate(() => window.__viewer.frame())) !== frame; g++) {
    await page.keyboard.press('ArrowRight');
    for (let k = 0; k < 80; k++) { await sleep(150); if (!(await page.evaluate(() => window.__viewer.fading()))) break; }
  }
  await sleep(600);
  if ((await page.evaluate(() => window.__viewer.frame())) !== frame) { P(`не удалось перейти на кадр ${frame + 1} (стрелкой)`); return { problems }; }
  await page.evaluate(() => window.__card.open());
  await sleep(1200);
  const lang = await page.evaluate(() => document.querySelectorAll('#cardCfg [data-clang]').length);
  if (lang) P(`в окне открытки есть переключатель языка (${lang} кнопки [data-clang]) — язык открытки = язык страницы`);
  const st0 = await page.evaluate(() => window.__card.state());
  if (st0.srcFrame !== undefined && st0.srcFrame !== frame) P(`открытка при открытии снята с кадра ${st0.srcFrame + 1}, а человек на кадре ${frame + 1}`);
  const runs = [['снег', () => { const b = document.querySelector('#cardCfg [data-cwx=snow]'); if (b) b.click(); return !!b; }]];
  if (await page.evaluate(() => { const b = document.getElementById('cardShowOn'); return !!b && !b.hidden; }))
    runs.push(['праздник', () => { const b = document.getElementById('cardShowOn'); if (b.getAttribute('aria-pressed') !== 'true') b.click(); return true; }]);
  const out = [];
  for (const [name, fn] of runs) {
    if (!(await page.evaluate(fn))) continue;
    // кадр сцены — каждый кадр анимации, пока идёт съёмка (независимо от того, что движок сам о себе скажет): старый код уезжал на кадр праздника
    // на время снимка и возвращался — по итоговому кадру этого не видно
    await page.evaluate(() => { window.__seenOn = true; const seen = window.__seenFrames = new Set(); (function f() { seen.add(window.__viewer.frame()); if (window.__seenOn) requestAnimationFrame(f); })(); window.__card.show(); });
    for (let i = 0; i < 200 && (await page.evaluate(() => window.__card.state().busy)); i++) await sleep(200);
    await sleep(400);
    const s = await page.evaluate(() => { window.__seenOn = false; return { st: window.__card.state(), fr: window.__viewer.frame(), seen: [...window.__seenFrames] }; });
    out.push({ name, scene: s.fr, src: s.st.srcFrame, seen: s.seen, dirty: s.st.dirty });
    if (s.fr !== frame) P(`после «${name}» + «Показать» сцена уехала на кадр ${s.fr + 1} (был ${frame + 1})`);
    const away = s.seen.filter((f) => f !== frame);
    if (away.length) P(`во время «${name}» + «Показать» сцена уезжала на кадр ${away.map((f) => f + 1).join(', ')} (человек на кадре ${frame + 1}) — открытка снята не с его кадра`);
    if (s.st.srcFrame !== undefined && s.st.srcFrame !== frame) P(`после «${name}» + «Показать» открытка снята с кадра ${s.st.srcFrame + 1}, а человек на кадре ${frame + 1}`);
    if (s.st.dirty) P(`после «${name}» + «Показать» превью не обновилось (Показать всё ещё горит)`);
  }
  await page.evaluate(() => { const b = document.getElementById('cardShowOn'); if (b && !b.hidden && b.getAttribute('aria-pressed') === 'true') b.click(); const sn = document.querySelector('#cardCfg [data-cwx=snow].on'); if (sn) sn.click(); });   // вернуть как было (настройка «праздник» запоминается)
  await page.evaluate(() => window.__card.close());
  await sleep(600);
  return { problems, runs: out };
}
