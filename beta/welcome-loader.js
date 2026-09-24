/* ============================================================================
   ПРИВЕТСТВИЕ + ЗАГРУЗКА — компонент движка (не привязан к Кукурузнику, годится для любого здания).

   Что делает
   • Появляется СРАЗУ, ещё до загрузки кадров, и держится, пока всё не загрузится (минимум minMs).
   • Пока идёт загрузка — без слов, без процентов и полосок: под приветствием буквы алфавита по одной
     прорисовываются карандашной линией, как будто их пишут от руки, и мягко растворяются;
     следующая буква начинается, пока прошлая ещё тает.
   • Когда загрузилось (и прошло minMs): анимация плавно гаснет, подложка становится прозрачной,
     появляется «коснись, чтобы начать». Дальше — по клику (телефон: по касанию), на ПК ещё и само через autoHideMs.

   Как подключить (см. test-assets/depth.html)
     <script src="welcome-letters.js"></script>   // буквы (tools/build_hy_titles.py), можно любой другой алфавит
     <script src="welcome-loader.js"></script>
     var wl = WelcomeLoader.create({
       parent: stage,                              // куда вставить (position: relative/absolute)
       lang: 'hy',
       text: function (key, lang) { return '…'; }, // key: 'welcome' | 'welcomeTap'
       images: { hy: { welcome: 'hy/welcome.svg', welcomeTap: 'hy/welcome-tap.svg' } }, // языки без рукописного шрифта
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
    '  padding: calc(env(safe-area-inset-top, 0px) + 8px) 24px calc(env(safe-area-inset-bottom, 0px) + 8px); opacity: 0; cursor: default;',
    '  transition: opacity 350ms var(--spring, ease); }',
    '.wl.in { opacity: 1; }',
    '.wl.ready { cursor: pointer; }',
    '.wl.out { opacity: 0; pointer-events: none; transition-duration: 600ms; }',
    '.wl[hidden] { display: none; }',
    /* подложка: сначала сплошная бумага (кадры ещё грузятся), потом мягкое пятно поверх готовой картинки */
    '.wl::before, .wl::after { content: ""; position: absolute; inset: 0; pointer-events: none; transition: opacity 900ms var(--spring, ease); }',
    '.wl::before { background: var(--paper, #f5ecda); opacity: 1; }',
    '.wl::after { background: radial-gradient(ellipse at center, rgba(245,236,218,0.9) 0%, rgba(245,236,218,0.62) 42%, rgba(245,236,218,0) 74%); opacity: 0; }',
    '.wl.ready::before { opacity: 0; }',
    '.wl.ready::after { opacity: 1; }',
    '.wl-box { position: relative; z-index: 1; display: flex; flex-direction: column; align-items: center; gap: 16px; max-width: 100%; }',
    '.wl-title { font: 700 40px/1.12 "Caveat", -apple-system, "Noto Sans Armenian", sans-serif; color: var(--ink, #2f2a25); }',
    '.wl-title img { display: block; width: min(80vw, 340px); height: auto; margin: 0 auto; }',
    /* под приветствием одно место на пару: пока грузим — рисуется буква, потом на её месте «коснись» */
    '.wl-under { position: relative; width: min(80vw, 340px); height: 104px; }',
    '.wl-pen, .wl-sub { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; transition: opacity 700ms var(--spring, ease); }',
    '.wl-pen svg { width: 100%; height: 100%; overflow: visible; }',
    '.wl.ready .wl-pen { opacity: 0; }',
    '.wl-sub { opacity: 0; font: 600 21px/1.2 "Caveat", -apple-system, "Noto Sans Armenian", sans-serif; color: var(--ink, #2f2a25); }',
    '.wl-sub span { opacity: 0.7; }',
    '.wl-sub img { display: block; width: min(64vw, 260px); height: auto; opacity: 0.8; }',
    '.wl.ready .wl-sub { opacity: 1; transition-delay: 350ms; }',
    '.wl-err { max-width: 80%; font: 600 16px/1.3 -apple-system, sans-serif; color: var(--ink, #2f2a25); }'
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
    el.id = 'welcome'; el.className = 'wl';
    el.innerHTML =
      '<div class="wl-box">' +
        '<div class="wl-title"></div>' +
        '<div class="wl-under">' +
          '<div class="wl-pen"><svg viewBox="0 0 1000 1100" aria-hidden="true">' +
            '<defs><filter id="' + id + 'f" filterUnits="userSpaceOnUse" x="-100" y="-100" width="1200" height="1300">' +
              '<feTurbulence type="fractalNoise" baseFrequency="0.014" numOctaves="2" seed="4" result="w"/>' +
              '<feDisplacementMap in="SourceGraphic" in2="w" scale="14" xChannelSelector="R" yChannelSelector="G"/>' +
            '</filter></defs>' +
            '<g class="wl-slot" filter="url(#' + id + 'f)"></g>' +
          '</svg></div>' +
          '<div class="wl-sub"></div>' +
        '</div>' +
      '</div>';
    opt.parent.appendChild(el);
    var titleEl = el.querySelector('.wl-title'), subEl = el.querySelector('.wl-sub'), slot = el.querySelector('.wl-slot');

    function later(fn, ms) { var h = setTimeout(function () { if (el.isConnected) fn(); }, ms); timers.push(h); return h; }

    function render() {
      var imgs = (opt.images && opt.images[lang]) || null;
      var tt = opt.text('welcome', lang), st2 = opt.text('welcomeTap', lang);
      if (imgs && imgs.welcome) titleEl.innerHTML = '<img src="' + imgs.welcome + '" alt="' + tt.replace(/"/g, '&quot;') + '">';
      else titleEl.textContent = tt;
      if (imgs && imgs.welcomeTap) subEl.innerHTML = '<img src="' + imgs.welcomeTap + '" alt="' + st2.replace(/"/g, '&quot;') + '">';
      else subEl.innerHTML = '<span></span>', subEl.firstChild.textContent = st2;
      el.setAttribute('aria-label', tt);
    }

    // ---- буква пером: контур прорисовывается, держится, тает; следующая — сразу следом ----
    function drawLetter() {
      if (!penRunning || !el.isConnected || !letters.length || !slot.animate) return;
      var L = letters[letterIdx++ % letters.length];
      var g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      var paths = [];
      [[24, 0.95, 0, 0], [11, 0.5, 14, 10]].forEach(function (s) {   // основная линия и лёгкий двойной контур
        var p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        p.setAttribute('d', L.d);
        p.setAttribute('fill', 'none'); p.setAttribute('stroke', '#2f2a25'); p.setAttribute('stroke-width', s[0]);
        p.setAttribute('stroke-linecap', 'round'); p.setAttribute('stroke-linejoin', 'round');
        p.setAttribute('opacity', s[1]);
        if (s[2]) p.setAttribute('transform', 'translate(' + s[2] + ' ' + s[3] + ')');
        g.appendChild(p); paths.push(p);
      });
      slot.appendChild(g);
      var bb = paths[0].getBBox();
      // по центру поля 1000×1100, высота буквы — до 800 единиц
      var k = Math.min(1, 800 / Math.max(bb.height, 1), 800 / Math.max(bb.width, 1));
      var tx = 500 - (bb.x + bb.width / 2) * k, ty = 550 - (bb.y + bb.height / 2) * k;
      g.setAttribute('transform', 'translate(' + tx + ' ' + ty + ') scale(' + k + ')');
      var len = paths[0].getTotalLength() + 4;
      var DRAW = 1500, HOLD = 250, FADE = 800;
      paths.forEach(function (p) {
        p.style.strokeDasharray = len;
        p.style.strokeDashoffset = len;
        p.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }], { duration: DRAW, easing: 'cubic-bezier(0.45, 0.05, 0.3, 1)', fill: 'forwards' });
      });
      g.animate([{ opacity: 1 }, { opacity: 1, offset: (DRAW + HOLD) / (DRAW + HOLD + FADE) }, { opacity: 0 }],
                { duration: DRAW + HOLD + FADE, fill: 'forwards' });
      later(function () { if (g.parentNode) g.parentNode.removeChild(g); }, DRAW + HOLD + FADE + 50);
      later(drawLetter, DRAW + HOLD - 250);   // следующая начинается, пока эта ещё тает
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
      el.classList.remove('in'); el.classList.add('out');
      setTimeout(function () { el.hidden = true; }, 650);
    }

    el.addEventListener('click', function (e) {
      e.stopPropagation();
      if (state !== 'ready') return;     // пока грузится — касание ничего не делает
      if (opt.onTap) opt.onTap(e);       // синхронно из касания: iOS даёт запрос на наклон только так
      hide();
    });

    render();
    requestAnimationFrame(function () { requestAnimationFrame(function () { el.classList.add('in'); }); });
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
      hide: hide
    };
  }

  global.WelcomeLoader = { create: create };
})(window);
