/* Չկա — общее для всех страниц альбома: карандашные рамки вокруг фото,
   проявление блоков при прокрутке, «приподнятие» карточек и слайдер
   «было / стало». Подключать первым скриптом на любой новой странице
   здания — эти четыре вещи нужны всем. */
(function () {
  document.documentElement.classList.add('js');

  window.ChkaReducedMotion = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  window.ChkaFinePointer = !!(window.matchMedia && matchMedia('(hover: hover) and (pointer: fine)').matches);

  var SVGNS = 'http://www.w3.org/2000/svg';

  /* ---------- карандашная рамка на [data-frame] ---------- */

  function random(seed) {
    return function () {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };
  }
  function f(n) { return Math.round(n * 10) / 10; }
  function strokePath(r, x1, y1, x2, y2) {
    var dx = x2 - x1, dy = y2 - y1, len = Math.sqrt(dx * dx + dy * dy) || 1;
    var ux = dx / len, uy = dy / len, nx = -uy, ny = ux;
    var j = function (a) { return (r() - 0.5) * 2 * a; };
    var s0 = 0.6 + r() * 1.8, s1 = 0.6 + r() * 1.8;
    var n0 = j(0.6), n1 = j(0.6), bow = j(0.9);
    var ax = x1 - ux * s0 + nx * n0, ay = y1 - uy * s0 + ny * n0;
    var bx = x2 + ux * s1 + nx * n1, by = y2 + uy * s1 + ny * n1;
    var cx = (ax + bx) / 2 + nx * bow, cy = (ay + by) / 2 + ny * bow;
    return 'M' + f(ax) + ' ' + f(ay) + 'Q' + f(cx) + ' ' + f(cy) + ' ' + f(bx) + ' ' + f(by);
  }
  function rectPath(r) {
    var p = [[0, 0], [100, 0], [100, 100], [0, 100]], d = '';
    for (var i = 0; i < 4; i++) d += strokePath(r, p[i][0], p[i][1], p[(i + 1) % 4][0], p[(i + 1) % 4][1]);
    return d;
  }
  function drawFrames(root) {
    var boxes = (root || document).querySelectorAll('[data-frame]:not([data-framed])');
    for (var i = 0; i < boxes.length; i++) {
      boxes[i].setAttribute('data-framed', '');
      var r = random(97 + i * 131 + Math.round(Math.random() * 999));
      var svg = document.createElementNS(SVGNS, 'svg');
      svg.setAttribute('class', 'frame');
      svg.setAttribute('viewBox', '0 0 100 100');
      svg.setAttribute('preserveAspectRatio', 'none');
      svg.setAttribute('aria-hidden', 'true');
      for (var k = 0; k < 2; k++) {
        var path = document.createElementNS(SVGNS, 'path');
        path.setAttribute('d', rectPath(r));
        path.setAttribute('vector-effect', 'non-scaling-stroke');
        path.setAttribute('class', k ? 'p2' : 'p1');
        svg.appendChild(path);
      }
      boxes[i].appendChild(svg);
    }
  }
  drawFrames();
  window.ChkaDrawFrames = drawFrames;

  /* ---------- проявление блоков при прокрутке ---------- */

  function initReveal(root) {
    var els = (root || document).querySelectorAll('.reveal:not([data-revealed])');
    if (!els.length) return;
    if (window.ChkaReducedMotion || !('IntersectionObserver' in window)) {
      els.forEach(function (el) { el.setAttribute('data-revealed', ''); el.classList.add('in'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          en.target.classList.add('in');
          en.target.setAttribute('data-revealed', '');
          io.unobserve(en.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
    els.forEach(function (el) { io.observe(el); });
  }
  initReveal();
  window.ChkaInitReveal = initReveal;

  /* ---------- порядковая задержка карточек в ряду/сетке ---------- */

  function setStagger(root) {
    (root || document).querySelectorAll('.cards, .gallery, .g-row').forEach(function (group) {
      var i = 0;
      [].forEach.call(group.children, function (child) {
        if (child.classList && child.classList.contains('reveal') && !child.hasAttribute('data-staggered')) {
          child.style.setProperty('--stagger', i);
          child.setAttribute('data-staggered', '');
        }
        i++;
      });
    });
  }
  setStagger();
  window.ChkaSetStagger = setStagger;

  /* ---------- карточки/плитки «приподнимаются» от касания ---------- */

  document.querySelectorAll('.card, [data-lift]').forEach(function (card) {
    card.addEventListener('pointerdown', function () { card.classList.add('lift'); });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (ev) {
      card.addEventListener(ev, function () { card.classList.remove('lift'); });
    });
    var link = card.querySelector('a');
    if (link) {
      link.addEventListener('focus', function () { card.classList.add('lift'); });
      link.addEventListener('blur', function () { card.classList.remove('lift'); });
    }
  });

  /* ---------- слайдер «было / стало» ----------
     Ожидает разметку: обёртка с классом .plate (получает .dragging),
     внутри .plate-in (получает --pos), внутри неё .handle (role=slider). */

  window.ChkaCompareSlider = function (plate, initial) {
    if (!plate) return;
    var plateIn = plate.querySelector('.plate-in');
    var handle = plate.querySelector('.handle');
    if (!plateIn || !handle) return;

    var pos = initial == null ? 38 : initial;
    var dragging = false;

    function apply(p) {
      pos = Math.max(0, Math.min(100, p));
      plateIn.style.setProperty('--pos', pos + '%');
      handle.setAttribute('aria-valuenow', String(Math.round(pos)));
    }
    function fromClientX(x) {
      var b = plateIn.getBoundingClientRect();
      return ((x - b.left) / b.width) * 100;
    }
    function down(e) {
      dragging = true;
      plate.classList.add('dragging');
      if (handle.setPointerCapture && e.pointerId != null) {
        try { handle.setPointerCapture(e.pointerId); } catch (err) {}
      }
      move(e);
    }
    function move(e) {
      if (!dragging) return;
      var x = e.clientX != null ? e.clientX : (e.touches && e.touches[0] && e.touches[0].clientX);
      if (x == null) return;
      apply(fromClientX(x));
      e.preventDefault();
    }
    function up() {
      if (!dragging) return;
      dragging = false;
      plate.classList.remove('dragging');
    }

    handle.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    plateIn.addEventListener('pointerdown', function (e) {
      if (e.target === handle || handle.contains(e.target)) return;
      plate.classList.add('dragging');
      apply(fromClientX(e.clientX));
      plate.classList.remove('dragging');
    });
    handle.addEventListener('keydown', function (e) {
      var step = e.shiftKey ? 12 : 5;
      if (e.key === 'ArrowLeft') { apply(pos - step); e.preventDefault(); }
      else if (e.key === 'ArrowRight') { apply(pos + step); e.preventDefault(); }
      else if (e.key === 'Home') { apply(0); e.preventDefault(); }
      else if (e.key === 'End') { apply(100); e.preventDefault(); }
    });

    apply(pos);

    /* Первое движение само — туда и обратно, — чтобы было видно, что
       здесь можно тянуть. Один раз, дальше решает пользователь. */
    if (!window.ChkaReducedMotion) {
      var imgs = plate.querySelectorAll('img');
      Promise.all([].map.call(imgs, function (img) {
        return new Promise(function (done) {
          if (img.complete && img.naturalWidth) return done();
          img.addEventListener('load', done, { once: true });
          img.addEventListener('error', done, { once: true });
        });
      })).then(function () {
        setTimeout(function () {
          if (dragging) return;
          plate.classList.remove('dragging');
          apply(Math.min(92, pos + 34));
          setTimeout(function () { if (!dragging) apply(pos - 34); }, 900);
        }, 900);
      });
    }

    return { set: apply };
  };
})();
