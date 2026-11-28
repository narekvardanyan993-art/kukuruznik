/* chka.am — «Оригинал» для замороженного engine-k (Кукурузник, Ленин). Единственная правка engine-k после заморозки — разрешение Нарека 26.11:
   «Оригинал» на каждом кадре, вид и поведение как в e2 (e2/src/fx/original.js, e2.0.30). Отдельный файл + одна строка в page.html; viewer.js не тронут.
   Пункт меню «Оригинал» (в ряду действий) → шторка-карандаш: стартует на 60 % ширины (правее центра), слева рисунок, справа архивное фото. Фото вписано в экран целиком и стоит по центру
   (между табличкой и кнопкой «Закрыть»); ссылка «источник» — в новой вкладке (e1.62-k2, уточнение Нарека 26.11).
   Линию двигает палец/мышь (← → на ПК). Табличка сверху — «Оригинал · год» и «источник ↗»; подпись автора и лицензии — мелко на самом фото.
   Закрыть — кнопка «Закрыть» внизу, Esc, смена кадра. Фото — уже опубликованные снимки галереи здания (gallery/…, авторство как в галерее),
   грузятся только по нажатию. Данные кадров — ниже (имя кадра → фото); их источник — work/originals/<здание>.md («G»).
   Для проверки: window.__orig = { open(), close(), set(cut), state() }. */
