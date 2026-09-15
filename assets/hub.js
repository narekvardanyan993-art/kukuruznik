/* Չկա — главная. Карандашные рамки, слайдер реставрации, живость. */
(function () {
  document.documentElement.classList.add('js');

  var reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var fine = window.matchMedia && matchMedia('(hover: hover) and (pointer: fine)').matches;

  var SVG = 'http://www.w3.org/2000/svg';

  function random(seed) {
    return function () {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };
  }

  function f(n) { return Math.round(n * 10) / 10; }

  function stroke(r, x1, y1, x2, y2) {
    var dx = x2 - x1, dy = y2 - y1, len = Math.sqrt(dx * dx + dy * dy);
    var ux = dx / len, uy = dy / len, nx = -uy, ny = ux;
    var j = function (a) { return (r() - 0.5) * 2 * a; };
    var s0 = 0.6 + r() * 1.8, s1 = 0.6 + r() * 1.8;
    var n0 = j(0.6), n1 = j(0.6), bow = j(0.9);
    var ax = x1 - ux * s0 + nx * n0, ay = y1 - uy * s0 + ny * n0;
    var bx = x2 + ux * s1 + nx * n1, by = y2 + uy * s1 + ny * n1;
    var cx = (ax + bx) / 2 + nx * bow, cy = (ay + by) / 2 + ny * bow;
    return 'M' + f(ax) + ' ' + f(ay) + 'Q' + f(cx) + ' ' + f(cy) + ' ' + f(bx) + ' ' + f(by);
  }

  function rect(r) {
    var p = [[0, 0], [100, 0], [100, 100], [0, 100]], d = '';
    for (var i = 0; i < 4; i++) d += stroke(r, p[i][0], p[i][1], p[(i + 1) % 4][0], p[(i + 1) % 4][1]);
    return d;
  }

  var boxes = document.querySelectorAll('[data-frame]');
  for (var i = 0; i < boxes.length; i++) {
    var r = random(97 + i * 131);
    var svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('class', 'frame');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('aria-hidden', 'true');
    for (var k = 0; k < 2; k++) {
      var path = document.createElementNS(SVG, 'path');
      path.setAttribute('d', rect(r));
      path.setAttribute('vector-effect', 'non-scaling-stroke');
      path.setAttribute('class', k ? 'p2' : 'p1');
      svg.appendChild(path);
    }
    boxes[i].appendChild(svg);
  }

  /* ---------- слайдер «было / стало» ---------- */

  (function () {
    var plate = document.getElementById('plate');
    var plateIn = document.getElementById('plateIn');
    var handle = document.getElementById('handle');
    if (!plate || !plateIn || !handle) return;

    var pos = 38;
    function apply(p, animated) {
      pos = Math.max(0, Math.min(100, p));
      plate.classList.toggle('dragging', !animated && dragging);
      plateIn.style.setProperty('--pos', pos + '%');
      handle.setAttribute('aria-valuenow', String(Math.round(pos)));
    }

    var dragging = false;
    function fromClientX(x) {
      var b = plateIn.getBoundingClientRect();
      return ((x - b.left) / b.width) * 100;
    }

    function down(e) {
      dragging = true;
      plate.classList.add('dragging');
      handle.setPointerCapture && e.pointerId != null && handle.setPointerCapture(e.pointerId);
      move(e);
    }
    function move(e) {
      if (!dragging) return;
      var x = e.clientX != null ? e.clientX : (e.touches && e.touches[0].clientX);
      if (x == null) return;
      apply(fromClientX(x), true);
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
      apply(fromClientX(e.clientX), false);
      down(e);
    });

    handle.addEventListener('keydown', function (e) {
      var step = e.shiftKey ? 12 : 5;
      if (e.key === 'ArrowLeft') { apply(pos - step, false); e.preventDefault(); }
      else if (e.key === 'ArrowRight') { apply(pos + step, false); e.preventDefault(); }
      else if (e.key === 'Home') { apply(0, false); e.preventDefault(); }
      else if (e.key === 'End') { apply(100, false); e.preventDefault(); }
    });

    apply(38, false);

    /* Первое движение само, чтобы было видно: тут можно тянуть.
       Один проход туда-сюда, затем ползунок отпускается пользователю. */
    if (!reduced) {
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
          apply(72, false);
          setTimeout(function () { if (!dragging) apply(38, false); }, 900);
        }, 900);
      });
    }
  })();

  /* ---------- параллакс от мыши и прокрутки (только мышь+курсор) ---------- */

  if (fine && !reduced) {
    var hero = document.querySelector('.hero');
    var plateEl = document.getElementById('plate');
    if (hero && plateEl) {
      var raf = null, px = 0, py = 0;
      function setVars() {
        raf = null;
        plateEl.querySelectorAll('.layer').forEach(function (l) {
          l.style.setProperty('--px', px.toFixed(2));
          l.style.setProperty('--py', py.toFixed(2));
        });
      }
      hero.addEventListener('mousemove', function (e) {
        var b = plateEl.getBoundingClientRect();
        var cx = b.left + b.width / 2, cy = b.top + b.height / 2;
        px = Math.max(-1, Math.min(1, (e.clientX - cx) / b.width)) * -7;
        py = Math.max(-1, Math.min(1, (e.clientY - cy) / b.height)) * -7;
        plateEl.classList.add('parallax');
        if (!raf) raf = requestAnimationFrame(setVars);
      });
      hero.addEventListener('mouseleave', function () {
        px = 0; py = 0;
        if (!raf) raf = requestAnimationFrame(setVars);
      });
      window.addEventListener('scroll', function () {
        var b = plateEl.getBoundingClientRect();
        var mid = b.top + b.height / 2 - window.innerHeight / 2;
        py = Math.max(-1, Math.min(1, mid / window.innerHeight)) * 6;
        plateEl.classList.add('parallax');
        if (!raf) raf = requestAnimationFrame(setVars);
      }, { passive: true });
    }
  }

  /* ---------- проявление блоков при прокрутке ---------- */

  if ('IntersectionObserver' in window) {
    var revealEls = document.querySelectorAll('.reveal');
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          en.target.classList.add('in');
          io.unobserve(en.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
    revealEls.forEach(function (el) { io.observe(el); });
  } else {
    document.querySelectorAll('.reveal').forEach(function (el) { el.classList.add('in'); });
  }

  /* ---------- карточки «приподнимаются» — тач и клавиатура ---------- */

  document.querySelectorAll('.card').forEach(function (card) {
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

  /* ---------- переход на страницу здания: карточка «разворачивается» ---------- */

  document.querySelectorAll('[data-transition]').forEach(function (a) {
    a.addEventListener('click', function (e) {
      if (reduced || e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
      var pic = a.querySelector('.pic');
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
})();
