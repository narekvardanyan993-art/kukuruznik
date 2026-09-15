/* Չկա — страница здания: слайдер (через chka-common), галерея-лайтбокс,
   окно 3D поверх страницы, мини-игра «угадай год». */
(function () {
  var plate = document.getElementById('plate');
  if (plate && window.ChkaCompareSlider) window.ChkaCompareSlider(plate, 38);

  /* ---------- галерея: лайтбокс со свайпом (нативный скролл) ---------- */

  (function () {
    var items = [].slice.call(document.querySelectorAll('.g-item'));
    if (!items.length) return;
    var lightbox = document.getElementById('lightbox');
    var img = document.getElementById('lbImg');
    var cap = document.getElementById('lbCap');
    if (!lightbox || !img) return;
    var idx = 0;

    function show(i) {
      idx = (i + items.length) % items.length;
      var it = items[idx];
      img.src = it.getAttribute('data-full');
      img.alt = it.getAttribute('data-cap') || '';
      var ru = it.getAttribute('data-cap') || '';
      var hy = it.getAttribute('data-cap-hy') || '';
      cap.innerHTML = ru + (hy ? ' <span class="hy" lang="hy">· ' + hy + '</span>' : '');
    }
    function open(i) {
      show(i);
      lightbox.hidden = false;
      document.body.style.overflow = 'hidden';
    }
    function close() {
      lightbox.hidden = true;
      document.body.style.overflow = '';
    }
    items.forEach(function (it, i) {
      it.addEventListener('click', function () { open(i); });
    });
    var btnClose = document.getElementById('lbClose');
    var btnPrev = document.getElementById('lbPrev');
    var btnNext = document.getElementById('lbNext');
    if (btnClose) btnClose.addEventListener('click', close);
    if (btnPrev) btnPrev.addEventListener('click', function () { show(idx - 1); });
    if (btnNext) btnNext.addEventListener('click', function () { show(idx + 1); });
    lightbox.addEventListener('click', function (e) {
      if (e.target === lightbox) close();
    });
    document.addEventListener('keydown', function (e) {
      if (lightbox.hidden) return;
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowLeft') show(idx - 1);
      else if (e.key === 'ArrowRight') show(idx + 1);
    });
    /* свайп внутри лайтбокса */
    var sx = null;
    lightbox.addEventListener('touchstart', function (e) { sx = e.touches[0].clientX; }, { passive: true });
    lightbox.addEventListener('touchend', function (e) {
      if (sx == null) return;
      var dx = e.changedTouches[0].clientX - sx;
      if (Math.abs(dx) > 40) show(idx + (dx < 0 ? 1 : -1));
      sx = null;
    }, { passive: true });
  })();

  /* ---------- окно 3D поверх страницы ---------- */

  (function () {
    var cfg = window.CHKA_BUILDING || {};
    var openBtn = document.getElementById('open3d');
    var overlay = document.getElementById('sceneOverlay');
    var closeBtn = document.getElementById('sceneClose');
    var frame = document.getElementById('sceneFrame');
    if (!openBtn || !overlay || !frame || !cfg.scene) return;
    var loaded = false;

    function openScene() {
      if (!loaded) { frame.src = cfg.scene; loaded = true; }
      overlay.hidden = false;
      requestAnimationFrame(function () { overlay.classList.add('open'); });
      document.body.style.overflow = 'hidden';
    }
    function closeScene() {
      overlay.classList.remove('open');
      document.body.style.overflow = '';
      setTimeout(function () { overlay.hidden = true; }, window.ChkaReducedMotion ? 0 : 340);
    }
    openBtn.addEventListener('click', openScene);
    if (closeBtn) closeBtn.addEventListener('click', closeScene);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !overlay.hidden) closeScene();
    });
    window.addEventListener('message', function (e) {
      if (e.data && e.data.chka === 'close-3d') closeScene();
    });
  })();

  /* ---------- угадай год ---------- */

  (function () {
    var root = document.getElementById('quiz');
    var cfg = window.CHKA_BUILDING || {};
    var qs = cfg.quiz || [];
    if (!root || !qs.length) return;

    var i = 0, score = 0;

    function optText(o) { return typeof o === 'string' ? { ru: o, hy: '' } : o; }

    function renderQuestion() {
      var q = qs[i];
      var dots = '';
      for (var d = 0; d < qs.length; d++) dots += '<span class="' + (d < i ? 'done' : '') + '"></span>';
      var opts = q.options.map(function (raw, n) {
        var o = optText(raw);
        return '<button class="q-opt" type="button" data-i="' + n + '">' + o.ru +
          (o.hy ? '<span class="hy" lang="hy">' + o.hy + '</span>' : '') + '</button>';
      }).join('');
      root.innerHTML =
        '<div class="q-progress">' + dots + '</div>' +
        '<p class="q-text">' + q.q + '</p>' +
        '<p class="q-text-hy hy" lang="hy">' + q.qHy + '</p>' +
        '<div class="q-options">' + opts + '</div>';
      window.ChkaDrawFrames && window.ChkaDrawFrames(root);
      var buttons = root.querySelectorAll('.q-opt');
      buttons.forEach(function (btn) {
        btn.addEventListener('click', function () {
          var n = +btn.getAttribute('data-i');
          buttons.forEach(function (b) { b.disabled = true; });
          if (n === q.correct) { btn.classList.add('correct'); score++; }
          else {
            btn.classList.add('wrong');
            buttons[q.correct].classList.add('correct');
          }
          setTimeout(function () {
            i++;
            if (i < qs.length) renderQuestion(); else renderResult();
          }, 850);
        });
      });
    }

    function shareText() {
      var t = cfg.shareText || 'Угадал {score} из {total}!';
      return t.replace('{score}', score).replace('{total}', qs.length);
    }

    function toast(text) {
      var el = document.querySelector('.q-toast');
      if (!el) {
        el = document.createElement('div');
        el.className = 'q-toast';
        document.body.appendChild(el);
      }
      el.textContent = text;
      requestAnimationFrame(function () { el.classList.add('show'); });
      setTimeout(function () { el.classList.remove('show'); }, 2200);
    }

    function renderResult() {
      var full = score === qs.length;
      var none = score === 0;
      var msg = full ? 'Ты знаешь Кукурузник лучше многих ереванцев!'
        : none ? 'Есть куда расти — но теперь ты знаешь его историю.'
        : 'Неплохо! Кукурузник запомнил.';
      var msgHy = full ? 'Կուկուրուզնիկը ավելի լավ գիտես, քան շատերը'
        : none ? 'Հիմա գիտես նրա պատմությունը'
        : 'Անվատ չէ';
      root.innerHTML =
        '<div class="q-result">' +
        '<p class="q-score">' + score + ' / ' + qs.length + '</p>' +
        '<p class="q-msg">' + msg + '</p>' +
        '<p class="q-msg-hy hy" lang="hy">' + msgHy + '</p>' +
        '<button class="q-share" type="button">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="2.6"/><circle cx="6" cy="12" r="2.6"/><circle cx="18" cy="19" r="2.6"/><path d="M8.4 10.7l7.2-4M8.4 13.3l7.2 4"/></svg>' +
        'поделиться</button>' +
        '<button class="q-again" type="button">пройти ещё раз · <span class="hy" lang="hy">կրկին փորձել</span></button>' +
        '</div>';
      window.ChkaDrawFrames && window.ChkaDrawFrames(root);
      root.querySelector('.q-share').addEventListener('click', function () {
        var text = shareText();
        if (navigator.share) {
          navigator.share({ title: cfg.shareTitle || document.title, text: text, url: location.href }).catch(function () {});
        } else if (navigator.clipboard) {
          navigator.clipboard.writeText(text + ' ' + location.href).then(function () {
            toast('Скопировано — вставь в TikTok');
          }).catch(function () { toast(text); });
        } else {
          toast(text);
        }
      });
      root.querySelector('.q-again').addEventListener('click', function () {
        i = 0; score = 0; renderQuestion();
      });
    }

    renderQuestion();
  })();
})();