(function () {
  'use strict';
  var U = { hy: 'հեղինակն անհայտ է', ru: 'автор неизвестен', en: 'author unknown' };
  var KDM = { hy: 'Կարեն Դեմիրճյանի թանգարան / Wikimedia Commons', ru: 'Музей Карена Демирчяна / Wikimedia Commons', en: 'Karen Demirchyan Museum / Wikimedia Commons' };
  var AMPV = { hy: 'Լուսանկարների և տեսանյութերի հայկական թանգարան / Wikimedia Commons', ru: 'Армянский музей фото- и видеоматериалов / Wikimedia Commons', en: 'Armenian Museum of Photo and Video Materials / Wikimedia Commons' };
  var COM = function (a) { return { hy: a.hy + ' / Wikimedia Commons', ru: a.ru + ' / Wikimedia Commons', en: a.en + ' / Wikimedia Commons' }; };
  var HILL = { src: 'gallery/hillview.webp', size: [1200, 1755], year: '', credit: KDM, license: 'CC BY-SA 4.0', url: 'https://commons.wikimedia.org/wiki/File:Youth_Palace_02.tif' };
  var L40 = { src: 'gallery/lenin-1940s.webp', size: [789, 1145], year: '1940', approx: true, credit: COM(U), license: 'PD', url: 'https://commons.wikimedia.org/wiki/File:Lenin_Statue_in_Yerevan_Lenin_Square.jpg' };
  var LSQ = { src: 'gallery/removal-1991-square.webp', size: [1200, 808], year: '1991', credit: AMPV, license: 'CC BY-SA 2.0', url: 'https://commons.wikimedia.org/wiki/File:Lenin_Statue_Removal_in_Yerevan_05.jpg' };
  var LCR = { src: 'gallery/removal-1991-crane.webp', size: [1200, 794], year: '1991', credit: AMPV, license: 'CC BY-SA 2.0', url: 'https://commons.wikimedia.org/wiki/File:Lenin_Statue_Removal_in_Yerevan_02.jpg' };
  function w(base, c) { var o = {}; for (var k in base) o[k] = base[k]; o.center = c; return o; }
  var DATA = {
    v_angle_0: w(HILL, [0.5, 0.45]), v_angle_1: w(HILL, [0.5, 0.45]), v_angle_2: w(HILL, [0.5, 0.45]), v_angle_3: w(HILL, [0.5, 0.45]), v_angle_4: w(HILL, [0.5, 0.4]),
    v_angle_5: { src: 'gallery/facade.webp', size: [768, 688], year: '', credit: KDM, license: 'CC BY-SA 4.0', url: 'https://commons.wikimedia.org/wiki/File:Youth_Palace_01.jpg', center: [0.629, 0.497] },
    lenin_1: w(L40, [0.42, 0.45]), lenin_2: w(LSQ, [0.6, 0.55]), lenin_3: w(LCR, [0.5, 0.6]), lenin_4: w(L40, [0.55, 0.3]), lenin_6: w(LSQ, [0.6, 0.55])
  };
  var T = {
    title: { hy: 'Բնօրինակը', ru: 'Оригинал', en: 'Original' }, drawing: { hy: 'նկար', ru: 'рисунок', en: 'drawing' }, photo: { hy: 'լուսանկար', ru: 'фото', en: 'photo' },
    src: { hy: 'աղբյուրը ↗', ru: 'источник ↗', en: 'source ↗' }, approx: { hy: 'մոտ ', ru: 'около ', en: 'c. ' }, by: { hy: 'լուսանկարը՝ ', ru: 'фото: ', en: 'photo: ' },
    close: { hy: 'Փակել', ru: 'Закрыть', en: 'Close' }, drag: { hy: 'Տեղաշարժեք գիծը', ru: 'Двигайте линию', en: 'Drag the line' }
  };
  var CSS = [
    '#korig { position: absolute; inset: 0; z-index: 40; overflow: hidden; touch-action: none; cursor: ew-resize; -webkit-user-select: none; user-select: none; }',
    '#korig[hidden] { display: none; }',
    '#korig .og-side { position: absolute; inset: 0; clip-path: inset(0 0 0 100%); -webkit-clip-path: inset(0 0 0 100%); }',
    '#korig .og-paper { position: absolute; inset: 0; background: radial-gradient(120% 90% at 50% 45%, rgba(239,228,204,.9), rgba(226,211,180,.95)); }',
    '#korig .og-img { position: absolute; left: 0; top: 0; display: block; max-width: none; opacity: 0; pointer-events: none; transition: opacity 700ms ease; }',
    '#korig .og-img.in { opacity: 1; filter: sepia(0.18) contrast(1.04); }',
    '#korig .og-credit { position: absolute; box-sizing: border-box; max-width: min(calc(50% - 24px), 300px); padding: 2px 6px; font: 400 10.5px/1.25 var(--font); color: var(--ink); background: rgba(245,236,218,.78); border-radius: 3px; text-align: right; pointer-events: none; }',
    '#korig .og-line { position: absolute; left: -6px; top: 0; bottom: 0; width: 12px; pointer-events: none; }',
    '#korig .og-line svg { width: 100%; height: 100%; overflow: visible; }',
    '#korig .og-line path { fill: none; stroke: var(--ink); stroke-linecap: round; vector-effect: non-scaling-stroke; }',
    '#korig .og-line .l1 { stroke-width: 2.2; } #korig .og-line .l2 { stroke-width: 0.9; opacity: .45; }',
    '#korig .og-knob { position: absolute; left: -22px; top: 56%; width: 44px; height: 44px; margin: -22px 0 0; padding: 0; border: 0; background: none; color: var(--ink); }',
    '#korig .og-dot { display: grid; place-items: center; width: 44px; height: 44px; box-sizing: border-box; border-radius: 50%; background: var(--paper); border: 1.8px solid var(--ink); box-shadow: 0 2px 6px rgba(47,42,37,.3); }',
    '#korig .og-dot svg { width: 26px; height: 26px; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }',
    '#korig .og-tag { position: absolute; top: 50%; transform: translateY(-50%); padding: 3px 8px; font: 600 13px/1.2 var(--font); white-space: nowrap; color: var(--ink); background: rgba(245,236,218,.9); border: 1px solid rgba(47,42,37,.4); border-radius: 3px; }',
    '#korig .og-l { right: calc(100% + 6px); } #korig .og-r { left: calc(100% + 6px); }',
    '#korig.edge-l .og-l, #korig.edge-r .og-r { opacity: 0; }',
    '#korig .og-plate { position: absolute; left: 50%; top: calc(env(safe-area-inset-top, 0px) + 14px); transform: translateX(-50%); box-sizing: border-box; width: max-content; max-width: min(calc(100% - 24px), 380px); display: grid; gap: 2px; padding: 8px 16px; text-align: center; color: var(--ink); background: rgba(245,236,218,.95); border: 1.5px solid var(--ink); border-radius: 4px; box-shadow: 2px 3px 0 rgba(47,42,37,.16); cursor: default; }',
    '#korig .og-plate b { font: 700 17px/1.25 var(--font); }',
    '#korig .og-plate a { justify-self: center; min-height: 30px; display: inline-flex; align-items: center; padding: 0 6px; font: 600 13px/1 var(--font); color: #8a2c33; text-underline-offset: 3px; }',
    '#korig .og-plate a[hidden] { display: none; }',
    '#korig .og-close { position: absolute; left: 50%; bottom: calc(env(safe-area-inset-bottom, 0px) + 14px); transform: translateX(-50%); display: grid; place-items: center; gap: 1px; min-width: 58px; min-height: 52px; padding: 4px 8px; box-sizing: border-box; font: 600 12px/1.1 var(--font); color: var(--ink); background: rgba(245,236,218,.95); border: 1.6px solid var(--ink); border-radius: 4px; box-shadow: 2px 3px 0 rgba(47,42,37,.16); cursor: pointer; }',
    '#korig .og-close svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2.4; stroke-linecap: round; }',
    'body.korig-on #bottomBar, body.korig-on #homeBtn, body.korig-on #panelBtn, body.korig-on #prevSide, body.korig-on #nextSide, body.korig-on #prevBtn, body.korig-on #nextBtn { opacity: 0 !important; pointer-events: none !important; }',
    '.p-acts .act-orig[hidden] { display: none; } #korigBtn[disabled] { opacity: .45; pointer-events: none; }',
    '#korigBtn svg { fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; }'
  ].join('\n');
  var root, side, img, cred, line, knob, plate, pT, pA, tagL, tagR, btn, closeB, stage;
  var OPEN_TO = 0.6, on = false, fr = -1, cut = 1, target = 1, closing = false, drag = null, rect = null, t0 = 0, ready = false, last = 0;
  function lang() { var l = document.documentElement.lang; return T.title[l] ? l : 'hy'; }
  function tr(k) { return T[k][lang()] || T[k].en; }
  function loc(v) { return v && typeof v === 'object' ? (v[lang()] || v.en || '') : (v || ''); }
  function el(tag, cls, parent) { var e = document.createElement(tag); if (cls) e.className = cls; parent.appendChild(e); return e; }
  function nameOf(i) {
    var F = window.CONFIG && CONFIG.FRAMES && CONFIG.FRAMES[i], c = F && (typeof F.color === 'string' ? F.color : '');
    var m = /([^\/?#]+)\.webp(?:[?#]|$)/.exec(c || ''); return m ? m[1] : null;
  }
  function photo(i) { return DATA[nameOf(i)] || null; }
  function frame() { return window.__viewer ? window.__viewer.frame() : 0; }
  function text() {
    var p = photo(fr); if (!p) return;
    pT.textContent = tr('title') + (p.year ? ' · ' + (p.approx ? tr('approx') : '') + p.year : '');
    cred.textContent = tr('by') + loc(p.credit) + (p.license ? ' · ' + p.license : '');
    pA.hidden = !p.url; if (p.url) { pA.href = p.url; pA.textContent = tr('src'); }
    tagL.textContent = tr('drawing'); tagR.textContent = tr('photo'); knob.setAttribute('aria-label', tr('drag'));
    closeB.querySelector('span').textContent = tr('close');
  }
  function updBtn() { if (btn) btn.disabled = !photo(frame()); }
  function closeSheet() { var b = document.body; if (b.classList.contains('sheet-open')) { var x = document.getElementById('sheetClose'); if (x) x.click(); } }
  function open() {
    var i = frame(), p = photo(i);
    if (!p || (window.__viewer && window.__viewer.fading())) return false;
    closeSheet();
    fr = i; on = true; closing = false; ready = false; cut = 1.02; target = OPEN_TO; t0 = performance.now(); last = t0;
    text();
    img.classList.remove('in');
    img.onload = function () { ready = true; img.classList.add('in'); };
    img.onerror = function () { shut(true); };
    var c = String(CONFIG.FRAMES[i].color || '').split(/[?#]/)[0], base = c.slice(0, c.lastIndexOf('/') + 1).replace(/[^\/]*\/$/, '');   // папка здания = родитель папки кадров (бета Кукурузника — ../../kukuruznik/)
    var u = new URL(base + p.src, location.href).href;
    if (img.src !== u) img.src = u; else if (img.complete && img.naturalWidth) img.onload();
    root.hidden = false; document.body.classList.add('korig-on');
    requestAnimationFrame(step);
    return true;
  }
  function shut(now) {
    if (!on) return false;
    if (now) { on = false; closing = false; root.hidden = true; document.body.classList.remove('korig-on'); return true; }
    closing = true; target = 1.04; return true;
  }
  function place() {
    var p = photo(fr), W = root.clientWidth, H = root.clientHeight, asp = p.size[0] / p.size[1];
    var top = Math.ceil(plate.offsetTop + plate.offsetHeight + 6), bot = 70, ah = Math.max(60, H - top - bot);
    var pw = Math.min(W, ah * asp), ph = pw / asp, x0 = (W - pw) / 2, y0 = top + (ah - ph) / 2;
    rect = [x0, y0, x0 + pw, y0 + ph];
    img.style.left = x0.toFixed(1) + 'px'; img.style.top = y0.toFixed(1) + 'px'; img.style.width = pw.toFixed(1) + 'px'; img.style.height = ph.toFixed(1) + 'px';
    cred.style.maxWidth = Math.max(90, Math.min(300, x0 + pw - OPEN_TO * W - 12)).toFixed(0) + 'px';
    cred.style.right = Math.max(8, W - Math.min(W, x0 + pw) + 8).toFixed(1) + 'px';
    cred.style.bottom = Math.max(bot + 4, H - Math.min(H, y0 + ph) + 8).toFixed(1) + 'px';
    return W;
  }
  function step(now) {
    if (!on) return;
    if (frame() !== fr) { shut(true); return; }
    var W = place(), dt = Math.min(64, (now || performance.now()) - last); last = now || performance.now();
    var k = drag !== null ? 0.45 : ((last - t0 < 1400 && !closing) ? 0.07 : 0.16);
    cut += (target - cut) * (1 - Math.pow(1 - k, dt / 16.667));
    if (Math.abs(target - cut) < 0.0005) cut = target;
    if (closing && cut > 1.0) { shut(true); return; }
    var x = cut * W;
    side.style.clipPath = side.style.webkitClipPath = 'inset(0 0 0 ' + x.toFixed(1) + 'px)';
    line.style.transform = knob.style.transform = 'translateX(' + x.toFixed(1) + 'px)';
    root.classList.toggle('edge-l', cut < 0.2); root.classList.toggle('edge-r', cut > 0.8);
    requestAnimationFrame(step);
  }
  function init() {
    stage = document.getElementById('stage');
    var acts = document.getElementById('pActs');
    if (!stage || !acts || !window.CONFIG || !CONFIG.FRAMES || !CONFIG.FRAMES.some(function (f, i) { return !!photo(i); })) return;
    var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    var a = el('div', 'act act-orig', acts);
    btn = el('button', 'chip chip-act', a); btn.type = 'button'; btn.id = 'korigBtn';
    btn.innerHTML = '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M5.4 7.6 Q16 6.8 26.6 7.4 Q27.4 16 26.7 24.6 Q16 25.4 5.3 24.7 Q4.6 16 5.4 7.6Z" stroke-width="1.8"/><path d="M8.8 21.4 L13.4 15.6 L16.6 19 L19 16.6 L23.2 21.4" stroke-width="1.6"/><path d="M16 4.2 V27.8" stroke-width="1.4" stroke-dasharray="2.2 2"/></svg><span></span>';
    btn.addEventListener('click', function (e) { e.stopPropagation(); open(); });
    root = el('div', '', stage); root.id = 'korig'; root.hidden = true;
    side = el('div', 'og-side', root); el('div', 'og-paper', side);
    img = el('img', 'og-img', side); img.alt = ''; img.decoding = 'async'; img.draggable = false;
    cred = el('small', 'og-credit', side);
    line = el('div', 'og-line', root);
    line.innerHTML = '<svg viewBox="0 0 12 100" preserveAspectRatio="none" aria-hidden="true"><path class="l1" d="M6 0 Q4.6 22 6.4 46 T5.6 100"/><path class="l2" d="M7.6 0 Q6.4 26 8 50 T7.2 100"/></svg>';
    knob = el('button', 'og-knob', root); knob.type = 'button';
    knob.innerHTML = '<span class="og-tag og-l"></span><span class="og-dot"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M12.5 10.5 Q9 13.4 6.6 16 Q9 18.7 12.5 21.5 M19.5 10.5 Q23 13.4 25.4 16 Q23 18.7 19.5 21.5"/></svg></span><span class="og-tag og-r"></span>';
    tagL = knob.querySelector('.og-l'); tagR = knob.querySelector('.og-r');
    plate = el('div', 'og-plate', root); pT = el('b', '', plate); pA = el('a', '', plate); pA.target = '_blank'; pA.rel = 'noopener';
    closeB = el('button', 'og-close', root); closeB.type = 'button';
    closeB.innerHTML = '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M9 9l14 14M23 9L9 23"/></svg><span></span>';
    var stop = function (e) { e.stopPropagation(); };
    closeB.addEventListener('pointerdown', stop); closeB.addEventListener('click', function (e) { e.stopPropagation(); shut(false); });
    function fromClient(cx) { var r = root.getBoundingClientRect(); return (cx - r.left) / (r.width || 1); }
    root.addEventListener('pointerdown', function (e) {
      if (plate.contains(e.target) || closeB.contains(e.target)) { e.stopPropagation(); return; }
      e.stopPropagation(); e.preventDefault(); drag = e.pointerId; target = Math.min(1, Math.max(0, fromClient(e.clientX)));
      if (root.setPointerCapture) try { root.setPointerCapture(e.pointerId); } catch (err) { /* без захвата — пока палец над фото */ }
    });
    root.addEventListener('pointermove', function (e) { e.stopPropagation(); if (drag === e.pointerId) target = Math.min(1, Math.max(0, fromClient(e.clientX))); });
    var up = function (e) { if (drag === e.pointerId) drag = null; };
    root.addEventListener('pointerup', up); root.addEventListener('pointercancel', up);
    ['click', 'touchstart', 'touchmove', 'wheel', 'mousedown', 'mousemove'].forEach(function (t) { root.addEventListener(t, stop, { passive: true }); });
    window.addEventListener('keydown', function (e) {
      if (!on) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.stopPropagation(); e.preventDefault(); target = Math.min(1, Math.max(0, target + (e.key === 'ArrowLeft' ? -0.1 : 0.1))); }
      if (e.key === 'Escape') { e.stopPropagation(); shut(false); }
    }, true);
    var lbl = function () { btn.querySelector('span').textContent = tr('title'); btn.setAttribute('aria-label', tr('title')); if (on) text(); updBtn(); };
    lbl(); new MutationObserver(lbl).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
    setInterval(updBtn, 500);
    window.__orig = {
      open: open, close: function () { return shut(false); }, has: function (i) { return !!photo(i === undefined ? frame() : i); }, name: nameOf,
      set: function (x) { if (!on) return false; target = cut = Math.min(1, Math.max(0, x)); return true; },
      state: function () {
        var p = on ? photo(fr) : null;
        return { on: on, frame: fr, cut: +cut.toFixed(4), ready: ready && !!img.naturalWidth, rect: rect, center: p ? p.center : null, size: p ? p.size : null,
          img: on ? img.getBoundingClientRect().toJSON() : null, stage: root.getBoundingClientRect().toJSON(), plate: on ? plate.getBoundingClientRect().toJSON() : null,
          src: img.src, text: on ? plate.textContent : '', credit: on ? cred.textContent : '', creditBox: on ? cred.getBoundingClientRect().toJSON() : null };
      }
    };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
