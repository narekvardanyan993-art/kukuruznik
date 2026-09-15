/* Չկա — главная. Специфика именно этой страницы: включение слайдера
   реставрации, параллакс большого фото, переход-разворот на карточку
   здания. Рамки, проявление при прокрутке и приподнятие карточек —
   в assets/chka-common.js, подключённом раньше этого файла. */
(function () {
  var plate = document.getElementById('plate');
  if (plate && window.ChkaCompareSlider) window.ChkaCompareSlider(plate, 38);

  /* ---------- параллакс от мыши и прокрутки (только мышь+курсор) ---------- */

  if (window.ChkaFinePointer && !window.ChkaReducedMotion) {
    var hero = document.querySelector('.hero');
    if (hero && plate) {
      var raf = null, px = 0, py = 0;
      function setVars() {
        raf = null;
        plate.querySelectorAll('.layer').forEach(function (l) {
          l.style.setProperty('--px', px.toFixed(2));
          l.style.setProperty('--py', py.toFixed(2));
        });
      }
      hero.addEventListener('mousemove', function (e) {
        var b = plate.getBoundingClientRect();
        var cx = b.left + b.width / 2, cy = b.top + b.height / 2;
        px = Math.max(-1, Math.min(1, (e.clientX - cx) / b.width)) * -7;
        py = Math.max(-1, Math.min(1, (e.clientY - cy) / b.height)) * -7;
        plate.classList.add('parallax');
        if (!raf) raf = requestAnimationFrame(setVars);
      });
      hero.addEventListener('mouseleave', function () {
        px = 0; py = 0;
        if (!raf) raf = requestAnimationFrame(setVars);
      });
      window.addEventListener('scroll', function () {
        var b = plate.getBoundingClientRect();
        var mid = b.top + b.height / 2 - window.innerHeight / 2;
        py = Math.max(-1, Math.min(1, mid / window.innerHeight)) * 6;
        plate.classList.add('parallax');
        if (!raf) raf = requestAnimationFrame(setVars);
      }, { passive: true });
    }
  }

  /* ---------- переход на страницу здания: карточка «разворачивается» ---------- */

  document.querySelectorAll('[data-transition]').forEach(function (a) {
    a.addEventListener('click', function (e) {
      if (window.ChkaReducedMotion || e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
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
