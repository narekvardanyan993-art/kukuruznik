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
