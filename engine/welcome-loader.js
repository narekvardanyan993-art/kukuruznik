/* ============================================================================
   ПРИВЕТСТВИЕ + ЗАГРУЗКА — компонент движка (не привязан к Кукурузнику, годится для любого здания).

   Что делает
   • Появляется СРАЗУ (вставляйте вызов create в самое начало страницы, до тяжёлых скриптов и картинок) и держится,
     пока всё не загрузится, но не меньше minMs (3 с). Шрифт берёт из --font страницы.
   • Пока идёт загрузка — без слов, без процентов и полосок: под приветствием буквы алфавита по одной
     прорисовываются карандашной линией, как будто их пишут от руки, и мягко растворяются;
     следующая буква начинается, пока прошлая ещё тает.
   • Когда загрузилось и прошло minMs: буква, которую перо уже начало, дорисовывается до конца (новые не начинаются),
     чуть-чуть (0.25 с) держится готовой, потом всё приветствие плавно (0.9 с) растворяется. Касаться ничего не нужно.
     Если загрузка сама дольше minMs — ничего не добавляется, кроме дорисовки начатой буквы (не дольше 1.5 с).
   • После ухода не остаётся ни одного слоя: элемент скрывается (display: none) и без подложек и пятен поверх картинки.
     v12: убрано кремовое пятно «коснись, чтобы начать» — оно висело над картинкой до касания.

   Как подключить (см. test-assets/depth.html)
     <script src="welcome-letters.js"></script>   // буквы (tools/build_hy_titles.py), можно любой другой алфавит
     <script src="welcome-loader.js"></script>
     var wl = WelcomeLoader.create({
       parent: document.body, fixed: true,         // сразу на всё окно; позже wl.attach(stage) — поверх картинки
       lang: 'hy',
       text: function (key, lang) { return '…'; }, // key: 'welcome'
       letters: window.WL_LETTERS,                 // [{ch, d}] — контуры букв в единицах em*1000, y вниз
       minMs: 3000,                                // показывать минимум столько от создания
       onHide: function () {}                      // приветствие начало уходить (например, запустить демо-наклон)
     });
     wl.setLang('ru');  wl.loaded();  wl.fail('текст ошибки');  wl.hide();
   ============================================================================ */
