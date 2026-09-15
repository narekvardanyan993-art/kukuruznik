/* Չկա — главная. Специфика именно этой страницы: переход-разворот на
   карточку здания. Рамки, проявление при прокрутке и приподнятие
   карточек — в assets/chka-common.js, подключённом раньше этого файла. */
(function () {
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
