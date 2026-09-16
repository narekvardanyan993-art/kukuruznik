/* Չկա — страница «История»: полоса прогресса чтения. Рамки и
   проявление блоков — из chka-common.js, подключённого раньше. */
(function () {
  var bar = document.getElementById('progressBar');
  if (!bar) return;
  var ticking = false;
  function update() {
    var doc = document.documentElement;
    var max = doc.scrollHeight - doc.clientHeight;
    var p = max > 0 ? Math.min(1, Math.max(0, doc.scrollTop / max)) : 0;
    bar.style.transform = 'scaleX(' + p.toFixed(4) + ')';
    ticking = false;
  }
  window.addEventListener('scroll', function () {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(update);
  }, { passive: true });
  update();
})();