(function (global) {
  'use strict';

  var CSS = [
    '.wl { position: absolute; inset: 0; z-index: 30; display: grid; place-items: center; text-align: center;',
    '  padding: calc(env(safe-area-inset-top, 0px) + 8px) 24px calc(env(safe-area-inset-bottom, 0px) + 8px); cursor: default; }',
    '.wl.wl-fixed { position: fixed; }',   /* пока страница не собрана: на всё окно; attach(stage) — только на картинку */
    '.wl.out { opacity: 0; pointer-events: none; transition: opacity 900ms var(--spring, ease); }',
    '.wl[hidden] { display: none; }',
    /* подложка — сплошная бумага, пока кадры грузятся; уходит вместе со всем приветствием (никаких пятен поверх картинки) */
    '.wl::before { content: ""; position: absolute; inset: 0; pointer-events: none; background: var(--paper, #f5ecda); }',
    '.wl-box { position: relative; z-index: 1; display: grid; justify-items: center; row-gap: 16px; max-width: 100%; }',
    '.wl-title { max-width: 16em; font: 700 30px/1.25 var(--font, serif); color: var(--ink, #2f2a25); }',
    '.wl-under { position: relative; width: 160px; height: 144px; }',
    '.wl-pen { position: absolute; inset: 0; display: grid; place-items: center; }',
    '.wl-pen svg { width: 100%; height: 100%; overflow: visible; }',
    '.wl-err { max-width: 80%; font: 600 16px/1.3 var(--font, serif); color: var(--ink, #2f2a25); }'
  ].join('\n');

  var uid = 0;

  function create(opt) {
    var minMs = opt.minMs == null ? 3000 : opt.minMs;
    var letters = opt.letters || [];
    var lang = opt.lang || 'ru';
    var id = 'wl' + (++uid);
    var t0 = performance.now();
    var state = 'loading';          // loading → ready → gone
    var timers = [];
    var letterIdx = 0, penRunning = true, drawEndsAt = 0;   // drawEndsAt: когда перо дорисует текущую букву (performance.now)

    if (!document.getElementById('wl-style')) {
      var st = document.createElement('style');
      st.id = 'wl-style'; st.textContent = CSS;
      document.head.appendChild(st);
    }

    var el = document.createElement('div');
    el.id = 'welcome'; el.className = 'wl' + (opt.fixed ? ' wl-fixed' : '');
    el.innerHTML =
      '<div class="wl-box">' +
        '<div class="wl-title"></div>' +
        '<div class="wl-under">' +
          '<div class="wl-pen"><svg viewBox="0 0 1000 1100" aria-hidden="true"><g class="wl-slot"></g></svg></div>' +
        '</div>' +
      '</div>';
    opt.parent.appendChild(el);
    var titleEl = el.querySelector('.wl-title'), slot = el.querySelector('.wl-slot');

    function later(fn, ms) { var h = setTimeout(function () { if (el.isConnected) fn(); }, ms); timers.push(h); return h; }

    function render() {
      var tt = opt.text('welcome', lang);
      titleEl.textContent = tt;
      el.setAttribute('aria-label', tt);
    }

    // ---- буква пером: контур прорисовывается, держится, тает; следующая — сразу следом ----
    function drawLetter() {
      if (!penRunning || !el.isConnected || !letters.length || !slot.animate) return;
      var L = letters[letterIdx++ % letters.length];
      var g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      var paths = [];
      [[16, 0.13, 0, 0, 1], [34, 1, 0, 0], [14, 0.55, 18, 12]].forEach(function (s) {   // призрак контура (виден всегда), основная линия, лёгкий двойной контур
        var p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        p.setAttribute('d', L.d);
        p.setAttribute('fill', 'none'); p.setAttribute('stroke', '#2f2a25'); p.setAttribute('stroke-width', s[0]);
        p.setAttribute('stroke-linecap', 'round'); p.setAttribute('stroke-linejoin', 'round');
        p.setAttribute('opacity', s[1]);
        if (s[2]) p.setAttribute('transform', 'translate(' + s[2] + ' ' + s[3] + ')');
        g.appendChild(p); if (!s[4]) paths.push(p);   // призрак не рисуется — он подсказывает форму буквы
      });
      slot.appendChild(g);
      var bb = g.firstChild.getBBox();
      // по центру поля 1000×1100, высота буквы — до 800 единиц
      var k = Math.min(1, 900 / Math.max(bb.height, 1), 900 / Math.max(bb.width, 1));
      var tx = 500 - (bb.x + bb.width / 2) * k, ty = 550 - (bb.y + bb.height / 2) * k;
      g.setAttribute('transform', 'translate(' + tx + ' ' + ty + ') scale(' + k + ')');
      var len = paths[0].getTotalLength() + 4;
      var DRAW = 1500, HOLD = 600, FADE = 900;
      drawEndsAt = performance.now() + DRAW;
      paths.forEach(function (p) {
        p.style.strokeDasharray = len;
        p.style.strokeDashoffset = len;
        p.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }], { duration: DRAW, easing: 'cubic-bezier(0.45, 0.05, 0.3, 1)', fill: 'forwards' });
      });
      g.animate([{ opacity: 1 }, { opacity: 1, offset: (DRAW + HOLD) / (DRAW + HOLD + FADE) }, { opacity: 0 }],
                { duration: DRAW + HOLD + FADE, fill: 'forwards' });
      later(function () { if (g.parentNode) g.parentNode.removeChild(g); }, DRAW + HOLD + FADE + 50);
      later(drawLetter, DRAW + HOLD - 300);   // следующая начинается, пока эта ещё тает
    }

    // Загрузилось и прошло minMs: если перо ещё ведёт линию буквы — ждём, пока она дойдёт до конца (не дольше DRAW = 1.5 с),
    // новые буквы не начинаем; 0.25 с держим готовую, потом всё приветствие плавно уходит.
    function goReady() {
      if (state !== 'loading') return;
      state = 'ready';
      penRunning = false;
      later(hide, 250);
    }

    function hide() {
      if (state === 'gone') return;
      state = 'gone';
      timers.forEach(clearTimeout);
      if (!el.isConnected) return;
      el.classList.add('out');
      if (opt.onHide) { try { opt.onHide(); } catch (e) {} }
      setTimeout(function () { el.hidden = true; }, 950);
    }

    render();
    drawLetter();

    return {
      el: el,
      setLang: function (l) { lang = l; render(); },
      loaded: function () {
        if (state !== 'loading') return;
        var wait = Math.max(0, minMs - (performance.now() - t0));
        later(function () {   // 3 с прошло: дорисовать начатую букву до конца
          var left = drawEndsAt - performance.now();
          if (left > 0 && penRunning) later(goReady, left + 30); else goReady();
        }, wait);
      },
      fail: function (msg) {
        penRunning = false;
        var box = el.querySelector('.wl-under');
        box.innerHTML = '<div class="wl-err"></div>'; box.firstChild.textContent = msg;
      },
      // перенести приветствие в контейнер (когда страница уже собрана): вместо «на всё окно» — поверх картинки
      attach: function (parent) { el.classList.remove('wl-fixed'); parent.appendChild(el); },
      hide: hide
    };
  }

  global.WelcomeLoader = { create: create };
})(window);
