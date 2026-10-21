/* Չկա — главная. Специфика именно этой страницы: переход-разворот на
   карточку здания. Рамки, проявление при прокрутке и приподнятие
   карточек — в assets/chka-common.js, подключённом раньше этого файла. */
(function () {
  /* Стопка фото на первом экране разлетается по местам сразу после
     отрисовки — без reduced-motion она стартует «сложенной» (см.
     .stack:not(.fanned) в hub.css) и класс .fanned запускает переход. */
  var stack = document.querySelector('.stack');
  if (stack) {
    if (window.ChkaReducedMotion) {
      stack.classList.add('fanned');
      initStackParallax(stack);
    } else {
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { stack.classList.add('fanned'); });
      });
      /* .parallax включаем только после разлёта, иначе его быстрый
         transition перебивает задержки веера (--stagger-подобная
         хореография у .sc-a..d). */
      var intro = document.documentElement.classList.contains('intro');
      setTimeout(function () {
        stack.classList.add('parallax');
        initStackParallax(stack);
      }, intro ? 1350 : 700);
    }
  }

  /* Лёгкий параллакс стопки: мышью на десктопе, прокруткой на телефоне.
     Только transform — дёшево даже на iPhone. */
  function initStackParallax(stack) {
    if (window.ChkaReducedMotion) return;
    var range = 10;
    if (window.ChkaFinePointer) {
      var hero = stack.closest('.hero') || stack;
      hero.addEventListener('mousemove', function (e) {
        var b = stack.getBoundingClientRect();
        var nx = ((e.clientX - (b.left + b.width / 2)) / (b.width / 2));
        var ny = ((e.clientY - (b.top + b.height / 2)) / (b.height / 2));
        nx = Math.max(-1, Math.min(1, nx));
        ny = Math.max(-1, Math.min(1, ny));
        stack.style.setProperty('--px', (nx * range).toFixed(1));
        stack.style.setProperty('--py', (ny * range).toFixed(1));
      });
      hero.addEventListener('mouseleave', function () {
        stack.style.setProperty('--px', 0);
        stack.style.setProperty('--py', 0);
      });
    } else {
      var ticking = false;
      window.addEventListener('scroll', function () {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(function () {
          var b = stack.getBoundingClientRect();
          var center = b.top + b.height / 2;
          var ny = (center - innerHeight / 2) / (innerHeight / 2);
          ny = Math.max(-1, Math.min(1, ny));
          stack.style.setProperty('--py', (ny * range).toFixed(1));
          ticking = false;
        });
      }, { passive: true });
    }
  }

  /* Подсказка «листайте вниз» уходит, как только человек начал листать. */
  function markScrolled() {
    if (window.scrollY > 24) {
      document.documentElement.classList.add('scrolled');
      window.removeEventListener('scroll', markScrolled);
    }
  }
  window.addEventListener('scroll', markScrolled, { passive: true });
  markScrolled();

  document.querySelectorAll('[data-transition]').forEach(function (a) {
    a.addEventListener('click', function (e) {
      if (window.ChkaReducedMotion || e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
      var card = a.closest('.card'), pic = a.querySelector('.pic') || (card && card.querySelector('.pic'));
      var href = a.getAttribute('href');
      if (!pic || !href) return;
      e.preventDefault();
      var b = pic.getBoundingClientRect();
      var clone = pic.cloneNode(true);
      clone.style.cssText = 'position:fixed;margin:0;left:' + b.left + 'px;top:' + b.top + 'px;' +
        'width:' + b.width + 'px;height:' + b.height + 'px;z-index:999;' +
        'transition:transform 420ms cubic-bezier(.4,0,.2,1), opacity 420ms ease, border-radius 420ms ease;' +
        'transform-origin:top left;will-change:transform;';
      document.body.appendChild(clone);
      requestAnimationFrame(function () {
        var sx = innerWidth / b.width, sy = innerHeight / b.height;
        var s = Math.max(sx, sy) * 1.02;
        clone.style.transform = 'translate(' +
          (innerWidth / 2 - (b.left + b.width / 2)) + 'px,' +
          (innerHeight / 2 - (b.top + b.height / 2)) + 'px) scale(' + s + ')';
        clone.style.opacity = '0.0001';
      });
      setTimeout(function () { location.href = href; }, 260);
    });
  });

  /* ---------- s39: плавная прокрутка к блокам («Листайте вниз», кнопки открытки) ----------
     Своя прокрутка с кривой «быстрый старт — долгое торможение» (docs/ANIMATION.md): одинаково плавно в Safari и Chrome.
     Колесо, касание или клавиша посреди пути — прокрутка сразу отдаёт управление человеку. */
  var root = document.documentElement;
  function navH() { var n = document.querySelector('.nav'); return n ? n.getBoundingClientRect().height : 0; }
  function scrollToEl(el) {
    var y = Math.max(0, Math.round(el.getBoundingClientRect().top + window.scrollY - navH() - 18));
    if (window.ChkaReducedMotion) { window.scrollTo(0, y); return; }
    var y0 = window.scrollY, dy = y - y0;
    if (Math.abs(dy) < 2) return;
    var dur = Math.min(1250, 650 + Math.abs(dy) * 0.25), t0 = performance.now(), stop = false;
    var cancel = function () { stop = true; };
    ['wheel', 'touchstart', 'keydown'].forEach(function (ev) { window.addEventListener(ev, cancel, { passive: true, once: true }); });
    root.style.scrollBehavior = 'auto';
    (function step(t) {
      if (stop) { root.style.scrollBehavior = ''; return; }
      var k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 4);
      window.scrollTo(0, y0 + dy * e);
      if (k < 1) requestAnimationFrame(step); else root.style.scrollBehavior = '';
    })(t0);
  }
  document.querySelectorAll('a[href^="#"]').forEach(function (a) {
    a.addEventListener('click', function (e) {
      var id = a.getAttribute('href').slice(1), t = id && document.getElementById(id);
      if (!t) return;
      e.preventDefault();
      /* к началу раздела (с подписью «Зал I»), а не к самому заголовку: заголовки проявляются сдвигом (.reveal), раздел — нет */
      scrollToEl(t.closest('section') || t);
    });
  });

  /* ---------- s39: гранат рисуется, текст выходит строками ---------- */
  var fig = document.querySelector('[data-pg]'), txt = document.querySelector('[data-lines]');
  if (fig && txt && !window.ChkaReducedMotion && 'IntersectionObserver' in window) {
    /* слова — в span.w; номер строки (--ln) — по вертикальному положению слова после раскладки */
    var walk = function (node) {
      Array.prototype.slice.call(node.childNodes).forEach(function (n) {
        if (n.nodeType === 3) {
          var parts = n.nodeValue.split(/(\s+)/), frag = document.createDocumentFragment();
          parts.forEach(function (w) {
            if (!w) return;
            if (/^\s+$/.test(w)) { frag.appendChild(document.createTextNode(w)); return; }
            var sp = document.createElement('span'); sp.className = 'w'; sp.textContent = w; frag.appendChild(sp);
          });
          n.parentNode.replaceChild(frag, n);
        } else if (n.nodeType === 1 && n.tagName !== 'svg') walk(n);
      });
    };
    walk(txt);
    var numberLines = function () {
      var tops = [], ws = txt.querySelectorAll('.w');
      ws.forEach(function (w) {
        if (!w.offsetParent) return;   /* слово другого языка — скрыто */
        var top = Math.round(w.getBoundingClientRect().top);
        var i = tops.findIndex(function (t) { return Math.abs(t - top) < 6; });
        if (i < 0) { tops.push(top); i = tops.length - 1; }
        w.style.setProperty('--ln', Math.min(i, 14));
      });
    };
    fig.classList.add('pg-armed');
    txt.classList.add('lines-armed');
    var k = parseFloat(getComputedStyle(fig).getPropertyValue('--k')) || 1;
    var io = new IntersectionObserver(function (es) {
      if (!es.some(function (e) { return e.isIntersecting; })) return;
      io.disconnect();
      numberLines();
      requestAnimationFrame(function () {
        fig.classList.add('drawn');
        txt.classList.add('lines-in');
        setTimeout(function () { fig.classList.add('alive'); }, (5.6 * k) * 1000);
      });
    }, { threshold: 0.3 });
    io.observe(fig);
    /* язык сменили до появления — строки пересчитать */
    document.addEventListener('chka-lang', function () { if (!txt.classList.contains('lines-in')) numberLines(); });
    /* лёгкий параллакс рисунка в паспарту — только ПК с мышью */
    if (window.ChkaFinePointer && matchMedia('(min-width: 860px)').matches) {
      var art = fig.querySelector('.pg'), ticking = false;
      window.addEventListener('scroll', function () {
        if (ticking) return; ticking = true;
        requestAnimationFrame(function () {
          var b = fig.getBoundingClientRect(), c = (b.top + b.height / 2 - innerHeight / 2) / innerHeight;
          art.style.transform = 'translate3d(0,' + (Math.max(-1, Math.min(1, c)) * -10).toFixed(2) + 'px,0)';
          ticking = false;
        });
      }, { passive: true });
    }
  }
})();
