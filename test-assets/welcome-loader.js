/* ============================================================================
   ПРИВЕТСТВИЕ + ЗАГРУЗКА — компонент движка (не привязан к Кукурузнику, годится для любого здания).

   Что делает
   • Появляется СРАЗУ (вставляйте вызов create в самое начало страницы, до тяжёлых скриптов и картинок) и держится,
     пока всё не загрузится (минимум minMs). Шрифт берёт из --font страницы.
   • Пока идёт загрузка — без слов, без процентов и полосок: под приветствием буквы алфавита по одной
     прорисовываются карандашной линией, как будто их пишут от руки, и мягко растворяются;
     следующая буква начинается, пока прошлая ещё тает.
   • Когда загрузилось (и прошло minMs): анимация плавно гаснет, подложка становится прозрачной,
     появляется «коснись, чтобы начать». Дальше — по клику (телефон: по касанию), на ПК ещё и само через autoHideMs.

   Как подключить (см. test-assets/depth.html)
     <script src="welcome-letters.js"></script>   // буквы (tools/build_hy_titles.py), можно любой другой алфавит
     <script src="welcome-loader.js"></script>
     var wl = WelcomeLoader.create({
       parent: document.body, fixed: true,         // сразу на всё окно; позже wl.attach(stage) — поверх картинки
       lang: 'hy',
       text: function (key, lang) { return '…'; }, // key: 'welcome' | 'welcomeTap'
       letters: window.WL_LETTERS,                 // [{ch, d}] — контуры букв в единицах em*1000, y вниз
       minMs: 2000, autoHideMs: 3000, autoHide: true,   // autoHide: false — ждать касания (телефон)
       onTap: function () {}                       // вызывается из обработчика касания (нужно для запроса наклона на iOS)
     });
     wl.setLang('ru');  wl.loaded();  wl.fail('текст ошибки');  wl.hide();
   ============================================================================ */
(function (global) {
  'use strict';

  var CSS = [
    '.wl { position: absolute; inset: 0; z-index: 30; display: grid; place-items: center; text-align: center;',
    '  padding: calc(env(safe-area-inset-top, 0px) + 8px) 24px calc(env(safe-area-inset-bottom, 0px) + 8px); cursor: default; }',
    '.wl.ready { cursor: pointer; }',
    '.wl.wl-fixed { position: fixed; }',   /* пока страница не собрана: на всё окно; attach(stage) — только на картинку */
    '.wl.out { opacity: 0; pointer-events: none; transition: opacity 600ms var(--spring, ease); }',
    '.wl[hidden] { display: none; }',
    /* подложка: сначала сплошная бумага (кадры ещё грузятся), потом мягкое пятно поверх готовой картинки */
    '.wl::before, .wl::after { content: ""; position: absolute; inset: 0; pointer-events: none; transition: opacity 900ms var(--spring, ease); }',
    '.wl::before { background: var(--paper, #f5ecda); opacity: 1; }',
    '.wl::after { background: radial-gradient(ellipse at center, rgba(245,236,218,0.9) 0%, rgba(245,236,218,0.62) 42%, rgba(245,236,218,0) 74%); opacity: 0; }',
    '.wl.ready::before { opacity: 0; }',
    '.wl.ready::after { opacity: 1; }',
    '.wl-box { position: relative; z-index: 1; display: grid; justify-items: center; row-gap: 16px; max-width: 100%; }',
    '.wl-title { max-width: 16em; font: 700 30px/1.25 var(--font, Georgia, serif); color: var(--ink, #2f2a25); }',
    /* под приветствием одно место на пару: пока грузим — рисуется буква, потом на её месте «коснись» */
    '.wl-under { position: relative; width: 160px; height: 144px; }',
    '.wl-pen, .wl-sub { position: absolute; inset: 0; display: grid; place-items: center; transition: opacity 700ms var(--spring, ease); }',
    '.wl-pen svg { width: 100%; height: 100%; overflow: visible; }',
    '.wl.ready .wl-pen { opacity: 0; }',
    '.wl-sub { opacity: 0; font: 600 20px/1.3 var(--font, Georgia, serif); color: var(--ink, #2f2a25); }',
    '.wl-sub span { opacity: 0.75; }',
    '.wl.ready .wl-sub { opacity: 1; transition-delay: 350ms; }',
    '.wl-err { max-width: 80%; font: 600 16px/1.3 var(--font, Georgia, serif); color: var(--ink, #2f2a25); }'
  ].join('\n');

  var uid = 0;

  function create(opt) {
    var minMs = opt.minMs == null ? 2000 : opt.minMs;
    var autoHide = opt.autoHide !== false;
    var autoHideMs = opt.autoHideMs == null ? 3000 : opt.autoHideMs;
    var letters = opt.letters || [];
    var lang = opt.lang || 'ru';
    var id = 'wl' + (++uid);
    var t0 = performance.now();
    var state = 'loading';          // loading → ready → gone
    var timers = [];
    var letterIdx = 0, penRunning = true;

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
          '<div class="wl-sub"></div>' +
        '</div>' +
      '</div>';
    opt.parent.appendChild(el);
    var titleEl = el.querySelector('.wl-title'), subEl = el.querySelector('.wl-sub'), slot = el.querySelector('.wl-slot');

    function later(fn, ms) { var h = setTimeout(function () { if (el.isConnected) fn(); }, ms); timers.push(h); return h; }

    function render() {
      var tt = opt.text('welcome', lang);
      titleEl.textContent = tt;
      subEl.innerHTML = '<span></span>';
      subEl.firstChild.textContent = opt.text('welcomeTap', lang);
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

    function goReady() {
      if (state !== 'loading') return;
      state = 'ready';
      penRunning = false;
      el.classList.add('ready');
      if (autoHide) later(hide, autoHideMs);
    }

    function hide() {
      if (state === 'gone') return;
      state = 'gone';
      timers.forEach(clearTimeout);
      if (!el.isConnected) return;
      el.classList.add('out');
      setTimeout(function () { el.hidden = true; }, 650);
    }

    el.addEventListener('click', function (e) {
      e.stopPropagation();
      if (state !== 'ready') return;     // пока грузится — касание ничего не делает
      if (opt.onTap) opt.onTap(e);       // синхронно из касания: iOS даёт запрос на наклон только так
      hide();
    });

    render();
    drawLetter();

    return {
      el: el,
      setLang: function (l) { lang = l; render(); },
      loaded: function () {
        if (state !== 'loading') return;
        var wait = Math.max(0, minMs - (performance.now() - t0));
        later(goReady, wait);
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
