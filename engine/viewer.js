/* ==========================================================================================================
   ПРОСМОТРЩИК «3D-фото» — основной скрипт. Вынесен из depth.html в отдельный файл, чтобы браузер мог разбирать и
   компилировать его в фоне (defer), пока показывается приветствие: разбор ~90 КБ JS на слабом телефоне — это
   сотни миллисекунд главного потока. CONFIG и приветствие остаются в самом HTML (они нужны первыми).
   ========================================================================================================== */
(function () {
  'use strict';

  // Движок (engine/) лежит отдельно от страницы здания: свои файлы (prep.js, details.js) берём рядом с этим скриптом
  // (с той же версией в адресе), а адреса кадров делаем полными — воркер считает относительный адрес от своего файла, а не от страницы.
  var ENGINE_SRC = (document.currentScript && document.currentScript.src) || '';
  var ENGINE_BASE = ENGINE_SRC.replace(/[?#].*$/, '').replace(/[^\/]*$/, '');
  var ENGINE_Q = (ENGINE_SRC.match(/\?[^#]*/) || [''])[0];
  function engineUrl(name) { return ENGINE_BASE + name + ENGINE_Q; }
  function absUrls(v) {
    if (typeof v === 'string') { try { return new URL(v, document.baseURI).href; } catch (e) { return v; } }
    if (v && typeof v === 'object') { var o = {}; for (var k in v) if (Object.prototype.hasOwnProperty.call(v, k)) o[k] = absUrls(v[k]); return o; }
    return v;
  }
  CONFIG.FRAMES = CONFIG.FRAMES.map(absUrls);

  var stage = document.getElementById('stage');
  var canvas = document.getElementById('gl');
  var prevBtn = document.getElementById('prevBtn');
  var nextBtn = document.getElementById('nextBtn');
  var dotsEl = document.getElementById('dots');
  var fbEl = document.getElementById('fallback');
  var panelBtn = document.getElementById('panelBtn');

  // Все списки «по кадрам» в CONFIG (кадры, точки, фонари, обрезка, флаги, небо, SCENE…) — одной длины и только из видимых кадров:
  // скрытые кадры (hidden в building.json) убирает сборка (tools/build_pages.py), поэтому номер кадра везде один и тот же.
  var FRAMES = CONFIG.FRAMES, HS = CONFIG.HOTSPOTS, LAMPS = CONFIG.LAMPS;
  var PARADE_FRAME = CONFIG.PARADE_FRAME == null ? -1 : CONFIG.PARADE_FRAME;   // кадр, на котором живёт кнопка парада; -1 — у здания парада нет
  // e1.3: парад может быть на нескольких кадрах, у каждого свой (самолёты / дроны / вертолёт); у старых настроек — только PARADE_FRAME, самолёты
  var PARADE_STYLES = CONFIG.PARADE_STYLES || CONFIG.FRAMES.map(function (_, i) { return i === PARADE_FRAME ? 'planes' : null; });
  function hasParade(i) { return !!PARADE_STYLES[i]; }

  // ---------- общие функции ----------
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  // e1.15 (s9): ошибка в одной подсистеме кадра (видео, детали, шоу, точки…) больше не останавливает цикл отрисовки —
  // раньше одно исключение навсегда «замораживало» картинку (меню работало, день/ночь — нет: кадр 5 G на iPhone).
  // Ошибки копятся в журнале; ?debug=1 — журнал и состояние на экране (fps, WebGL, видео).
  var ERR = [], ERRN = {}, DBG = /[?&]debug=1/.test(location.search), dbgEl = null, dbgT = 0;
  function logErr(where, e) {
    var m = where + ': ' + ((e && (e.message || e.reason)) || String(e));
    ERRN[where] = (ERRN[where] || 0) + 1;
    if (ERR.length < 40 && (ERRN[where] <= 3)) { ERR.push(new Date().toISOString().slice(11, 19) + ' ' + m); try { console.warn('[chka]', m, e && e.stack); } catch (x) {} }
    if (DBG) dbgShow(true);
  }
  function safe(where, fn) { try { return fn(); } catch (e) { logErr(where, e); } }
  window.addEventListener('error', function (e) { logErr('window', e.error || e.message); });
  window.addEventListener('unhandledrejection', function (e) { logErr('promise', e.reason); });
  function dbgShow(force) {
    if (!DBG) return;
    var now = performance.now(); if (!force && now - dbgT < 1000) return; dbgT = now;
    if (!dbgEl) { dbgEl = document.createElement('pre'); dbgEl.id = 'dbgLog'; dbgEl.style.cssText = 'position:fixed;left:4px;top:4px;z-index:99999;max-width:92vw;max-height:46vh;overflow:hidden;margin:0;padding:4px 6px;font:10px/1.25 ui-monospace,Menlo,monospace;color:#fff;background:rgba(0,0,0,0.62);border-radius:4px;pointer-events:none;white-space:pre-wrap'; document.body.appendChild(dbgEl); }
    var mv = []; try { [MV, MVN].forEach(function (map, q) { Object.keys(map).forEach(function (k) { var S = map[k]; mv.push(k + (q ? 'n' : '') + ':' + (S.fail ? 'FAIL' : 'rs' + S.v.readyState + (S.v.paused ? ' pause' : ' play') + ' t' + S.v.currentTime.toFixed(1))); }); }); } catch (x) {}
    var figPk = FIG_PEAK || 0; FIG_PEAK = 0;
    dbgEl.textContent = (CONFIG.ENGINE_V || '') + ' кадр ' + frameIndex + ' fps ' + (dbgFps || 0) + ' perf ' + perfLevel + (glLost ? ' GL-LOST' : '') + ' gl ' + (useGL ? 'on' : 'off') + (FN > 0 || FIG_CUT ? '\nфигуры ' + (fx && fx.figOn ? 'идут' : 'СТОЯТ') + ' ' + ((FIGS[frameIndex] || []).length) + ' шт., сдвиг до ' + figPk.toFixed(1) + ' px' + (FIG_CUT ? ' (урезано ' + FIG_CUT + ')' : '') + (reduced() ? ' · «Уменьшить движение» ВКЛ' : '') : '') + '\nвидео ' + (mv.join(' | ') || '—') + (ERR.length ? '\n' + ERR.slice(-12).join('\n') : '\nошибок нет');
  }
  var dbgFps = 0, dbgFc = 0, dbgF0 = 0;
  // Пружина как в iOS (response 0.65 с, damping ratio 0.86): ступенчатый отклик, оседание ~0.5%.
  // Время оседания считаем численно; p (0..1) — доля этого времени, поэтому любую длительность
  // (кроссфейд, время суток, возврат в центр) можно прогнать по той же кривой.
  var springTable = (function () {
    var w = 2 * Math.PI / CONFIG.SPRING_RESPONSE, z = CONFIG.SPRING_DAMPING, wd = w * Math.sqrt(1 - z * z);
    function x(t) { return 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + z * w / wd * Math.sin(wd * t)); }
    var T = 0, t;
    for (t = 0; t < 3; t += 0.002) if (Math.abs(1 - x(t)) > 0.0015) T = t;
    var a = [], N = 256, i;
    for (i = 0; i <= N; i++) a.push(x(T * i / N));
    a[N] = 1;
    return a;
  })();
  function EASE(p) {
    p = clamp(p, 0, 1);
    var f = p * 256, i = f | 0;
    return i >= 256 ? 1 : springTable[i] + (springTable[i + 1] - springTable[i]) * (f - i);
  }
  // prefers-reduced-motion: выключаем только фоновое движение (дыхание, облака, птицы); переходы и автопокачивание работают
  var reduceMQ = window.matchMedia('(prefers-reduced-motion: reduce)');
  var motionForce = /[?&]motion=1/.test(location.search);   // ?motion=1 — для проверки: показать всё движение при включённом «Уменьшить движение»
  var stillQ = /[?&]still=1/.test(location.search);   // e1.23: ?still=1 — для снимков (tools/snap.mjs): камера без «дыхания», остальное живёт
  function reduced() { return reduceMQ.matches && !motionForce; }
  // Сглаживание, не зависящее от частоты кадров: k — доля пути за кадр на 60 fps.
  function lerpK(k, dt) { return 1 - Math.pow(1 - k, dt / 16.667); }

  // ---------- язык (общий с сайтом: тот же ключ localStorage) ----------
  var currentLang = chkaLang();

  var pageTitleEl = document.getElementById('barTitle');
  var langButtons = document.querySelectorAll('#langSeg button');

  function setI18n(el, key) { el.textContent = CONFIG.UI_I18N[key][currentLang]; }

  var wl = null;   // приветствие + загрузка (компонент test-assets/welcome-loader.js) — создаётся ниже, сразу
  function applyLang() {
    var t = CONFIG.UI_I18N;
    setI18n(pageTitleEl, 'title');
    document.getElementById('homeBtn').setAttribute('aria-label', t.home[currentLang]);
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var key = el.getAttribute('data-i18n');
      if (t[key]) setI18n(el, key);
    });
    if (wx && wx.label) showWxName();   // название погоды — на новом языке
    document.querySelectorAll('[data-i18n-title]').forEach(function (el) {   // подписи кнопок без текста: aria-label и всплывающая подсказка
      var key = el.getAttribute('data-i18n-title');
      if (t[key]) { el.setAttribute('aria-label', t[key][currentLang]); el.title = t[key][currentLang]; }
    });
    if (wl) wl.setLang(currentLang);
    panelBtn.setAttribute('aria-label', t.menu[currentLang]);
    // e1.9: короткие общепонятные слова на бирках-кнопках телефона (меню, шоу/стоп); aria-label остаётся полным из I18N
    var BTN_WORD = { menu: { hy: 'Մենյու', ru: 'Меню', en: 'Menu' }, show: { hy: 'Հրաշք', ru: 'Чудо', en: 'Magic' }, stop: { hy: 'Կանգ', ru: 'Стоп', en: 'Stop' } };
    var bw = function (k) { return BTN_WORD[k][currentLang] || BTN_WORD[k].en; };
    var pbTxt = panelBtn.querySelector('.pb-txt'); if (pbTxt) pbTxt.textContent = bw('menu');
    document.querySelectorAll('.sh-w-play').forEach(function (el) { el.textContent = bw('show'); });
    document.querySelectorAll('.sh-w-stop').forEach(function (el) { el.textContent = bw('stop'); });
    document.title = t.pageTitle[currentLang];
    ['prevSide', 'prevBtn'].forEach(function (id) { document.getElementById(id).setAttribute('aria-label', t.prevFrame[currentLang]); });
    ['nextSide', 'nextBtn'].forEach(function (id) { document.getElementById(id).setAttribute('aria-label', t.nextFrame[currentLang]); });
    // справка о здании: строки из уже утверждённых фактов (какие — ABOUT_FACTS в настройках здания)
    var about = document.getElementById('aboutText');
    about.innerHTML = '';
    CONFIG.ABOUT_FACTS.forEach(function (k) {
      var pe = document.createElement('p');
      pe.textContent = CONFIG.I18N[k][currentLang];
      about.appendChild(pe);
    });
    langButtons.forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-lang') === currentLang); });
    document.documentElement.lang = currentLang;
    fitTitle();
    if (window.__cardOnLang) window.__cardOnLang();   // окно открытки: плашки на языке страницы
  }

  // Название в нижней полосе телефона: если строка не влезает (длинный заголовок на узком экране, напр. армянский на 375 px),
  // кегль уменьшается ровно настолько, чтобы влезла (не меньше 13 px). Влезающие названия не трогаются — кегль из CSS.
  function fitTitle() {
    var el = pageTitleEl;
    if (!el) return;
    el.style.fontSize = '';
    if (!el.clientWidth || el.scrollWidth <= el.clientWidth) return;
    var fs = parseFloat(getComputedStyle(el).fontSize);
    while (fs > 13 && el.scrollWidth > el.clientWidth) {
      fs = Math.round((fs - 0.25) * 100) / 100;
      el.style.fontSize = fs + 'px';
    }
  }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitTitle).catch(function () {});

  // Смена языка и размера текста (e1.28, docs/ANIMATION.md): текст гаснет за 120 мс (--in) и чуть уходит вверх, меняется, проявляется снизу
  // (--out / --spring). Только opacity/transform (классы tx-* на <html>, CSS в page.html). Новое нажатие посреди смены сразу применяет
  // отложенную и начинает свою — без мигания и возврата.
  var txT = [], txApply = null;
  function textSwap(kind, apply) {
    var root = document.documentElement;
    txT.forEach(clearTimeout); txT = [];
    if (txApply) { var f0 = txApply; txApply = null; f0(); }
    root.classList.remove('tx-pre', 'tx-lang', 'tx-size');
    root.classList.add('tx-run', 'tx-' + kind, 'tx-out');
    txApply = apply;
    txT.push(setTimeout(function () {
      var f = txApply; txApply = null; if (f) f();
      root.classList.add('tx-pre'); root.classList.remove('tx-out'); void root.offsetWidth;
      root.classList.remove('tx-pre');
      txT.push(setTimeout(function () { root.classList.remove('tx-run', 'tx-lang', 'tx-size'); }, 700));   // после конца переходов (460 мс), с запасом
    }, 130));
  }
  // «Табло» (e1.29, 9б-2): при смене языка видимые надписи ~0,5 с перебирают случайные буквы (армянские, кириллица, латиница) и встают в новый
  // язык волной слева направо — как вокзальное табло. Всё от времени (а не от номера кадра): буква встаёт в 90 + 380·(x на экране / ширина) мс
  // (+ до 40 мс у каждой надписи своё), до того раз в 45 мс сменяет случайную. Пишем textContent только у надписей без вложенных тегов, видимых
  // на экране, и только когда строка изменилась; замер времени скрипта — window.__tablo.stat() (цель ≤ 1 мс на кадр). «Уменьшить движение» — сразу.
  var TB_UP = 'ԱԲԳԴԵԶԷԹԺԻԼԽԾԿՀՁՂՃՄՅՆՇՈՉՊՋՌՍՎՏՐՑՓՔՕՖАБВГДЕЖЗИКЛМНОПРСТУФХЦЧШЭЮЯABCDEFGHJKLMNPRSTUVWXYZ';
  var TB_LO = 'աբգդեզէըթժիլխծկհձղճմյնշոչպջռսվտրցւփքօֆабвгдежзиклмнопрстуфхцчшэюяabcdefghkmnprstuvwxyz';
  var tablo = { items: [], t0: 0, raf: 0, clock: null, maxMs: 0, frames: 0, sumMs: 0 };
  function tbNow() { return tablo.clock != null ? tablo.clock : performance.now(); }
  function tbHash(a, b, c) { var h = (a * 374761393 + b * 668265263 + c * 2246822519) >>> 0; h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0; return (h ^ (h >>> 16)) >>> 0; }
  function tbTargets() {
    var vw = window.innerWidth || 1, vh = window.innerHeight, out = [], total = 0;
    document.querySelectorAll('[data-i18n], #aboutText p, .pb-txt, #wxName, #barTitle').forEach(function (el) {
      if (el.childElementCount || total > 1600) return;
      var t = el.textContent; if (!t || !t.trim()) return;
      var r = el.getBoundingClientRect(); if (!r.width || r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) return;
      var cs = getComputedStyle(el); if (cs.visibility === 'hidden' || +cs.opacity === 0) return;
      var ch = Array.from(t), n = ch.length, j = (tbHash(out.length, n, 7) % 40);
      total += n;
      out.push({ el: el, ch: ch, fin: t, last: t, at: ch.map(function (c, i) { return 90 + j + 380 * clamp((r.left + r.width * (i + 0.5) / n) / vw, 0, 1); }) });
    });
    return out;
  }
  function tbRender() {
    var t0p = performance.now(), t = tbNow() - tablo.t0, live = false, tick = Math.floor(t / 45);
    tablo.items.forEach(function (it, k) {
      var s = '';
      for (var i = 0; i < it.ch.length; i++) {
        var c = it.ch[i];
        if (t >= it.at[i] || /[\s.,:;!?()«»\-–—№\d]/.test(c)) { s += c; continue; }
        live = true;
        var pool = c !== c.toLowerCase() ? TB_UP : TB_LO;
        s += pool[tbHash(k, i, tick) % pool.length];
      }
      if (s !== it.last) { it.el.textContent = s; it.last = s; }
    });
    var ms = performance.now() - t0p; tablo.frames++; tablo.sumMs += ms; if (ms > tablo.maxMs) tablo.maxMs = ms;
    return live;
  }
  function tbStop(final) {
    cancelAnimationFrame(tablo.raf); tablo.raf = 0;
    if (final) tablo.items.forEach(function (it) { if (it.last !== it.fin) it.el.textContent = it.fin; });
    tablo.items = [];
    fitTitle();
  }
  function tbLoop() { tablo.raf = 0; if (tbRender()) tablo.raf = requestAnimationFrame(tbLoop); else tbStop(true); }
  function tabloSwap(apply) {
    if (tablo.items.length) tbStop(true);
    apply();   // новые тексты — сразу (подписи, aria, заголовок вкладки); табло только «докручивает» видимое
    if (reduced()) return;
    tablo.items = tbTargets(); tablo.t0 = tbNow();
    if (!tablo.items.length) return;
    tbRender();
    if (tablo.clock == null) tablo.raf = requestAnimationFrame(tbLoop);
  }
  window.__tablo = {   // для проверки и GIF (report s29): часы табло можно остановить и крутить вручную
    stat: function () { return { frames: tablo.frames, maxMs: +tablo.maxMs.toFixed(3), avgMs: tablo.frames ? +(tablo.sumMs / tablo.frames).toFixed(3) : 0, items: tablo.items.length }; },
    clock: function (ms) { tablo.clock = ms; }, render: function () { var l = tbRender(); if (!l) tbStop(true); return l; }, reset: function () { tablo.frames = 0; tablo.sumMs = 0; tablo.maxMs = 0; }
  };
  langButtons.forEach(function (b) {
    b.addEventListener('click', function () {
      var l = b.getAttribute('data-lang');
      closePopup();
      if (l === currentLang) return;
      langButtons.forEach(function (x) { x.classList.toggle('on', x === b); });   // отметка — сразу, текст — «табло» (e1.29)
      tabloSwap(function () {
        currentLang = l;
        try { localStorage.setItem('chka-lang', currentLang); } catch (e) {}
        applyLang();
      });
    });
  });
  applyLang();

  // ---------- приветствие и загрузка: появляется сразу, держится, пока всё не загрузится (минимум 3 с), потом плавно уходит сам ----------
  var isTouchDevice = window.matchMedia ? window.matchMedia('(pointer: coarse)').matches
    : (('ontouchstart' in window) || (navigator.maxTouchPoints > 0));
  wl = window.__wl;
  wl.attach(stage);   // с этого момента приветствие только поверх картинки, панель видна

  // iOS даёт запрос на наклон только из обработчика касания. Приветствие больше не ждёт касания (оно уходит само), поэтому запрос
  // идёт при ПЕРВОМ касании чего угодно на странице (click), один раз. Android и ПК разрешения не просят.
  function askTilt() {
    document.removeEventListener('click', askTilt, true);
    DeviceOrientationEvent.requestPermission().then(function (state) {
      if (state === 'granted') startGyro(); // отказ — остаётся управление пальцем
    }).catch(function (err) { console.warn('Гироскоп: разрешение не выдано —', err && err.message); });
  }
  if (typeof DeviceOrientationEvent !== 'undefined' && isTouchDevice) {
    if (window.isSecureContext === false) console.warn('Гироскоп недоступен: страница открыта не по https (небезопасный контекст).');
    else if (typeof DeviceOrientationEvent.requestPermission === 'function') document.addEventListener('click', askTilt, true);
  }

  // ---------- WebGL (если нет — остаётся двухслойный DOM-вариант) ----------
  var wantGL = !/[?&]nogl=1/.test(location.search); // ?nogl=1 — принудительно проверить откат
  var gl = null;
  if (wantGL) {
    gl = canvas.getContext('webgl', { antialias: false, alpha: false, premultipliedAlpha: false })
      || canvas.getContext('experimental-webgl');
  }
  var useGL = !!gl;
  if (!useGL) canvas.style.display = 'none';

  // Кадр = два слоя, оба берутся из одного цельного набора:
  //  • фон и земля (bg — кадр без здания) сдвигаются попиксельно по карте
  //    глубины (X и Y), карта заранее размыта (prepareDepth);
  //  • здание (вырезка по маске SAM) двигается ЦЕЛИКОМ — один общий сдвиг
  //    по его средней глубине, поэтому главное здание никогда не гнётся.
  // Первый проход рисует сцену в текстуру (цвет + маска окон в альфе),
  // второй — время суток (закат/ночь) поверх готовой картинки.
  var VERT = [
    'attribute vec2 aPos;',
    'varying vec2 vUv;',   // координаты картинки (y вниз)
    'varying vec2 vTc;',   // координаты текстуры (y вверх)
    'void main() {',
    '  vTc = aPos * 0.5 + 0.5;',
    '  vUv = vec2(vTc.x, 1.0 - vTc.y);',
    '  gl_Position = vec4(aPos, 0.0, 1.0);',
    '}'
  ].join('\n');

  // Закат и ночь (v10–v11) — картинки, а не процедурные: на кадр по две текстуры на состояние («земля» с подложкой и главное здание),
  // с днём 8 юнитов на кадр, 16 на два кадра при переходе. Если видеокарта даёт меньше — картинки не используются
  // (откат на закат и ночь v8).
  var NI = useGL && gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) >= 16;
  var UB0 = NI ? 8 : 4;   // первый юнит кадра B
  var FW = CONFIG.FRAME_SIZE[0], FH = CONFIG.FRAME_SIZE[1];   // размер исходного кадра здания, пиксели
  var SUN_RIGHT = CONFIG.SUN_SIDE !== 'left';                 // с какой стороны солнце у заката без картинки
  function vec3lit(a) { return 'vec3(' + a.map(function (x) { return x.toFixed(4); }).join(',') + ')'; }
  // Числа внешнего вида (CONFIG.LOOK: закат, ночь, звёзды, свет окон, фонари) — из настроек; здание может переопределить любое (tuning).
  var LK = CONFIG.LOOK;
  function glf(x) { return Number.isInteger(x) ? x.toFixed(1) : String(x); }                    // число -> литерал GLSL
  function v3(a) { return 'vec3(' + a.map(glf).join(', ') + ')'; }
  // e1.18 (s14), всё за настройками здания (у Кукурузника 0/false — шейдер тот же, что в e1.17):
  // WIN_SPILL — свет окна на стене под ним; CLOUD_FIELD — тени облаков полем по всему кадру (вместо двух пятен), CLOUD_FIELD_NIGHT —
  // доля этих теней ночью (лунные облака); MV_DELTA — видео синемаграфа хранит отличие от рисунка (серый 128 = рисунок), MV_CAL —
  // калибровка цвета видео по полоске в его нижнем крае (см. mvUpload).
  var SPILL = +CONFIG.WIN_SPILL || 0, SPILL_PX = +CONFIG.WIN_SPILL_PX || 7;
  var CF = +CONFIG.CLOUD_FIELD || 0, CFN = +CONFIG.CLOUD_FIELD_NIGHT || 0;
  var MVD = !!CONFIG.MV_DELTA;
  // e1.25 (s22), только у зданий с настройкой (у Кукурузника нет — шейдер и поведение прежние):
  // SNOW (look.snow) — снег на поверхностях по маске кадра (<кадр>_snow.webp: «что стало белым» в зимнем варианте Gemini), а не по формуле
  // из глубины; маска лежит в альфе ночной картинки земли (свободный канал — лишних юнитов текстур не нужно). Снег копится accumS с,
  // тает meltS с, плавно (кривая с мягким началом и концом). Кадр без маски — старая формула.
  // GUSTS (look.gusts) — ветер порывами: волны «тише — сильнее — тише» (быстрый разгон, долгое мягкое затухание), деревья гнутся
  // пружиной (инерция, лёгкий перехлёст) и качаются чаще в порыв, порыв идёт по кадру слева направо, листья летят гроздьями в порыв,
  // в метель снег кружит и идёт косо.
  var SNOWM = NI && !!CONFIG.SNOW && FRAMES.some(function (f) { return f.snow; });
  var GUSTS = CONFIG.GUSTS || null;
  // e1.26 SWAY (s23, look.gusts.swayMaxPx + frames[].sway): крона качается, НЕ затягивая фон. Раньше выборка сдвигалась по маске
  // дерева в точке экрана: у наветренного края кроны в крону затягивало небо, дома и столбы (размазня), подветренный край обрезался
  // по маске, а мягкая маска с разной высотой по строкам рвала штрих «лесенкой». Теперь каждая строка кроны каждого дерева —
  // отрезок [x0, x1] (поля u, v в нижнем этаже карты окружения, см. prep.js addSway): при наклоне вправо левый край стоит, правый
  // уходит на A и накрывает фон, влево — наоборот. Точку кроны для пикселя находим итерациями q = p - A·u(q); фон рядом с кроной
  // не сдвигается никогда — он виден как есть или закрыт кроной (ближнее кроны — по глубине — крона не закрывает).
  // Сдвиг A мягко ограничен swayMaxPx (px кадра). Без настройки — прежний ветер e1.25, шейдер Кукурузника прежний.
  var SWAY = !!(GUSTS && GUSTS.swayMaxPx > 0 && FRAMES.some(function (f) { return f.sway; }));
  var EH = (FH + 1) >> 1;   // строк в одном этаже карты окружения (она вдвое мельче кадра)
  // e1.22 FIGURES (s18): мелкие фигуры рисунка (люди, игроки в нарды, голуби, шарик, листья, трава) чуть движутся на месте — не спрайты,
  // а сдвиг выборки самой картинки внутри мягкой маски фигуры (prep.js кладёт маску в альфу карты окружения там, где нет дерева).
  // Фигура = рамка (доли кадра) + тип + сторона; движение считает CPU (figMotion: по времени, кривые --ios/--out/--in из page.html,
  // своя фаза у каждой), шейдер деформирует: ноги/сиденье на месте, верх качается; голова/рука/клюв — своей зоной. Ночь — та же маска,
  // фигуры в ночной картинке двигаются так же; голуби ночью спят. У зданий без figures (Кукурузник) кода в шейдере нет.
  var FIG_TYPES = ['sit', 'stand', 'chess', 'pigeon', 'balloon', 'leaf', 'grass'];
  var FIGS = (CONFIG.FIGURES || []).map(function (q) { return q && q.items ? q.items : []; });
  var FN = FIGS.reduce(function (m, a) { return Math.max(m, a.length); }, 0);
  // e1.23 (s19): шейдеру фигур нужно 4 vec4 на фигуру (рамки и движение кадров A и B). Если видеокарта даёт меньше uniform-векторов,
  // чем нужно (минимум по стандарту WebGL — 16), фигур меньше — иначе шейдер сцены не соберётся и вся картинка уйдёт в запасной режим.
  var FIG_CUT = 0;
  if (FN > 0 && useGL) {
    var fuMax = gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS) || 0, fnMax = Math.max(0, Math.floor((fuMax - 96) / 4));
    if (FN > fnMax) { FIG_CUT = FN - fnMax; FN = fnMax; FIGS = FIGS.map(function (a) { return a.slice(0, fnMax); }); console.info('фигуры: uniform-векторов ' + fuMax + ' -> до ' + fnMax + ' фигур на кадр'); }
  }
  var FIGB = FN > 0 && FIGS.some(function (a) { return a.some(function (it) { return it[6] === 1; }); });   // есть фигуры на слое здания
  // e1.19 (s15): тени облаков полем (CLOUD_FIELD) — в вершинном шейдере сцены на сетке CF_GRID, а не на каждый пиксель
  var CF_GRID = [64, 128];   // ячеек сетки по ширине и высоте экрана
  var CF_SRC = CF > 0 ? [
    'float wxHash(vec2 q) { return fract(sin(dot(q, vec2(127.1, 311.7))) * 43758.5453); }',
    'float wxNoise(vec2 q) { vec2 i = floor(q), f = fract(q); f = f * f * (3.0 - 2.0 * f);',
    '  return mix(mix(wxHash(i), wxHash(i + vec2(1.0, 0.0)), f.x), mix(wxHash(i + vec2(0.0, 1.0)), wxHash(i + vec2(1.0, 1.0)), f.x), f.y); }',
    'float cloudField(vec2 uv, float t) {' +
      ' vec2 q = vec2(uv.x * ' + glf(FW / FH) + ', uv.y) * ' + glf(+CONFIG.CLOUD_FIELD_SCALE || 2.4) + ' + vec2(t, t * 0.23) * ' + glf(+CONFIG.CLOUD_FIELD_SPEED || 0.011) + ';' +
      ' float n = 0.55 * wxNoise(q) + 0.30 * wxNoise(q * 2.03 + vec2(5.2, 1.3) + t * 0.021) + 0.15 * wxNoise(q * 4.1 + vec2(1.7, 8.9) - t * 0.034);' +
      ' return smoothstep(0.15, 0.82, n); }'
  ].join('\n') : '';
  // вершинный шейдер сцены: при CLOUD_FIELD — ещё и поле облаков в узлах сетки (uv — та же формула, что в main() фрагмента)
  var VERT_SCENE = CF > 0 ? [
    'precision highp float;',
    'attribute vec2 aPos;',
    'varying vec2 vUv;',
    'varying vec2 vTc;',
    'varying float vCloud;',
    'uniform vec2 uCoverScale; uniform vec2 uCoverOffset; uniform float uScale; uniform float uCloudT;',
    CF_SRC,
    'void main() {',
    '  vTc = aPos * 0.5 + 0.5;',
    '  vUv = vec2(vTc.x, 1.0 - vTc.y);',
    '  vec2 uv = vUv * uCoverScale + uCoverOffset;',
    '  uv = 0.5 + (uv - 0.5) / uScale;',
    '  vCloud = cloudField(uv, uCloudT);',
    '  gl_Position = vec4(aPos, 0.0, 1.0);',
    '}'
  ].join('\n') : VERT;
  var STAR_CELLS = [Math.max(1, Math.round(FW / LK.stars.cell)), Math.max(1, Math.round(FH / LK.stars.cell))];   // сетка звёзд: ячейка ~LK.stars.cell пикселей кадра, любой размер кадра
  var SCENE_FRAG = [
    'precision highp float;',
    'varying vec2 vUv;',
    CF > 0 ? 'varying float vCloud;' : '',   // e1.19: поле облаков из вершинного шейдера
    // день (v12): цвета неба и настройки зелени — из CONFIG.DAY
    'const vec3 DAY_SKY_TOP = ' + vec3lit(CONFIG.DAY.SKY_TOP) + ';',
    'const vec3 DAY_SKY_HOR = ' + vec3lit(CONFIG.DAY.SKY_HOR) + ';',
    'const float GREEN_HUE = ' + CONFIG.DAY.GREEN_HUE.toFixed(4) + ';',
    'const float GREEN_PULL = ' + CONFIG.DAY.GREEN_PULL.toFixed(4) + ';',
    'const float GREEN_SAT = ' + CONFIG.DAY.GREEN_SAT.toFixed(4) + ';',
    'const float DAY_MIX = ' + CONFIG.DAY.MIX.toFixed(4) + ';',   // 0 — как v11, 1 — как v12
    'uniform vec2 uCloudK;',      // сила тени облаков на кадрах A и B
    'uniform vec4 uSkyRef;',      // кадр A: яркость исходной вымывки неба (x) и нижняя граница неба, доля высоты (y); кадр B — z, w
    // на кадр: земля (0), карта глубины+окружения (1), здание (2), окна (3)
    'uniform sampler2D uBgA; uniform sampler2D uDepthA; uniform sampler2D uBldA; uniform sampler2D uEmA;',
    'uniform sampler2D uBgB; uniform sampler2D uDepthB; uniform sampler2D uBldB; uniform sampler2D uEmB;',
    NI ? 'uniform sampler2D uSGA; uniform sampler2D uSBA; uniform sampler2D uNGA; uniform sampler2D uNBA;' : '',   // кадр A: закат (земля, главное здание), ночь (земля, главное здание)
    NI ? 'uniform sampler2D uSGB; uniform sampler2D uSBB; uniform sampler2D uNGB; uniform sampler2D uNBB;' : '',   // кадр B
    NI ? 'uniform vec3 uHasA; uniform vec3 uHasB;' : '',         // x — есть картинка заката, y — есть картинка ночи, z — в юните заката-земли видео синемаграфа (e1.14)
    NI && MVD ? 'uniform mat4 uMvCalA; uniform mat4 uMvCalB;' : '',
    SPILL > 0 ? 'uniform vec2 uEmKA; uniform vec2 uEmKB;' : '',   // e1.19: текстура окон кадра A/B — доля высоты окон и начало света на стене   // e1.18: калибровка цвета видео кадра A/B (по полоске в краю видео, MV_CAL)
    NI ? 'uniform float uSunMix; uniform float uNightMix;' : '', // день→закат (2.5 с), закат→ночь (3 с): плавное растворение
    'uniform vec4  uCropA; uniform vec4 uCropB; uniform vec4 uFlagA; uniform vec4 uFlagB;',   // обрезка кадров A/B: x0, y0, ширина, высота (доли)
    'uniform vec3  uKdA;',        // здание кадра A: x = k (-1..1), y = средняя глубина 0..1, z = 1 — глубина здания по точкам (альфа земли)
    'uniform vec3  uKdB;',
    'uniform vec2  uStarQ;',      // доля ячеек со звездой для кадров A/B (зависит от площади неба)
    'uniform float uMix;',        // 0 = кадр A, 1 = кадр B
    'uniform vec2  uShift;',      // max-сдвиг * наклон + «дыхание», в долях картинки
    'uniform float uZoom;',       // добавка к масштабу для самых ближних (0..0.02)
    'uniform float uScale;',      // общий масштаб (1.05), чтобы не видеть краёв
    'uniform vec2  uCoverScale;', // "cover"-обрезка кадра под экран
    'uniform vec2  uCoverOffset;',
    'uniform float uTime;',        // настоящее время (ветер, мерцание звёзд)
    'uniform float uCloudT;',      // время облаков (замирает при «уменьшении движения»)
    'uniform float uSunset;',     // 0..1
    'uniform float uNightSky;',   // небо темнеет первым (0..1)
    'uniform float uNightGnd;',   // потом земля
    'uniform float uStars;',      // звёзды проявляются последними
    'uniform vec2  uFadeZoom;',   // масштаб уходящего/приходящего кадра при переходе
    'uniform float uAspect;',     // ширина/высота экрана
    'uniform float uWindAmp;',    // амплитуда ветра на макушке дерева, в долях картинки
    'uniform float uWindOn;' + (GUSTS ? '\nuniform vec3 uWindG;' : ''),     // 1 — ветер включён; e1.25 uWindG: x наклон крон сейчас, y — с задержкой (правый край кадра), z — фаза качания
    'uniform vec4 uWeather;' + (SNOWM ? '\nuniform vec2 uSnowM;' : ''),   // e1.25: снег по маске у кадра A/B: -1 — формула, 0..1 — маска (проявляется 1,5 с после загрузки)
    'uniform float uFlash;',      // молния: 0..1 — небо и облака вспыхивают (ночью заметнее)     // погода: x пасмурно, y туман, z мокрая земля (дождь), w снег; 0 — как без погоды
    'uniform vec2  uCellPx;',     // размер ячейки звёздной сетки в пикселях экрана
    'uniform vec4  uShoot;',      // падающая звезда: старт xy (экран 0..1), направление xy
    'uniform vec2  uShootP;' +    // x = прогресс 0..1 (<0 — нет), y = длина пролёта
      (FN > 0 ? '\nuniform vec4 uFigA[' + (2 * FN) + ']; uniform vec4 uFigB[' + (2 * FN) + ']; uniform vec2 uFigN;' : '') +   // e1.22: на фигуру — рамка (x0, y0, тип·2+сторона + ширина, высота) и движение (px)
      (FIGB ? '\nuniform vec4 uFigBoxA; uniform vec4 uFigBoxB;' : ''),   // рамка всех фигур слоя здания кадра A/B (x0, y0, x1, y1); без фигур строк нет — шейдер Кукурузника побайтно прежний
    '',
    'float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }',
    'vec3 rgb2hsv(vec3 c) {',
    '  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);',
    '  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));',
    '  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));',
    '  float d = q.x - min(q.w, q.y);',
    '  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);',
    '}',
    'vec3 hsv2rgb(vec3 c) {',
    '  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);',
    '  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);',
    '  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);',
    '}',
    // Мягкое пятно тени от облака: смещённый и чуть "разлохмаченный"
    // синусами круг, край размыт smoothstep — не ровный диск.
    'float blob(vec2 uv, vec2 center, vec2 radius) {',
    '  vec2 d = (uv - center) / radius;',
    '  float wobble = 0.15 * sin(d.x * 6.0 + center.x * 9.0) * sin(d.y * 5.0 + center.y * 7.0);',
    '  float dist = length(d) + wobble;',
    '  return smoothstep(1.0, 0.15, dist);',
    '}',
    // Две тени от облаков не спеша ползут по кадру слева направо,
    // один полный проход ~40с, без всякой другой анимации.
    'float cloudShadow(vec2 uv, float t) {',
    '  float cycle1 = 40.0;',
    '  float p1 = fract(t / cycle1);',
    '  float b1 = blob(uv, vec2(mix(-0.35, 1.35, p1), 0.58), vec2(0.30, 0.17));',
    '  float cycle2 = 53.0;',
    '  float p2 = fract((t + cycle1 * 0.5) / cycle2);',
    '  float b2 = blob(uv, vec2(mix(-0.35, 1.35, p2), 0.32), vec2(0.22, 0.13));',
    '  float bb = clamp(b1 + b2, 0.0, 1.0);',
    '  return bb;',
    '}',
    '',
    'float wxHash(vec2 q) { return fract(sin(dot(q, vec2(127.1, 311.7))) * 43758.5453); }',
    'float wxNoise(vec2 q) { vec2 i = floor(q), f = fract(q); f = f * f * (3.0 - 2.0 * f);',
    '  return mix(mix(wxHash(i), wxHash(i + vec2(1.0, 0.0)), f.x), mix(wxHash(i + vec2(0.0, 1.0)), wxHash(i + vec2(1.0, 1.0)), f.x), f.y); }',
    // e1.18 CLOUD_FIELD: тени облаков полем по всему кадру — мягкие пятна с широким краем (почти нигде не ровно 0) плывут и медленно меняют форму, поэтому за 15 с
    // меняется любой участок земли и фасадов (а не только полоса двух пятен cloudShadow)
    // e1.19 (s15): поле считается в ВЕРШИННОМ шейдере на сетке ~12×13 px экрана (CF_GRID) и приходит во фрагмент готовым (vCloud):
    // поле плавное (самая мелкая ячейка шума ~170 px), линейная интерполяция между узлами отличается < 0,5 уровня, а на пиксель
    // больше не считается 12 хешей с sin. Тот же код функции — CF_SRC (см. VERT_SCENE).
    // e1.22 FIGURES: сдвиг выборки (доли кадра) в точке q кадра slot (0 — A, 1 — B) при маске фигур m. Точка относится к ближайшей
    // по центру рамке из тех, что её содержат (стаи: у каждой птицы своё движение). Край рамки — плавно в 0 за 2 px.
    (FN > 0 ? [
      'vec2 figWarp(float slot, vec2 q, float m) {',
      '  float nf = slot < 0.5 ? uFigN.x : uFigN.y;',
      '  float bd = 1e3; vec4 R = vec4(0.0); vec4 M = vec4(0.0); vec2 S = vec2(0.0);',
      '  for (int i = 0; i < ' + FN + '; i++) {',
      '    if (float(i) >= nf) break;',
      '    vec4 r = slot < 0.5 ? uFigA[2 * i] : uFigB[2 * i];',
      '    vec2 st = (q - r.xy) / vec2(fract(r.z), r.w);',
      '    if (st.x < 0.0 || st.x > 1.0 || st.y < 0.0 || st.y > 1.0) continue;',
      '    float dd = dot(st - 0.5, st - 0.5);',
      '    if (dd < bd) { bd = dd; R = r; S = st; M = slot < 0.5 ? uFigA[2 * i + 1] : uFigB[2 * i + 1]; }',
      '  }',
      '  if (bd > 100.0) return vec2(0.0);',
      '  float code = floor(R.z), ty = floor(code * 0.5 + 0.01), side = code - 2.0 * ty > 0.5 ? 1.0 : -1.0;',
      '  float s = S.x, t = S.y, fs = side > 0.0 ? s : 1.0 - s;',   // fs: 0 — спина/хвост, 1 — перед (куда смотрит)
      '  vec2 v = vec2(0.0);',
      '  if (ty < 2.5) {',   // люди: sit 0, stand 1, chess 2 — верх качается (ноги/сиденье на месте), голова кивает
      '    float body = ty < 0.5 ? clamp((0.62 - t) / 0.62, 0.0, 1.0) : 1.0 - t;',
      '    float head = 1.0 - smoothstep(0.16, 0.32, t);',
      '    v = M.xy * body; v.y += M.w * head;',
      '    if (ty > 1.5) v += vec2(side, 0.35) * M.z * smoothstep(0.42, 0.8, fs) * smoothstep(0.22, 0.4, t) * (1.0 - smoothstep(0.6, 0.8, t));',   // рука к доске
      '    else v.x += M.z * (s - 0.5) * 2.0 * head;',   // поворот головы: лёгкое сжатие по горизонтали
      '  } else if (ty < 3.5) {',   // голубь: подскок целиком, клюв — голова вперёд-вниз
      '    v = M.xy + vec2(side * M.z, M.w) * smoothstep(0.42, 0.72, fs) * (1.0 - smoothstep(0.42, 0.7, t));',
      '  } else if (ty < 4.5) {',   // шарик: верх качается, нитка и ребёнок почти на месте
      '    v = M.xy * (1.0 - smoothstep(0.38, 0.75, t));',
      '  } else if (ty < 5.5) {',   // лист: приподнимает ветром
      '    v = M.xy * (0.6 + 0.4 * (1.0 - t));',
      '  } else {',   // трава: корень на месте
      '    v = M.xy * (1.0 - t) * (1.0 - t);',
      '  }',
      '  vec2 rp = vec2(fract(R.z) * ' + glf(FW) + ', R.w * ' + glf(FH) + ');',
      '  float edge = min(min(s, 1.0 - s) * rp.x, min(t, 1.0 - t) * rp.y);',
      '  return v * (m * smoothstep(0.0, 2.0, edge)) * vec2(' + glf(1 / FW) + ', ' + glf(1 / FH) + ');',
      '}'
    ].join('\n') + '\n' : '') +
    // e1.26 SWAY: карта окружения двухэтажная (верх — как была, низ — поля качания крон); строки на стыке этажей не смешиваются
    (SWAY ? [
      'vec4 envT(sampler2D s, vec2 uv) { return texture2D(s, vec2(uv.x, clamp(uv.y * 0.5, ' + glf(0.25 / EH) + ', ' + glf(0.5 - 0.25 / EH) + '))); }',
      'vec4 swayF(sampler2D s, vec2 uv) { return texture2D(s, vec2(uv.x, 0.5 + clamp(uv.y * 0.5, ' + glf(0.25 / EH) + ', ' + glf(0.5 - 0.25 / EH) + '))); }',
      'float swayA(vec4 s, float x) {',   // сдвиг кроны (доли кадра, + вправо): наклон по ветру + качание по фазе дерева, мягко ограничен swayMaxPx
      '  float per = 5.0 + 2.0 * fract(s.a * 7.13);',
      '  float a = mix(uWindG.x, uWindG.y, clamp(x, 0.0, 1.0)) * s.b * (0.75 + 0.5 * fract(s.a * 3.7)) - uWindAmp * s.b * sin(uWindG.z * 6.2832 / per + s.a * 19.0);',
      '  return a / sqrt(1.0 + a * a * ' + glf(1 / Math.pow(GUSTS.swayMaxPx / FW, 2)) + ');',
      '}'
    ].join('\n') + '\n' : '') +
    // Готовый цвет пикселя одного кадра: параллакс, ветер, закат, ночь.
    'vec4 shadeFrame(sampler2D bg, sampler2D depth, sampler2D bld, sampler2D em, vec3 kd, float starQ, vec2 skyRef, vec4 crop, vec4 flag,' + (SPILL > 0 ? ' vec2 ek,' : '') + (NI ? ' sampler2D sg, sampler2D sb, sampler2D ng, sampler2D nb, vec3 has,' : '') + (NI && MVD ? ' mat4 cal,' : '') + (FN > 0 ? ' float slot,' : '') + (SNOWM ? ' float snowM,' : '') + ' vec2 uv, vec2 sc) {',
    '  uv = crop.xy + uv * crop.zw;',   // обрезка белого края бумаги: показываем только внутренний прямоугольник кадра
    // фон и земля: у каждого пикселя свой сдвиг (3 итерации против «резины» на краях)
    '  vec2 p = uv;',
    '  for (int i = 0; i < 3; i++) {',
    '    float d = texture2D(depth, p).r;',                  // 0 = далеко, 1 = близко
    '    float k = d * 2.0 - 1.0;',                           // -1..1, 0 — плоскость фокуса
    '    p = 0.5 + (uv - 0.5) / (1.0 + uZoom * d) - k * uShift;',
    '  }',
    '  vec4 env = texture2D(depth, p);' +                     // r глубина, g небо, b высота дерева, a фаза дерева
      (FN > 0 ? '\n  if (env.b < 0.008 && env.a > 0.004) p -= figWarp(slot, p, env.a);' : ''),   // e1.22: фигура рисунка (маска в альфе, где нет дерева)
    // ветер: чем выше точка дерева, тем сильнее сдвиг; корень неподвижен; у каждого дерева своя фаза и период 5–7 с
    SWAY ? [   // e1.26: крона тянется по ветру, наветренный край стоит, фон не двигается (см. SWAY выше)
      '  if (uWindOn > 0.5) {',
      '    vec4 s0 = swayF(depth, p);',
      '    if (s0.b > 0.002) {',
      '      vec2 p0 = p; float q = p0.x, A = 0.0;',
      '      for (int i = 0; i < 6; i++) { vec4 sq = swayF(depth, vec2(q, p0.y)); A = swayA(sq, q); q = p0.x - A * (A >= 0.0 ? sq.r : sq.g); }',
      '      vec4 s1 = swayF(depth, vec2(q, p0.y)); float A1 = swayA(s1, q);',
      '      float err = abs(q + A1 * (A1 >= 0.0 ? s1.r : s1.g) - p0.x);',
      '      float T1 = clamp(2.0 - s1.r - s1.g, 0.0, 1.0), T0 = clamp(2.0 - s0.r - s0.g, 0.0, 1.0);',
      '      if (T1 > 0.5 && err < ' + glf(1.5 / FW) + ' && (T0 > 0.5 || env.r < envT(depth, vec2(q, p0.y)).r + 0.08)) { p.x = q; env = envT(depth, p); }',
      '    }',
      '  }'
    ].join('\n') : [
    '  if (uWindOn > 0.5 && env.b > 0.004) {',
    '    float per = 5.0 + 2.0 * fract(env.a * 7.13);',
    GUSTS ? '    p.x += uWindAmp * env.b * sin(uWindG.z * 6.2832 / per + env.a * 19.0) - mix(uWindG.x, uWindG.y, clamp(p.x, 0.0, 1.0)) * env.b * (0.75 + 0.5 * fract(env.a * 3.7));'   // e1.25: качание по фазе порывов + наклон по ветру (порыв приходит слева)
      : '    p.x += uWindAmp * env.b * sin(uTime * 6.2832 / per + env.a * 19.0);',
    '  }'].join('\n'),
    // флаги колышутся: небольшая волна только внутри прямоугольника флага
    '  if (flag.z > 0.0 && uWindOn > 0.5 && p.x > flag.x && p.x < flag.x + flag.z && p.y > flag.y && p.y < flag.y + flag.w) {',
    '    p.y += 0.0011 * sin(uTime * 3.4 + p.x * 210.0);',
    '    p.x += 0.0008 * sin(uTime * 2.7 + p.y * 300.0);',
    '  }',
    '  vec2 pc = clamp(p, 0.0, 1.0);',
    '  vec3 c = texture2D(bg, pc).rgb;',
    // e1.14 синемаграф: видео Veo (rgb, в альфе — маска движения) — часть рисунка земли: тот же параллакс по глубине, ветер, дневная обработка,
    // ночь и погода, что у рисунка; ночью — ночная картинка × (видео / рисунок): неподвижное = ночной рисунок без шва, движущееся темнеет так же
    // e1.17: has.z = 1 — дневной клип (юнит заката-земли), +2 — ночной клип (юнит заката-здания: у кадров с видео картинки заката нет).
    // Ночной клип — это ночная картинка + движение из ролика Flow (фары, огни — из самого ролика), кладётся прямо в ночную картинку;
    // день растворяется в ночь вместе с картинкой: дневные машины уходят с днём, ночные приходят с ночью.
    // e1.18 MV_DELTA (s14): видео хранит не пиксели, а ОТЛИЧИЕ от рисунка (серый 128 = «как на рисунке»): неподвижное всегда из
    // рисунка, сдвиг цвета видео при декодировании (iPhone) не красит площадь маски; cal — поправка цвета по полоске (MV_CAL)
    NI ? (MVD
      ? '  vec3 c0 = c; vec4 mv = vec4(0.0); float mvN = step(1.5, has.z); if (has.z - 2.0 * mvN > 0.5) { mv = texture2D(sg, pc); mv.rgb = clamp(c0 + (cal * vec4(mv.rgb, 1.0)).rgb - 0.50196, 0.0, 1.0); c = mix(c, mv.rgb, mv.a); }'
      : '  vec3 c0 = c; vec4 mv = vec4(0.0); float mvN = step(1.5, has.z); if (has.z - 2.0 * mvN > 0.5) { mv = texture2D(sg, pc); c = mix(c, mv.rgb, mv.a); }') : '',
    '  float sky = env.g;',
    // e1.19 (s15) при WIN_SPILL текстура окон двухэтажная: сверху сами окна (ek.x — их доля высоты), снизу — заранее посчитанный
    // свет окон на стене под ними (с ek.y); см. emSpillRows
    SPILL > 0 ? '  vec4 eg = texture2D(em, vec2(pc.x, pc.y * ek.x));' : '  vec4 eg = texture2D(em, pc);',                         // окна других зданий: g = свет ночью, a = сама маска
    // здание: один общий сдвиг и масштаб на весь предмет — жёсткое тело
    '  vec2 pb = 0.5 + (uv - 0.5) / (1.0 + uZoom * kd.y) - kd.x * uShift;',
    '  float bdL = kd.y;',
    // BUILDING_DEPTH_PIXEL: у каждой точки здания своя глубина (альфа земли) — низ лестницы/постамента едет вместе с полом под ним
    '  if (kd.z > 0.5) {',
    '    for (int i = 0; i < 3; i++) {',
    '      bdL = texture2D(bg, clamp(pb, 0.0, 1.0)).a;',
    '      pb = 0.5 + (uv - 0.5) / (1.0 + uZoom * bdL) - (bdL * 2.0 - 1.0) * uShift;',
    '    }',
    '  }',
    (FIGB ? '  { vec4 fbx = slot < 0.5 ? uFigBoxA : uFigBoxB; if (pb.x > fbx.x && pb.x < fbx.z && pb.y > fbx.y && pb.y < fbx.w) { vec4 ef = texture2D(depth, pb); if (ef.b < 0.008 && ef.a > 0.004) pb -= figWarp(slot, pb, ef.a); } }\n' : '') +   // e1.22: фигуры на слое здания (листья на постаменте)
    '  vec4 b = texture2D(bld, pb);',                         // цвет уже умножен на альфу
    SPILL > 0 ? '  vec4 eb = texture2D(em, vec2(pb.x, clamp(pb.y, 0.0, 1.0) * ek.x));' : '  vec4 eb = texture2D(em, pb);',                         // окна главного здания: r = свет ночью, b = сама маска
    '  c = b.rgb + c * (1.0 - b.a);',
    '  float inv = 1.0 - b.a;',
    '  sky *= inv;',
    // ---- день (v12): небо светло-голубое, зелень насыщеннее. Рисунок (штрих, мазки, облака, бумага) сохраняется: небо — умножением
    // на голубой, зелень — сдвигом оттенка и насыщенности только у жёлто-зелёных тонов. Закат и ночь — свои картинки, ниже. ----
    '  {',
    '    vec3 cOrig = c;',
    '    float lum0 = dot(c, vec3(0.299, 0.587, 0.114));',
    '    float rel = lum0 / skyRef.x;',                                                     // 1 — вымывка неба, >1 облако, <1 штрих
    '    vec3 skyCol = mix(DAY_SKY_TOP, DAY_SKY_HOR, smoothstep(0.02, 0.42, uv.y));',
    '    vec3 tinted = skyCol * clamp(rel, 0.0, 1.06);',
    '    tinted = mix(tinted, vec3(min(1.0, lum0 * 1.05 + 0.02)), smoothstep(1.03, 1.12, rel) * 0.75);',   // облака остаются белыми
    // светлая «бумажная» кромка вырезки здания (несколько пикселей вокруг контура): у дневного неба она была незаметна, у голубого — видна;
    // краевые пиксели вырезки, светлые как небо, красим в цвет неба
    '    float haloW = 0.0;',
    '    if (b.a > 0.05 && b.a < 0.999 || (b.a >= 0.999 && rel > 0.90)) {',
    '      vec2 hd = vec2(4.5 / ' + FW.toFixed(1) + ', 4.5 / ' + FH.toFixed(1) + ');',   // 4.5 пикселя кадра (размер кадра — FRAME_SIZE здания)
    '      float mn = min(min(texture2D(bld, pb + vec2(hd.x, 0.0)).a, texture2D(bld, pb - vec2(hd.x, 0.0)).a), min(texture2D(bld, pb + vec2(0.0, hd.y)).a, texture2D(bld, pb - vec2(0.0, hd.y)).a));',
    '      haloW = (1.0 - smoothstep(0.3, 0.95, mn)) * smoothstep(0.90, 1.02, rel);',
    '    }',
    // такая же светлая кромка вокруг деревьев и предметов у неба: пиксели рядом с маской неба (в пределах ~4–8 пикселей кадра), светлые как небо
    '    float ringW = 0.0;',
    '    if (sky < 0.5 && rel > 0.92) {',
    '      vec2 e1 = vec2(2.0 / ' + Math.ceil(FW / 2).toFixed(1) + ', 2.0 / ' + Math.ceil(FH / 2).toFixed(1) + '), e2 = e1 * 2.0;',   // 2 пикселя карты окружения (она вдвое мельче кадра)
    '      float sn = max(max(texture2D(depth, p + vec2(e1.x, 0.0)).g, texture2D(depth, p - vec2(e1.x, 0.0)).g), max(texture2D(depth, p + vec2(0.0, e1.y)).g, texture2D(depth, p - vec2(0.0, e1.y)).g));',
    '      sn = max(sn, max(max(texture2D(depth, p + vec2(e2.x, 0.0)).g, texture2D(depth, p - vec2(e2.x, 0.0)).g), max(texture2D(depth, p + vec2(0.0, e2.y)).g, texture2D(depth, p - vec2(0.0, e2.y)).g)));',
    '      ringW = smoothstep(0.3, 0.8, sn) * (1.0 - inv * 0.0) * smoothstep(0.92, 1.0, rel);',
    '    }',
    '    float skyW = max(max(smoothstep(0.35, 0.85, sky), haloW), ringW);',
    '    skyW *= (1.0 - smoothstep(0.10, 0.19, c.r - c.b)) * (1.0 - smoothstep(skyRef.y - 0.03, skyRef.y + 0.01, uv.y)) * (1.0 - smoothstep(0.12, 0.28, env.r));',   // и не ближе неба по глубине (маска местами заходит на главное здание)                                // тёплые дальние холмы остаются тёплыми
    '    c = mix(c, mix(c, tinted, smoothstep(0.55, 0.85, rel)), skyW);',                // тёмный карандашный штрих — как был
    '    vec3 hv = rgb2hsv(c);',
    '    float gw = smoothstep(0.10, 0.16, hv.x) * (1.0 - smoothstep(0.36, 0.45, hv.x)) * smoothstep(0.06, 0.16, hv.y) * smoothstep(0.18, 0.40, hv.z) * (1.0 - skyW);',
    // e1.24 (s20) look.bronzeKeep: малонасыщенные пиксели главного здания (бронза статуи, серо-зелёная патина) не тянутся к зелени —
    // иначе тёмная бронза Gemini днём становится «хаки». Кроны и туф на слое здания насыщеннее порога — как было. Без настройки кода нет.
    CONFIG.BRONZE_KEEP ? '    gw *= 1.0 - b.a * (1.0 - smoothstep(0.14, 0.26, hv.y));' : '',
    '    hv.x = mix(hv.x, GREEN_HUE, gw * GREEN_PULL);',
    '    hv.y = clamp(hv.y * (1.0 + gw * (GREEN_SAT - 1.0)) + gw * 0.05, 0.0, 1.0);',
    '    c = mix(c, hsv2rgb(hv), step(0.001, gw));',
    '    c = mix(cOrig, c, DAY_MIX);',
    '  }',
    '  float winNight = eb.r * b.a + eg.g * inv;',
    '  float winBase = max(eb.b * b.a, eg.a * inv);',
    // e1.18 (s14) WIN_SPILL: свет окна слегка ложится на подоконник и стену под окном; гаснет и зажигается вместе с окном.
    // e1.19 (s15): не три выборки карты окон на каждый пиксель, а одна — из заранее посчитанного света (нижний этаж текстуры окон,
    // пересчитывается на CPU только в куске переключённого окна) и только ночью. 0 (по умолчанию, Кукурузник) — кода в шейдере нет.
    NI ? '  float hasSv = has.x, hasNv = has.y;' : '  float hasSv = 0.0, hasNv = 0.0;',
    // ---- закат: тёплый оранжево-розовый тон, свечение с одной стороны, окна отражают закат ----
    '  if (uSunset > 0.001 && hasSv < 0.5) {',
    '    vec3 warm = c * ' + v3(LK.sunsetProc.tint) + ';',
    '    vec3 skyTint = mix(' + v3(LK.sunsetProc.skyLow) + ', ' + v3(LK.sunsetProc.skyHigh) + ', smoothstep(0.10, 0.62, sc.y));',
    '    warm = mix(warm, c * skyTint * 1.02 + skyTint * 0.05, sky * 0.85);',
    '    vec2 gd = (sc - vec2(' + (SUN_RIGHT ? '1.08' : '-0.08') + ', 0.52)) * vec2(uAspect * 0.9, 1.0);',   // свечение со стороны солнца (SUN_SIDE здания)
    '    warm += ' + v3(LK.sunsetProc.glowColor) + ' * exp(-dot(gd, gd) * 5.0) * ' + glf(LK.sunsetProc.glowStrength) + ';',
    '    warm += ' + v3(LK.sunsetProc.windowColor) + ' * winBase * ' + glf(LK.sunsetProc.windowStrength) + ';',
    '    c = mix(c, warm, uSunset);',
    '  }',
    // ---- ночной кадр-картинка: дневной кадр плавно растворяется в ночной (земля — в координатах фона, главное здание — в своих) ----
    // закат-картинка: день растворяется в закат (земля — в координатах фона, главное здание — в своих)
    NI ? '  if (hasSv > 0.5 && uSunMix > 0.001) c = mix(c, texture2D(sb, pb).rgb * b.a + texture2D(sg, pc).rgb * inv, uSunMix);' : '',
    // ночь-картинка: закат (или день) растворяется в ночь; тёмное темнее (CONFIG.NIGHT_DIM), свет окон и фонарей — как нарисован
    NI ? '  if (hasNv > 0.5 && uNightMix > 0.001) {' : '',
    NI ? '    vec3 ngc = texture2D(ng, pc).rgb; if (mvN > 0.5) { vec4 mn = texture2D(sb, pc); ngc = mix(ngc, mn.rgb, mn.a); } else if (mv.a > 0.004) ngc = mix(ngc, ngc * clamp(mv.rgb / max(c0, vec3(0.04)), 0.0, 1.5), mv.a);' : '',
    // e1.14 look.nightEdge "solid": у мягкого края вырезки ночью — сама ночная картинка (её небо у силуэта), а не подложка под зданием:
    // подложка × средний тон кольца светлее ночного неба и давала светлую «обводку» вокруг статуи (s8). Без флага — как было.
    NI ? '    float bn = ' + (CONFIG.NIGHT_EDGE === 'solid' ? 'smoothstep(0.0, 0.3, b.a)' : 'b.a') + ';' : '',
    NI ? '    vec3 cn = texture2D(nb, pb).rgb * bn + ngc * (1.0 - bn);' : '',
    NI ? '    cn *= mix(' + CONFIG.NIGHT_DIM.toFixed(3) + ', 1.0, smoothstep(0.30, 0.60, dot(cn, vec3(0.299, 0.587, 0.114))));' : '',
    NI ? '    c = mix(c, cn, uNightMix);' : '',
    NI ? '  }' : '',
    // ---- ночь: без картинки вся сцена тёмно-синяя (30–35%), небо темнее земли, огни; звёзды — поверх всегда ----
    '  if (uNightSky > 0.001 || uNightGnd > 0.001 || uStars > 0.001) {',
    '    vec3 nc = hasNv > 0.5 ? c : mix(mix(c, c * ' + v3(LK.nightProc.ground) + ', uNightGnd), mix(c, c * ' + v3(LK.nightProc.sky) + ', uNightSky), sky);',
    '    float star = 0.0;',
    '    if (sky > 0.02 && starQ > 0.0) {',
    '      vec2 g = pc * vec2(' + glf(STAR_CELLS[0]) + ', ' + glf(STAR_CELLS[1]) + ');',   // звёздная сетка: ячеек по ширине и высоте кадра (от размера кадра здания)
    '      vec2 cell = floor(g);',
    '      if (h21(cell) < starQ) {',
    '        vec2 sp = vec2(0.15 + 0.7 * h21(cell + 7.3), 0.15 + 0.7 * h21(cell + 19.1));',
    '        float r = 0.5 + 1.0 * h21(cell + 3.7);',                    // радиус 0.5–1.5 px
    '        float dpx = length((fract(g) - sp) * uCellPx);',
    '        float per = 3.0 + 4.0 * h21(cell + 11.9);',                // мерцание: период 3–7 с
    '        float tw = 0.62 + 0.38 * sin(uTime * 6.2832 / per + h21(cell + 5.5) * 6.2832);',
    '        star = smoothstep(r, 0.0, dpx) * tw * (0.55 + 0.45 * h21(cell + 2.2));',
    '      }',
    '    }',
    '    if (uShootP.x >= 0.0) {',                                        // падающая звезда (в экранных координатах)
    '      vec2 head = uShoot.xy + uShoot.zw * uShootP.y * uShootP.x;',
    '      vec2 tl = uShoot.zw * 0.11;',
    '      vec2 pa = (sc - (head - tl)) * vec2(uAspect, 1.0);',
    '      vec2 ba = tl * vec2(uAspect, 1.0);',
    '      float hh = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);',
    '      star += smoothstep(0.004, 0.0, length(pa - ba * hh)) * hh * sin(3.1416 * uShootP.x) * 1.5;',
    '    }',
    '    nc += ' + v3(LK.stars.color) + ' * star * sky * uStars;',
    '    nc += ' + v3(LK.windowGlow.color) + ' * winNight * ' + glf(LK.windowGlow.strength) + ' + ' + v3(LK.windowGlow.color2) + ' * winNight * winNight * ' + glf(LK.windowGlow.strength2) + ';',
    SPILL > 0 ? '    nc += ' + v3(LK.windowGlow.color) + ' * (texture2D(em, vec2(pc.x, ek.y + pc.y * ek.x)).r * (1.0 - eg.a) * inv) * ' + glf(SPILL) + ';' : '',
    '    c = nc;',
    '  }',
    // ---- погода (e1.3): при uWeather = 0 блок не выполняется — картинка ровно как без погоды ----
    '  if (uWeather.x + uWeather.y + uWeather.z + uWeather.w > 0.0) {',
    '    float dd = clamp(mix(env.r, bdL, b.a), 0.0, 1.0);',                       // глубина точки: 0 — далеко, 1 — близко
    '    float lw = dot(c, vec3(0.299, 0.587, 0.114));',
    '    vec3 oc = mix(c, vec3(lw), ' + glf(LK.weather.overcastGray) + ') * (1.0 - ' + glf(LK.weather.overcastDim) + ' * (1.0 - 0.7 * uNightGnd));',   // пасмурно: цвета глуше, свет ровнее
    '    oc = mix(oc, ' + v3(LK.weather.overcastSky) + ' * mix(1.0, 0.22, uNightSky) * clamp(lw / skyRef.x * 1.05, 0.7, 1.05), sky * 0.85);',   // небо — серое, звёзды тонут
    '    c = mix(c, oc, uWeather.x);',
    '    c *= 1.0 - ' + glf(LK.weather.wetDim) + ' * uWeather.z * (1.0 - sky);',           // мокрая земля и стены темнее
    '    if (uWeather.w > 0.0) {',
    '      vec2 ey = vec2(0.0, 5.0 / ' + FH.toFixed(1) + ');',
    '      float dUp = texture2D(depth, p - ey).r, dDn = texture2D(depth, p + ey).r;',
    '      float cap = clamp((env.r - dUp) / max(env.r, 0.06) * 7.0, 0.0, 1.0);',   // верх предмета; относительная разница — и у дальних крыш                                     // верх предмета: над ним — дальше (крыша, крона, карниз)
    '      float gnd = smoothstep(0.003, 0.015, dDn - dUp) * (1.0 - smoothstep(0.04, 0.09, dDn - dUp));',   // земля: глубина плавно растёт к зрителю
    '      float capB = b.a * clamp(1.0 - texture2D(bld, pb - ey * 1.6).a, 0.0, 1.0);',              // верхний край главного здания
    '      float sm = max(max(cap, capB), gnd) * (1.0 - sky) * (0.7 + 0.6 * wxNoise(sc * vec2(90.0, 160.0))) * (0.85 + 0.15 * dd);' + (SNOWM ? '\n      if (snowM > -0.5) sm = snowM * mix(texture2D(ng, pc).a, texture2D(ng, clamp(pb, 0.0, 1.0)).a, b.a);' : ''),   // рыхло; // e1.25: маска кадра (Gemini) вместо формулы; snowM — проявление маски 0..1 (пока грузится — 0)
    SNOWM ? '      c = mix(c, ' + v3(LK.weather.snowTint) + ' * mix(1.0, snowM > -0.5 ? 0.5 : 0.35, uNightGnd) * (snowM > -0.5 ? 0.8 + 0.22 * smoothstep(0.12, 0.65, lw) : 1.0), clamp(uWeather.w * ' + glf(LK.weather.snowK) + ' * sm, 0.0, snowM > -0.5 ? 0.95 : 0.92));'   // по маске: штрих рисунка чуть просвечивает сквозь снег
      : '      c = mix(c, ' + v3(LK.weather.snowTint) + ' * mix(1.0, 0.35, uNightGnd), clamp(uWeather.w * ' + glf(LK.weather.snowK) + ' * sm, 0.0, 0.92));',
    '      float gn = clamp((c.g - max(c.r, c.b)) * 7.0, 0.0, 1.0) * (1.0 - sky);',                  // зелень (трава, листва) зимой — серо-белая
    SNOWM ? '      c = mix(c, vec3(dot(c, vec3(0.3, 0.59, 0.11))) * vec3(0.98, 1.0, 1.04) * 1.12, uWeather.w * gn * (snowM > -0.5 ? 0.3 : 0.85));'   // с маской зелень не седеет целиком — снег лежит на кронах сам
      : '      c = mix(c, vec3(dot(c, vec3(0.3, 0.59, 0.11))) * vec3(0.98, 1.0, 1.04) * 1.12, uWeather.w * gn * 0.85);',
    '      c = mix(c, c * vec3(0.96, 0.98, 1.03), uWeather.w * 0.6);',                             // холодный свет
    '    }',
    '    float wisp = 0.6 * wxNoise(vec2(sc.x * 2.6 - uCloudT * 0.045, sc.y * 7.0)) + 0.4 * wxNoise(vec2(sc.x * 6.0 - uCloudT * 0.08, sc.y * 15.0 + 3.0));',   // полосы тумана плывут
    '    float fg = uWeather.y * clamp((pow(1.0 - dd, 1.3) * ' + glf(LK.weather.fogNear) + ' + sky * ' + glf(LK.weather.fogSky) + ') * (0.55 + 0.9 * wisp) + 0.18 * smoothstep(0.45, 0.95, sc.y) * wisp, 0.0, 0.95);',   // туман по глубине: дальнее тонет сильнее, у земли гуще
    '    fg = min(0.93, fg * (1.0 + 0.45 * uNightGnd) * mix(1.0, 0.55 + 0.9 * wisp, uNightGnd));',   // ночью туман — клубами, светлее неба и земли (как в кино)
    '    c = mix(c, mix(' + v3(LK.weather.fogDay) + ', ' + v3(LK.weather.fogNight) + ', uNightGnd), fg);',
    '  }',
    '  if (uFlash > 0.0) c = mix(c, ' + v3(LK.weather.flash) + ', uFlash * (sky * mix(0.55, 0.9, uNightSky) + (1.0 - sky) * mix(0.12, 0.3, uNightGnd)));',
    '  return vec4(c, sky);',   // a — доля неба в точке (тень облака на небо не кладём)
    '}',
    '',
    'void main() {',
    '  vec2 uv = vUv * uCoverScale + uCoverOffset;',
    '  uv = 0.5 + (uv - 0.5) / uScale;',
    '  vec2 uvA = 0.5 + (uv - 0.5) / uFadeZoom.x;',
    '  vec4 sa = shadeFrame(uBgA, uDepthA, uBldA, uEmA, uKdA, uStarQ.x, uSkyRef.xy, uCropA, uFlagA, ' + (SPILL > 0 ? 'uEmKA, ' : '') + (NI ? 'uSGA, uSBA, uNGA, uNBA, uHasA, ' : '') + (NI && MVD ? 'uMvCalA, ' : '') + (FN > 0 ? '0.0, ' : '') + (SNOWM ? 'uSnowM.x, ' : '') + 'uvA, vUv);',
    '  if (uMix > 0.0) {',
    '    vec2 uvB = 0.5 + (uv - 0.5) / uFadeZoom.y;',
    '    sa = mix(sa, shadeFrame(uBgB, uDepthB, uBldB, uEmB, uKdB, uStarQ.y, uSkyRef.zw, uCropB, uFlagB, ' + (SPILL > 0 ? 'uEmKB, ' : '') + (NI ? 'uSGB, uSBB, uNGB, uNBB, uHasB, ' : '') + (NI && MVD ? 'uMvCalB, ' : '') + (FN > 0 ? '1.0, ' : '') + (SNOWM ? 'uSnowM.y, ' : '') + 'uvB, vUv), uMix);',
    '  }',
    '  vec3 c = sa.rgb;',
    CF > 0 ? '  float shadow = vCloud;' : '  float shadow = cloudShadow(uv, uCloudT);',
    '  if (uWeather.x > 0.0) shadow = clamp(mix(shadow, max(shadow, cloudShadow(uv * 0.7 + 0.15, uCloudT * 1.3 + 17.0)), uWeather.x) * (0.55 + 0.7 * wxNoise(uv * 3.5 + vec2(uCloudT * 0.02, 0.0))), 0.0, 1.0);',   // тучи: теней больше, края рваные
    '  c *= (1.0 - (mix(uCloudK.x, uCloudK.y, uMix)' + (CF > 0 ? ' * ' + glf(CF) : '') + ' + uWeather.x * ' + glf(LK.weather.overcastShadow) + ') * shadow * (1.0 - sa.a) * (1.0 - uNightGnd' + (CFN > 0 ? ' * ' + glf(1 - CFN) : '') + '));',   // в тучи тени облаков по земле гуще; e1.18 CLOUD_FIELD_NIGHT — и ночью слабее
    '  gl_FragColor = vec4(c, 1.0);',
    '}'
  ].join('\n');
  if (SWAY) SCENE_FRAG = SCENE_FRAG.replace(/texture2D\(depth, /g, 'envT(depth, ');   // e1.26: верхний этаж карты окружения

  // Второй проход: длинные тени на закате и фонари ночью (тёплый ореол + светлое пятно на земле).
  var POST_FRAG = [
    'precision highp float;',
    'varying vec2 vTc;',
    'uniform sampler2D uScene;',
    'uniform float uSunset;',   // 0..1
    'uniform float uNight;',    // 0..1
    'uniform float uAspect;',
    'uniform vec3 uLampH[16];', // ореол у лампы: x,y (текстурные координаты), z = яркость
    'uniform vec3 uLampB[16];', // пятно света на земле под лампой
    'uniform float uFog;',      // туман: ореолы фонарей шире — свет рассеивается в дымке
    'float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }',
    'void main() {',
    '  vec3 c = texture2D(uScene, vTc).rgb;',
    '  if (uSunset > 0.001) {',
    // тени длиннее: тёмное «стекает» вдоль направления от низкого солнца
    '    vec2 dir = vec2(' + (SUN_RIGHT ? '1.0' : '-1.0') + ', -0.28) * ' + glf(LK.sunsetSmear.length) + ';',   // тени «стекают» от солнца (SUN_SIDE здания)
    '    float smear = 0.0;',
    '    for (int i = 1; i <= 10; i++) {',
    '      vec3 tap = texture2D(uScene, vTc - dir * float(i)).rgb;',
    '      smear += smoothstep(0.62, 0.30, lum(tap)) * (1.0 - float(i) / 11.0);',
    '    }',
    '    smear = clamp(smear / 4.0, 0.0, 1.0);',
    '    float l = lum(c);',
    '    vec3 dk = c * (1.0 - ' + glf(LK.sunsetSmear.strength) + ' * smear) * mix(1.0, ' + glf(LK.sunsetSmear.dark) + ', smoothstep(0.50, 0.22, l));',   // длинные и темнее
    '    c = mix(c, dk, uSunset);',
    '  }',
    '  if (uNight > 0.001) {',
    '    for (int i = 0; i < 16; i++) {',
    '      vec3 lh = uLampH[i];',
    '      if (lh.z > 0.001) {',
    '        vec2 d = (vTc - lh.xy) * vec2(uAspect, 1.0);',
    '        float r2 = dot(d, d);',
    '        c += ' + v3(LK.lampHalo.color) + ' * (exp(-r2 / ' + glf(LK.lampHalo.coreSize) + ') * ' + glf(LK.lampHalo.core) + ' + exp(-r2 / (' + glf(LK.lampHalo.wideSize) + ' * (1.0 + 5.0 * uFog))) * ' + glf(LK.lampHalo.wide) + ' * (1.0 + 1.6 * uFog)) * lh.z;',
    '      }',
    '      vec3 lb = uLampB[i];',
    '      if (lb.z > 0.001) {',
    '        vec2 d = vTc - lb.xy;',
    '        d.x *= uAspect;',
    '        c += ' + v3(LK.lampHalo.groundColor) + ' * exp(-(d.x * d.x / ' + glf(LK.lampHalo.groundSizeX) + ' + d.y * d.y / ' + glf(LK.lampHalo.groundSizeY) + ')) * lb.z * ' + glf(LK.lampHalo.ground) + ';',
    '      }',
    '    }',
    '  }',
    '  gl_FragColor = vec4(c, 1.0);',
    '}'
  ].join('\n');
  // s16: редкое мягкое мигание 1–2 фонарей кадра ночью (LAMP_FLICKER.lamps[1] > 0 — только здания с настройкой; у остальных шейдер тот же).
  // Провал яркости — по эллипсу нарисованного в ночной картинке пятна света (как p9_lamp_light.py: полуоси 1,25·H и 1,25·H·0,5, центр чуть ниже основания).
  var FLICK = !!(CONFIG.LAMP_FLICKER && CONFIG.LAMP_FLICKER.lamps && CONFIG.LAMP_FLICKER.lamps[1] > 0);
  if (FLICK) POST_FRAG = POST_FRAG.replace('void main() {', 'uniform vec4 uLampD[16];\nvoid main() {').replace('  gl_FragColor = vec4(c, 1.0);', [
    '  if (uNight > 0.001) {',
    '    for (int i = 0; i < 16; i++) {',
    '      vec4 ld = uLampD[i];',
    '      if (ld.w > 0.001) {',
    '        vec2 d = (vTc - ld.xy) * vec2(uAspect, 1.0);',
    '        float e = sqrt(d.x * d.x / (ld.z * ld.z) + d.y * d.y / (ld.z * ld.z * 0.25));',
    '        c *= 1.0 - ld.w * smoothstep(1.15, 0.25, e);',
    '      }',
    '    }',
    '  }',
    '  gl_FragColor = vec4(c, 1.0);'].join('\n'));

  var scenePrg = null, postPrg = null;
  var US = {}, UP = {};
  var fbo = null, sceneTex = null, fboW = 0, fboH = 0;

  var parExt = useGL ? gl.getExtension('KHR_parallel_shader_compile') : null;   // компиляция в фоне, если умеет браузер

  function compileShader(type, src) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    return sh;
  }
  function startProgram(frag, vert) {   // компиляция и линковка запускаются, но не ждём ответа драйвера
    var prog = gl.createProgram(), vs = compileShader(gl.VERTEX_SHADER, vert || VERT), fs = compileShader(gl.FRAGMENT_SHADER, frag);
    gl.attachShader(prog, vs); gl.attachShader(prog, fs);
    gl.bindAttribLocation(prog, 0, 'aPos');
    gl.linkProgram(prog);
    return { prog: prog, vs: vs, fs: fs };
  }
  function finishProgram(h, names, out) {   // готово? -> проверяем ошибки, берём адреса uniform-ов
    if (!gl.getProgramParameter(h.prog, gl.LINK_STATUS)) {
      throw new Error((gl.getShaderInfoLog(h.vs) || '') + (gl.getShaderInfoLog(h.fs) || '') + (gl.getProgramInfoLog(h.prog) || ''));
    }
    gl.useProgram(h.prog);
    names.forEach(function (n) { out[n] = gl.getUniformLocation(h.prog, n); });
    return h.prog;
  }
  function whenCompiled(hs) {   // ждём в фоне, короткими проверками (без блокировки главного потока)
    return new Promise(function (res) {
      (function poll() {
        var done = !parExt || hs.every(function (h) { return gl.getProgramParameter(h.prog, parExt.COMPLETION_STATUS_KHR); });
        if (done) res(); else setTimeout(poll, 30);
      })();
    });
  }

  var SCENE_NAMES = ['uBgA', 'uDepthA', 'uBldA', 'uEmA', 'uBgB', 'uDepthB', 'uBldB', 'uEmB',
    'uKdA', 'uKdB', 'uSkyRef', 'uCloudK', 'uCropA', 'uCropB', 'uFlagA', 'uFlagB', 'uStarQ', 'uMix', 'uShift', 'uZoom', 'uScale', 'uCoverScale', 'uCoverOffset', 'uTime', 'uCloudT',
    'uSunset', 'uNightSky', 'uNightGnd', 'uStars', 'uFadeZoom', 'uAspect', 'uWindAmp', 'uWindOn', 'uWeather', 'uFlash', 'uCellPx', 'uShoot', 'uShootP']
    .concat(NI ? ['uSGA', 'uSBA', 'uNGA', 'uNBA', 'uSGB', 'uSBB', 'uNGB', 'uNBB', 'uHasA', 'uHasB', 'uSunMix', 'uNightMix'] : [])
    .concat(NI && MVD ? ['uMvCalA', 'uMvCalB'] : [])
    .concat(SPILL > 0 ? ['uEmKA', 'uEmKB'] : [])
    .concat(FN > 0 ? ['uFigA', 'uFigB', 'uFigN'] : [])
    .concat(FIGB ? ['uFigBoxA', 'uFigBoxB'] : [])
    .concat(GUSTS ? ['uWindG'] : [])
    .concat(SNOWM ? ['uSnowM'] : []);

  var quadBuf = null, gridBuf = null, gridIdx = null, gridN = 0;   // e1.19: четыре вершины (второй проход) и сетка сцены (CLOUD_FIELD)
  function initGLProgram() {   // возвращает Promise: шейдеры компилируются в фоне, приветствие и анимации не замирают
    quadBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gridBuf = null; gridIdx = null; gridN = 0;
    if (CF > 0) {   // e1.19: сетка для сцены (поле облаков в узлах); второй проход — как был, на четырёх вершинах
      var gx = CF_GRID[0], gy = CF_GRID[1], vtx = new Float32Array((gx + 1) * (gy + 1) * 2), ix = new Uint16Array(gx * gy * 6), a, b2, k2 = 0;
      for (b2 = 0; b2 <= gy; b2++) for (a = 0; a <= gx; a++) { vtx[k2++] = a / gx * 2 - 1; vtx[k2++] = b2 / gy * 2 - 1; }
      k2 = 0;
      for (b2 = 0; b2 < gy; b2++) for (a = 0; a < gx; a++) {
        var v0 = b2 * (gx + 1) + a, v1 = v0 + 1, v2 = v0 + gx + 1, v3 = v2 + 1;
        ix[k2++] = v0; ix[k2++] = v1; ix[k2++] = v2; ix[k2++] = v2; ix[k2++] = v1; ix[k2++] = v3;
      }
      gridBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, gridBuf); gl.bufferData(gl.ARRAY_BUFFER, vtx, gl.STATIC_DRAW);
      gridIdx = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gridIdx); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, ix, gl.STATIC_DRAW);
      gridN = ix.length;
      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    }
    var hs = startProgram(SCENE_FRAG, VERT_SCENE), hp = startProgram(POST_FRAG);
    return whenCompiled([hs, hp]).then(function () {
      scenePrg = finishProgram(hs, SCENE_NAMES, US);
      // юниты: кадр A = 0..7 (земля, глубина+окружение, здание, окна, закат: земля/главное здание, ночь: земля/главное здание),
      // кадр B = 8..15. Сами текстуры подставляются при отрисовке — подгрузки во время показа нет.
      var uA = ['uBgA', 'uDepthA', 'uBldA', 'uEmA', 'uSGA', 'uSBA', 'uNGA', 'uNBA'], uB = ['uBgB', 'uDepthB', 'uBldB', 'uEmB', 'uSGB', 'uSBB', 'uNGB', 'uNBB'];
      uA.forEach(function (n, i) { if (US[n]) gl.uniform1i(US[n], i); });
      uB.forEach(function (n, i) { if (US[n]) gl.uniform1i(US[n], i + UB0); });
      gl.uniform1f(US.uScale, CONFIG.BASE_SCALE);
      postPrg = finishProgram(hp, ['uScene', 'uSunset', 'uNight', 'uAspect', 'uLampH', 'uLampB', 'uFog'].concat(FLICK ? ['uLampD'] : []), UP);
      gl.uniform1i(UP.uScene, 0);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      fbo = null; sceneTex = null; fboW = 0; fboH = 0;
    });
  }

  function makeTexture(filter) {
    var tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    return tex;
  }

  function uploadL(d) { // одноканальная карта
    var tex = makeTexture(gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, d.w, d.h, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, d.d);
    return tex;
  }

  // Заливает в GPU данные кадра, подготовленные воркером (prep.js): типизированные массивы. Каждая текстура — отдельной
  // короткой задачей (между ними пауза), чтобы главный поток не замирал: приветствие и анимации идут плавно.
  function tick() { return new Promise(function (r) { setTimeout(r, 0); }); }
  function texRGB(w, h, data) {
    var t = makeTexture(gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, w, h, 0, gl.RGB, gl.UNSIGNED_BYTE, data);
    return t;
  }
  function texRGBA(w, h, data) {
    var t = makeTexture(gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    return t;
  }
  function uploadDay(f, r) {
    var steps = [
      function () { f.bgTex = r.ground4 ? texRGBA(r.w, r.h, r.ground4) : texRGB(r.w, r.h, r.ground); },   // земля: кадр с подложкой на месте здания (+ в альфе глубина здания по точкам, если включена)
      function () { f.depthTex = texRGBA(r.ew, r.swayRows ? r.eh * 2 : r.eh, r.gpuDepth); },   // R глубина, G небо, B высота дерева, A фаза (вдвое мельче); e1.26 SWAY — двухэтажная (снизу поля качания крон)
      function () { f.bldTex = texRGBA(r.w, r.h, r.bldPm); },                // здание, цвет уже умножен на альфу
      function () { emSetup(f, r); f.emTex = texRGBA(r.ew, f.emH, f.emAll); }   // окна: R/G свет ночью (главное здание/другие здания), B/A сами маски (+ свет на стене, e1.19)
    ];
    return steps.reduce(function (p, st) { return p.then(function () { st(); return tick(); }); }, Promise.resolve());
  }
  // e1.25 (s22): маска снега кадра — в альфу ночной картинки земли (одна загрузка, отдельный маленький холст только для чтения)
  function snowMaskData(url, w, h) {
    return new Promise(function (res) {
      var im = new Image(); im.crossOrigin = 'anonymous';
      im.onload = function () {
        try { var cv = document.createElement('canvas'); cv.width = w; cv.height = h; var x = cv.getContext('2d', { willReadFrequently: true }); x.drawImage(im, 0, 0, w, h); res(x.getImageData(0, 0, w, h).data); }
        catch (e) { logErr('snow mask', e); res(null); }
      };
      im.onerror = function () { logErr('snow mask', 'не загрузилась'); res(null); };
      im.src = url;
    });
  }
  function uploadState(f, kind, r) {   // kind: 's' закат | 'n' ночь; ground — земля, full — вся картинка (главное здание берётся по альфе дня)
    if (SNOWM && kind === 'n' && FRAMES[f.idx].snow) {
      return snowMaskData(FRAMES[f.idx].snow, r.w, r.h).then(function (a) {
        var n = r.w * r.h, g4 = new Uint8Array(n * 4);
        for (var i = 0; i < n; i++) { g4[i * 4] = r.ground[i * 3]; g4[i * 4 + 1] = r.ground[i * 3 + 1]; g4[i * 4 + 2] = r.ground[i * 3 + 2]; g4[i * 4 + 3] = a ? a[i * 4] : 0; }
        f.nG = texRGBA(r.w, r.h, g4); f.snowOk = !!a; f.snowFail = !a; f.snowT = 0;
        return tick();
      }).then(function () { f.nB = texRGB(r.w, r.h, r.full); return tick(); });
    }
    f[kind + 'G'] = texRGB(r.w, r.h, r.ground);
    return tick().then(function () { f[kind + 'B'] = texRGB(r.w, r.h, r.full); return tick(); });
  }

  // e1.19 (s15): текстура окон. Без WIN_SPILL — как была (ew × eh). С WIN_SPILL — двухэтажная (ew × (2·eh + 4)): строки 0..eh-1 — окна
  // (f.emis — вид на них, туда пишет updateWindows), eh и eh+1 — копия последней строки окон (край как у CLAMP_TO_EDGE), eh+2 и eh+3 —
  // копия первой строки света на стене, eh+4.. — свет окна на стене под ним (R). Свет на стене = те же три выборки карты окон выше точки
  // (0,5 / 0,32 / 0,18), что считал шейдер e1.18 на каждый пиксель, только на CPU, один раз и потом лишь в куске переключённого окна.
  var SPILL_TAPS = SPILL > 0 ? [[+glf(SPILL_PX * 0.35 / FH), 0.5], [+glf(SPILL_PX * 0.7 / FH), 0.32], [+glf(SPILL_PX * 1.05 / FH), 0.18]] : [];
  function emSetup(f, r) {
    var ew = r.ew, eh = r.eh;
    f.emRect = null;
    if (SPILL > 0) {
      var H = eh * 2 + 4, all = new Uint8Array(ew * H * 4);
      all.set(r.emis);
      f.emAll = all; f.emis = all.subarray(0, ew * eh * 4); f.emH = H; f.emK = [eh / H, (eh + 4) / H];
      f.emTaps = SPILL_TAPS.map(function (t) { return [t[0] * eh, t[1]]; });
      f.emReach = Math.ceil(Math.max.apply(null, f.emTaps.map(function (t) { return t[0]; }))) + 1;   // на сколько строк вниз достаёт свет окна
      emSpillRows(f, 0, ew - 1, 0, eh - 1);
      emPadRows(f, 0, ew - 1);
    } else { f.emAll = r.emis; f.emis = r.emis; f.emH = eh; f.emK = [1, 0]; }
  }
  function emSpillRows(f, x0, x1, j0, j1) {   // свет на стене в строках j0..j1, столбцах x0..x1 (по каналу G окон других зданий)
    var ew = f.ew, eh = f.eh, A = f.emAll, T = f.emTaps, base = (eh + 4) * ew, j, x, i, y, y0, fr, ra, rb, sum;
    for (j = j0; j <= j1; j++) {
      for (x = x0; x <= x1; x++) {
        sum = 0;
        for (i = 0; i < T.length; i++) {   // линейная выборка по вертикали, как у текстуры (край — CLAMP_TO_EDGE)
          y = j - T[i][0]; y0 = Math.floor(y); fr = y - y0;
          ra = y0 < 0 ? 0 : (y0 > eh - 1 ? eh - 1 : y0); rb = y0 + 1 < 0 ? 0 : (y0 + 1 > eh - 1 ? eh - 1 : y0 + 1);
          sum += T[i][1] * (A[(ra * ew + x) * 4 + 1] * (1 - fr) + A[(rb * ew + x) * 4 + 1] * fr);
        }
        A[(base + j * ew + x) * 4] = (sum + 0.5) | 0;
      }
    }
  }
  function emPadRows(f, x0, x1) {   // строки-прокладки между этажами (чтобы линейная выборка у края этажа вела себя как у края текстуры)
    var ew = f.ew, eh = f.eh, A = f.emAll, x, k, s0 = ((eh - 1) * ew) * 4, s1 = ((eh + 4) * ew) * 4;
    for (x = x0; x <= x1; x++) for (k = 0; k < 4; k++) {
      A[(eh * ew + x) * 4 + k] = A[((eh + 1) * ew + x) * 4 + k] = A[s0 + x * 4 + k];
      A[((eh + 2) * ew + x) * 4 + k] = A[((eh + 3) * ew + x) * 4 + k] = A[s1 + x * 4 + k];
    }
  }
  function emSub(f, x0, y0, x1, y1) {   // залить в GPU прямоугольник текстуры окон (WebGL1 без UNPACK_ROW_LENGTH — копия строк)
    var ew = f.ew, w = x1 - x0 + 1, h = y1 - y0 + 1, buf;
    if (w === ew) buf = f.emAll.subarray(y0 * ew * 4, (y1 + 1) * ew * 4);
    else {
      var n = w * h * 4;
      if (!f.emTmp || f.emTmp.length < n) f.emTmp = new Uint8Array(Math.max(n, 4096));
      buf = f.emTmp.subarray(0, n);
      for (var y = 0; y < h; y++) buf.set(f.emAll.subarray(((y0 + y) * ew + x0) * 4, ((y0 + y) * ew + x1 + 1) * 4), y * w * 4);
    }
    gl.texSubImage2D(gl.TEXTURE_2D, 0, x0, y0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  }
  // e1.19: в GPU уходит только изменившийся кусок (рамка переключённых окон), а не вся текстура окон каждый кадр перехода
  function uploadEm(f) {
    if (!f || !f.emDirty) return;
    f.emDirty = false;
    var R = f.emRect; f.emRect = null;
    if (!R) return;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, f.emTex);
    var eh = f.eh;
    if (SPILL > 0) {
      var j1 = Math.min(eh - 1, R[3] + f.emReach);
      emSpillRows(f, R[0], R[2], R[1], j1);
      emPadRows(f, R[0], R[2]);
      emSub(f, R[0], R[1], R[2], R[3] >= eh - 1 ? eh + 1 : R[3]);
      emSub(f, R[0], R[1] === 0 ? eh + 2 : eh + 4 + R[1], R[2], eh + 4 + j1);
    } else emSub(f, R[0], R[1], R[2], R[3]);
  }
  function winBox(idx, ew) {   // рамка окна в пикселях карты окон
    var x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
    for (var k = 0; k < idx.length; k++) { var x = idx[k] % ew, y = (idx[k] / ew) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    return [x0, y0, x1, y1];
  }

  // ---------- e1.14 синемаграф (кадр: motionVideo {src, mask, on}) — основной способ оживления ----------
  // Включён у каждого кадра, где задан (on: false — выключен, ?cine=1 — включить и такой; ?cine=0 — выключить все, для сравнения).
  // Видео держим только у текущего и соседних кадров (и у того, в который идёт переход); остальные освобождаются.
  // Кадр видео × маска (альфа) → холст → текстура в юнит заката-земли; шейдер кладёт его в рисунок земли (см. shadeFrame).
  var MV = {}, MVN = {}, mvQ = location.search;   // e1.17: MV — дневные клипы кадра, MVN — ночные (clips[].time = "night")
  function mvConf(i) {
    if (!NI || /[?&]cine=0/.test(mvQ)) return null;
    var M = ((CONFIG.SCENE && CONFIG.SCENE[i]) || {}).motionVideo;
    if (!M || !(M.src || (M.clips && M.clips.length)) || !M.mask) return null;   // e1.16: clips [{src}] или старое src
    if (M.on === false && !/[?&]cine=1/.test(mvQ)) return null;
    if (FRAMES[i] && FRAMES[i].sunset) return null;   // юнит заката-земли занят картинкой заката — видео не кладём (у кадров с синемаграфом заката-картинки нет)
    return M;
  }
  // e1.16 (s10): клипы Flow «Frames to Video» — первый кадр = последний = рисунок, поэтому любой клип стыкуется с любым:
  // motionVideo.clips [{src}] — после каждого круга случайный следующий (один клип — обычная петля). Старое {src} — один клип.
  // e1.17 (s11): у клипа time: "day" (по умолчанию) | "night". Днём играют дневные, ночью — ночные (ночная картинка + фары и огни из ролика);
  // на переходе день↔ночь оба клипа играют, каждый в своей картинке, и меняются вместе с картинкой. Без ночных клипов ночью — как в e1.16
  // (дневной клип поверх ночной картинки, темнее). speed — замедление, уже вшитое в файл (tools/cinemagraph.py), rate — доп. множитель.
  // Искусственные фары по трекам (e1.15, _cars.json) удалены: фары — только в ночных роликах.
  function mvClips(M, night) {
    var a = M.clips && M.clips.length ? M.clips : [{ src: M.src }];
    return a.filter(function (c) { return night ? c.time === 'night' : c.time !== 'night'; });
  }
  // iOS: видео вне документа и до первого касания Safari может не запускать (бета s9: «B оживает после нескольких пролистываний»).
  // Поэтому: видео живут в скрытом слое документа (1 px, прозрачно), muted + playsinline + autoplay ДО src, play() — на canplay,
  // при отказе — повтор с паузой, и первое касание/клавиша запускает все нужные видео прямо в обработчике жеста.
  var mvHold = null;
  function mvHolder() {
    if (mvHold) return mvHold;
    mvHold = document.createElement('div'); mvHold.setAttribute('aria-hidden', 'true');
    mvHold.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;overflow:hidden;opacity:0.01;pointer-events:none;z-index:-1';
    document.body.appendChild(mvHold); return mvHold;
  }
  function mvTryPlay(S, now) {
    if (!S.want || !S.v.paused || S.pending || S.fail || (now || 0) < S.retryAt) return;
    var pr; try { pr = S.v.play(); } catch (e) { pr = null; }
    if (pr && pr.then) {
      S.pending = true;
      pr.then(function () { S.pending = false; S.retries = 0; }, function (e) {
        S.pending = false; S.retries++; S.retryAt = performance.now() + Math.min(2000, 250 * S.retries);
        if (S.retries === 3) logErr('video play', (e && e.name) || e);
      });
    }
  }
  function mvGesture() {   // жест пользователя: нужные видео — играть; соседние (ещё не показанные) — «разблокировать» play→pause, чтобы при пролистывании они пошли сразу
    Object.keys(MV).map(function (k) { return MV[k]; }).concat(Object.keys(MVN).map(function (k) { return MVN[k]; })).forEach(function (S) {   // e1.17: и ночные клипы
      if (S.want && S.v.paused) { S.retryAt = 0; S.pending = false; mvTryPlay(S, 0); }
      else if (!S.want && !S.unlocked && S.v.paused) {
        S.unlocked = true;
        try { var pr = S.v.play(); if (pr && pr.then) pr.then(function () { if (!S.want) S.v.pause(); }, function () { S.unlocked = false; }); } catch (e) { S.unlocked = false; }
      }
    });
  }
  ['pointerdown', 'touchend', 'keydown', 'click'].forEach(function (ev) { window.addEventListener(ev, mvGesture, { passive: true, capture: true }); });
  function mvSetClip(S, j) {
    var C = S.clips[j]; S.ci = j; S.ready = false; S.t = -1;
    var vs = String(C.src), vq = vs.match(/[?#].*$/);   // s25: у адреса ролика может быть ?v=<хэш> — .mp4→.webm меняем в пути, запрос возвращаем
    if (vq) vs = vs.slice(0, vq.index);
    S.v.src = S.base + (S.h264 ? vs : vs.replace(/\.mp4$/, '.webm')) + (vq ? vq[0] : '');   // без H.264 — запасной VP9
    try { S.v.load(); } catch (e) {}
    S.rate = +C.rate > 0 ? +C.rate : 1;
    try { S.v.defaultPlaybackRate = S.rate; S.v.playbackRate = S.rate; } catch (e) {}
  }
  function mvOpen(i, night) {
    var map = night ? MVN : MV, S = map[i], M = mvConf(i);
    if (S || !M) return S;
    var clips = mvClips(M, night);
    if (!clips.length) return null;
    var base = (FRAMES[i].color || '').replace(/[^\/]*$/, '');
    S = map[i] = { v: document.createElement('video'), m: new Image(), t: -1, fail: false, ready: false, errs: 0, clips: clips, ci: 0, base: base, night: !!night,
                  want: false, pending: false, retries: 0, retryAt: 0, rate: 1 };
    S.v.muted = true; S.v.defaultMuted = true; S.v.playsInline = true; S.v.autoplay = false;
    S.v.setAttribute('playsinline', ''); S.v.setAttribute('webkit-playsinline', ''); S.v.setAttribute('muted', ''); S.v.preload = 'auto';
    S.v.loop = S.clips.length < 2;
    S.v.style.cssText = 'width:1px;height:1px';
    S.h264 = !!S.v.canPlayType('video/mp4; codecs="avc1.42E01E"');
    S.v.addEventListener('error', function () { S.fail = true; logErr('video ' + i + (night ? 'n' : ''), (S.v.error && ('code ' + S.v.error.code)) || 'error'); });
    S.v.addEventListener('loadeddata', function () { S.ready = true; try { S.v.playbackRate = S.rate; } catch (e) {} });
    S.v.addEventListener('canplay', function () { S.retryAt = 0; mvTryPlay(S, performance.now()); });   // готово — сразу играть, не ждать следующего кадра/касания
    S.v.addEventListener('ended', function () {   // e1.16: круг кончился (последний кадр = рисунок) — случайный следующий клип
      var n = S.clips.length, j = n < 2 ? 0 : (S.ci + 1 + Math.floor(Math.random() * (n - 1))) % n;
      if (n < 2) { try { S.v.currentTime = 0; } catch (e) {} } else mvSetClip(S, j);
      S.retryAt = 0; mvTryPlay(S, performance.now());
    });
    mvSetClip(S, window.__mvFreeze ? 0 : Math.floor(Math.random() * S.clips.length));
    S.m.src = base + M.mask;
    mvHolder().appendChild(S.v);
    return S;
  }
  function mvClose(i, night) {
    var map = night ? MVN : MV, S = map[i]; if (!S) return;
    try { S.v.pause(); S.v.removeAttribute('src'); S.v.load(); if (S.v.parentNode) S.v.parentNode.removeChild(S.v); } catch (e) {}
    var f = store[i];
    if (f && night) { if (f.mvTexN && useGL && gl) gl.deleteTexture(f.mvTexN); f.mvTexN = null; f.mvUseN = false; }
    else if (f) { if (f.mvTex && useGL && gl) gl.deleteTexture(f.mvTex); f.mvTex = null; f.mvUse = false; }
    delete map[i];
  }
  function mvPlan(cur, to, rm) {   // какие видео держать и какие играть — раз за кадр отрисовки (текущий + соседи — предзагрузка с входа)
    var n = FRAMES.length, keep = {}, now = performance.now();
    [cur, (cur + 1) % n, (cur + n - 1) % n, to].forEach(function (k) { if (k != null && mvConf(k)) keep[k] = 1; });
    // e1.17: ночные клипы грузим, когда ночь близко (идёт переход к ночи или уже за серединой заката), и освобождаем днём
    var nightNear = tod.p > 0.5 || tod.night > 0 || !!(todAnim && todAnim.p1 > 1);
    Object.keys(MV).forEach(function (k) { if (!keep[k]) mvClose(+k, false); });
    Object.keys(MVN).forEach(function (k) { if (!keep[k] || !nightNear) mvClose(+k, true); });
    Object.keys(keep).forEach(function (k) {
      var act = (+k === cur || +k === to) && !rm && perfLevel < 2 && !window.__mvFreeze && !document.hidden;
      var Sn = nightNear ? mvOpen(+k, true) : null, nOk = !!(Sn && !Sn.fail);
      var S = mvOpen(+k, false);
      if (S) {   // дневной клип: пока виден день; ночью — только если своего ночного клипа нет (тогда он ложится в ночную картинку, как в e1.16)
        S.want = act && (!nOk || tod.night < 0.999);
        if (S.want) mvTryPlay(S, now); else if (!S.v.paused) S.v.pause();
      }
      if (Sn) {
        Sn.want = act && tod.night > 0.001;
        if (Sn.want) mvTryPlay(Sn, now); else if (!Sn.v.paused) Sn.v.pause();
      }
    });
  }
  var mvCanvas = null;   // e1.15: один общий холст для всех видео (память iPhone): кадр видео × маска собирается и сразу уходит в текстуру
  function mvStep(f) {   // новый кадр видео → текстура (только когда кадр видео сменился); e1.17: дневной и ночной клип — каждый в свою текстуру
    if (!f) return;
    [MV[f.idx], MVN[f.idx]].forEach(function (S) {
      if (!S || S.fail || !S.ready || S.v.readyState < 2 || S.v.seeking || !S.m.complete || !S.m.naturalWidth) return;   // e1.15: только готовый кадр видео
      try { mvUpload(f, S); } catch (e) { S.errs++; logErr('video→texture ' + f.idx + (S.night ? 'n' : ''), e); if (S.errs > 5) { S.fail = true; if (S.night) f.mvUseN = false; else f.mvUse = false; } }
    });
  }
  // e1.18 (s14) MV_CAL: калибровка цвета видео. Нижние 16 строк ролика — плашки известного цвета (CONFIG.MV_CAL_PATCHES, их же рисует
  // tools/cinemagraph.py --cal; маска там 0, на экране их нет). Раз на клип меряем середины плашек на холсте (то, что реально уйдёт в
  // текстуру после декодирования Safari/Chrome) и подбираем поправку rgb' = A·rgb + b (наименьшие квадраты). Шейдер применяет её к
  // видео до вычитания серого 128 (MV_DELTA) — сдвиг цвета/гаммы декодера не меняет картинку. Нет полоски / странный замер — без поправки.
  var MV_ID = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  // e1.19 (s15): полоску меряем на СВОЁМ маленьком холсте (vw × 16, willReadFrequently), а не на общем холсте видео. Chrome после двух
  // чтений (getImageData) переводит холст на процессор навсегда: каждый кадр видео тогда идёт через CPU (видео → память → маска → снова
  // в GPU) — бета e1.18 на «ночь, кадр 2» (второй клип = второе чтение) упала с 60 до 47 fps. Замер и поправка — те же.
  var mvCalCv = null;
  function mvCalibrate(v, vw, vh) {
    var P = CONFIG.MV_CAL_PATCHES || [], n = P.length;
    if (n < 6) return null;
    var d;
    try {
      var cc = mvCalCv || (mvCalCv = document.createElement('canvas'));
      if (cc.width !== vw || cc.height !== 16) { cc.width = vw; cc.height = 16; }
      var cx = cc.getContext('2d', { willReadFrequently: true });
      cx.globalCompositeOperation = 'copy'; cx.drawImage(v, 0, vh - 16, vw, 16, 0, 0, vw, 16);
      d = cx.getImageData(0, 4, vw, 8).data;   // = строки vh-12 … vh-5 кадра видео, как в e1.18
    } catch (e) { logErr('video cal', e); return null; }
    var meas = [], i, j, k, w = vw / n;
    for (i = 0; i < n; i++) {
      var x0 = Math.round(i * w + w * 0.25), x1 = Math.round((i + 1) * w - w * 0.25), r = 0, g = 0, b = 0, c = 0;
      for (var yy = 0; yy < 8; yy++) for (var xx = x0; xx < x1; xx++) { k = (yy * vw + xx) * 4; r += d[k]; g += d[k + 1]; b += d[k + 2]; c++; }
      meas.push([r / c, g / c, b / c]);
    }
    // проверка, что полоска есть: серые плашки 0..6 идут по возрастанию и близки к своим значениям (±40)
    for (i = 0; i < 7; i++) if (Math.abs(meas[i][1] - P[i][1]) > 40 || (i && meas[i][1] <= meas[i - 1][1])) return null;
    // наименьшие квадраты: для каждого канала c: [m_r m_g m_b 1]·[a_r a_g a_b b] = P_c
    var AtA = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], Atb = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
    for (i = 0; i < n; i++) {
      var v = [meas[i][0] / 255, meas[i][1] / 255, meas[i][2] / 255, 1];
      for (j = 0; j < 4; j++) { for (k = 0; k < 4; k++) AtA[j][k] += v[j] * v[k]; for (var ch = 0; ch < 3; ch++) Atb[ch][j] += v[j] * P[i][ch] / 255; }
    }
    for (j = 0; j < 4; j++) AtA[j][j] += 1e-4;   // слабая регуляризация к единичной
    var sol = [0, 1, 2].map(function (ch) {   // Гаусс 4×4
      var M = AtA.map(function (row, r0) { return row.concat([Atb[ch][r0]]); }), r1, c1, q;
      for (c1 = 0; c1 < 4; c1++) {
        var piv = c1; for (r1 = c1 + 1; r1 < 4; r1++) if (Math.abs(M[r1][c1]) > Math.abs(M[piv][c1])) piv = r1;
        q = M[c1]; M[c1] = M[piv]; M[piv] = q;
        for (r1 = 0; r1 < 4; r1++) if (r1 !== c1) { var fk = M[r1][c1] / M[c1][c1]; for (k = c1; k < 5; k++) M[r1][k] -= fk * M[c1][k]; }
      }
      return [M[0][4] / M[0][0], M[1][4] / M[1][1], M[2][4] / M[2][2], M[3][4] / M[3][3]];
    });
    for (i = 0; i < 3; i++) if (!isFinite(sol[i][3]) || Math.abs(sol[i][i] - 1) > 0.6 || Math.abs(sol[i][3]) > 0.4) return null;
    // mat4 по столбцам: rgb' = A·rgb + b
    var m = new Float32Array([sol[0][0], sol[1][0], sol[2][0], 0, sol[0][1], sol[1][1], sol[2][1], 0, sol[0][2], sol[1][2], sol[2][2], 0, sol[0][3], sol[1][3], sol[2][3], 1]);
    window.__mvCal = { meas: meas.map(function (q) { return q.map(Math.round); }), m: Array.prototype.map.call(m, function (z) { return +z.toFixed(4); }) };
    return m;
  }
  function mvUpload(f, S) {
    var ct = S.v.currentTime, N = S.night;
    if ((N ? f.mvUseN : f.mvUse) && ct === S.t) return;
    S.t = ct;
    var vw = S.v.videoWidth, vh = S.v.videoHeight;
    if (!vw || !vh) return;
    var cv = mvCanvas || (mvCanvas = document.createElement('canvas'));
    if (cv.width !== vw || cv.height !== vh) { cv.width = vw; cv.height = vh; }
    var x = cv.getContext('2d');
    x.globalCompositeOperation = 'copy'; x.drawImage(S.v, 0, 0, vw, vh);
    if (MVD && CONFIG.MV_CAL && !N && S.calCi !== S.ci) { S.calCi = S.ci; S.cal = mvCalibrate(S.v, vw, vh); f.mvCal = S.cal; }   // e1.18: раз на клип
    else if (!N && S.cal) f.mvCal = S.cal;
    x.globalCompositeOperation = 'destination-in'; x.drawImage(S.m, 0, 0, vw, vh); x.globalCompositeOperation = 'source-over';
    gl.activeTexture(gl.TEXTURE0);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);   // как у картинок кадра (prep.js: colorSpaceConversion none)
    var tk = N ? 'mvTexN' : 'mvTex', wk = N ? 'mvWN' : 'mvW', hk = N ? 'mvHN' : 'mvH';
    if (!f[tk] || f[wk] !== vw || f[hk] !== vh) {
      if (f[tk]) gl.deleteTexture(f[tk]);
      f[tk] = makeTexture(gl.LINEAR); f[wk] = vw; f[hk] = vh;
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
    } else {
      gl.bindTexture(gl.TEXTURE_2D, f[tk]);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, cv);
    }
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.BROWSER_DEFAULT_WEBGL);
    if (N) f.mvUseN = true; else f.mvUse = true;
  }

  function bindFrame(f, unit0) {
    var t = [f.bgTex, f.depthTex, f.bldTex, f.emTex];
    for (var i = 0; i < 4; i++) {
      gl.activeTexture(gl.TEXTURE0 + unit0 + i);
      gl.bindTexture(gl.TEXTURE_2D, t[i]);
    }
    if (NI) {   // закат и ночь: юниты +4..+7; если картинки ещё нет — заглушка (шейдер её не читает: has = 0)
      var st = [f.mvUse ? f.mvTex : (f.sG || f.bgTex), f.mvUseN ? f.mvTexN : (f.sB || f.bgTex), f.nG || f.bgTex, f.nB || f.bgTex];   // e1.17: ночной клип — в юните заката-здания   // e1.14: видео синемаграфа — в юните заката-земли (у кадров с видео картинки заката нет)
      for (i = 0; i < 4; i++) {
        gl.activeTexture(gl.TEXTURE0 + unit0 + 4 + i);
        gl.bindTexture(gl.TEXTURE_2D, st[i]);
      }
    }
  }

  function ensureFbo(w, h) {
    if (fbo && fboW === w && fboH === h) return;
    if (sceneTex) gl.deleteTexture(sceneTex);
    if (fbo) gl.deleteFramebuffer(fbo);
    sceneTex = makeTexture(gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, sceneTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    fboW = w; fboH = h;
  }

  // ---------- e1.22 FIGURES: движение фигур (CPU, px кадра) ----------
  // Кривые — те же, что у интерфейса (engine/page.html): --ios cubic-bezier(.32,.72,0,1), --out (.16,1,.3,1), --in (.4,0,.9,.3).
  function bez(x1, y1, x2, y2) {
    function cx(t) { return 3 * x1 * t * (1 - t) * (1 - t) + 3 * x2 * t * t * (1 - t) + t * t * t; }
    function cy(t) { return 3 * y1 * t * (1 - t) * (1 - t) + 3 * y2 * t * t * (1 - t) + t * t * t; }
    return function (x) {
      if (x <= 0) return 0; if (x >= 1) return 1;
      var lo = 0, hi = 1, t = x;
      for (var k = 0; k < 18; k++) { t = (lo + hi) / 2; if (cx(t) < x) lo = t; else hi = t; }
      return cy(t);
    };
  }
  var C_IOS = bez(0.32, 0.72, 0, 1), C_OUT = bez(0.16, 1, 0.3, 1), C_IN = bez(0.4, 0, 0.9, 0.3);
  var TAU = Math.PI * 2;
  // импульс: подъём за a с (кривая ci), держим h с, спад за b с (кривая co); 0..1
  function pulse(dt, a, h, b, ci, co) {
    if (dt <= 0 || dt >= a + h + b) return 0;
    if (dt < a) return ci(dt / a);
    if (dt < a + h) return 1;
    return 1 - co((dt - a - h) / b);
  }
  function figInit(it, idx, j) {
    var R = rng(7919 * (idx + 1) + 104729 * (j + 1) + 17), ty = it[4];
    var r = function (a, b) { return a + (b - a) * R(); };
    var S = { R: R, r: r, p1: r(0, TAU), p2: r(0, TAU), p3: r(0, TAU), P1: r(5, 8.5), P2: r(2.9, 4.4), Pb: r(3.4, 4.9), next: r(1, 6), ev: -1e9, ev2: -1e9, evA: 1, hold: 0.5,
      wsFrom: 0, wsTo: 0, wsT0: -1e9, wsNext: r(0.5, 5), hop: -1e9, hopNext: r(6, 20), hopH: 2, sgn: R() < 0.5 ? -1 : 1 };
    S.amp = ty === 'sit' ? r(0.55, 0.85) : ty === 'chess' ? r(0.3, 0.5) : r(0.35, 0.55);
    if (ty === 'grass') { S.P1 = r(2.2, 3.4); S.amp = r(0.7, 1.1); }
    if (ty === 'balloon') { S.P1 = r(2.8, 3.6); S.P2 = r(1.5, 2.0); }
    return S;
  }
  // движение одной фигуры в момент t: [x, y] верха/целиком, z — рука/поворот головы/клюв вперёд, w — кивок/клюв вниз (px кадра)
  function figMotion(it, S, t, night) {
    var ty = it[4], r = S.r, x = 0, y = 0, z = 0, w = 0;
    if (ty === 'sit' || ty === 'stand' || ty === 'chess') {
      x = S.amp * (0.65 * Math.sin(TAU * t / S.P1 + S.p1) + 0.35 * Math.sin(TAU * t / S.P2 + S.p2));
      y = -(ty === 'sit' ? 0.5 : 0.35) * (0.5 - 0.5 * Math.cos(TAU * t / S.Pb + S.p3));   // дыхание
      if (ty === 'stand') {   // перенос веса: ±1 px, переход 1,3–1,8 с по --ios
        if (t > S.wsNext) { S.wsFrom = S.wsFrom + (S.wsTo - S.wsFrom) * C_IOS(Math.min(1, (t - S.wsT0) / S.wsDur || 1)); S.wsTo = (S.wsTo > 0 ? -1 : 1) * r(0.6, 1.1); S.wsT0 = t; S.wsDur = r(1.3, 1.8); S.wsNext = t + r(4, 10); }
        x += S.wsFrom + (S.wsTo - S.wsFrom) * C_IOS(Math.min(1, (t - S.wsT0) / (S.wsDur || 1)));
      }
      if (t > S.next) {   // событие: кивок (сидит), рука к доске (нарды), поворот головы (стоит)
        S.ev = evAt(S.next, t); S.evA = ty === 'chess' ? r(1.6, 2.2) : ty === 'sit' ? r(FIG_K ? 0.5 : 0.8, FIG_K ? 0.7 : 1.2) : (R2s(S) * r(0.45, 0.7));
        S.hold = ty === 'stand' ? r(1, 2.5) : ty === 'chess' ? r(0.35, 0.8) : r(0.3, 0.8);
        S.ev2 = ty === 'chess' && S.R() < 0.3 ? S.ev + 1.2 + S.hold + 1.25 : -1e9;
        S.next = S.ev + (ty === 'chess' ? r(6, 14) : ty === 'sit' ? r(8, 20) : r(10, 25));
      }
      var e = pulse(t - S.ev, ty === 'chess' ? 0.55 : 0.5, S.hold, ty === 'chess' ? 0.7 : 0.6, C_OUT, C_IOS) * S.evA;
      if (ty === 'chess') { z = e + pulse(t - S.ev2, 0.5, 0.3, 0.6, C_OUT, C_IOS) * S.evA * 0.7; w = 0.35 * e; }
      else if (ty === 'stand') z = e;
      else w = e;
    } else if (ty === 'pigeon') {
      if (t > S.next) { S.ev = evAt(S.next, t); S.evA = r(1.0, 1.5); S.ev2 = S.R() < 0.35 ? S.ev + r(0.4, 0.55) : -1e9; S.next = S.ev + r(1.6, 4.5); }
      var pk = pulse(t - S.ev, 0.12, 0.05, 0.22, C_IN, C_OUT) + pulse(t - S.ev2, 0.12, 0.04, 0.22, C_IN, C_OUT);
      w = pk * S.evA; z = pk * 0.4;
      if (t > S.hopNext) { S.hop = evAt(S.hopNext, t); S.hopH = FIG_K ? r(1.0, 1.6) : r(1.6, 2.6); S.hopNext = S.hop + r(10, 25); }
      var hp = (t - S.hop) / 0.32;
      if (hp > 0 && hp < 1) { y = -S.hopH * 4 * hp * (1 - hp); x = it[5] * 0.9 * Math.sin(Math.PI * hp); }
      var k = 1 - night; x *= k; y *= k; z *= k; w *= k;   // ночью спят
    } else if (ty === 'balloon') {
      x = 1.3 * Math.sin(TAU * t / S.P1 + S.p1) + 0.5 * Math.sin(TAU * t / S.P2 + S.p2);
      y = 0.5 * Math.sin(TAU * t / 2.5 + S.p3);
    } else if (ty === 'leaf') {
      if (t > S.next) { S.ev = evAt(S.next, t); S.next = S.ev + r(5, 14); S.evA = r(0.7, 1.1); }
      var lp = (t - S.ev) / 1.0;
      if (lp > 0 && lp < 1) { var en = Math.sin(Math.PI * lp); x = it[5] * 0.9 * S.evA * en * (1 + 0.3 * Math.sin(6 * Math.PI * lp)); y = -0.7 * S.evA * en * (0.6 + 0.4 * Math.sin(4 * Math.PI * lp)); }
      x *= wx.wind; y *= wx.wind;
    } else {   // grass
      x = S.amp * (0.6 * Math.sin(TAU * t / S.P1 + S.p1) + 0.4 * Math.sin(TAU * t / (S.P1 * 0.53) + S.p2)) * (0.7 + 0.3 * Math.sin(TAU * t / 11 + S.p3)) * wx.wind;
    }
    return [x, y, z, w];
  }
  function R2s(S) { return S.R() < 0.5 ? -1 : 1; }
  function evAt(due, t) { return t - due < 0.5 ? due : t; }   // событие — в назначенный момент (не «в кадр, когда заметили»); после паузы вкладки — сейчас
  var FIG_BUF = FN > 0 ? [new Float32Array(8 * FN), new Float32Array(8 * FN)] : null, FIG_ST = [], FIG_BOX = [new Float32Array(4), new Float32Array(4)];
  var FIG_PEAK = 0;   // наибольший сдвиг фигуры (px кадра) с прошлого вопроса — для ?debug=1 и tools/snap.mjs
  // e1.23: у фигур есть множитель движения (восьмое число) — кивок сидящего и подскок голубя мягче, иначе при множителе 3–4 «прыгают»
  var FIG_K = FIGS.some(function (a) { return a.some(function (it) { return it.length > 7; }); });
  function figFill(f, slot, t) {
    var buf = FIG_BUF[slot], items = f ? (FIGS[f.idx] || []) : [], n = items.length, on = fx.figOn ? 1 : 0;
    if (!n) { if (FIGB) FIG_BOX[slot].set([0, 0, 0, 0]); return 0; }
    var st = FIG_ST[f.idx] || (FIG_ST[f.idx] = items.map(function (it, j) { return figInit(it, f.idx, j); }));
    var bx0 = 2, by0 = 2, bx1 = -1, by1 = -1;
    for (var j = 0; j < n; j++) {
      var it = items[j], m = on ? figMotion(it, st[j], t, tod.night) : [0, 0, 0, 0], o = j * 8;
      var ka = it.length > 7 ? +it[7] : 1;   // e1.23 (s19): восьмое число — множитель движения фигуры (от её размера; маска шире на столько же)
      if (ka !== 1) { var kr = Math.sqrt(ka); m[0] *= ka; m[1] *= kr; m[2] *= ka; m[3] *= ka; }   // y (дыхание, подскок) — по корню: крупнее, но не «прыгает»
      var am = Math.max(Math.abs(m[0]) + Math.abs(m[2]), Math.abs(m[1]) + Math.abs(m[3])); if (am > FIG_PEAK) FIG_PEAK = am;
      buf[o] = it[0]; buf[o + 1] = it[1]; buf[o + 2] = (FIG_TYPES.indexOf(it[4]) * 2 + (it[5] > 0 ? 1 : 0)) + Math.min(0.999, it[2] - it[0]); buf[o + 3] = it[3] - it[1];
      buf[o + 4] = m[0]; buf[o + 5] = m[1]; buf[o + 6] = m[2]; buf[o + 7] = m[3];
      if (it[6] === 1) { bx0 = Math.min(bx0, it[0]); by0 = Math.min(by0, it[1]); bx1 = Math.max(bx1, it[2]); by1 = Math.max(by1, it[3]); }
    }
    if (FIGB) FIG_BOX[slot].set(bx1 > bx0 ? [bx0, by0, bx1, by1] : [0, 0, 0, 0]);
    return n;
  }
  function figUpload(fa, fb, t) {
    var na = figFill(fa, 0, t), nb = fb ? figFill(fb, 1, t) : 0;
    gl.uniform4fv(US.uFigA, FIG_BUF[0]); gl.uniform4fv(US.uFigB, FIG_BUF[1]); gl.uniform2f(US.uFigN, na, nb);
    if (FIGB) { gl.uniform4fv(US.uFigBoxA, FIG_BOX[0]); gl.uniform4fv(US.uFigBoxB, FIG_BOX[1]); }
  }

  // s = состояние кадра: fa/fb (готовые кадры), mix, shiftX/Y, zoom, t
  function drawGL(fa, fb, mix, shiftX, shiftY, zoom, t, tAmb) {
    ensureFbo(canvas.width, canvas.height);
    gl.viewport(0, 0, canvas.width, canvas.height);
    uploadEm(fa); uploadEm(fb);
    if (NI) { mvStep(fa); if (fb) mvStep(fb); }
    var aspect = canvas.width / canvas.height, visW = coverUvW / CONFIG.BASE_SCALE, visH = coverUvH / CONFIG.BASE_SCALE;
    // --- проход 1: сцена (параллакс, ветер, закат, ночь) -> текстура ---
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.useProgram(scenePrg);
    bindFrame(fa, 0);
    if (fb) bindFrame(fb, UB0);
    gl.uniform4fv(US.uCropA, fa.crop); gl.uniform4fv(US.uFlagA, fa.flag);
    gl.uniform3f(US.uKdA, fa.kB, fa.dB, fa.bldD ? 1 : 0);
    if (fb) { gl.uniform3f(US.uKdB, fb.kB, fb.dB, fb.bldD ? 1 : 0); gl.uniform4fv(US.uCropB, fb.crop); gl.uniform4fv(US.uFlagB, fb.flag); }
    gl.uniform2f(US.uStarQ, fa.starQ, fb ? fb.starQ : 0);
    gl.uniform2f(US.uCloudK, CONFIG.CLOUD_SHADOW[fa.idx] || 0.12, fb ? (CONFIG.CLOUD_SHADOW[fb.idx] || 0.12) : 0.12);
    gl.uniform4f(US.uSkyRef, CONFIG.DAY.SKY_REF[fa.idx] || 0.86, CONFIG.DAY.SKY_END[fa.idx] || 0.55,
      fb ? (CONFIG.DAY.SKY_REF[fb.idx] || 0.86) : 0.86, fb ? (CONFIG.DAY.SKY_END[fb.idx] || 0.55) : 0.55);
    if (SPILL > 0) { gl.uniform2f(US.uEmKA, fa.emK[0], fa.emK[1]); gl.uniform2f(US.uEmKB, fb ? fb.emK[0] : 1, fb ? fb.emK[1] : 0); }   // e1.19: двухэтажная текстура окон
    if (NI) {
      gl.uniform3f(US.uHasA, fa.sG && !fa.mvUse && !fa.mvUseN ? 1 : 0, fa.nG ? 1 : 0, (fa.mvUse ? 1 : 0) + (fa.mvUseN && fa.nG ? 2 : 0));
      gl.uniform3f(US.uHasB, fb && fb.sG && !fb.mvUse && !fb.mvUseN ? 1 : 0, fb && fb.nG ? 1 : 0, fb ? (fb.mvUse ? 1 : 0) + (fb.mvUseN && fb.nG ? 2 : 0) : 0);
      if (MVD) { gl.uniformMatrix4fv(US.uMvCalA, false, (fa && fa.mvCal) || MV_ID); gl.uniformMatrix4fv(US.uMvCalB, false, (fb && fb.mvCal) || MV_ID); }
      gl.uniform1f(US.uSunMix, tod.sun); gl.uniform1f(US.uNightMix, tod.night);
    }
    gl.uniform2f(US.uShift, shiftX, shiftY);
    gl.uniform1f(US.uZoom, zoom);
    gl.uniform1f(US.uMix, mix);
    gl.uniform1f(US.uTime, tAmb);
    gl.uniform1f(US.uCloudT, t);
    gl.uniform1f(US.uSunset, tod.s);
    gl.uniform1f(US.uNightSky, tod.sky);
    gl.uniform1f(US.uNightGnd, tod.gnd);
    gl.uniform1f(US.uStars, tod.stars);
    gl.uniform2f(US.uFadeZoom, fx.zoomA, fx.zoomB);
    gl.uniform1f(US.uAspect, aspect);
    gl.uniform1f(US.uWindAmp, fx.windAmp);
    gl.uniform1f(US.uWindOn, fx.windOn ? 1 : 0);
    gl.uniform4f(US.uWeather, wx.cur[0], wx.cur[1], wx.cur[2], wx.cover);
    if (SNOWM) gl.uniform2f(US.uSnowM, snowCode(fa, performance.now()), fb ? snowCode(fb, performance.now()) : -1);
    if (GUSTS) gl.uniform3f(US.uWindG, fx.leanA, fx.leanB, wx.windPh);
    gl.uniform1f(US.uFlash, wx.flash || 0);
    gl.uniform2f(US.uCellPx, canvas.width / (STAR_CELLS[0] * visW), canvas.height / (STAR_CELLS[1] * visH));
    gl.uniform4f(US.uShoot, fx.shoot[0], fx.shoot[1], fx.shoot[2], fx.shoot[3]);
    gl.uniform2f(US.uShootP, fx.shootP, fx.shootLen);
    gl.uniform2f(US.uCoverScale, coverUvW, coverUvH);
    gl.uniform2f(US.uCoverOffset, coverOffX, coverOffY);
    if (FN > 0) figUpload(fa, fb, tAmb);   // e1.22
    if (gridBuf) {   // e1.19: сцена на сетке (поле облаков в вершинах), потом обратно четыре вершины для второго прохода
      gl.bindBuffer(gl.ARRAY_BUFFER, gridBuf); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gridIdx);
      gl.drawElements(gl.TRIANGLES, gridN, gl.UNSIGNED_SHORT, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    } else gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    // --- проход 2: длинные тени (закат) и фонари (ночь) -> экран ---
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.useProgram(postPrg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sceneTex);
    gl.uniform1f(UP.uSunset, (NI && fa.sG && (!fb || fb.sG)) ? 0 : tod.s);   // длинные тени процедурного заката; у закатной картинки они нарисованы
    gl.uniform1f(UP.uNight, tod.lights);
    gl.uniform1f(UP.uAspect, aspect);
    gl.uniform1f(UP.uFog, wx.cur[1]);
    gl.uniform3fv(UP.uLampH, fx.lampH);
    gl.uniform3fv(UP.uLampB, fx.lampB);
    if (FLICK) gl.uniform4fv(UP.uLampD, fx.lampD);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  var glLost = false, glReadyP = Promise.resolve();
  var tod = { p: 0, s: 0, sky: 0, gnd: 0, stars: 0, lights: 0, night: 0, sun: 0 }; // время суток; p: 0 день, 1 закат, 2.17 ночь
  if (useGL) {
    glReadyP = initGLProgram();
    glReadyP.catch(function (err) { console.warn('WebGL shader failed, fallback:', err); });
    var loseExt = gl.getExtension('WEBGL_lose_context');
    canvas.addEventListener('webglcontextlost', function (e) {
      e.preventDefault(); glLost = true; logErr('webgl', 'context lost');
      Object.keys(MV).forEach(function (k) { try { MV[k].v.pause(); } catch (x) {} var f = store[k]; if (f) { f.mvTex = null; f.mvUse = false; } });   // текстуры потеряны вместе с контекстом
      Object.keys(MVN).forEach(function (k) { try { MVN[k].v.pause(); } catch (x) {} var f = store[k]; if (f) { f.mvTexN = null; f.mvUseN = false; } });
      // e1.15: iOS часто сам контекст не возвращает — просим вернуть через 1,5 с (WEBGL_lose_context)
      setTimeout(function () { if (glLost && loseExt && gl.isContextLost()) { try { loseExt.restoreContext(); } catch (x) { logErr('webgl restore', x); } } }, 1500);
    });
    canvas.addEventListener('webglcontextrestored', function () {
      logErr('webgl', 'context restored');
      try {
        glReadyP = initGLProgram();
        // текстуры заново: CPU-копии картинок мы не держим (память iPhone) — прогоняем конвейер заново, начиная с видимого кадра
        var keep = frameIndex;
        store.length = 0; dayP = []; stateP = [];
        loadDay(keep).then(function () { resize(true); glLost = false; startBackground(); });
      } catch (err) { console.warn('WebGL restore failed', err); }
    });
  }

  // (загрузка и подготовка кадров — в конце файла, «старт»; тяжёлая обработка — в prep.js, в Web Worker)

  function rng(seed) { // mulberry32: одинаковые «случайные» окна при каждом запуске
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function rand(R, a, b) { return a + (b - a) * R(); }

  // Свет окон на текущий момент: ночь (0..1) со сдвигом по окнам, свои включения/выключения.
  // Возвращает true, если поменялись пиксели (тогда текстуру окон нужно залить в GPU).
  function updateWindows(f, night, nowMs) {
    var dirty = false, e = f.emis, ch;
    for (var i = 0; i < f.wins.length; i++) {
      var w = f.wins[i];
      if (w.animT0 >= 0) {
        var p = (nowMs - w.animT0) / CONFIG.WINDOW_FADE_MS, target = w.on ? 1 : 0;
        w.cur = w.animFrom + (target - w.animFrom) * clamp(EASE(p), 0, 1);
        if (p >= 1) { w.cur = target; w.animT0 = -1; }
      }
      var gate = clamp((night - w.delay) / 0.12, 0, 1); // окна зажигаются по одному в течение 2 с
      var lvl = w.cur * gate * w.bright;
      if (Math.abs(lvl - w.lvl) > 0.003 || (lvl === 0 && w.lvl !== 0)) {
        w.lvl = lvl; ch = w.ch;
        for (var k = 0; k < w.idx.length; k++) e[w.idx[k] * 4 + ch] = (w.val[k] * lvl + 0.5) | 0;
        dirty = true;
        if (w.idx.length) {   // e1.19: рамка изменившегося куска — только он уходит в GPU
          var bb = w.bb || (w.bb = winBox(w.idx, f.ew)), R = f.emRect;
          if (!R) f.emRect = bb.slice();
          else { if (bb[0] < R[0]) R[0] = bb[0]; if (bb[1] < R[1]) R[1] = bb[1]; if (bb[2] > R[2]) R[2] = bb[2]; if (bb[3] > R[3]) R[3] = bb[3]; }
        }
      }
    }
    return dirty;
  }

  var store = [];          // готовые кадры: {bgTex, depthTex, bldTex, winTex, depth, kB, dB, thumb, w, h}

  function depthAtMap(dm, u, v) {
    var x = clamp(Math.round(u * (dm.w - 1)), 0, dm.w - 1);
    var y = clamp(Math.round(v * (dm.h - 1)), 0, dm.h - 1);
    return dm.d[y * dm.w + x] / 255;
  }

  // ---------- загрузка кадров: сначала только первый (день), остальное — потом, в фоне, по одному, в простое ----------
  // Вся тяжёлая обработка (декодирование, глубина, вырезка, маски, закат и ночь) — в Web Worker (prep.js): главный поток
  // не занят, приветствие и анимации идут плавно. Если Worker/OffscreenCanvas нет — тот же код в главном потоке.
  var prep = (function () {
    var worker = null, pend = {}, seq = 0, mainReadyP = null;
    var cfg = {
      MAX_TEX_SIZE: CONFIG.MAX_TEX_SIZE, DEPTH_BLUR_PX: CONFIG.DEPTH_BLUR_PX, STARS: CONFIG.STARS, BUILDING_DEPTH_PIXEL: !!CONFIG.BUILDING_DEPTH_PIXEL,
      NIGHT_MAIN_LIT: CONFIG.NIGHT_MAIN_LIT, FRAME_SIZE: CONFIG.FRAME_SIZE, STAR_CELLS: STAR_CELLS, NIGHT_OTHER_LIT: CONFIG.NIGHT_OTHER_LIT, WINDOW_BRIGHT: CONFIG.WINDOW_BRIGHT, DAY: CONFIG.DAY,
      NIGHT_WINS: (CONFIG.SCENE || []).map(function (q) { return !!(q && q.nightWins); }),
      NIGHT_MAIN_WINS: CONFIG.NIGHT_MAIN_WINS, NIGHT_EDGE: CONFIG.NIGHT_EDGE, FIG_ON: !!CONFIG.FIGURES
    };
    if (SWAY) cfg.SWAY_ON = true;   // e1.26: подготовка кадра кладёт поля качания крон в нижний этаж карты окружения
    function viaMain(method, args) {
      if (!mainReadyP) {
        mainReadyP = new Promise(function (res, rej) {
          var sc = document.createElement('script');
          sc.src = engineUrl('prep.js'); sc.onload = function () { window.Prep.init(cfg).then(res); }; sc.onerror = function () { rej(new Error('prep.js не загрузился')); };
          document.head.appendChild(sc);
        });
      }
      return mainReadyP.then(function () { return window.Prep[method].apply(null, args); });
    }
    if (window.Worker && window.OffscreenCanvas && window.createImageBitmap && !/[?&]noworker=1/.test(location.search)) {
      try {
        worker = new Worker(engineUrl('prep.js'));
        worker.onmessage = function (e) {
          var m = e.data, q = pend[m.id]; delete pend[m.id];
          if (q) { if (m.ok) q.res(m.res); else q.rej(new Error(m.err)); }
        };
        worker.onerror = function (e) {   // воркер не поднялся: всё, что ждало, переезжает в главный поток
          console.warn('prep.js: воркер недоступен, считаю в главном потоке', e && e.message);
          worker = null;
          Object.keys(pend).forEach(function (id) { var q = pend[id]; delete pend[id]; viaMain(q.method, q.args).then(q.res, q.rej); });
        };
        worker.postMessage({ id: ++seq, method: 'init', args: [cfg] });
      } catch (err) { worker = null; }
    }
    return {
      call: function (method, args) {
        if (!worker) return viaMain(method, args);
        return new Promise(function (res, rej) {
          var id = ++seq; pend[id] = { res: res, rej: rej, method: method, args: args };
          worker.postMessage({ id: id, method: method, args: args });
        });
      }
    };
  })();

  function makeLayers(entry, r) {   // откат без WebGL: слои-канвасы (фон и здание)
    var n = r.w * r.h, i;
    function cv() { var c = document.createElement('canvas'); c.width = r.w; c.height = r.h; return c; }
    var bg = cv(), b = cv(), bx = bg.getContext('2d'), by = b.getContext('2d');
    var bi = bx.createImageData(r.w, r.h), yi = by.createImageData(r.w, r.h);
    for (i = 0; i < n; i++) {
      bi.data[i * 4] = r.ground[i * 3]; bi.data[i * 4 + 1] = r.ground[i * 3 + 1]; bi.data[i * 4 + 2] = r.ground[i * 3 + 2]; bi.data[i * 4 + 3] = 255;
      var a = r.bldPm[i * 4 + 3];
      yi.data[i * 4] = a ? Math.min(255, r.bldPm[i * 4] * 255 / a) : 0; yi.data[i * 4 + 1] = a ? Math.min(255, r.bldPm[i * 4 + 1] * 255 / a) : 0;
      yi.data[i * 4 + 2] = a ? Math.min(255, r.bldPm[i * 4 + 2] * 255 / a) : 0; yi.data[i * 4 + 3] = a;
    }
    bx.putImageData(bi, 0, 0); by.putImageData(yi, 0, 0);
    entry.layers = { bg: bg, building: b };
  }

  function lampsFor(list, i, depth) {
    var out = [];
    (list || []).forEach(function (l, j) {
      var R = rng(500 + i * 31 + j);
      out.push({
        hu: l[0], hv: l[1], bu: l[2], bv: l[3], hd: depthAtMap(depth, l[0], l[1]), bd: depthAtMap(depth, l[2], l[3]),
        phase: R() * 6.2832, period: rand(R, CONFIG.LAMP_PERIOD_S[0], CONFIG.LAMP_PERIOD_S[1]), delay: R() * 0.88
      });
    });
    if (FLICK && out.length) {   // s16: какие фонари кадра мигают (1–2, всегда одни и те же)
      var R2 = rng(900 + i * 17), LF = CONFIG.LAMP_FLICKER, kf = Math.round(rand(R2, LF.lamps[0], LF.lamps[1]));
      for (var q = 0; q < kf; q++) out[Math.floor(R2() * out.length)].flick = { next: 0, t0: -1, dur: 0, depth: 0, dbl: false };
    }
    return out;
  }

  var dayP = [], stateP = [];
  function loadDay(i) {          // день: всё, что нужно, чтобы кадр показать и двигать
    if (dayP[i]) return dayP[i];
    dayP[i] = prep.call('day', [FRAMES[i], i]).then(function (r) {
      var entry = {
        w: r.w, h: r.h, depth: r.depth, thumb: r.thumb ? URL.createObjectURL(r.thumb) : '', dB: r.dB, kB: r.kB, bldD: (useGL && r.bldD) || null,
        ew: r.ew, eh: r.eh, emis: r.emis, wins: r.wins, skyFrac: r.skyFrac, starQ: r.starQ, emDirty: false,
        lamps: lampsFor(LAMPS[i], i, r.depth), winList: r.winList, nightLit: null, haloK: 1, idx: i,
        flag: new Float32Array(CONFIG.FLAGS[i] || [0, 0, 0, 0]),
        crop: (function (c) { return new Float32Array([c[0], c[1], c[2] - c[0], c[3] - c[1]]); })(CONFIG.CROP[i] || [0, 0, 1, 1])
      };
      var scI = (CONFIG.SCENE && CONFIG.SCENE[i]) || {};
      if (scI.bldDepth != null) { entry.dB = scI.bldDepth; entry.kB = scI.bldDepth * 2 - 1; entry.bldD = null; }   // e1.5: здание кадра — жёстко на этой глубине (крупный план: статуя не «плывёт» отдельно от постамента и фона)
      var up = useGL ? uploadDay(entry, r) : Promise.resolve(makeLayers(entry, r));
      return up.then(function () { store[i] = entry; if (window.__fillThumb) window.__fillThumb(i); return entry; });
    });
    dayP[i].catch(function () { dayP[i] = null; });
    return dayP[i];
  }
  function loadStates(i) {       // закат и ночь (картинки): потом, в фоне; пока их нет — процедурные (v8)
    if (!NI) return Promise.resolve(null);
    if (stateP[i]) return stateP[i];
    stateP[i] = loadDay(i).then(function (entry) {
      var f = FRAMES[i], chain = Promise.resolve();
      ['sunset', 'night'].forEach(function (kind) {
        if (!f[kind]) return;
        chain = chain.then(function () { return prep.call('state', [i, kind, f[kind]]); }).then(function (r) {
          return uploadState(entry, kind === 'sunset' ? 's' : 'n', r).then(function () {
            if (kind === 'night') {   // ночь-картинка: свои окна и фонари, без процедурных
              var scN = (CONFIG.SCENE && CONFIG.SCENE[i]) || {};
              if (!scN.nightWins) { entry.wins = []; entry.nightLit = r.lit; }   // e1.12: nightWins — окна в ночной картинке тёмные, зажигает движок по одному
              var nl = lampsFor(CONFIG.NIGHT_LAMPS[i], i, entry.depth);
              if (nl.length) { entry.lamps = nl; entry.haloK = CONFIG.NIGHT_HALO[i] == null ? 1 : CONFIG.NIGHT_HALO[i]; }
            }
          });
        }).catch(function (err) { console.warn('кадр ' + (i + 1) + ': ' + kind + ' не загрузился, остаётся процедурный —', err && err.message); });
      });
      return chain;
    });
    return stateP[i];
  }

  function idle(fn) { if (window.requestIdleCallback) requestIdleCallback(fn, { timeout: 2500 }); else setTimeout(fn, 250); }
  function loadDetails() {   // живые детали — отдельный файл, подгружается после первого кадра
    var sc = document.createElement('script');
    sc.src = engineUrl('details.js'); sc.onload = function () { window.Details.init(window.__viewer); };
    document.head.appendChild(sc);
  }
  function startBackground() {   // по одному, в простое, не при скрытой вкладке
    loadDetails();
    var q = [function () { return loadStates(0); }], i;
    for (i = 1; i < FRAMES.length; i++) (function (k) { q.push(function () { return loadDay(k); }); })(i);
    for (i = 1; i < FRAMES.length; i++) (function (k) { q.push(function () { return loadStates(k); }); })(i);
    (function next() {
      if (!q.length) { document.documentElement.setAttribute('data-loaded', 'all'); return; }   // всё загружено (для проверочных скриптов)
      if (document.hidden) { document.addEventListener('visibilitychange', function once() { document.removeEventListener('visibilitychange', once); next(); }); return; }
      idle(function () { var job = q.shift(); job().then(next, next); });
    })();
  }

  // Что нужно живым деталям (details.js): текущий кадр, время суток, проекция точки кадра на сцену.
  window.__viewer = {
    stage: stage, tod: tod, weather: function () { return wx; },
    testBolt: function () { nextFlash = performance.now(); },   // для проверки: следующая молния — сейчас
    frame: function () { return frameIndex; }, fading: function () { return !!fade; }, entry: function (i) { return store[i]; },
    motionOn: function (i) { return !!mvConf(i) && !(MV[i] && MV[i].fail); },
    mvState: function (i) {   // e1.17: для проверки — какие клипы кадра сейчас в текстурах (день/ночь)
      var f = store[i], S = MV[i], N = MVN[i];
      return { day: S ? (S.clips[S.ci] || {}).src + (S.v.paused ? ' P' : '') : null, night: N ? (N.clips[N.ci] || {}).src + (N.v.paused ? ' P' : '') : null, useD: !!(f && f.mvUse), useN: !!(f && f.mvUseN) };
    },
    figs: function () { var pk = FIG_PEAK; FIG_PEAK = 0; return { n: FN, on: !!fx.figOn, cut: FIG_CUT, peakPx: +pk.toFixed(2), reduced: reduced(), perf: perfLevel }; },   // e1.23: для tools/snap.mjs
    errors: function () { return ERR.slice(); },   // журнал ошибок (проверочные скрипты, ?debug=1)   // e1.14: у кадра синемаграф — спрайтовые машины/люди/сценки не рисуются
    mvBusy: function () { return Object.keys(MV).some(function (k) { var S = MV[k], f = store[k]; return !S.fail && f && !f.mvUse && (+k === frameIndex); }); },   // для проверки: видео текущего кадра ещё не в текстуре
    projectB: function (f, u, v) {   // точка слоя «здание» -> пиксели сцены (для пролёта «за зданием»)
      var ld = lastDraw || { shiftX: 0, shiftY: 0, zoom: 0 };
      var q = projectImg(u, v, f.dB, f.kB, ld.shiftX, ld.shiftY, ld.zoom, f.crop);
      return [q[0] * stage.clientWidth, q[1] * stage.clientHeight];
    },
    project: function (f, u, v, d) {
      var ld = lastDraw || { shiftX: 0, shiftY: 0, zoom: 0 };
      var q = projectImg(u, v, d, d * 2 - 1, ld.shiftX, ld.shiftY, ld.zoom, f.crop);
      return [q[0] * stage.clientWidth, q[1] * stage.clientHeight];
    }
  };

  // ---------- размер холста ----------
  var natW = 1080, natH = 1920; // перезапишется по первому кадру
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  // "cover"-масштаб/офсет — и в JS, чтобы точки-подсказки считали
  // экранную позицию той же формулой, что и шейдер.
  var coverUvW = 1, coverUvH = 1, coverOffX = 0, coverOffY = 0;
  var lastCssW = 0, lastCssH = 0;

  function resize(force) {
    var cssW = stage.clientWidth, cssH = stage.clientHeight;
    if (!force && cssW === lastCssW && cssH === lastCssH) return;
    lastCssW = cssW; lastCssH = cssH;
    if (useGL) {
      var w = Math.round(cssW * dpr), h = Math.round(cssH * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w; canvas.height = h;
      }
    }
    // "cover": как CSS background-size: cover — без искажений, лишнее обрезается.
    var factor = Math.max(cssW / natW, cssH / natH);
    coverUvW = cssW / (natW * factor);
    coverUvH = cssH / (natH * factor);
    coverOffX = (1 - coverUvW) / 2;
    coverOffY = (1 - coverUvH) / 2;
  }
  window.addEventListener('resize', function () { resize(true); fitTitle(); if (window.__penFit) window.__penFit(); });
  window.addEventListener('orientationchange', function () { setTimeout(function () { resize(true); }, 200); });

  function setNaturalSize(w, h) {
    natW = w; natH = h;
    document.documentElement.style.setProperty('--natW', String(w));
    document.documentElement.style.setProperty('--natH', String(h));
    resize(true);
  }

  // ---------- откат без WebGL: два слоя (фон + здание) на кадр ----------
  var fbFrames = []; // [{el, bg, bld}]

  function buildFallbackDom() {
    fbEl.hidden = false;
    FRAMES.forEach(function (_, i) {
      var wrap = document.createElement('div');
      wrap.className = 'fb-frame';
      var bg = store[i].layers.bg, bld = store[i].layers.building;
      bg.className = 'fb-layer'; bld.className = 'fb-layer';
      wrap.appendChild(bg); wrap.appendChild(bld);
      fbEl.appendChild(wrap);
      fbFrames.push({ el: wrap, bg: bg, bld: bld });
    });
  }

  // ---------- кадры: индексы, переход, точки ----------
  var frameIndex = 0;
  var fade = null;      // {from, to, t0}
  var mixState = 0;

  function buildDots() {
    dotsEl.innerHTML = '';
    FRAMES.forEach(function (_, i) {
      var d = document.createElement('span');
      if (i === frameIndex) d.className = 'on';
      dotsEl.appendChild(d);
    });
  }

  function markDot(i) {
    var kids = dotsEl.children, th = thumbsEl.children;
    for (var k = 0; k < kids.length; k++) kids[k].classList.toggle('on', k === i);
    for (k = 0; k < th.length; k++) th[k].classList.toggle('on', k === i);
  }

  // ---------- точки-подсказки ----------
  var hotspotsEl = document.getElementById('hotspots');
  var hsPopup = document.getElementById('hsPopup');
  var activeHotspots = []; // [{el, hs, d, k}] для текущего кадра

  var hsText = document.getElementById('hsText');
  var hsBack = document.getElementById('hsBack');
  var hsCloseTimer = null;
  var lastPointerType = 'mouse';

  function closePopup() {
    clearTimeout(hsCloseTimer); hsCloseTimer = null;
    hsPopup.classList.remove('show');   // обратная анимация 300 мс
    stage.classList.remove('reading');  // фон возвращается
    hsPopup._forDot = null;
  }
  // Ставит карточку над точкой (или под ней, если сверху нет места) и не даёт
  // вылезти за края; хвостик всегда указывает на точку.
  function placePopup(a) {
    var w = hsPopup.offsetWidth, h = hsPopup.offsetHeight, cssW = stage.clientWidth;
    var left = a.x - w / 2, cl = clamp(left, 8, Math.max(8, cssW - 8 - w));
    var below = a.y - 11 - 16 - h < 56; // 56 — шапка с кнопкой «на сайт»
    hsPopup.classList.toggle('below', below);
    hsPopup.style.left = a.x + 'px';
    hsPopup.style.top = (below ? a.y + 11 : a.y - 11) + 'px';
    hsPopup.style.setProperty('--shift', (cl - left) + 'px');
  }

  function openPopup(hs, dotEl) {
    clearTimeout(hsCloseTimer); hsCloseTimer = null;
    hsText.textContent = (CONFIG.I18N[hs.key] && CONFIG.I18N[hs.key][currentLang]) || '';
    hsPopup._forDot = dotEl;
    var a = activeHotspots.filter(function (x) { return x.el === dotEl; })[0];
    if (a) placePopup(a);
    hsPopup.classList.add('show');
    stage.classList.add('reading');
  }

  hsBack.addEventListener('click', closePopup);

  // Глубина точки — из той же (размытой) карты, что читает шейдер.
  function depthAt(frameIdx, u, v) {
    var dm = store[frameIdx] && store[frameIdx].depth;
    if (!dm) return 0.5;
    var x = clamp(Math.round(u * (dm.w - 1)), 0, dm.w - 1);
    var y = clamp(Math.round(v * (dm.h - 1)), 0, dm.h - 1);
    return dm.d[y * dm.w + x] / 255;
  }

  function bldDepthAt(frameIdx, u, v) {   // глубина здания по точкам (BUILDING_DEPTH_PIXEL) — та же, что в альфе земли у шейдера
    var bd = store[frameIdx] && store[frameIdx].bldD;
    if (!bd) return store[frameIdx] ? store[frameIdx].dB : 0.5;
    return bd.d[clamp(Math.round(v * (bd.h - 1)), 0, bd.h - 1) * bd.w + clamp(Math.round(u * (bd.w - 1)), 0, bd.w - 1)] / 255;
  }

  function buildHotspots(frameIdx) {
    hotspotsEl.innerHTML = '';
    activeHotspots = [];
    (HS[frameIdx] || []).forEach(function (hs) {
      var btn = document.createElement('button');   // e1.15: только точки как у живого Кукурузника; «обводка» с номерами (e1.13) удалена из движка
      btn.type = 'button';
      btn.className = 'hs-dot';
      btn.setAttribute('aria-label', (CONFIG.I18N[hs.key] && CONFIG.I18N[hs.key][currentLang]) || hs.key);
      btn.addEventListener('pointerdown', function (e) { lastPointerType = e.pointerType; });
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var isOpen = hsPopup.classList.contains('show') && hsPopup._forDot === btn;
        // и на ПК, и на телефоне подсказка открывается только кликом/тапом по точке
        if (isOpen) closePopup();
        else openPopup(hs, btn);
      });
      hotspotsEl.appendChild(btn);
      var d, k;
      if (useGL && hs.layer === 'building' && store[frameIdx].bldD) { d = bldDepthAt(frameIdx, hs.u, hs.v); k = d * 2 - 1; }   // здание с глубиной по точкам
      else if (useGL && hs.layer === 'building') { d = store[frameIdx].dB; k = store[frameIdx].kB; }   // здание — жёстко, общий сдвиг
      else if (useGL) { d = depthAt(frameIdx, hs.u, hs.v); k = d * 2 - 1; }                       // фон/земля — по пикселю
      else { d = 0; k = hs.layer === 'building' ? CONFIG.FALLBACK_LAYER_K : -CONFIG.FALLBACK_LAYER_K; }
      activeHotspots.push({ el: btn, hs: hs, d: d, k: k });
    });
    // показать с лёгкой задержкой, чтобы не мигали поверх кроссфейда
    requestAnimationFrame(function () {
      activeHotspots.forEach(function (a) { a.el.classList.add('show'); });
    });
  }

  function hideHotspots() {
    closePopup();
    activeHotspots.forEach(function (a) { a.el.classList.remove('show'); });
  }

  document.addEventListener('pointerdown', function (e) {
    if (hsPopup.classList.contains('show') && !hsPopup.contains(e.target) && e.target !== hsPopup._forDot) {
      closePopup();
    }
  });

  // Та же формула, что в шейдере, но «вперёд»: где на экране окажется
  // точка (u,v) исходной картинки при текущем сдвиге/наклоне.
  function updateHotspotPositions(sx, sy, zoom) {
    if (!activeHotspots.length) return;
    var cssW = stage.clientWidth, cssH = stage.clientHeight, S = CONFIG.BASE_SCALE;
    activeHotspots.forEach(function (a) {
      var z = 1 + zoom * a.d;
      var px = 0.5 + (a.hs.u + a.k * sx - 0.5) * z;
      var py = 0.5 + (a.hs.v + a.k * sy - 0.5) * z;
      var cr = store[frameIndex] && store[frameIndex].crop;
      if (cr) { px = (px - cr[0]) / cr[2]; py = (py - cr[1]) / cr[3]; }   // обратно из обрезанного прямоугольника
      px = 0.5 + (px - 0.5) * S;
      py = 0.5 + (py - 0.5) * S;
      var screenU = (px - coverOffX) / coverUvW;
      var screenV = (py - coverOffY) / coverUvH;
      a.x = screenU * cssW; a.y = screenV * cssH;
      a.el.style.transform = 'translate(' + a.x + 'px,' + a.y + 'px)';
      if (a.hs.r) {   // e1.13: размер обводки — доли кадра (ширина, высота) → пиксели экрана
        var ux = S * z / (coverUvW * (cr ? cr[2] : 1)) * cssW, vy = S * z / (coverUvH * (cr ? cr[3] : 1)) * cssH;
        var rw = Math.max(22, a.hs.r[0] * ux), rh = Math.max(22, a.hs.r[1] * vy);
        if (Math.abs((a.rw || 0) - rw) > 0.5 || Math.abs((a.rh || 0) - rh) > 0.5) { a.rw = rw; a.rh = rh; a.el.style.width = (2 * rw) + 'px'; a.el.style.height = (2 * rh) + 'px'; a.el.style.margin = (-rh) + 'px 0 0 ' + (-rw) + 'px'; }
      }
      if (hsPopup._forDot === a.el && hsPopup.classList.contains('show')) placePopup(a); // карточка едет вместе с точкой
    });
  }

  function goTo(newIndex) {
    if (fade || !store[0]) return;
    var n = FRAMES.length;
    newIndex = ((newIndex % n) + n) % n;
    if (newIndex === frameIndex) return;
    if (!store[newIndex]) { loadDay(newIndex).then(function () { goTo(newIndex); }); return; }   // ещё грузится в фоне — дождёмся
    hideHotspots();
    fade = { from: frameIndex, to: newIndex, t0: null };
    markDot(newIndex);
  }

  // ---------- ввод ----------
  // curX/curY — текущий наклон -1..1 (то, что видно на экране);
  // targetX/Y — куда он плавно едет (гироскоп, мышь).
  var targetX = 0, targetY = 0, curX = 0, curY = 0;
  var tiltHold = null;   // e1.29 (9б-2): «свой ракурс» открытки — { sx, sy, z }: сдвиг и приближение замерли (окно открытки, кнопка «Замереть»)
  var ret = null;             // плавный возврат в центр после пальца
  var pointerActive = false, dragId = null;
  var dragStartX = 0, dragStartY = 0, dragBaseX = 0, dragBaseY = 0, dragStartT = 0;

  function setTiltFromClient(clientX, clientY) { // мышь: абсолютная позиция
    var r = stage.getBoundingClientRect();
    targetX = clamp((clientX - (r.left + r.width / 2)) / (r.width / 2), -1, 1);
    targetY = clamp((clientY - (r.top + r.height / 2)) / (r.height / 2), -1, 1);
  }

  stage.addEventListener('pointerdown', function (e) {
    demoStop();
    if (e.pointerType === 'mouse') { setTiltFromClient(e.clientX, e.clientY); return; }
    // Палец: перетаскивание на всю ширину экрана = полный диапазон сдвига.
    pointerActive = true;
    dragId = e.pointerId;
    ret = null;
    dragStartX = e.clientX; dragStartY = e.clientY;
    dragBaseX = curX; dragBaseY = curY;
    dragStartT = performance.now();
  });

  stage.addEventListener('pointermove', function (e) {
    if (e.pointerType === 'mouse') {
      demoStop();
      setTiltFromClient(e.clientX, e.clientY);
      return;
    }
    if (!pointerActive || e.pointerId !== dragId) return;
    var W = stage.clientWidth || 1;
    targetX = clamp(dragBaseX + 2 * (e.clientX - dragStartX) / W, -1, 1);
    targetY = clamp(dragBaseY + 2 * (e.clientY - dragStartY) / W, -1, 1);
  });

  function releasePointer(e) {
    if (e.pointerType === 'mouse' || !pointerActive || e.pointerId !== dragId) return;
    pointerActive = false;
    dragId = null;
    // Быстрый росчерк по горизонтали — смена кадра; медленное перетаскивание
    // только двигает объём.
    var dx = e.clientX - dragStartX, dy = e.clientY - dragStartY;
    var quick = performance.now() - dragStartT < CONFIG.SWIPE_MAX_MS;
    if (e.type === 'pointerup' && quick && Math.abs(dx) > CONFIG.SWIPE_MIN_PX && Math.abs(dx) > 1.5 * Math.abs(dy)) {
      goTo(frameIndex + (dx < 0 ? 1 : -1));
    }
    // плавный возврат в центр за RETURN_MS (или к гироскопу, если он включён)
    targetX = gyroActive ? gyroTargetX : 0;
    targetY = gyroActive ? gyroTargetY : 0;
    ret = { t0: null, fx: curX, fy: curY };
  }
  stage.addEventListener('pointerup', releasePointer);
  stage.addEventListener('pointercancel', releasePointer);

  stage.addEventListener('mouseleave', function () { targetX = 0; targetY = 0; });

  [prevBtn, document.getElementById('prevSide')].forEach(function (b) { b.addEventListener('click', function () { goTo(frameIndex - 1); }); });
  [nextBtn, document.getElementById('nextSide')].forEach(function (b) { b.addEventListener('click', function () { goTo(frameIndex + 1); }); });
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { if (hsPopup.classList.contains('show')) closePopup(); else closeSheet(); }
    else if (e.key === 'ArrowLeft') goTo(frameIndex - 1);
    else if (e.key === 'ArrowRight') goTo(frameIndex + 1);
  });

  // ---------- гироскоп ----------
  var gyroActive = false, gyroBaseBeta = null, gyroBaseGamma = null;
  var gyroTargetX = 0, gyroTargetY = 0, gyroGotEvent = false;

  function onOrientation(e) {
    if (e.beta === null || e.gamma === null || e.beta === undefined) return;
    gyroGotEvent = true;
    if (gyroBaseBeta === null) { gyroBaseBeta = e.beta; gyroBaseGamma = e.gamma; }
    var dGamma = e.gamma - gyroBaseGamma; // лево/право
    var dBeta = e.beta - gyroBaseBeta;    // к себе / от себя
    gyroTargetX = clamp(dGamma / CONFIG.MAX_TILT_X_DEG, -1, 1);
    gyroTargetY = clamp(dBeta / CONFIG.MAX_TILT_Y_DEG, -1, 1);
    if (!pointerActive) { targetX = gyroTargetX; targetY = gyroTargetY; }
  }

  function startGyro() {
    if (gyroActive) return;
    gyroActive = true;
    window.addEventListener('deviceorientation', onOrientation);
  }

  var hasOrientation = typeof DeviceOrientationEvent !== 'undefined';
  var needsPermission = hasOrientation && typeof DeviceOrientationEvent.requestPermission === 'function';

  // ---------- приветствие и доступ к наклону ----------
  if (!needsPermission && hasOrientation && isTouchDevice && window.isSecureContext !== false) {
    startGyro(); // Android и прочие — разрешение не нужно
  }

  // ---------- ночные эффекты, ветер, контроль fps ----------
  var fx = {
    windAmp: 0, windOn: true, zoomA: 1, zoomB: 1, leanA: 0, leanB: 0,
    shoot: [0, 0, 0, 0], shootP: -1, shootLen: 0.3,
    lampH: new Float32Array(48), lampB: new Float32Array(48), lampD: new Float32Array(64)
  };
  var perfLevel = 0;                 // 0 — всё; 1 — выключены живые детали и падающие звёзды; 2 — ещё и ветер
  var perfOn = !/[?&]perf=0/.test(location.search);
  var fpsFrames = 0, fpsT0 = 0, perfSince = 0, perfLow = 0, perfGood = 0, perfRecov = 0;
  var fpsBest = 0;   // лучший замеренный fps: у iPhone в энергосбережении и во встроенных страницах потолок 30 — ровные 30 там норма, а не перегрузка
  var nextToggleAt = 0, nextShootAt = 0, shootT0 = -1, secondPending = false;
  var fxRng = rng(99);

  // Куда на экране (доли ширины/высоты сцены) попадёт точка картинки при текущем сдвиге — та же формула, что в шейдере.
  function projectImg(u, v, d, k, sx, sy, zoom, crop) {
    var z = 1 + zoom * d, S = CONFIG.BASE_SCALE;
    var px = 0.5 + (u + k * sx - 0.5) * z, py = 0.5 + (v + k * sy - 0.5) * z;
    if (crop) { px = (px - crop[0]) / crop[2]; py = (py - crop[1]) / crop[3]; }   // обратно из обрезанного прямоугольника
    px = 0.5 + (px - 0.5) * S; py = 0.5 + (py - 0.5) * S;
    return [(px - coverOffX) / coverUvW, (py - coverOffY) / coverUvH];
  }

  // Фонари: ореол у лампы и светлое пятно на земле под ней; «дыхание» яркости ±8%, у каждого свой период 4–6 с.
  function flickDip(s, t) {   // s16: редкий короткий мягкий провал яркости фонаря (раз в every с, глубина depth, длительность dur)
    var LF = CONFIG.LAMP_FLICKER;
    if (!s.next) s.next = t + 2 + Math.random() * LF.every[0];
    if (s.t0 < 0 && t >= s.next) { s.t0 = t; s.dur = LF.dur[0] + Math.random() * (LF.dur[1] - LF.dur[0]); s.depth = LF.depth[0] + Math.random() * (LF.depth[1] - LF.depth[0]); s.dbl = Math.random() < 0.4; }
    if (s.t0 < 0) return 0;
    var p = (t - s.t0) / s.dur;
    if (p >= 1 || p < 0) { s.t0 = -1; s.next = t + LF.every[0] + Math.random() * (LF.every[1] - LF.every[0]); return 0; }
    var e = Math.sin(Math.PI * p);
    if (s.dbl) e = Math.max(e * 0.55, Math.sin(Math.PI * Math.min(1, p * 2.2)));   // иногда двойной «морг»
    return s.depth * e * e;
  }
  function fillLamps(fa, fb, mix, sx, sy, zoom, tAmb) {
    var H = fx.lampH, B = fx.lampB, D = fx.lampD, n = 0;
    function add(f, wgt) {
      if (!f || wgt <= 0.001) return;
      f.lamps.forEach(function (l) {
        if (n >= 16) return;
        var gate = clamp((tod.lights - l.delay) / 0.12, 0, 1);   // фонари зажигаются по одному
        var I = gate * (1 + CONFIG.LAMP_BREATH * Math.sin(tAmb * 2 * Math.PI / l.period + l.phase)) * wgt * (f.haloK || 1);
        var dip = (FLICK && l.flick) ? flickDip(l.flick, tAmb) : 0;
        I *= 1 - dip;
        var h = projectImg(l.hu, l.hv, l.hd, l.hd * 2 - 1, sx, sy, zoom, f.crop);
        var b = projectImg(l.bu, l.bv, l.bd, l.bd * 2 - 1, sx, sy, zoom, f.crop);
        H[n * 3] = h[0]; H[n * 3 + 1] = 1 - h[1]; H[n * 3 + 2] = I;
        B[n * 3] = b[0]; B[n * 3 + 1] = 1 - b[1]; B[n * 3 + 2] = I;
        if (FLICK) {
          var rx = 1.25 * Math.max(Math.abs(b[1] - h[1]), 0.004);
          D[n * 4] = b[0]; D[n * 4 + 1] = 1 - b[1] - 0.06 * rx; D[n * 4 + 2] = rx; D[n * 4 + 3] = dip * gate * wgt;
        }
        n++;
      });
    }
    add(fa, fb ? 1 - mix : 1);
    add(fb, mix);
    for (; n < 16; n++) { H[n * 3 + 2] = 0; B[n * 3 + 2] = 0; D[n * 4 + 3] = 0; }
  }

  // Окна, раз в 8–12 с одно случайное окно плавно зажигается/гаснет (1.5 с); падающие звёзды раз в 40–60 с.
  function stepNightFx(fa, fb, now) {
    [fa, fb].forEach(function (f) {
      if (f && updateWindows(f, tod.lights, now)) f.emDirty = true;
    });
    if (tod.lights > 0.95) {
      if (nextToggleAt === 0) nextToggleAt = now + rand(fxRng, CONFIG.WINDOW_TOGGLE_S[0], CONFIG.WINDOW_TOGGLE_S[1]) * 1000;
      else if (now >= nextToggleAt) {
        if (!fb && fa.wins.length) {
          var mainOnly = fa.wins.filter(function (w) { return w.ch === 0; });   // окна главного здания
          var pool = (mainOnly.length && fxRng() < CONFIG.MAIN_WINDOW_SHARE) ? mainOnly : fa.wins;
          var w = pool[(fxRng() * pool.length) | 0];
          w.on = !w.on; w.animFrom = w.cur; w.animT0 = now;
        }
        nextToggleAt = now + rand(fxRng, CONFIG.WINDOW_TOGGLE_S[0], CONFIG.WINDOW_TOGGLE_S[1]) * 1000;
      }
    } else nextToggleAt = 0;

    if (perfLevel < 1 && tod.stars > 0.7) {
      if (shootT0 < 0) {
        if (nextShootAt === 0) nextShootAt = now + rand(fxRng, CONFIG.SHOOT_EVERY_S[0], CONFIG.SHOOT_EVERY_S[1]) * 1000;
        else if (now >= nextShootAt) {
          var dirX = (fxRng() < 0.5 ? -1 : 1) * rand(fxRng, 0.75, 0.95), dirY = rand(fxRng, 0.30, 0.48);
          fx.shoot = [rand(fxRng, 0.2, 0.8), rand(fxRng, 0.04, 0.3), dirX, dirY];
          shootT0 = now;
          if (!secondPending && fxRng() < 0.4) { secondPending = true; nextShootAt = now + rand(fxRng, 1500, 3000); }
          else { secondPending = false; nextShootAt = now + rand(fxRng, CONFIG.SHOOT_EVERY_S[0], CONFIG.SHOOT_EVERY_S[1]) * 1000; }
        }
      }
    } else { nextShootAt = 0; }
    if (shootT0 >= 0) {
      var p = (now - shootT0) / CONFIG.SHOOT_MS;
      if (p >= 1 || perfLevel >= 1) { shootT0 = -1; fx.shootP = -1; } else fx.shootP = p;
    } else fx.shootP = -1;
  }

  // Цель — 60 fps. Если средний fps ниже PERF_MIN_FPS (45): сначала выключаем ветер, потом падающие звёзды.
  // диагностика: адрес с #debug — строчка вверху экрана (fps, уровень экономии, «уменьшение движения», погода). Для проверки на телефоне.
  var dbgEl = null, dbgT = 0, dbgFrames = 0, dbgFps = 0;
  function debugLine(now) {
    if (location.hash !== '#debug') { if (dbgEl) { dbgEl.remove(); dbgEl = null; } return; }
    dbgFrames++;
    if (!dbgEl) { dbgEl = document.createElement('div'); dbgEl.style.cssText = 'position:fixed;left:6px;top:calc(env(safe-area-inset-top,0px) + 6px);z-index:99;font:11px/1.3 monospace;background:rgba(255,255,255,.85);color:#000;padding:3px 6px;border-radius:4px;pointer-events:none;white-space:pre'; document.body.appendChild(dbgEl); dbgT = now; }
    if (now - dbgT < 1000) return;
    dbgFps = dbgFrames * 1000 / (now - dbgT); dbgFrames = 0; dbgT = now;
    var c = document.getElementById('wxCanvas');
    dbgEl.textContent = 'fps ' + dbgFps.toFixed(0) + ' · экономия ' + perfLevel + ' · меньше движения ' + (reduced() ? 'ДА' : 'нет') + ' · dpr ' + (window.devicePixelRatio || 1) +
      '\nпогода ' + wx.cur.map(function (x) { return x.toFixed(2); }).join('/') + ' · ветер ' + wx.wind.toFixed(1) + ' · холст ' + (c ? c.width + '×' + c.height + ' ' + (c.style.display || 'виден') : 'нет') +
      ' · детали ' + (window.Details ? 'да' : 'нет');
  }
  function perfCheck(now, busy) {
    debugLine(now);
    if (!perfOn) return;
    if (!perfSince) perfSince = now;
    if (busy || !fpsT0 || now - perfSince < 4000) { fpsT0 = now; fpsFrames = 0; return; } // разогрев 4 с, переходы, чтение — не считаем
    fpsFrames++;
    var dt = now - fpsT0;
    if (dt >= 2500) {
      var fps = fpsFrames * 1000 / dt;
      fpsBest = Math.max(fpsBest, fps);
      if (fps < CONFIG.PERF_MIN_FPS && fps < fpsBest * 0.8 && document.visibilityState === 'visible') {   // медленно И заметно хуже, чем этот экран умеет
        perfGood = 0;
        if (perfLevel < 2 && ++perfLow >= 2) {   // два медленных окна подряд (5 с): одиночная заминка (окно на заднем плане, вкладка) не считается
          perfLow = 0; perfLevel++;              // сначала отключаем детали (и падающие звёзды), потом ветер
          console.info('fps ' + fps.toFixed(1) + ' < ' + CONFIG.PERF_MIN_FPS + ' -> отключаю ' + (perfLevel === 1 ? 'живые детали и падающие звёзды' : 'ветер'));
        }
      } else {
        perfLow = 0;
        if (perfLevel >= 1 && fps >= Math.min(56, fpsBest * 0.93) && ++perfGood >= Math.min(24, 4 + 2 * perfRecov)) {   // 10 с ровных 56+ fps без деталей — возвращаем; после каждого срыва ждём дольше (до 60 с), чтобы детали не «мигали»
          perfGood = 0; perfRecov++; perfLevel--;
          console.info('fps ровный -> возвращаю ' + (perfLevel === 0 ? 'живые детали' : 'ветер'));
        } else if (fps < Math.min(56, fpsBest * 0.93)) perfGood = 0;
      }
      fpsT0 = now; fpsFrames = 0;
    }
  }

  // ---------- демо-наклон: при первом показе картинки один мягкий наклон (~1.5 с) и возврат — видно, что она двигается ----------
  // Запускается, когда приветствие начало уходить. Не запускается, если картинка уже реагирует на руку (гироскоп даёт наклон,
  // палец/мышь на сцене) и при «уменьшении движения»; любое касание или движение мыши по сцене его прерывает.
  var demo = null;
  function demoStart() {
    if (demo || reduced() || pointerActive || gyroGotEvent || stage.classList.contains('reading') || stage.classList.contains('loading')) return;
    demo = { t0: null, dur: 1500, ax: 1.0, ay: -0.3 };
  }
  function demoStop() {
    if (!demo) return;
    demo = null;
    targetX = gyroActive ? gyroTargetX : 0; targetY = gyroActive ? gyroTargetY : 0;
  }
  window.__demoTilt = function () { setTimeout(demoStart, 250); setTimeout(showHint, 2600); };   // после начала растворения приветствия
  // e1.12 (s4): подсказка при первом заходе — карандашная стрелка к кнопке шоу (не к меню): телефон, один раз
  function showHint() {
    var b = document.getElementById('flagBtnB');
    if (desktopMQ.matches || !b || b.hidden || b.classList.contains('off-frame') || lsGet('chka-show-hint') || bodyEl.classList.contains('sheet-open')) return;
    lsSet('chka-show-hint', '1');
    b.classList.add('sh-hint');
    setTimeout(function () { b.classList.remove('sh-hint'); }, 4400);
  }
  // e1.12 (s4): нажали шоу — из кнопки в кадр разлетаются искры (цвета флага и тёплое золото), ~0,9 с
  function magicSparks(b) {
    if (reduced() || !b.getBoundingClientRect || !document.body.animate) return;
    var r = b.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    var COL = ['#d90012', '#1c4cc0', '#f2a800', '#f6d27a', '#fff3c4'];
    for (var k = 0; k < 16; k++) {
      var el = document.createElement('div'), star = k % 3 !== 2, c = COL[k % COL.length], sz = star ? 12 + Math.random() * 12 : 5 + Math.random() * 5;
      el.className = 'mg-spark'; el.setAttribute('aria-hidden', 'true');
      el.style.width = el.style.height = sz + 'px'; el.style.margin = (-sz / 2) + 'px 0 0 ' + (-sz / 2) + 'px';
      el.innerHTML = star ? '<svg viewBox="0 0 20 20"><path d="M10 1 Q11 8.6 19 10 Q11 11.4 10 19 Q9 11.4 1 10 Q9 8.6 10 1Z" fill="' + c + '" stroke="#2f2a25" stroke-width="1.2" stroke-linejoin="round"/></svg>'
        : '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="' + c + '"/></svg>';
      document.body.appendChild(el);
      var ang = -Math.PI * (0.18 + 0.82 * Math.random()), dist = 110 + Math.random() * 230, dx = Math.cos(ang) * dist, dy = Math.sin(ang) * dist * 1.25, rot = (Math.random() - 0.5) * 540;
      var an = el.animate([
        { transform: 'translate(' + cx + 'px,' + cy + 'px) scale(0.3) rotate(0deg)', opacity: 0 },
        { transform: 'translate(' + (cx + dx * 0.35) + 'px,' + (cy + dy * 0.35) + 'px) scale(1.15) rotate(' + rot * 0.4 + 'deg)', opacity: 1, offset: 0.25 },
        { transform: 'translate(' + (cx + dx) + 'px,' + (cy + dy + 30) + 'px) scale(0.5) rotate(' + rot + 'deg)', opacity: 0 }
      ], { duration: 700 + Math.random() * 450, delay: Math.random() * 120, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'both' });
      (function (e) { an.onfinish = function () { if (e.parentNode) e.parentNode.removeChild(e); }; setTimeout(function () { if (e.parentNode) e.parentNode.removeChild(e); }, 2000); })(el);
    }
  }

  // ---------- кнопка «Парад» (флаг Армении): три истребителя и дымные следы, рисует details.js ----------
  // Нажатие: если открыт не кадр парада (PARADE_FRAME) — плавный переход на него, потом показ. Повторные нажатия во время показа игнорируются.
  // При fps < 45 (детали отключены) и при «уменьшении движения» кнопка скрыта.
  var flagBtns = document.querySelectorAll('.flag-btn');
  var paradeBusy = false, paradeWant = null;
  var flagOnFrame = true;
  function flagFrameStep() {   // кнопка живёт только на кадре парада; при переходе на другой кадр гаснет сразу
    var on = hasParade(frameIndex) && !fade;
    if (on === flagOnFrame) return;
    flagOnFrame = on;
    flagBtns.forEach(function (b) { b.classList.toggle('off-frame', !on); });
  }
  // Кнопка не исчезает никогда (только гаснет на остальных кадрах; у здания без парада её нет). На слабом устройстве (fps < 45), при «уменьшении движения» и без WebGL
  // показывается упрощённый парад: флаг Армении просто проявляется в небе, чуть колышется и растворяется (simpleParade).
  function flagUpdate() { flagBtns.forEach(function (b) { b.hidden = PARADE_FRAME < 0; }); }   // у здания без парада кнопки нет
  function simpleParade(done) {
    var el = document.createElement('div');
    el.className = 'flag-lite'; el.setAttribute('aria-hidden', 'true');
    el.innerHTML = '<svg viewBox="0 0 46 34" width="140" height="103"><g stroke-linejoin="round">' +
      '<path class="fb fb1" d="M4 4 Q13 1 23 4 Q33 7 42 4 L42 12 Q33 15 23 12 Q13 9 4 12 Z" fill="#d90012"/>' +
      '<path class="fb fb2" d="M4 12 Q13 9 23 12 Q33 15 42 12 L42 20 Q33 23 23 20 Q13 17 4 20 Z" fill="#1c4cc0"/>' +
      '<path class="fb fb3" d="M4 20 Q13 17 23 20 Q33 23 42 20 L42 28 Q33 31 23 28 Q13 25 4 28 Z" fill="#f2a800"/>' +
      '<path d="M4 4 Q13 1 23 4 Q33 7 42 4 L42 28 Q33 31 23 28 Q13 25 4 28 Z" fill="none" stroke="#2f2a25" stroke-width="1.1" opacity=".75"/>' +
      '<path d="M3 2 L3.4 33" fill="none" stroke="#2f2a25" stroke-width="1.6" stroke-linecap="round"/></g></svg>';
    stage.appendChild(el);
    var finished = false; simpleT0 = performance.now();
    function end() { if (finished) return; finished = true; if (el.parentNode) el.parentNode.removeChild(el); done(); }
    simpleEnd = end;
    el.addEventListener('animationend', function (e) { if (e.animationName === 'liteFlag') end(); });
    setTimeout(end, 9000);   // страховка
  }
  var ringSegs = [], ringP = -1, simpleT0 = null, simpleEnd = null;
  flagBtns.forEach(function (b) { ringSegs.push(b.querySelectorAll('.rs')); });
  function setParadeBusy(v) {
    paradeBusy = v; ringP = -1; if (!v) { simpleT0 = null; simpleEnd = null; }
    flagBtns.forEach(function (b) { b.setAttribute('aria-pressed', v ? 'true' : 'false'); b.classList.toggle('busy', v); b.classList.toggle('wait', v); });
    if (!v) ringDraw(0);
  }
  function ringDraw(p) {   // p: доля показа 0..1 (кольцо заполняется тремя цветами); p < 0 — «готовится»: три коротких штриха кружат
    if (Math.abs(p - ringP) < 0.002) return; ringP = p;
    ringSegs.forEach(function (segs) {
      for (var k = 0; k < 3; k++) {
        var l = p < 0 ? 0.24 : clamp(p * 3 - k, 0, 1);
        segs[k].style.strokeDasharray = l.toFixed(4) + ' 3'; segs[k].style.strokeDashoffset = (-k).toString(); segs[k].style.opacity = l > 0.002 ? '1' : '0';
      }
    });
  }
  function ringStep(now) {   // из рендер-цикла, пока идёт показ
    if (!paradeBusy) return;
    var p = paradeWant ? -1 : simpleT0 !== null ? clamp((now - simpleT0) / 6400, 0, 1) : (window.Details && window.Details.paradeProgress ? window.Details.paradeProgress(now) : -1);
    var w = p < 0; flagBtns.forEach(function (b) { if (b.classList.contains('wait') !== w) b.classList.toggle('wait', w); });
    ringDraw(p);
  }
  function stopParade() {   // повторное нажатие во время показа — остановить
    if (paradeWant) { paradeWant = null; setParadeBusy(false); return; }
    if (simpleEnd) { simpleEnd(); return; }
    if (window.Details && window.Details.paradeBusy && window.Details.paradeBusy()) window.Details.paradeAbort();
  }
  flagBtns.forEach(function (b) {
    b.addEventListener('click', function () {
      lsSet('chka-show-hint', '1'); b.classList.remove('sh-hint');
      if (paradeBusy) { stopParade(); return; }
      if (!hasParade(frameIndex) || fade) return;
      closePopup(); closeSheet();
      magicSparks(b);
      setParadeBusy(true);
      paradeWant = { since: performance.now(), shown: null };
    });
  });
  (reduceMQ.addEventListener ? reduceMQ.addEventListener('change', flagUpdate) : reduceMQ.addListener(flagUpdate));
  function paradeStep(now) {   // из рендер-цикла: довести до кадра парада, дать ему осесть, запустить показ
    if (!paradeWant) return;
    if (now - paradeWant.since > 9000) { paradeWant = null; setParadeBusy(false); return; }   // что-то не так — не зависаем
    if (fade) return;
    if (!hasParade(frameIndex)) { goTo(PARADE_FRAME); return; }
    if (paradeWant.shown === null) paradeWant.shown = now;
    if (now - paradeWant.shown < 450) return;
    paradeWant = null;
    var done = function () { setParadeBusy(false); };
    var full = useGL && perfLevel < 1 && !reduced() && window.Details && window.Details.parade;
    if (!(full && window.Details.parade(done, PARADE_STYLES[frameIndex]))) simpleParade(done);   // слабое устройство, «уменьшить движение», нет WebGL или занято — упрощённый парад
  }

  // ---------- рендер-цикл ----------
  var t0 = performance.now();
  var lastNow = null;
  var lastDraw = null;

  function frame(now) {   // e1.15: исключение в кадре не останавливает цикл — следующий кадр всё равно будет
    try { frameStep(now); } catch (e) { logErr('frame', e); requestAnimationFrame(frame); }
    if (DBG) { dbgFc++; if (now - dbgF0 >= 1000) { dbgFps = Math.round(dbgFc * 1000 / (now - dbgF0)); dbgFc = 0; dbgF0 = now; } dbgShow(false); }
  }
  function frameStep(now) {
    var dt = lastNow === null ? 16.667 : clamp(now - lastNow, 1, 64);
    lastNow = now;
    var rm = reduced();
    var t = rm ? 0 : (now - t0) / 1000;   // облака замирают при «уменьшении движения»
    var retMs = CONFIG.RETURN_MS;

    // --- кроссфейд ---
    if (fade) {
      if (fade.t0 === null) fade.t0 = now;
      var p = (now - fade.t0) / CONFIG.FRAME_CROSSFADE_MS;
      if (p >= 1) {
        frameIndex = fade.to;
        fade = null;
        mixState = 0;
        fx.zoomA = 1; fx.zoomB = 1;
        safe('dots', function () { markDot(frameIndex); buildHotspots(frameIndex); });
      } else {
        mixState = clamp(EASE(p), 0, 1);
        fx.zoomA = 1 + 0.06 * mixState;    // уходящий кадр медленно приближается и растворяется,
        fx.zoomB = 1.04 - 0.04 * mixState; // следующий проявляется из лёгкого отдаления
      }
    }

    // --- время суток: день→закат 2.5 с, закат→ночь 3 с (небо, потом земля, с середины по одному окна и фонари 2 с,
    // звёзды последними); обратно — в обратном порядке. Время бежит равномерно, по краям мягко.
    if (todAnim) {
      if (todAnim.t0 === null) todAnim.t0 = now;
      var dur = Math.max(1, Math.abs(todAnim.T1 - todAnim.T0) * 1000);
      var tf = clamp((now - todAnim.t0) / dur, 0, 1);
      var tfe = 0.5 * tf + 0.5 * tf * tf * (3 - 2 * tf);
      applyTod(todP(todAnim.T0 + (todAnim.T1 - todAnim.T0) * tfe));
      if (tf >= 1) { applyTod(todAnim.p1); todAnim = null; }
    }

    // Пока открыта карточка подсказки, картинка за ней стоит: точки и карточка не «плывут» за мышью,
    // GPU не тратится на размытый фон.
    if (stage.classList.contains('reading') && !fade && !todAnim) { fpsT0 = 0; requestAnimationFrame(frame); return; }

    // --- демо-наклон (один раз): туда-обратно по синусоиде; дальше управление возвращается мыши/гироскопу ---
    if (demo) {
      if (demo.t0 === null) demo.t0 = now;
      var dp = (now - demo.t0) / demo.dur;
      if (dp >= 1) demoStop();
      else { var dk = Math.sin(Math.PI * dp); targetX = demo.ax * dk; targetY = demo.ay * dk; }
    }
    safe('parade', function () { paradeStep(now); ringStep(now); flagFrameStep(); });

    // --- наклон ---
    if (ret) {
      if (ret.t0 === null) ret.t0 = now;
      var e = EASE((now - ret.t0) / retMs);
      curX = ret.fx + (targetX - ret.fx) * e;
      curY = ret.fy + (targetY - ret.fy) * e;
      if (now - ret.t0 >= CONFIG.RETURN_MS) ret = null;
    } else if (pointerActive) {
      var kf = lerpK(0.35, dt); // палец: почти без отставания
      curX += (targetX - curX) * kf;
      curY += (targetY - curY) * kf;
    } else {
      var ks = lerpK(CONFIG.SMOOTH, dt);
      curX += (targetX - curX) * ks;
      curY += (targetY - curY) * ks;
    }

    var tiltX = clamp(curX, -1, 1);
    var tiltY = clamp(curY, -1, 1);

    var ba = rm || stillQ ? 0 : CONFIG.BREATH_AMPLITUDE;
    var breathX = ba * Math.sin(t * 2 * Math.PI / CONFIG.BREATH_PERIOD_S);
    var breathY = ba * Math.cos(t * 2 * Math.PI / (CONFIG.BREATH_PERIOD_S * 0.7));
    var shiftX = tiltX * CONFIG.MAX_SHIFT_X + breathX;
    var shiftY = tiltY * CONFIG.MAX_SHIFT_Y + breathY;
    // наклон к себе (вниз) — ближние части чуть увеличиваются
    var zoom = CONFIG.ZOOM_NEAR * clamp(tiltY, 0, 1);
    if (tiltHold) { shiftX = tiltHold.sx; shiftY = tiltHold.sy; zoom = tiltHold.z; }   // e1.29: ракурс замер — наклон, дыхание и палец не двигают картинку

    resize(false);

    var fa = store[fade ? fade.from : frameIndex];
    var fb = fade ? store[fade.to] : null;
    if (!fa || (fade && !fb)) { requestAnimationFrame(frame); return; }   // кадр ещё не восстановлен

    if (useGL) {
      var tAmb = (now - t0) / 1000; // настоящее время: ветер, мерцание звёзд, «дыхание» фонарей
      fx.windOn = CONFIG.WIND && perfLevel < 2;
      fx.figOn = FN > 0 && !rm;   // e1.22: фигуры стоят при «Уменьшить движение»; e1.23 (s19): от экономии по fps не зависят — они дешёвые (только пиксели фигур), а на телефоне экономия могла их выключить навсегда
      fx.windAmp = CONFIG.WIND_AMP_PX * wx.wind * (fb ? CONFIG.WIND_K[fa.idx] + (CONFIG.WIND_K[fb.idx] - CONFIG.WIND_K[fa.idx]) * mixState : CONFIG.WIND_K[fa.idx]) * (coverUvW / CONFIG.BASE_SCALE) / Math.max(1, stage.clientWidth);
      if (GUSTS) {   // e1.25: качание сильнее в порыв, наклон крон по ветру (px экрана на макушке -> доли картинки)
        var kU = (fb ? CONFIG.WIND_K[fa.idx] + (CONFIG.WIND_K[fb.idx] - CONFIG.WIND_K[fa.idx]) * mixState : CONFIG.WIND_K[fa.idx]) * (coverUvW / CONFIG.BASE_SCALE) / Math.max(1, stage.clientWidth);
        fx.windAmp = CONFIG.WIND_AMP_PX * wx.windEff * kU;
        fx.leanA = GUSTS.leanPx * wx.lean * kU; fx.leanB = GUSTS.leanPx * wx.leanDel * kU;
      }
      safe('nightfx', function () { stepNightFx(fa, fb, now); fillLamps(fa, fb, mixState, shiftX, shiftY, zoom, tAmb); });
      stage.classList.toggle('is-night', tod.sky > 0.5);
      var nightNow = tod.night > 0.5 ? '1' : '0';
      if (document.documentElement.getAttribute('data-night') !== nightNow) document.documentElement.setAttribute('data-night', nightNow);   // тёмная подложка кнопок на телефоне
      perfCheck(now, !!(fade || todAnim || (window.Details && window.Details.paradeBusy && window.Details.paradeBusy())));
      lastDraw = { fa: fa, fb: fb, mix: mixState, shiftX: shiftX, shiftY: shiftY, zoom: zoom, t: t, tAmb: tAmb };
      safe('weather', function () { stepWeather(now); });
      if (NI) safe('video', function () { mvPlan(fade ? fade.from : frameIndex, fade ? fade.to : null, rm); });
      if (!glLost && !(gl.isContextLost && gl.isContextLost())) safe('draw', function () { drawGL(fa, fb, mixState, shiftX, shiftY, zoom, t, tAmb); });
      safe('precip', function () { drawPrecip(now, dt, rm); });
      if (window.Details && window.Details.frame && !detailsBroken) {   // живые детали: тот же цикл, не свой rAF; 30 ошибок подряд — детали выключаются, кадр живёт
        try { if (perfLevel < 1 && !rm) window.Details.frame(now); else window.Details.off(); detailsErr = 0; }
        catch (e) { logErr('details', e); if (++detailsErr > 30) { detailsBroken = true; safe('details off', function () { window.Details.off(); }); } }
      }
    } else {
      var cssW = stage.clientWidth, cssH = stage.clientHeight;
      var kb = CONFIG.FALLBACK_LAYER_K;
      var ia = fade ? fade.from : frameIndex, ib = fade ? fade.to : -1;
      fbFrames.forEach(function (ff, i) {
        var on = i === ia || i === ib;
        ff.el.style.opacity = i === ia ? '1' : (i === ib ? String(mixState) : '0');
        ff.el.style.visibility = on ? 'visible' : 'hidden';
        if (!on) return;
        var bx = (kb * shiftX / coverUvW) * cssW, by = (kb * shiftY / coverUvH) * cssH;
        ff.bld.style.transform = 'translate(' + bx + 'px,' + by + 'px) scale(' + CONFIG.BASE_SCALE + ')';
        ff.bg.style.transform = 'translate(' + (-bx) + 'px,' + (-by) + 'px) scale(' + CONFIG.BASE_SCALE + ')';
      });
    }

    if (!fade) safe('hotspots', function () { updateHotspotPositions(shiftX, shiftY, useGL ? zoom : 0); });

    requestAnimationFrame(frame);
  }
  var detailsErr = 0, detailsBroken = false;

  // ---------- панель: время суток, миниатюры, настройки, открытка ----------
  var bodyEl = document.body;
  var desktopMQ = window.matchMedia('(min-width: 1024px)');
  var scrimEl = document.getElementById('scrim');
  var thumbsEl = document.getElementById('thumbs');

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  // Выделение меняется мгновенно, в том же кадре, что и запуск смены (без CSS-перехода фона —
  // в WebKit он не перерисовывался, пока рядом рисует WebGL); reflow принудительно.
  function segMark(segId, attr, value) {
    var seg = document.getElementById(segId);
    seg.querySelectorAll('button').forEach(function (b) {
      var on = b.getAttribute(attr) === value;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    void seg.offsetWidth;
  }

  // свернуть/развернуть (ПК) и шторка (телефон)
  if (lsGet('chka-panel') === 'collapsed') bodyEl.classList.add('panel-collapsed');
  // закрытие шторки на телефоне — простое и надёжное: sheet-open снимается СРАЗУ, sheet-closing включает CSS-переход (шторка с содержимым уезжает вниз и
  // гаснет за 350 мс, затемнение гаснет одновременно) и отключает нажатия. Конец хода определяет таймер по длительности (а не transitionend — в Safari на
  // iPhone событие может не прийти или прийти от другого элемента): по нему sheet-closing снимается. Открыли снова посреди закрытия — sheet-quick
  // отключает вступительные анимации содержимого, шторка возвращается от текущего положения обычным переходом открытия (без миганий).
  var closeT = [];
  var CLOSE_MS = 350;
  function endClose() { closeT.forEach(clearTimeout); closeT = []; bodyEl.classList.remove('sheet-closing'); }
  function closeSheet() {
    if (!bodyEl.classList.contains('sheet-open') || bodyEl.classList.contains('sheet-closing')) return;
    if (desktopMQ.matches || reduced()) { bodyEl.classList.remove('sheet-open'); return; }
    document.documentElement.classList.add('panel-anim');
    closeT.forEach(clearTimeout); closeT = [];
    bodyEl.classList.add('sheet-closing');
    bodyEl.classList.remove('sheet-open', 'sheet-quick');
    closeT.push(setTimeout(endClose, CLOSE_MS + 50));
  }
  function openSheet() {
    var was = bodyEl.classList.contains('sheet-closing');
    closeT.forEach(clearTimeout); closeT = []; bodyEl.classList.remove('sheet-closing');
    bodyEl.classList.toggle('sheet-quick', was);
    bodyEl.classList.add('sheet-open');
  }
  var sheetCloseEl = document.getElementById('sheetClose');
  if (sheetCloseEl) sheetCloseEl.addEventListener('click', closeSheet);
  panelBtn.addEventListener('click', function () {
    lsSet('chka-menu-hint', '1'); panelBtn.classList.remove('pb-hint');
    document.documentElement.classList.add('panel-anim');   // анимации закрытия/иконки включаются только после первого нажатия (не при загрузке)
    if (desktopMQ.matches) lsSet('chka-panel', bodyEl.classList.toggle('panel-collapsed') ? 'collapsed' : 'open');
    else if (bodyEl.classList.contains('sheet-open') && !bodyEl.classList.contains('sheet-closing')) closeSheet(); else openSheet();
  });
  scrimEl.addEventListener('click', closeSheet);
  (desktopMQ.addEventListener ? desktopMQ.addEventListener('change', closeSheet) : desktopMQ.addListener(closeSheet));

  // время суток: p = 0 день, 1 закат, 2.1667 ночь (последние 0.1667 — доезжают огни и звёзды)
  var TOD_P = { day: 0, sunset: 1, night: 2.1667 };
  var todAnim = null;
  function sstep(a, b, x) { x = clamp((x - a) / (b - a), 0, 1); return x * x * (3 - 2 * x); }
  function todT(p) { return p <= 1 ? CONFIG.DAY_SUNSET_S * p : CONFIG.DAY_SUNSET_S + CONFIG.SUNSET_NIGHT_S * (p - 1); }
  function todP(T) { return T <= CONFIG.DAY_SUNSET_S ? T / CONFIG.DAY_SUNSET_S : 1 + (T - CONFIG.DAY_SUNSET_S) / CONFIG.SUNSET_NIGHT_S; }
  function applyTod(p) {
    var q = p - 1;
    tod.p = p;
    tod.s = p <= 1 ? p : 1 - sstep(0.3, 0.9, q);          // тёплый тон держится, пока темнеет
    tod.sky = q > 0 ? sstep(0.0, 0.55, q) : 0;            // сначала небо
    tod.gnd = q > 0 ? sstep(0.3, 0.9, q) : 0;             // потом земля
    tod.lights = clamp((p - 1.5) / 0.667, 0, 1);          // с середины перехода, в течение 2 с
    tod.stars = q > 0 ? sstep(0.75, 1.1667, q) : 0;       // звёзды — последними
    tod.night = q > 0 ? sstep(0.0, 1.1667, q) : 0;        // ночной кадр проявляется все 3 с перехода
    tod.sun = clamp(p, 0, 1);                             // закатный кадр проявляется все 2.5 с перехода день→закат
  }
  function setTod(name) {
    var p1 = TOD_P[name];
    if (p1 === undefined) return;
    todAnim = { t0: null, T0: todT(tod.p), T1: todT(p1), p1: p1 };
    segMark('todSeg', 'data-tod', name);
    if (name === 'night' && wx) { wx.rainbowT0 = 0; if (wx.label) showWxName(); }
    var cbtn = document.querySelector('#wxChips [data-wx=cloudy]');   // ночью тучи не видны — кнопка гаснет (и тучи выключаются)
    if (cbtn && wx) {
      cbtn.disabled = name === 'night'; cbtn.title = name === 'night' ? CONFIG.UI_I18N.nightNA[currentLang] : '';
      if (name === 'night' && wxOn.cloudy) { wxOn.cloudy = false; applyWeather(); }
    }
    if (!useGL) fbEl.setAttribute('data-tod', name);
  }
  document.querySelectorAll('#todSeg button').forEach(function (b) {
    b.addEventListener('click', function () { setTod(b.getAttribute('data-tod')); });
  });

  // ---------- погода и ветер (e1.3) ----------
  // wx.cur — доли эффектов [пасмурно, туман, мокро, снег], плавно идут к wx.to за WEATHER_FADE_MS; wx.wind — множитель качания деревьев.
  var wx = { cur: [0, 0, 0, 0], from: [0, 0, 0, 0], to: [0, 0, 0, 0], t0: null, label: 'clear', wind: 1, windTo: 1, windFrom: 1, cover: 0, lastNow: 0, flash: 0, rainbowT0: 0,
    snowLin: 0, lastNow0: 0, gusts: [], gNext: 0, gLast: 0, gLevel: 0, gust: 0, gRise: 0, windEff: 1, lean: 0, leanV: 0, leanDel: 0, leanHist: [], windPh: 0 };   // e1.25: накопление снега и порывы (только при SNOW/GUSTS)
  // Погода (e1.3): тучи, дождь, снег, туман включаются независимо; ветер — по кругу тихо/ветрено/буря. Всё выключено — ясно.
  // Цель — по каждому эффекту наибольшее из включённых; сочетания дают своё: дождь + буря — гроза (темнее, молнии),
  // снег + буря — метель (снег косо, дымка), дождь выключили днём — радуга. Под значками — название получившейся погоды.
  var wxOn = {}, windIdx = 0;
  function wxLabel() {
    var r = wxOn.rain, s = wxOn.snow, f = wxOn.fog, c = wxOn.cloudy, st = windIdx === 2, k;
    if (r && st) k = 'thunder'; else if (s && st) k = 'blizzard';
    else if (r && f) k = 'drizzle'; else if (s && f) k = 'haze'; else if (r) k = windIdx ? 'slant' : 'rain'; else if (s) k = 'snow';
    else if (f && c) k = 'gloom'; else if (f) k = 'fog'; else if (c) k = 'overcast'; else k = ['clear', 'breezy', 'gale'][windIdx];
    return k;
  }
  function applyWeather() {
    if (SNOWM && wxOn.snow) { loadStates(frameIndex); }   // e1.25: маска снега живёт в ночной картинке кадра — грузим сразу
    var to = [0, 0, 0, 0];
    Object.keys(wxOn).forEach(function (k) { if (wxOn[k]) CONFIG.WEATHER[k].forEach(function (v, i) { to[i] = Math.max(to[i], v); }); });
    if (wxOn.rain && windIdx === 2) to[0] = Math.max(to[0], 1);     // гроза: небо тяжелее
    if (wxOn.snow && windIdx === 2) to[1] = Math.max(to[1], 0.45);  // метель: видимость падает
    wx.from = wx.cur.slice(); wx.to = to; wx.t0 = null; wx.windFrom = wx.wind;
    document.querySelectorAll('#wxChips [data-wx]').forEach(function (b) { var on = !!wxOn[b.getAttribute('data-wx')]; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    segMark('precipSeg', 'data-precip', wxOn.rain ? 'rain' : (wxOn.snow ? 'snow' : 'none'));
    var wb = document.getElementById('windBtn'); if (wb) { wb.setAttribute('data-wind', String(windIdx)); wb.classList.toggle('on', windIdx > 0); wb.setAttribute('aria-pressed', windIdx > 0 ? 'true' : 'false'); }
    wx.label = wxLabel(); showWxName();
  }
  function showWxName() { var el = document.getElementById('wxName'); if (el) el.textContent = CONFIG.UI_I18N['wxN_' + (wx.rainbowT0 && !wx.label.match(/rain|thunder|sleet|drizzle|slant/) && wx.label !== 'snow' ? 'rainbow' : wx.label)][currentLang]; }
  function setWeather(name) {
    if (!CONFIG.WEATHER || !CONFIG.WEATHER[name]) return;
    var hadRain = !!wxOn.rain;
    wxOn[name] = !wxOn[name];
    if (wxOn[name]) wx.rainbowT0 = 0;   // тучи или туман — радуги нет
    if (wxOn[name] && name === 'rain') wxOn.snow = false;   // дождь и снег вместе не бывают: включили одно — другое выключилось
    if (wxOn[name] && name === 'snow') wxOn.rain = false;
    if (hadRain && !wxOn.rain && tod.night < 0.5 && !wxOn.snow) wx.rainbowT0 = performance.now();   // дождь кончился днём — радуга
    if (wxOn.rain) wx.rainbowT0 = 0;
    applyWeather();
  }
  // Осадки — одно из: сухо / дождь / снег
  function setPrecip(v) {
    var hadRain = !!wxOn.rain;
    wxOn.rain = v === 'rain'; wxOn.snow = v === 'snow';
    if (hadRain && !wxOn.rain && tod.night < 0.5 && !wxOn.snow) wx.rainbowT0 = performance.now();   // дождь кончился днём — радуга
    if (wxOn.rain || wxOn.snow) wx.rainbowT0 = 0;
    applyWeather();
  }
  document.querySelectorAll('#precipSeg [data-precip]').forEach(function (b) { b.addEventListener('click', function () { setPrecip(b.getAttribute('data-precip')); }); });
  function setWind(i) {
    var k = CONFIG.WIND_LEVELS && CONFIG.WIND_LEVELS[i];
    if (!k) return;
    windIdx = i; wx.windFrom = wx.wind; wx.windTo = k;
    applyWeather();
  }
  document.querySelectorAll('#wxChips [data-wx]').forEach(function (b) { b.addEventListener('click', function () { setWeather(b.getAttribute('data-wx')); }); });
  var windBtnEl = document.getElementById('windBtn');
  if (windBtnEl) windBtnEl.addEventListener('click', function () { setWind((windIdx + 1) % 3); });
  showWxName();   // название погоды сразу на языке страницы
  function stepWeather(now) {
    if (wx.t0 === null) wx.t0 = now;
    var k = sstep(0, 1, (now - wx.t0) / (CONFIG.WEATHER_FADE_MS || 1));
    for (var i = 0; i < 4; i++) wx.cur[i] = wx.from[i] + (wx.to[i] - wx.from[i]) * k;
    wx.wind = wx.windFrom + (wx.windTo - wx.windFrom) * k;
    // снежный покров: копится ~15 с, пока идёт снег, тает ~5 с
    var dts = wx.lastNow ? Math.min(0.1, (now - wx.lastNow) / 1000) : 0; wx.lastNow = now;
    var tgt = wx.to[3];
    if (CONFIG.SNOW) {   // e1.25: копится ~accumS с, тает ~meltS с; в шейдер — кривая с мягким началом и концом (без скачков)
      dts = wx.lastNow0 ? Math.min(1, (now - wx.lastNow0) / 1000) : 0; wx.lastNow0 = now;
      var SN = CONFIG.SNOW;
      wx.snowLin = tgt > wx.snowLin ? Math.min(tgt, wx.snowLin + dts / (SN.accumS || 35)) : Math.max(tgt, wx.snowLin - dts / (SN.meltS || 90));
      wx.cover = wx.snowLin * wx.snowLin * (3 - 2 * wx.snowLin);
    } else wx.cover = tgt > wx.cover ? Math.min(tgt, wx.cover + dts / 15) : Math.max(tgt, wx.cover - dts / 5);
    if (GUSTS) stepGusts(now);
  }
  function snowCode(f, now) {   // -1 — у кадра нет маски (старая формула); 0..1 — маска проявляется плавно после загрузки (без скачка)
    if (!f || !FRAMES[f.idx].snow || f.snowFail) return -1;
    if (!f.snowOk) return 0;
    if (!f.snowT) f.snowT = now;
    var q = Math.min(1, (now - f.snowT) / 1500); return q * q * (3 - 2 * q);
  }
  // e1.25 GUSTS: порыв = огибающая (разгон attack с, плато hold, мягкое затухание decay — как кривая --ios), пауза gap; сила по уровню
  // ветра (level[тихо, ветрено, буря]). Деревья — пружина (частота spring Гц, затухание damp): наклон догоняет порыв с инерцией.
  // Наклон пишется в историю — правый край кадра получает его на delay с позже (порыв идёт по кадру).
  function stepGusts(now) {
    var G = GUSTS, dt = wx.gLast ? Math.min(0.25, (now - wx.gLast) / 1000) : 0; wx.gLast = now;
    var lvT = G.level[windIdx] || 0;
    wx.gLevel += (lvT - wx.gLevel) * Math.min(1, dt / 1.2);
    if (!wx.gNext) wx.gNext = now + 1500;
    if (now >= wx.gNext) {
      var R = pRng;
      wx.gusts.push({ t0: now, a: G.attack * (0.75 + 0.5 * R()), h: G.hold * (0.5 + R()), d: G.decay * (0.8 + 0.4 * R()), k: 0.65 + 0.35 * R() });
      wx.gNext = now + (G.gap[0] + (G.gap[1] - G.gap[0]) * R()) * 1000;
    }
    var e = 0;
    for (var i = wx.gusts.length - 1; i >= 0; i--) {
      var g = wx.gusts[i], t = (now - g.t0) / 1000, v;
      if (t < g.a) { v = 1 - Math.pow(1 - t / g.a, 3); }   // быстрый старт
      else if (t < g.a + g.h) v = 1;
      else if (t < g.a + g.h + g.d) { var q = (t - g.a - g.h) / g.d; v = 1 - q * q * (3 - 2 * q); }   // долгое мягкое затухание
      else { wx.gusts.splice(i, 1); continue; }
      e = Math.max(e, v * g.k);
    }
    e *= 1 + 0.12 * Math.sin(now / 1000 * 5.3) * e;   // внутри порыва ветер «дышит»
    var gPrev = wx.gust; wx.gust = e * wx.gLevel;
    wx.gRise = wx.gust > 0.3 && gPrev <= 0.3 ? now : wx.gRise;   // начало порыва — гроздь листьев
    wx.windEff = wx.wind * (G.calm + G.boost * wx.gust);
    var w0 = 6.2832 * G.spring, z = G.damp, steps = Math.max(1, Math.ceil(dt / 0.008)), h = dt / steps;
    for (var s2 = 0; s2 < steps; s2++) { wx.leanV += (w0 * w0 * (wx.gust - wx.lean) - 2 * z * w0 * wx.leanV) * h; wx.lean += wx.leanV * h; }
    wx.windPh += dt * (G.calm + G.flutter * wx.gust) * (reduced() ? 0 : 1);
    wx.leanHist.push([now, wx.lean]);
    while (wx.leanHist.length > 2 && wx.leanHist[1][0] < now - G.delay * 1000) wx.leanHist.shift();
    wx.leanDel = wx.leanHist[0][1];   // наклон delay с назад — для правого края кадра
  }

  // Капли и снежинки — отдельный прозрачный холст над картинкой (под точками-подсказками); создаётся, только когда нужен.
  var pc = null, pctx = null, drops = [], flakes = [], leaves = [], splashes = [], pRng = rng(7), flash = null, nextFlash = 0;
  function precipCanvas() {
    if (pc) return;
    pc = document.createElement('canvas');
    pc.id = 'wxCanvas';
    pc.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;z-index:4;pointer-events:none';
    stage.insertBefore(pc, document.getElementById('hotspots'));
    pctx = pc.getContext('2d');
  }
  // Молния: ломаная из середины вниз (смещение средней точки) + ветви; рисуется на своём слое и оставляется только в небе —
  // за зданиями, деревьями и землёй её не видно, поэтому она «вдали».
  function makeBolt(x0, y0, y1, seg) {
    var main = [[x0, y0]], x = x0, y = y0, branches = [];
    while (y < y1) { x += (pRng() - 0.5) * seg * 1.3; y += seg * (0.35 + 0.5 * pRng()); main.push([x, Math.min(y, y1)]); }
    for (var k = 0; k < 3 + Math.floor(pRng() * 3); k++) {
      var i0 = 1 + Math.floor(pRng() * (main.length * 0.7)), bx = main[i0][0], by = main[i0][1], dir = pRng() < 0.5 ? -1 : 1, br = [[bx, by]];
      for (var j = 0; j < 3 + Math.floor(pRng() * 5); j++) { bx += dir * seg * (0.3 + 0.6 * pRng()); by += seg * (0.25 + 0.45 * pRng()); br.push([bx, by]); }
      branches.push(br);
    }
    return { main: main, branches: branches };
  }
  var boltCv = null, skyMaskCv = {};
  function skyMaskFor(i) {   // маска неба кадра из карты окружения (R — небо)
    if (skyMaskCv[i]) return skyMaskCv[i] === 'loading' ? null : skyMaskCv[i];
    skyMaskCv[i] = 'loading';
    var im = new Image(); im.crossOrigin = 'anonymous';
    im.onload = function () {
      try {
        var mw = 192, mh = Math.round(mw * FH / FW), c = document.createElement('canvas'); c.width = mw; c.height = mh;
        var x = c.getContext('2d'); x.drawImage(im, 0, 0, mw, mh); var id = x.getImageData(0, 0, mw, mh), D = id.data;
        for (var k = 0; k < D.length; k += 4) { D[k + 3] = D[k]; D[k] = D[k + 1] = D[k + 2] = 255; }
        x.putImageData(id, 0, 0); skyMaskCv[i] = c;
      } catch (e) { skyMaskCv[i] = null; }
    };
    im.onerror = function () { skyMaskCv[i] = null; };
    im.src = FRAMES[i].env;
    return null;
  }
  function drawBolt(fl, W, H, d) {
    if (!boltCv) boltCv = document.createElement('canvas');
    if (boltCv.width !== W || boltCv.height !== H) { boltCv.width = W; boltCv.height = H; }
    var bc = boltCv.getContext('2d'); bc.clearRect(0, 0, W, H); bc.lineJoin = 'round'; bc.lineCap = 'round';
    function path(pts) { bc.beginPath(); pts.forEach(function (pt, k) { if (k) bc.lineTo(pt[0], pt[1]); else bc.moveTo(pt[0], pt[1]); }); bc.stroke(); }
    bc.shadowColor = 'rgba(190,210,255,' + fl + ')'; bc.shadowBlur = 22 * d;
    bc.strokeStyle = 'rgba(170,195,255,' + (0.45 * fl).toFixed(3) + ')'; bc.lineWidth = 6 * d; path(wx.bolt.main);   // свечение вокруг
    bc.shadowBlur = 8 * d;
    wx.bolt.branches.forEach(function (br) { bc.strokeStyle = 'rgba(235,242,255,' + (0.7 * fl).toFixed(3) + ')'; bc.lineWidth = 1.1 * d; path(br); });
    bc.strokeStyle = 'rgba(255,255,255,' + (0.95 * fl).toFixed(3) + ')'; bc.lineWidth = 2 * d; path(wx.bolt.main);
    var m = skyMaskFor(frameIndex), ent = store[frameIndex];
    if (m && ent) {   // только в небе
      var p0 = window.__viewer.project(ent, 0, 0, 0), p1 = window.__viewer.project(ent, 1, 1, 0);
      bc.globalCompositeOperation = 'destination-in'; bc.shadowBlur = 0;
      bc.drawImage(m, p0[0] * d, p0[1] * d, (p1[0] - p0[0]) * d, (p1[1] - p0[1]) * d);
      bc.globalCompositeOperation = 'source-over';
    }
    pctx.drawImage(boltCv, 0, 0);
  }
  var groundPts = {};
  function groundFor(i) {
    if (groundPts[i]) return groundPts[i] === 'loading' ? null : groundPts[i];
    groundPts[i] = 'loading';
    var F = FRAMES[i], gw = 72, gh = Math.round(gw * FH / FW), n = 0, imgs = {};
    function done() {
      if (++n < 3) return;
      try {
        var cv = document.createElement('canvas'); cv.width = gw; cv.height = gh; var x = cv.getContext('2d');
        function px(im) { x.clearRect(0, 0, gw, gh); x.drawImage(im, 0, 0, gw, gh); return x.getImageData(0, 0, gw, gh).data; }
        var D = px(imgs.d), E = px(imgs.e), B = px(imgs.b), pts = [];
        for (var y = 2; y < gh - 2; y++) for (var xx = 0; xx < gw; xx++) {
          var o = (y * gw + xx) * 4, g = (D[o + 8 * gw] - D[o - 8 * gw]) / 255;   // глубина ниже минус выше
          if (E[o] > 90 || E[o + 1] > 8 || B[o + 3] > 90) continue;               // небо, дерево, главное здание — не земля
          if (g > 0.012 && g < 0.2) pts.push([(xx + 0.5) / gw, (y + 0.5) / gh, D[o] / 255]);
        }
        groundPts[i] = pts;
      } catch (e) { groundPts[i] = []; }
    }
    [['d', F.depth], ['e', F.env], ['b', F.building.color]].forEach(function (q) {
      var im = new Image(); im.crossOrigin = 'anonymous'; im.onload = done; im.onerror = function () { groundPts[i] = []; }; im.src = q[1]; imgs[q[0]] = im;
    });
    return null;
  }
  function drawPrecip(now, dt, rm) {
    var rainK = wx.cur[2], snowK = wx.cur[3], leafK = clamp((wx.wind - 1.4) / 1.6, 0, 1) * (1 - snowK);
    var rbA = 0;   // радуга после дождя: 4 с проявляется, держится, 6 с тает (всего ~30 с); ночью и в тучах — нет
    if (wx.rainbowT0) {
      var ra0 = (now - wx.rainbowT0) / 1000;
      rbA = clamp(ra0 / 5, 0, 1) * clamp((30 - ra0) / 7, 0, 1) * (1 - tod.night) * (1 - wx.cur[0]) * (1 - wx.cur[1]) * (1 - rainK) * (1 - snowK);
      if (ra0 > 30) { wx.rainbowT0 = 0; showWxName(); }
    }
    wx.flash = 0;
    if (rainK < 0.01 && snowK < 0.01 && leafK < 0.01 && rbA < 0.01 && !(GUSTS && leaves.length)) { if (pc && pc.style.display !== 'none') { pctx.clearRect(0, 0, pc.width, pc.height); pc.style.display = 'none'; } return; }
    precipCanvas();
    pc.style.display = '';
    var d = Math.min(window.devicePixelRatio || 1, 1.5), w = stage.clientWidth, h = stage.clientHeight;
    if (pc.width !== Math.round(w * d) || pc.height !== Math.round(h * d)) { pc.width = Math.round(w * d); pc.height = Math.round(h * d); }
    var W = pc.width, H = pc.height, area = (w * h) / (390 * 844), lite = perfLevel >= 1 ? 0.5 : 1;
    var nR = Math.round(CONFIG.RAIN_DROPS * area * lite), nS = Math.round(CONFIG.SNOW_FLAKES * area * lite);
    while (drops.length < nR) drops.push({ x: pRng() * W, y: pRng() * H, z: 0.35 + 0.65 * pRng() });   // z: 1 — близко (длиннее, ярче)
    while (flakes.length < nS) flakes.push({ x: pRng() * W, y: pRng() * H, z: 0.3 + 0.7 * pRng(), ph: pRng() * 6.28 });
    var s = rm ? 0 : dt / 16.667, slant = 0.08 + 0.1 * (wx.wind - 1), night = tod.night, L = CONFIG.LOOK.weather;
    var rc = [0, 1, 2].map(function (i) { return Math.round(L.rainDay[i] + (L.rainNight[i] - L.rainDay[i]) * night); });
    var ra = L.rainDay[3] + (L.rainNight[3] - L.rainDay[3]) * night;
    pctx.clearRect(0, 0, W, H);
    var skyEnd = (CONFIG.DAY.SKY_END[frameIndex] || 0.55) * H;
    // молния: только буря + дождь; короткая двойная вспышка раз в 7–15 с
    var storm = rainK > 0.5 && windIdx === 2 && tod.night > 0.5 && !rm;   // гроза — ночью: дождь + буря
    if (storm) {
      if (!nextFlash) { nextFlash = now + 1200 + pRng() * 1500; wx.nextSheet = now + 600; }
      if (now >= wx.nextSheet && flash === null) { wx.sheetT0 = now; wx.sheetK = 0.25 + 0.35 * pRng(); wx.nextSheet = now + 1400 + pRng() * 2600; }   // зарница: облака вспыхивают изнутри
      if (now >= nextFlash) {
        flash = now; nextFlash = now + 4000 + pRng() * 5000;
        wx.bolt = makeBolt(W * (0.12 + 0.76 * pRng()), skyEnd * (0.08 + 0.12 * pRng()), skyEnd * (1.02 + 0.06 * pRng()), H * 0.028);
      }
    } else { nextFlash = 0; wx.sheetT0 = 0; }
    if (wx.sheetT0) {
      var sa2 = (now - wx.sheetT0) / 420, sf = sa2 < 1 ? Math.sin(sa2 * Math.PI) * (0.6 + 0.4 * Math.sin(sa2 * 40)) : 0;
      if (sa2 >= 1) wx.sheetT0 = 0;
      wx.flash = Math.max(wx.flash, sf * wx.sheetK);
    }
    if (flash !== null) {
      var fa = now - flash, fl = fa < 160 ? 1 - 0.4 * fa / 160 : (fa < 230 ? 0.25 : (fa < 560 ? 0.85 * (1 - (fa - 230) / 330) : 0));   // двойная вспышка ~0.5 с
      if (fa > 560) { flash = null; wx.bolt = null; }
      wx.flash = Math.max(wx.flash, fl * rainK);
      if (fl > 0 && wx.bolt) drawBolt(fl, W, H, d);
    }
    if (rbA > 0.01) {   // радуга: мягкие переходы цветов, концы и низ тают, рядом бледная вторая дуга; напротив солнца
      var key = W + 'x' + H + 'x' + Math.round(skyEnd);
      if (!wx.rbCv || wx.rbKey !== key) {
        var rc2 = document.createElement('canvas'); rc2.width = W; rc2.height = H; var rx = rc2.getContext('2d');
        var rcx = W * (CONFIG.SUN_SIDE === 'left' ? 0.66 : 0.34), rcy = skyEnd * 1.18, R0 = Math.max(W, skyEnd) * 0.72, bw = R0 * 0.09;
        [[R0, 1, 1], [R0 * 1.2, 0.3, -1]].forEach(function (arc) {   // основная и вторая (бледнее, цвета наоборот)
          for (var k4 = 0; k4 < 40; k4++) {
            var f4 = k4 / 39, hue = arc[2] > 0 ? f4 * 275 : (1 - f4) * 275;
            rx.strokeStyle = 'hsla(' + hue.toFixed(0) + ',85%,62%,' + (arc[1] * 0.16 * Math.sin(f4 * Math.PI) + 0.02).toFixed(3) + ')';
            rx.lineWidth = bw / 40 * 1.6;
            rx.beginPath(); rx.arc(rcx, rcy, arc[0] - f4 * bw, Math.PI * 1.02, Math.PI * 1.98); rx.stroke();
          }
        });
        rx.globalCompositeOperation = 'destination-in';   // концы тают, у горизонта радуга растворяется
        var gx = rx.createLinearGradient(0, 0, W, 0); gx.addColorStop(0, 'rgba(0,0,0,0)'); gx.addColorStop(0.28, 'rgba(0,0,0,1)'); gx.addColorStop(0.72, 'rgba(0,0,0,1)'); gx.addColorStop(1, 'rgba(0,0,0,0)');
        rx.fillStyle = gx; rx.fillRect(0, 0, W, H);
        var gy = rx.createLinearGradient(0, 0, 0, skyEnd); gy.addColorStop(0, 'rgba(0,0,0,1)'); gy.addColorStop(0.7, 'rgba(0,0,0,0.9)'); gy.addColorStop(1, 'rgba(0,0,0,0)');
        rx.fillStyle = gy; rx.fillRect(0, 0, W, H);
        wx.rbCv = rc2; wx.rbKey = key;
      }
      pctx.save(); pctx.globalAlpha = rbA; pctx.drawImage(wx.rbCv, 0, 0); pctx.restore();
    }
    if (rainK >= 0.01) {
      pctx.lineCap = 'round';
      var nRon = Math.round(nR * Math.min(1, rainK * 1.15));   // дождь начинается с редких капель
      for (var i = 0; i < nRon; i++) {
        var p = drops[i], v = (14 + 10 * p.z) * d * s, len = (10 + 16 * p.z) * d;
        p.y += v; p.x += v * slant;
        if (p.y > H) { p.y = -len - pRng() * 40 * d; p.x = pRng() * W * 1.2 - W * 0.1; }
        if (p.x > W) p.x -= W;
        pctx.strokeStyle = 'rgba(' + rc.join(',') + ',' + (ra * rainK * (0.45 + 0.55 * p.z)).toFixed(3) + ')';
        pctx.lineWidth = (0.8 + 1.0 * p.z) * d;
        pctx.beginPath(); pctx.moveTo(p.x, p.y); pctx.lineTo(p.x - len * slant, p.y - len); pctx.stroke();
      }
      // брызги на земле: маленькие «галочки» карандашом ниже линии горизонта
      var nsp = rainK * 5 * area * s, gp = groundFor(frameIndex), ent = store[frameIndex];
      while (gp && gp.length && ent && pRng() < nsp) {
        var g0 = gp[Math.floor(pRng() * gp.length)], q = window.__viewer.project(ent, g0[0] + (pRng() - 0.5) / 72, g0[1], g0[2]);
        splashes.push({ x: q[0] * d, y: q[1] * d, t0: now, r: (1.5 + 3 * pRng()) * d * (0.5 + g0[2]) }); nsp -= 1;
      }
      pctx.lineWidth = 0.9 * d;
      for (var si = splashes.length - 1; si >= 0; si--) {
        var sp = splashes[si], sa = (now - sp.t0) / 320;
        if (sa >= 1) { splashes.splice(si, 1); continue; }
        var rr = sp.r * (0.6 + sa);
        pctx.strokeStyle = 'rgba(' + rc.join(',') + ',' + (0.55 * ra * 2 * (1 - sa) * rainK).toFixed(3) + ')';
        pctx.beginPath(); pctx.moveTo(sp.x - rr, sp.y - rr * 0.9); pctx.lineTo(sp.x - rr * 0.3, sp.y); pctx.moveTo(sp.x + rr, sp.y - rr * 0.9); pctx.lineTo(sp.x + rr * 0.3, sp.y); pctx.stroke();
      }
    } else splashes.length = 0;
    if (snowK >= 0.01) {
      var sc = L.snowColor, t = now / 1000;
      if (flakes.length > nS) flakes.length = nS;
      var nSon = Math.round(nS * Math.min(1, snowK * 1.15));   // снег тоже начинается с редких снежинок
      for (var j = 0; j < nSon; j++) {
        var f = flakes[j], bl = windIdx === 2 ? 1 : 0, fv = (0.6 + 1.2 * f.z) * d * s * (1 + 1.2 * bl);
        if (GUSTS) {   // e1.25: в порыв снег сносит и закручивает: у каждой снежинки свой маленький круг (кружит), в метель — косо и вихрем
          var gN = wx.gust, om = 2.2 + 1.4 * f.z, rr2 = (0.25 + 0.9 * gN) * (0.35 + 0.65 * bl) * (1.2 + 1.6 * bl);
          var vx2 = (Math.sin(t * 0.9 + f.ph) * 0.5 + (wx.windEff - 1) * 0.9 * (1 + 1.5 * bl) + Math.sin(f.y / (46 * d) + t * 1.6 + f.ph) * 1.4 * gN * bl + Math.cos(t * om + f.ph) * rr2) * d * s;
          var vy2 = fv * (1 - 0.45 * gN * bl * (0.5 + 0.5 * Math.sin(t * 1.9 + f.ph))) + Math.sin(t * om + f.ph) * rr2 * d * s;
          f.x += vx2; f.y += vy2;
          if (bl && !rm && s > 0) {   // метель: штрих вдоль движения (короткий шлейф)
            var vl = Math.max(1e-3, Math.sqrt(vx2 * vx2 + vy2 * vy2)), ln2 = (6 + 10 * f.z) * d;
            pctx.strokeStyle = 'rgba(' + sc[0] + ',' + sc[1] + ',' + sc[2] + ',' + (0.8 * snowK * (0.4 + 0.6 * f.z)).toFixed(3) + ')';
            pctx.lineWidth = (1 + 1.6 * f.z) * d; pctx.lineCap = 'round';
            pctx.beginPath(); pctx.moveTo(f.x, f.y); pctx.lineTo(f.x - vx2 / vl * ln2, f.y - vy2 / vl * ln2); pctx.stroke();
          }
        } else {
        f.y += fv; f.x += (Math.sin(t * 0.9 + f.ph) * 0.5 + (wx.wind - 1) * 0.9 * (1 + 1.5 * bl)) * d * s;
        if (bl && !rm) {   // метель: снежинка — короткий косой штрих
          pctx.strokeStyle = 'rgba(' + sc[0] + ',' + sc[1] + ',' + sc[2] + ',' + (0.8 * snowK * (0.4 + 0.6 * f.z)).toFixed(3) + ')';
          pctx.lineWidth = (1 + 1.6 * f.z) * d; pctx.lineCap = 'round';
          pctx.beginPath(); pctx.moveTo(f.x, f.y); pctx.lineTo(f.x - (6 + 10 * f.z) * d, f.y - (2 + 3 * f.z) * d); pctx.stroke();
        }
        }
        if (f.y < -8 * d) f.y += H + 8 * d;
        if (f.y > H) { f.y = -4 * d; f.x = pRng() * W; }
        if (f.x > W) f.x -= W; if (f.x < 0) f.x += W;
        pctx.fillStyle = 'rgba(' + sc[0] + ',' + sc[1] + ',' + sc[2] + ',' + (sc[3] * snowK * (0.5 + 0.5 * f.z)).toFixed(3) + ')';
        pctx.strokeStyle = 'rgba(70,78,96,' + (0.5 * snowK * (0.4 + 0.6 * f.z)).toFixed(3) + ')';   // тонкий карандашный контур — снежинка видна и на светлом небе
        pctx.lineWidth = 0.8 * d;
        pctx.beginPath(); pctx.arc(f.x, f.y, (1.3 + 2.2 * f.z) * d, 0, 6.2832); pctx.fill(); pctx.stroke();
      }
    }
    if (GUSTS) { drawGustLeaves(now, s, d, W, H, area, lite, leafK, rm); return; }
    // ветер: листья летят слева направо, кувыркаясь (карандашный контур + зелёно-охристая заливка)
    var nL = Math.round(leafK * 26 * area * lite);
    while (leaves.length < nL) leaves.push({ x: -pRng() * W * 0.5, y: pRng() * H * 0.9, z: 0.4 + 0.6 * pRng(), ph: pRng() * 6.28, sp: pRng() * 6.28, hue: pRng() });
    if (leaves.length > nL && leaves.length) leaves.length = nL;
    var tl = now / 1000, nightL = 1 - 0.55 * tod.night;
    for (var li = 0; li < leaves.length; li++) {
      var lf = leaves[li], lv = (2.2 + 3.2 * lf.z) * (wx.wind / 2.4) * d * s;
      lf.x += lv; lf.y += (Math.sin(tl * 2.1 + lf.ph) * 1.1 + 0.35) * d * s; lf.sp += 0.09 * s * (0.6 + lf.z);
      if (lf.x > W + 20 * d || lf.y > H) { lf.x = -20 * d - pRng() * W * 0.3; lf.y = pRng() * H * 0.8; }
      var ls = (3 + 4 * lf.z) * d, gC = lf.hue < 0.5 ? [120, 138, 70] : [176, 132, 58];
      pctx.save(); pctx.translate(lf.x, lf.y); pctx.rotate(lf.sp); pctx.scale(1, 0.35 + 0.65 * Math.abs(Math.sin(lf.sp * 1.3)));
      pctx.fillStyle = 'rgba(' + gC.map(function (c) { return Math.round(c * nightL); }).join(',') + ',' + (0.85 * leafK).toFixed(3) + ')';
      pctx.strokeStyle = 'rgba(47,42,37,' + (0.7 * leafK).toFixed(3) + ')'; pctx.lineWidth = 0.8 * d;
      pctx.beginPath(); pctx.ellipse(0, 0, ls, ls * 0.45, 0, 0, 6.2832); pctx.fill(); pctx.stroke();
      pctx.beginPath(); pctx.moveTo(-ls, 0); pctx.lineTo(ls, 0); pctx.stroke();
      pctx.restore();
    }
  }

  // e1.25 GUSTS: листья гроздьями. В начале порыва (wx.gRise) из-за левого края вылетает стайка 7–16 листьев; каждый лист — тело
  // с сопротивлением воздуха: скорость тянется к скорости ветра (быстро в порыв, медленно после), в порыв его подхватывает вверх,
  // без порыва он тормозит и опускается, покачиваясь. Кувыркается тем быстрее, чем быстрее летит; быстрому — короткий шлейф.
  function drawGustLeaves(now, s, d, W, H, area, lite, leafK, rm) {
    var tl = now / 1000, nightL = 1 - 0.55 * tod.night, gN = wx.gust, la = 1 - clamp(wx.cur[3] * 1.4, 0, 1);   // снег пошёл — листья, что ещё летят, тают
    if (la < 0.01) { leaves.length = 0; return; }
    if (leafK > 0.01 && !rm && wx.gRise && wx.gRise !== wx.gRiseDone) {
      wx.gRiseDone = wx.gRise;
      var nC = Math.round((7 + 9 * pRng()) * leafK * Math.min(1.6, area) * lite), cy = H * (0.18 + 0.45 * pRng());
      for (var c2 = 0; c2 < nC; c2++) leaves.push({ x: -12 * d - pRng() * W * 0.22, y: cy + (pRng() - 0.5) * H * 0.18, vx: 0, vy: 0, z: 0.4 + 0.6 * pRng(), ph: pRng() * 6.28, sp: pRng() * 6.28, hue: pRng() });
    }
    if (leafK > 0.01 && !rm && leaves.length < 40 && pRng() < 0.004 * leafK * s)   // между порывами — редкий одиночный лист
      leaves.push({ x: -12 * d, y: H * (0.2 + 0.5 * pRng()), vx: 0, vy: 0, z: 0.4 + 0.6 * pRng(), ph: pRng() * 6.28, sp: pRng() * 6.28, hue: pRng() });
    var kD = 1 - Math.pow(1 - 0.05, s);
    for (var li = leaves.length - 1; li >= 0; li--) {
      var lf = leaves[li];
      if (lf.vx === undefined) { lf.vx = 0; lf.vy = 0; }
      var turb = Math.sin(tl * 1.7 + lf.ph) * 0.6 + Math.sin(tl * 3.1 + lf.ph * 2) * 0.3;
      var tx = (0.5 + 5.5 * gN) * (0.6 + 0.6 * lf.z) * (1 + 0.25 * turb) * d;
      var ty = (0.8 - 2.4 * gN * (0.5 + 0.5 * Math.sin(tl * 1.3 + lf.ph))) * (0.6 + 0.4 * lf.z) * d;
      lf.vx += (tx - lf.vx) * kD; lf.vy += (ty - lf.vy) * kD;
      lf.x += lf.vx * s; lf.y += (lf.vy + Math.sin(tl * 2.1 + lf.ph) * 0.7 * d) * s;
      lf.sp += (0.03 + 0.035 * Math.abs(lf.vx) / d) * s * (0.6 + lf.z);
      if (lf.x > W + 30 * d || lf.y > H + 20 * d || lf.y < -H * 0.3) { leaves.splice(li, 1); continue; }
      if (LEAF) { drawLeaf(lf, d, nightL, la); continue; }   // e1.26: мелкий чёткий лист по сезону сцены
      var ls = (3 + 4 * lf.z) * d, gC = lf.hue < 0.5 ? [120, 138, 70] : [176, 132, 58], fc = gC.map(function (c) { return Math.round(c * nightL); }).join(',');
      if (Math.abs(lf.vx) > 3 * d) {   // шлейф: при 60 Гц заполняет промежуток между кадрами
        pctx.strokeStyle = 'rgba(' + fc + ',' + (0.18 * la).toFixed(3) + ')'; pctx.lineWidth = ls * 0.7; pctx.lineCap = 'round';
        pctx.beginPath(); pctx.moveTo(lf.x - lf.vx * 1.4, lf.y - lf.vy * 1.4); pctx.lineTo(lf.x, lf.y); pctx.stroke();
      }
      pctx.save(); pctx.translate(lf.x, lf.y); pctx.rotate(lf.sp); pctx.scale(1, 0.35 + 0.65 * Math.abs(Math.sin(lf.sp * 1.3)));
      pctx.fillStyle = 'rgba(' + fc + ',' + (0.85 * la).toFixed(3) + ')';
      pctx.strokeStyle = 'rgba(47,42,37,' + (0.7 * la).toFixed(3) + ')'; pctx.lineWidth = 0.8 * d;
      pctx.beginPath(); pctx.ellipse(0, 0, ls, ls * 0.45, 0, 0, 6.2832); pctx.fill(); pctx.stroke();
      pctx.beginPath(); pctx.moveTo(-ls, 0); pctx.lineTo(ls, 0); pctx.stroke();
      pctx.restore();
    }
  }

  // e1.26 (s23, look.gusts.leaves): летящий лист — не размытое пятно-эллипс со шлейфом, а мелкий чёткий листок рисунка:
  // заострённая форма (две дуги), карандашный контур 0,6 px, жилка и черешок; цвет — из палитры сцены по долям (сезон кадров),
  // длина size[0..1] css px. Кувыркание — поворот и «сплющивание» (лист поворачивается ребром), без шлейфа.
  var LEAF = GUSTS && GUSTS.leaves ? GUSTS.leaves : null;
  function leafColor(h) {
    var cl = LEAF.colors, tot = 0, i;
    for (i = 0; i < cl.length; i++) tot += cl[i][3];
    var t = h * tot;
    for (i = 0; i < cl.length; i++) { t -= cl[i][3]; if (t <= 0) return cl[i]; }
    return cl[cl.length - 1];
  }
  function drawLeaf(lf, d, nightL, la) {
    var c = leafColor(lf.hue), L = (LEAF.size[0] + (LEAF.size[1] - LEAF.size[0]) * lf.z) * d * 0.5, W = L * 0.42;
    var fc = Math.round(c[0] * nightL) + ',' + Math.round(c[1] * nightL) + ',' + Math.round(c[2] * nightL);
    pctx.save(); pctx.translate(lf.x, lf.y); pctx.rotate(lf.sp); pctx.scale(1, 0.25 + 0.75 * Math.abs(Math.sin(lf.sp * 1.3)));
    pctx.beginPath(); pctx.moveTo(-L, 0); pctx.quadraticCurveTo(-0.1 * L, -2 * W, L, 0); pctx.quadraticCurveTo(-0.1 * L, 2 * W, -L, 0); pctx.closePath();
    pctx.fillStyle = 'rgba(' + fc + ',' + (0.95 * la).toFixed(3) + ')'; pctx.fill();
    pctx.lineWidth = 0.6 * d; pctx.lineJoin = 'round'; pctx.strokeStyle = 'rgba(40,36,30,' + (0.6 * la).toFixed(3) + ')'; pctx.stroke();
    pctx.beginPath(); pctx.moveTo(-1.45 * L, 0); pctx.lineTo(0.75 * L, 0);   // черешок и жилка
    pctx.lineWidth = 0.45 * d; pctx.strokeStyle = 'rgba(40,36,30,' + (0.55 * la).toFixed(3) + ')'; pctx.stroke();
    pctx.restore();
  }

  // миниатюры кадров
  function buildThumbs() {
    thumbsEl.innerHTML = '';
    FRAMES.forEach(function (_, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = i === frameIndex ? 'on' : '';
      b.setAttribute('aria-label', (i + 1) + ' / ' + FRAMES.length);
      var im = new Image();
      im.alt = ''; if (store[i]) im.src = store[i].thumb;
      b.appendChild(im);
      var nm = document.createElement('span'); nm.className = 'th-num'; nm.textContent = String(i + 1); b.appendChild(nm);   // номер кадра
      b.style.setProperty('--c', i);
      b.addEventListener('click', function () { goTo(i); });
      thumbsEl.appendChild(b);
    });
  }
  window.__fillThumb = function (i) {   // кадр догрузился в фоне — показываем его миниатюру
    var b = thumbsEl && thumbsEl.children[i];
    if (b && b.firstChild && !b.firstChild.getAttribute('src') && store[i]) b.firstChild.src = store[i].thumb;
  };

  // полный экран
  var fsBtn = document.getElementById('fsBtn');
  // iPhone (iOS Safari) полноэкранный режим для страниц не поддерживает — кнопку прячем. iPad и остальные — работают.
  var isIPhone = /iPhone|iPod/.test(navigator.userAgent);
  var fsApi = !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);
  var immExitEl = document.getElementById('immExit'), immT = 0;
  function immersive(on) {
    bodyEl.classList.toggle('immersive', on); bodyEl.classList.remove('imm-idle');
    clearTimeout(immT); if (on) immT = setTimeout(function () { bodyEl.classList.add('imm-idle'); }, 2500);
  }
  if (immExitEl) immExitEl.addEventListener('click', function () { immersive(false); });
  stage.addEventListener('pointerdown', function () { if (bodyEl.classList.contains('immersive')) { bodyEl.classList.remove('imm-idle'); clearTimeout(immT); immT = setTimeout(function () { bodyEl.classList.add('imm-idle'); }, 2500); } });
  if (isIPhone && fsBtn) {   // Safari на iPhone не даёт полный экран страницам — кнопка включает «только картинку»
    fsBtn.addEventListener('click', function () { closeSheet(); setTimeout(function () { immersive(true); }, 400); });
  } else if (!fsApi || !(document.fullscreenEnabled || document.webkitFullscreenEnabled)) {
    fsBtn.hidden = true;
    fsBtn.parentNode.hidden = true;   // и её пустая секция в панели
  }
  fsBtn.addEventListener('click', function () {
    if (isIPhone) return;   // на iPhone — «только картинка» (выше)
    var el = document.documentElement;
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    } else {
      (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
    }
  });
  // Вход и выход (кнопка, Esc, жест) меняют размер окна: пересчитываем картинку, точки и панель.
  // Размеры устаканиваются не сразу (особенно в Safari на iPad), поэтому пересчёт идёт несколько раз.
  function onFullscreenChange() {
    closePopup();
    [0, 120, 400].forEach(function (ms) {
      setTimeout(function () { resize(true); }, ms);   // точки-подсказки пересчитываются в каждом кадре сами
    });
  }
  document.addEventListener('fullscreenchange', onFullscreenChange);
  document.addEventListener('webkitfullscreenchange', onFullscreenChange);

  // ---------- открытка «в сторис» (e1.27 s26 → e1.28 9б-1) ----------
  // Кнопка «Открытка» (пара с «Во весь экран») открывает окно: на телефоне — шторка снизу (тянется вниз за ручку — закрыть), на ПК — по центру.
  // В окне — живое превью (кадр с экрана в момент открытия: время суток, погода, снег, облака, птицы; табличка, штемпель — engine/postcard.js),
  // большая «Сохранить» (телефон — системное «Поделиться» с JPEG, там «Сохранить изображение»; ПК и без Web Share — PNG) и настройки группами:
  // «Дата» (сегодня / мой год — год на штемпеле), «Подпись» (язык, своя строка, старая плёнка). Группы «Момент» и «Оборот» — 9б-2 (CARD_GROUPS).
  // Номер экспоната — building.json → postcard.no; редкая открытка — особая погода (ночь + снег, закат + дождь/снег, ночь + туман, метель, парад)
  // или «повезло» (1 из 15 по зерну окна): красный штемпель и «✦ РЕДКАЯ» на табличке.
  // «Сохранить» отдаёт ГОТОВУЮ открытку из превью СИНХРОННО в обработчике нажатия (toDataURL, без ожиданий) — иначе iOS теряет «жест» и не
  // открывает меню; не вышло (шрифты не успели) — плашка «Открытка готова» со вторым нажатием.
  var cardBtn = document.getElementById('cardBtn'), cardGo = document.getElementById('cardGo');
  var cardCfg = document.getElementById('cardCfg'), cardPrev = document.getElementById('cardPrev'), cardPrevOld = document.getElementById('cardPrevOld'), cardLineIn = document.getElementById('cardLine');
  var cardToast = document.getElementById('cardToast'), cardFlash = document.getElementById('cardFlash');
  var cardYearIn = document.getElementById('cardYear'), cardYearOut = document.getElementById('cardYearOut');
  var CARD_FONT = '"Chka Serif", "Noto Serif", serif';
  var CARD_SAMPLE = { hy: 'Երևան Կուկուռուզնիկ 0123', ru: 'Ереван Памятник 0123', en: 'Yerevan Monument 0123' };
  var CARD_GROUPS = { moment: true, date: true, sign: true, back: true };   // e1.29 (9б-2): «Момент» и «Оборот» включены (оборот — по умолчанию выкл.)
  Object.keys(CARD_GROUPS).forEach(function (k) { var g = cardCfg && cardCfg.querySelector('[data-grp="' + k + '"]'); if (g) g.hidden = !CARD_GROUPS[k]; });
  if (!useGL || !window.ChkaPostcard) { cardBtn.hidden = true; cardBtn.parentNode.hidden = true; }
  (function () { var a = document.getElementById('pActs'); if (a) a.classList.toggle('solo', !!(fsBtn.parentNode.hidden || cardBtn.parentNode.hidden)); })();   // одна кнопка — во всю ширину
  var CARD_YEARS = (function () {   // «мой год» — в пределах жизни здания (годы с таблички), не позже текущего
    var y = (CONFIG.POSTCARD || {}).years, now = new Date().getFullYear();
    y = y && typeof y === 'object' ? (y.en || y.ru || y.hy) : y;
    var m = /(\d{4})\D+(\d{4})/.exec(String(y || ''));
    var a = m ? +m[1] : 1900, b = m ? Math.min(+m[2], now) : now;
    return b > a ? [a, b] : [1900, now];
  })();
  var cardSet = (function () { var s = null; try { s = JSON.parse(lsGet('chka-card') || 'null'); } catch (e) {} s = s && typeof s === 'object' ? s : {};
    var yr = Math.round(+s.year); yr = yr >= CARD_YEARS[0] && yr <= CARD_YEARS[1] ? yr : null;
    return { lang: CONFIG.LANGS.indexOf(s.lang) >= 0 ? s.lang : null, line: typeof s.line === 'string' ? s.line.slice(0, 40) : '', film: !!s.film,
      date: s.date === 'year' ? 'year' : 'today', year: yr, back: !!s.back }; })();
  function cardSave() { lsSet('chka-card', JSON.stringify(cardSet)); }
  function cardLang() { return cardSet.lang || currentLang; }
  function cardYear() { return cardSet.year || Math.round((CARD_YEARS[0] + CARD_YEARS[1]) / 2); }
  function cardNo() { var n = Math.round(+(CONFIG.POSTCARD || {}).no); return n > 0 ? (n < 10 ? '00' : n < 100 ? '0' : '') + n : ''; }
  var shareOK = !!(navigator.share && navigator.canShare) && window.matchMedia('(pointer: coarse)').matches;   // ПК — скачивание файла
  function cardFontsReady(lang) {
    if (!document.fonts || !document.fonts.check) return true;
    var t = CARD_SAMPLE[lang] || CARD_SAMPLE.en;
    try { return document.fonts.check('700 40px ' + CARD_FONT, t) && document.fonts.check('400 40px ' + CARD_FONT, t); } catch (e) { return true; }
  }
  function cardFontsLoad() {   // шрифты всех трёх письменностей — заранее, чтобы нажатие не ждало сети
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    var all = [];
    CONFIG.LANGS.forEach(function (l) { ['400', '500', '600', '700'].forEach(function (w) { all.push(document.fonts.load(w + ' 40px ' + CARD_FONT, CARD_SAMPLE[l] || '').catch(function () {})); }); });
    return Promise.all(all);
  }
  function cardInfo(lang) {   // данные таблички — из building.json (postcard); старое здание без них — название из панели
    var P = CONFIG.POSTCARD || {};
    var tx = function (v) { return v && typeof v === 'object' ? (v[lang] || v.en || '') : (v || ''); };
    return { name: tx(P.name) || CONFIG.UI_I18N.panelTitle[lang], years: tx(P.years), url: P.url || 'chka.am' };
  }
  function cardTodName() { var b = document.querySelector('#todSeg .chip.on'); return b ? b.getAttribute('data-tod') : 'day'; }
  function sceneRare() {   // особая погода — редкая открытка
    var t = cardTodName(), n = t === 'night', ss = t === 'sunset';
    return !!((n && wxOn.snow) || (ss && (wxOn.snow || wxOn.rain)) || (n && wxOn.fog) || (wxOn.snow && windIdx === 2) || paradeBusy || (window.Details && window.Details.paradeBusy && window.Details.paradeBusy()));
  }
  // кадр с экрана → холст 1080×1920 (cover). null — рисовать нечем (нет WebGL / потерян контекст / первый кадр ещё не нарисован)
  function captureView() {
    if (!useGL || glLost || !lastDraw) return null;
    var d = lastDraw, PW = ChkaPostcard.W, PH = ChkaPostcard.H;
    // Буфер WebGL читается только сразу после отрисовки — рисуем ещё раз (крупнее: ≥ 1080 по ширине) и копируем тут же.
    var W0 = canvas.width, H0 = canvas.height, kq = clamp(PW / W0, 1, 2.5);
    if (kq > 1) { canvas.width = Math.round(W0 * kq); canvas.height = Math.round(H0 * kq); }
    drawGL(d.fa, d.fb, d.mix, d.shiftX, d.shiftY, d.zoom, d.t, d.tAmb);
    var W = canvas.width, H = canvas.height, s = Math.max(PW / W, PH / H), sw = PW / s, sh = PH / s, sx = (W - sw) / 2, sy = (H - sh) / 2;
    var out = document.createElement('canvas'); out.width = PW; out.height = PH;
    var x = out.getContext('2d'); x.imageSmoothingQuality = 'high';
    x.drawImage(canvas, sx, sy, sw, sh, 0, 0, PW, PH);
    ['fxCanvas', 'wxCanvas'].forEach(function (id) {   // облака, солнце, птицы, дождь и снег — тем же вырезом
      var o = document.getElementById(id); if (!o || o.style.display === 'none' || !o.width) return;
      var kx = o.width / W, ky = o.height / H;
      x.drawImage(o, sx * kx, sy * ky, sw * kx, sh * ky, 0, 0, PW, PH);
    });
    if (kq > 1) { canvas.width = W0; canvas.height = H0; }   // следующий кадр цикла перерисует холст
    return out;
  }
  // Карта «здание» для открытки (s27): альфа слоя здания кадра (тот же файл, что у движка — из кэша), спроецированная в открытку 108×192
  // тем же сдвигом, что на экране (projectB). По ней штемпель и табличка обходят памятник. Слои грузятся заранее, в простое; не загрузился — null.
  var cardBld = {};   // индекс кадра → { c: холст-альфа 144 px } | 'loading' | null
  function cardBldLoad(i) {
    var F = FRAMES[i];
    if (i in cardBld || !F || !F.building || !F.building.color) return;
    cardBld[i] = 'loading';
    var im = new Image(); im.crossOrigin = 'anonymous';
    im.onload = function () {
      try { var w = 144, h = Math.max(1, Math.round(w * im.naturalHeight / im.naturalWidth)), c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(im, 0, 0, w, h); cardBld[i] = { c: c }; }
      catch (e) { cardBld[i] = null; }
    };
    im.onerror = function () { cardBld[i] = null; };
    im.src = F.building.color;
  }
  function cardBuildingMask() {
    if (!lastDraw) return null;
    var d = lastDraw, PW = ChkaPostcard.W, PH = ChkaPostcard.H, MW = 108, MH = 192, cw = stage.clientWidth, ch = stage.clientHeight;
    var s = Math.max(PW / cw, PH / ch), sx = (cw - PW / s) / 2, sy = (ch - PH / s) / 2;   // тот же cover-вырез, что у captureView (в px сцены)
    var cv = document.createElement('canvas'); cv.width = MW; cv.height = MH;
    var x = cv.getContext('2d', { willReadFrequently: true }), out = new Uint8Array(MW * MH), any = false;
    [d.fa, d.mix > 0.02 ? d.fb : null].forEach(function (f) {
      if (!f) return;
      var m = cardBld[f.idx]; cardBldLoad(f.idx);
      if (!m || m === 'loading') return;
      var p0 = window.__viewer.projectB(f, 0, 0), p1 = window.__viewer.projectB(f, 1, 1);
      x.clearRect(0, 0, MW, MH);
      x.drawImage(m.c, (p0[0] - sx) * s * MW / PW, (p0[1] - sy) * s * MH / PH, (p1[0] - p0[0]) * s * MW / PW, (p1[1] - p0[1]) * s * MH / PH);
      var a = x.getImageData(0, 0, MW, MH).data;
      for (var i = 0; i < out.length; i++) if (a[i * 4 + 3] > out[i]) { out[i] = a[i * 4 + 3]; any = true; }
    });
    return any ? out : null;
  }
  var cfg = { src: null, mask: null, seed: undefined, rare: false, code: '', card: null, back: null, t: 0, pend: false };   // окно: снимок кадра, зерно, редкость, личный номер — одни на всё окно
  // «Момент» (e1.29): ползунок 0…4 = рассвет, день, закат, синий час, ночь → время суток движка p (0 день, 1 закат, 2.1667 ночь) и часы на штемпеле.
  // Своего рассвета у движка нет: рассвет = p 0,5 (полузакатный тёплый свет); синий час = p 1,55 (небо уже ночное, земля в сумерках, огни только зажигаются).
  var MOM_P = [0.5, 0, 1, 1.55, 2.1667], MOM_MIN = [370, 780, 1160, 1215, 1410], MOM_KEY = ['cardDawn', 'day', 'sunset', 'cardBlue', 'night'];   // 06:10 13:00 19:20 20:15 23:30
  var momS = null;   // null — ползунок не трогали: показывает время суток сцены
  function momTab(T, v) { v = clamp(v, 0, 4); var i = Math.min(3, Math.floor(v)), f = v - i; return T[i] + (T[i + 1] - T[i]) * f; }
  function momFromP(p) { if (p <= 0.001) return 1; if (p <= 1) return 1 + p; if (p <= 1.55) return 2 + (p - 1) / 0.55; return Math.min(4, 3 + (p - 1.55) / (2.1667 - 1.55)); }
  function momNow() { return momS != null ? momS : momFromP(todAnim ? todAnim.p1 : tod.p); }
  function cardTime() { var m = Math.round(momTab(MOM_MIN, momNow())), h = Math.floor(m / 60) % 24, mm = m % 60; return (h < 10 ? '0' : '') + h + ':' + (mm < 10 ? '0' : '') + mm; }
  function composeCard(src, extra) {
    var lang = cardLang(), info = cardInfo(lang), U = CONFIG.UI_I18N;
    var o = { lang: lang, name: info.name, years: info.years, url: info.url, line: cardSet.line.trim(), film: cardSet.film, font: CARD_FONT,
      mask: cfg.mask !== null ? cfg.mask : cardBuildingMask(), no: cardNo(), noLabel: U.cardExhibit[lang], rare: cfg.rare, rareLabel: U.cardRare[lang],
      year: cardSet.date === 'year' ? cardYear() : null, seed: cfg.seed, code: cfg.code, time: cardTime() };
    if (extra) Object.keys(extra).forEach(function (k) { if (extra[k] !== undefined) o[k] = extra[k]; });
    return o.back ? ChkaPostcard.composeBack(src, o) : ChkaPostcard.compose(src, o);
  }
  function cardName(ext) { return String(CONFIG.POSTCARD_FILE || 'chka.png').replace(/\.png$/i, '') + ext; }
  function fileFromCanvas(cv, back) {   // синхронно (toDataURL): между нажатием и share не должно быть ожиданий
    var u = cv.toDataURL('image/jpeg', 0.92), b = atob(u.slice(u.indexOf(',') + 1)), a = new Uint8Array(b.length);
    for (var i = 0; i < b.length; i++) a[i] = b.charCodeAt(i);
    return new File([a], cardName(back ? '-back.jpg' : '.jpg'), { type: 'image/jpeg', lastModified: Date.now() });
  }
  function downloadBlob(blob, name) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
  }
  var toastT = 0, toastFile = null;
  function hideToast() { clearTimeout(toastT); toastFile = null; if (cardToast) cardToast.classList.remove('on'); }
  function showToast(file) {   // file — файл или список файлов (лицо + оборот)   // share не открылся без жеста (ждали шрифты) — второе нажатие по плашке откроет его наверняка
    toastFile = file; if (!cardToast) return;
    cardToast.querySelector('span').textContent = CONFIG.UI_I18N.cardReady[currentLang];
    cardToast.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(hideToast, 9000);
  }
  function shareFile(file) {
    var files = Array.isArray(file) ? file : [file], p;
    try { p = navigator.share({ files: files }); } catch (e) { p = Promise.reject(e); }
    return p.then(hideToast, function (e) {
      if (e && e.name === 'AbortError') { hideToast(); return; }           // человек закрыл меню сам
      if (e && e.name === 'NotAllowedError') { showToast(files); return; }   // нет жеста — плашка «Открытка готова»
      hideToast(); files.forEach(function (f) { downloadBlob(f, f.name); });
    });
  }
  // отдать открытку: телефон — меню «Поделиться» (Сохранить изображение / Instagram / TikTok) с одним файлом или двумя (лицо + оборот, e1.29);
  // ПК — PNG-файл (с оборотом — два PNG)
  function deliverCard(cv, back) {
    if (shareOK) {
      var fs = [fileFromCanvas(cv)];
      if (back) fs.push(fileFromCanvas(back, true));
      if (navigator.canShare({ files: fs })) return shareFile(fs);
      if (fs.length > 1 && navigator.canShare({ files: [fs[0]] })) return shareFile([fs[0]]);   // два файла не умеет — хотя бы лицо
    }
    cv.toBlob(function (blob) { if (blob) downloadBlob(blob, cardName('.png')); }, 'image/png');
    if (back) back.toBlob(function (blob) { if (blob) downloadBlob(blob, cardName('-back.png')); }, 'image/png');
  }
  function cardFlashNow() { if (cardFlash && cardFlash.animate) cardFlash.animate([{ opacity: reduced() ? 0.35 : 0.75 }, { opacity: 0 }], { duration: reduced() ? 380 : 620, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }); }
  function goDone() { cardGo.classList.add('done'); clearTimeout(cardGo.__t); cardGo.__t = setTimeout(function () { cardGo.classList.remove('done'); }, 1600); }
  if (cardToast) cardToast.addEventListener('click', function () { if (toastFile) shareFile(toastFile); });

  // окно: отметки, превью (новое проявляется поверх старого), год
  function cfgMarks() {
    cardCfg.querySelectorAll('[data-clang]').forEach(function (b) { var on = b.getAttribute('data-clang') === cardLang(); b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    cardCfg.querySelectorAll('[data-cdate]').forEach(function (b) { var on = b.getAttribute('data-cdate') === cardSet.date; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    cardCfg.classList.toggle('cc-yr', cardSet.date === 'year');
    var fb = document.getElementById('cardFilm'); fb.classList.toggle('on', cardSet.film); fb.setAttribute('aria-pressed', cardSet.film ? 'true' : 'false');
    var cn = document.getElementById('cardLineN'); if (cn) cn.textContent = cardSet.line.length + ' / 40';
    if (cardYearIn) { cardYearIn.min = CARD_YEARS[0]; cardYearIn.max = CARD_YEARS[1]; cardYearIn.value = cardYear(); }
    if (cardYearOut) cardYearOut.textContent = cardYear();
  }
  function cfgMeta() {   // плашки под «Сохранить»: номер экспоната (язык страницы), «редкая»
    var U = CONFIG.UI_I18N, no = cardNo(), nb = document.getElementById('cardNo'), rb = document.getElementById('cardRareB');
    if (nb) { nb.hidden = !no && !cfg.code; nb.textContent = (no ? U.cardExhibit[currentLang] + ' № ' + no : '') + (cfg.code ? (no ? ' · ' : '№ ') + cfg.code : ''); nb.title = U.cardCode[currentLang]; }
    if (rb) { var was = !rb.hidden; rb.hidden = !cfg.rare; if (cfg.rare && !was) { rb.classList.remove('pop'); void rb.offsetWidth; rb.classList.add('pop'); } }
  }
  function cfgRender(fade) {
    cfg.pend = false; clearTimeout(cfg.t);
    if (!cfg.src) return;
    if (!cardFontsReady(cardLang())) { cardFontsLoad().then(function () { if (bodyEl.classList.contains('card-open')) cfgRender(fade); }); return; }
    cfg.card = composeCard(cfg.src);
    cfg.back = cardSet.back ? composeCard(cfg.src, { back: true }) : null;
    if (cardPrevBack) {   // оборот выглядывает из-за превью
      cardPrevBack.parentNode.classList.toggle('cc-has-back', !!cfg.back);
      if (cfg.back) { var bx = cardPrevBack.getContext('2d'); bx.imageSmoothingQuality = 'high'; bx.drawImage(cfg.back, 0, 0, cardPrevBack.width, cardPrevBack.height); }
    }
    var pw = cardPrev.width, ph = cardPrev.height;
    if (fade && cardPrevOld && cardPrevOld.animate) {   // старое превью гаснет поверх нового — смена без мигания
      var ox = cardPrevOld.getContext('2d'); ox.clearRect(0, 0, pw, ph); ox.drawImage(cardPrev, 0, 0);
      cardPrevOld.animate([{ opacity: 1 }, { opacity: 0 }], { duration: reduced() ? 160 : 300, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
    }
    var px = cardPrev.getContext('2d'); px.imageSmoothingQuality = 'high';
    px.drawImage(cfg.card, 0, 0, pw, ph);
  }
  function cfgLater() { cfg.pend = true; clearTimeout(cfg.t); cfg.t = setTimeout(function () { cfgRender(true); }, 140); }
  var cfgHideT = 0;
  function openCfg() {
    if (!window.ChkaPostcard) return;
    var src = captureView(); if (!src) return;
    cfg.src = src; cfg.mask = cardBuildingMask(); cfg.card = null;
    cfg.seed = ChkaPostcard.seed ? ChkaPostcard.seed() : undefined;
    cfg.rare = sceneRare() || !!(ChkaPostcard.luck && ChkaPostcard.luck(cfg.seed));
    cfg.code = ChkaPostcard.code ? ChkaPostcard.code(cfg.seed) : '';
    bodyEl.classList.remove('card-aim');
    var dp = Math.min(2, window.devicePixelRatio || 1);
    [cardPrev, cardPrevOld, cardPrevBack].forEach(function (c) { if (c) { c.width = Math.round(180 * dp); c.height = Math.round(320 * dp); } });
    cardLineIn.value = cardSet.line; cfgMarks(); cfgMeta(); momMarks();
    hideToast();
    document.documentElement.classList.add('panel-anim');
    clearTimeout(cfgHideT); cardCfg.classList.remove('cc-fling', 'cc-drag-on'); cardCfg.style.transform = '';
    cardCfg.hidden = false; void cardCfg.offsetWidth;   // переход с текущего положения (закрыли посреди открытия — откроется от того места)
    bodyEl.classList.add('card-open');
    cardFlashNow();   // «щёлк» — снимок кадра взят
    cfgRender(false);
  }
  function closeCfg(fling) {
    if (!bodyEl.classList.contains('card-open')) return;
    cardCfg.classList.remove('cc-drag-on'); cardCfg.classList.toggle('cc-fling', !!fling);
    cardCfg.style.transform = '';
    bodyEl.classList.remove('card-open'); clearTimeout(cfg.t); cfg.pend = false; recapT.forEach(clearTimeout); recapT = [];
    clearTimeout(cfgHideT); cfgHideT = setTimeout(function () { cardCfg.classList.remove('cc-fling'); }, 400);
    if (cardLineIn === document.activeElement) cardLineIn.blur();
  }
  cardBtn.addEventListener('click', openCfg);
  document.getElementById('cardCfgClose').addEventListener('click', function () { closeCfg(); });
  document.getElementById('cardScrim').addEventListener('click', function () { closeCfg(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && bodyEl.classList.contains('card-open')) closeCfg(); });
  // телефон: шторку тянут вниз за ручку/заголовок — палец ведёт её 1:1 (вверх — с сопротивлением); отпустили ниже 110 px или быстрым
  // движением — уезжает (от текущего положения, с затуханием), иначе пружиной возвращается
  (function () {
    var zone = cardCfg.querySelector('.cc-drag'), y0 = null, dy = 0, hist = [];
    if (!zone) return;
    zone.addEventListener('pointerdown', function (e) {
      if (desktopMQ.matches || !bodyEl.classList.contains('card-open') || (e.target.closest && e.target.closest('button'))) return;
      y0 = e.clientY; dy = 0; hist = [[e.timeStamp, e.clientY]];
      cardCfg.classList.add('cc-drag-on');
      try { zone.setPointerCapture(e.pointerId); } catch (_) {}
    });
    zone.addEventListener('pointermove', function (e) {
      if (y0 === null) return;
      dy = e.clientY - y0; hist.push([e.timeStamp, e.clientY]); if (hist.length > 6) hist.shift();
      cardCfg.style.transform = 'translateY(' + (dy > 0 ? dy : -Math.sqrt(-dy) * 2) + 'px)';
    });
    function end() {
      if (y0 === null) return;
      y0 = null;
      var a = hist[0], b = hist[hist.length - 1], v = b && a && b[0] > a[0] ? (b[1] - a[1]) / (b[0] - a[0]) : 0;   // px/мс
      if (dy > 110 || (v > 0.5 && dy > 16)) closeCfg(true);
      else { cardCfg.classList.remove('cc-drag-on'); cardCfg.style.transform = ''; }
    }
    zone.addEventListener('pointerup', end); zone.addEventListener('pointercancel', end);
  })();
  cardCfg.querySelectorAll('[data-clang]').forEach(function (b) {
    b.addEventListener('click', function () { cardSet.lang = b.getAttribute('data-clang'); cardSave(); cfgMarks(); cfgRender(true); });
  });
  cardCfg.querySelectorAll('[data-cdate]').forEach(function (b) {
    b.addEventListener('click', function () { cardSet.date = b.getAttribute('data-cdate'); cardSave(); cfgMarks(); cfgRender(true); });
  });
  function setYear(v, now) {
    v = clamp(Math.round(v), CARD_YEARS[0], CARD_YEARS[1]);
    var ch = v !== cardYear() || cardSet.date !== 'year';
    cardSet.year = v; cardSet.date = 'year'; cardSave(); cfgMarks();   // тронули год — значит «мой год»
    if (cardYearOut && ch) { cardYearOut.classList.remove('tick'); void cardYearOut.offsetWidth; cardYearOut.classList.add('tick'); }
    if (ch) { if (now) cfgRender(true); else cfgLater(); }
  }
  if (cardYearIn) {
    cardYearIn.addEventListener('input', function () { setYear(+cardYearIn.value); });
    document.getElementById('cardYearDn').addEventListener('click', function () { setYear(cardYear() - 1); });
    document.getElementById('cardYearUp').addEventListener('click', function () { setYear(cardYear() + 1); });
  }
  document.getElementById('cardFilm').addEventListener('click', function () { cardSet.film = !cardSet.film; cardSave(); cfgMarks(); cfgRender(true); });
  cardLineIn.addEventListener('input', function () { cardSet.line = cardLineIn.value.replace(/[\r\n]+/g, ' ').slice(0, 40); cardSave(); cfgMarks(); cfgLater(); });
  cardLineIn.addEventListener('keydown', function (e) { if (e.key === 'Enter') cardLineIn.blur(); });
  cardGo.addEventListener('click', function () {   // сохранить ту открытку, что в превью (с текущими настройками) — синхронно в нажатии
    if (!cfg.src) return;
    if ((cfg.pend || !cfg.card) && cardFontsReady(cardLang())) cfgRender(false);
    if (!cfg.card) {   // шрифты не готовы — дождаться; share уже без жеста → плашка «готово»
      cardFontsLoad().then(function () { cfgRender(false); if (!cfg.card) return; if (shareOK) showToast(cfg.back ? [fileFromCanvas(cfg.card), fileFromCanvas(cfg.back, true)] : fileFromCanvas(cfg.card)); else deliverCard(cfg.card, cfg.back); });
      return;
    }
    deliverCard(cfg.card, cardSet.back ? cfg.back : null);
    cardFlashNow(); goDone();
  });

  // ---------- «Момент» (e1.29): время суток ползунком, погода, свой ракурс — сцена за окном меняется вживую, превью снимается заново ----------
  var cardTodIn = document.getElementById('cardTod'), cardPrevBack = document.getElementById('cardPrevBack'), cardHold = document.getElementById('cardHold');
  var recapT = [];
  function recapture(delays) {   // снять кадр заново: сразу после смены и ещё раз, когда доедут плавные переходы движка (погода — 4 с, снег копится ~12 с)
    recapT.forEach(clearTimeout); recapT = [];
    delays.forEach(function (ms) { recapT.push(setTimeout(function () {
      if (!bodyEl.classList.contains('card-open')) return;
      var src = captureView(); if (!src) return;
      cfg.src = src; cfg.mask = cardBuildingMask(); cfgRender(true);
    }, ms)); });
  }
  function momMarks() {
    var v = momNow();
    if (cardTodIn && document.activeElement !== cardTodIn) cardTodIn.value = Math.round(v * 100);
    var nm = document.getElementById('cardTodName'), tm = document.getElementById('cardTime'), U = CONFIG.UI_I18N;
    if (nm) nm.textContent = U[MOM_KEY[Math.round(clamp(v, 0, 4))]][currentLang];
    if (tm) tm.textContent = cardTime();
    var night = momTab(MOM_P, v) > 1.2;
    cardCfg.querySelectorAll('[data-cwx]').forEach(function (b) {
      var k = b.getAttribute('data-cwx'), on = k === 'wind' ? windIdx > 0 : k === 'rainbow' ? !!rbHold : !!wxOn[k];
      b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
      if (k === 'wind') b.setAttribute('data-wind', String(windIdx));
      if (k === 'rainbow') { b.disabled = night; b.title = night ? U.nightNA[currentLang] : ''; }
    });
    var hb = document.getElementById('cardHoldBtn');
    if (hb) { hb.classList.toggle('on', !!tiltHold); hb.setAttribute('aria-pressed', tiltHold ? 'true' : 'false'); var ht = hb.querySelector('span'); if (ht) ht.textContent = U[tiltHold ? 'cardHoldOff' : 'cardHoldOn'][currentLang]; }
    bodyEl.classList.toggle('card-held', !!tiltHold);
    if (cardHold) { var pt = cardHold.querySelector('span'); if (pt) pt.textContent = U[tiltHold ? 'cardHoldOff' : 'cardAim'][currentLang]; }
  }
  function momChanged(delays) {
    cfg.rare = sceneRare() || !!(ChkaPostcard.luck && ChkaPostcard.luck(cfg.seed));
    momMarks(); cfgMeta(); recapture(delays);
  }
  function setMoment(v) {   // ползунок: сразу то время суток движка (без 2,5–3-секундного перехода кнопок панели)
    momS = clamp(v, 0, 4);
    var p = momTab(MOM_P, momS), name = p > 1.6 ? 'night' : (p > 0.55 ? 'sunset' : 'day');
    if (p > 0.05) loadStates(frameIndex);   // картинки заката и ночи этого кадра — если ещё не в памяти
    todAnim = null; applyTod(p);
    segMark('todSeg', 'data-tod', name);
    var cbtn = document.querySelector('#wxChips [data-wx=cloudy]');   // как у кнопок панели: ночью туч нет
    if (cbtn) { cbtn.disabled = name === 'night'; cbtn.title = name === 'night' ? CONFIG.UI_I18N.nightNA[currentLang] : ''; if (name === 'night' && wxOn.cloudy) { wxOn.cloudy = false; applyWeather(); } }
    if (p > 1.2 && rbHold) rbSet(false);
    momChanged([200, 900]);
  }
  // радуга: у движка она бывает только после дождя днём и гаснет через 30 с — кнопка держит её (время «после дождя» обновляется каждые 10 с)
  var rbHold = 0;
  function rbSet(on) {
    clearInterval(rbHold); rbHold = 0;
    if (on) {
      if (wxOn.rain || wxOn.snow) setPrecip('none');
      ['fog', 'cloudy'].forEach(function (k) { if (wxOn[k]) setWeather(k); });
      var keep = function () { wx.rainbowT0 = performance.now() - 7000; showWxName(); };
      keep(); rbHold = setInterval(keep, 10000);
    } else { wx.rainbowT0 = 0; showWxName(); }
  }
  cardCfg.querySelectorAll('[data-cwx]').forEach(function (b) {
    b.addEventListener('click', function () {
      var k = b.getAttribute('data-cwx');
      if (k === 'snow' || k === 'rain') { var on = !wxOn[k]; if (rbHold) rbSet(false); setPrecip(on ? k : 'none'); }
      else if (k === 'fog') { if (rbHold) rbSet(false); setWeather('fog'); }
      else if (k === 'wind') setWind((windIdx + 1) % 3);
      else if (k === 'rainbow') rbSet(!rbHold);
      momChanged(k === 'snow' ? [250, 1500, 4400, 9000, 13500] : [250, 1500, 4400]);   // погода доезжает 4 с, снег копится ~12 с
    });
  });
  if (cardTodIn) cardTodIn.addEventListener('input', function () { setMoment(+cardTodIn.value / 100); });
  // «Свой ракурс»: окно уходит, картинку наклоняют (телефон — наклоном или пальцем, ПК — мышью) и касаются её — наклон, дыхание и сдвиг замирают
  // (tiltHold в цикле кадра), окно возвращается с открыткой с этого ракурса. Пока замерло — плашка «Отпустить ракурс» над картинкой.
  function holdSet(on) {
    var d = lastDraw;
    tiltHold = on ? { sx: d ? d.shiftX : 0, sy: d ? d.shiftY : 0, z: d ? d.zoom : 0 } : null;
    momMarks();
  }
  function aimStart() { closeCfg(); if (!desktopMQ.matches) closeSheet(); bodyEl.classList.add('card-aim'); momMarks(); }
  var holdBtn = document.getElementById('cardHoldBtn');
  if (holdBtn) holdBtn.addEventListener('click', function () { if (tiltHold) { holdSet(false); momChanged([150]); } else aimStart(); });
  stage.addEventListener('pointerup', function () {
    if (!bodyEl.classList.contains('card-aim')) return;
    holdSet(true); bodyEl.classList.remove('card-aim');
    cardFlashNow(); setTimeout(openCfg, 280);
  }, true);
  if (cardHold) cardHold.addEventListener('click', function (e) {
    e.stopPropagation();
    if (bodyEl.classList.contains('card-aim')) { holdSet(true); bodyEl.classList.remove('card-aim'); cardFlashNow(); setTimeout(openCfg, 280); }
    else if (tiltHold) holdSet(false);
  });
  var backBtn = document.getElementById('cardBack');
  function backMarks() { if (backBtn) { backBtn.classList.toggle('on', cardSet.back); backBtn.setAttribute('aria-pressed', cardSet.back ? 'true' : 'false'); } }
  if (backBtn) backBtn.addEventListener('click', function () { cardSet.back = !cardSet.back; cardSave(); backMarks(); cfgRender(true); });
  backMarks(); momMarks();
  window.__cardOnLang = function () { momMarks(); if (bodyEl.classList.contains('card-open')) cfgMeta(); };
  // шрифты открытки — в простое после загрузки страницы (нажатие потом не ждёт сеть)
  setTimeout(function () { (window.requestIdleCallback || function (f) { setTimeout(f, 1) })(function () { cardFontsLoad(); FRAMES.forEach(function (F, i) { setTimeout(function () { cardBldLoad(i); }, 300 * i); }); }); }, 4000);
  window.__card = {   // для проверки (report s26/s28): открытка с заданными настройками без «Поделиться»; dataURL JPEG/PNG
    make: function (o) { var src = captureView(); if (!src) return null; o = o || {};
      var keep = { lang: cardSet.lang, line: cardSet.line, film: cardSet.film, date: cardSet.date, year: cardSet.year }, kr = cfg.rare, km = cfg.mask;
      if (o.lang) cardSet.lang = o.lang; if (o.line != null) cardSet.line = o.line; if (o.film != null) cardSet.film = !!o.film;
      if (o.year) { cardSet.date = 'year'; cardSet.year = o.year; } else cardSet.date = 'today';
      cfg.rare = !!o.rare; cfg.mask = null;
      var ex = { seed: o.seed != null ? o.seed : 26, date: o.date ? new Date(o.date) : undefined, grain: o.grain, code: o.code, time: o.time, back: !!o.back };
      var cv = composeCard(src, ex);
      cardSet.lang = keep.lang; cardSet.line = keep.line; cardSet.film = keep.film; cardSet.date = keep.date; cardSet.year = keep.year; cfg.rare = kr; cfg.mask = km;
      return { url: cv.toDataURL(o.png ? 'image/png' : 'image/jpeg', 0.9), boxes: cv.__boxes, src: o.src ? src.toDataURL(o.png ? 'image/png' : 'image/jpeg', 0.9) : null }; },
    fontsReady: function (l) { return cardFontsReady(l || cardLang()); }, fontsLoad: cardFontsLoad, bldLoad: function () { FRAMES.forEach(function (F, i) { cardBldLoad(i); }); return new Promise(function (res) { var n = 0; (function w() { if (FRAMES.every(function (F, i) { return cardBld[i] !== 'loading'; }) || ++n > 100) res(); else setTimeout(w, 100); })(); }); }, mask: cardBuildingMask, safe: function () { return ChkaPostcard.SAFE; },
    open: openCfg, close: closeCfg, state: function () { return { open: bodyEl.classList.contains('card-open'), rare: cfg.rare, seed: cfg.seed, code: cfg.code, time: cardTime(), mom: momNow(), hold: tiltHold, back: !!cfg.back, years: CARD_YEARS, set: JSON.parse(JSON.stringify(cardSet)), no: cardNo() }; },
    moment: setMoment, hold: holdSet, aim: aimStart
  };

  // размер текста: крупный (по умолчанию) / обычный. Нажатие — отметка сразу, текст меняется мягко (textSwap)
  function setTextSize(v) {
    v = v === 'normal' ? 'normal' : 'large';
    document.documentElement.setAttribute('data-textsize', v);
    segMark('sizeSeg', 'data-size', v);
    lsSet('chka-textsize', v);
  }
  document.querySelectorAll('#sizeSeg button').forEach(function (b) {
    b.addEventListener('click', function () {
      var v = b.getAttribute('data-size');
      if (document.documentElement.getAttribute('data-textsize') === (v === 'normal' ? 'normal' : 'large')) return;
      segMark('sizeSeg', 'data-size', v);
      textSwap('size', function () { setTextSize(v); });
    });
  });
  setTextSize(lsGet('chka-textsize'));

  // ---------- старт ----------
  // Сначала грузим и показываем только первый кадр (день). Остальные кадры, закат, ночь — потом, в фоне, по одному, в простое.
  // (Откат без WebGL грузит все кадры сразу: слои для CSS-варианта нужны заранее.)
  // Первый кадр при сбое сети пробуем ещё раз (до 3 попыток): иначе на плохой связи экран загрузки остался бы навсегда.
  function withRetry(make, tries) {
    return make().catch(function (err) {
      if (tries <= 1) throw err;
      console.warn('кадр не загрузился, пробую ещё раз —', err && err.message);
      return new Promise(function (r) { setTimeout(r, 700); }).then(function () { return withRetry(make, tries - 1); });
    });
  }
  var firstP = useGL ? Promise.all([withRetry(function () { return loadDay(0); }, 3), glReadyP])
    : Promise.all(FRAMES.map(function (_, i) { return withRetry(function () { return loadDay(i); }, 3); }));
  firstP.then(function () {
    if (!useGL) buildFallbackDom();
    setNaturalSize(store[0].w, store[0].h);
    buildDots();
    buildThumbs();
    buildHotspots(0);
    frame(performance.now());            // первая отрисовка, потом убираем экран загрузки —
    stage.classList.remove('loading');   // пустого кадра не бывает, даже если вкладка в фоне
    wl.loaded();                         // приветствие держится ещё, если прошло меньше 3 с; потом уходит само
    flagUpdate();
    if (useGL) startBackground();
  }).catch(function (err) {
    console.error(err);
    wl.fail('Не удалось загрузить кадры: ' + (err && err.message ? err.message : err));
  });

})();
