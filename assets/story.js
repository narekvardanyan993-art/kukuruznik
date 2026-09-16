/* Չկա — страница здания: слайдер (через chka-common), галерея-лайтбокс,
   окно 3D поверх страницы, мини-игра «угадай год». Всё, что рисует сам
   JS (лайтбокс, игра), тоже на трёх языках — берёт текущий язык из
   window.ChkaI18n и перерисовывается на событие 'chka-lang'. */
(function () {
  function lang() { return (window.ChkaI18n && window.ChkaI18n.get()) || document.documentElement.getAttribute('data-lang') || 'hy'; }
  function pick(obj) { return (obj && (obj[lang()] || obj.ru || obj.en || obj.hy)) || ''; }

  var UI = {
    hy: { close: 'Փակել', prev: 'Նախորդ լուսանկարը', next: 'Հաջորդ լուսանկարը', share: 'կիսվել', again: 'կրկին փորձել', copied: 'Պատճենվեց — տեղադրիր TikTok-ում', closeScene: 'Փակել 3D-ն' },
    ru: { close: 'Закрыть', prev: 'Предыдущее фото', next: 'Следующее фото', share: 'поделиться', again: 'пройти ещё раз', copied: 'Скопировано — вставь в TikTok', closeScene: 'Закрыть 3D' },
    en: { close: 'Close', prev: 'Previous photo', next: 'Next photo', share: 'share', again: 'play again', copied: 'Copied — paste it into TikTok', closeScene: 'Close 3D' }
  };
  function ui(key) { return (UI[lang()] || UI.ru)[key]; }

  var plate = document.getElementById('plate');
  if (plate && window.ChkaCompareSlider) window.ChkaCompareSlider(plate, 50);

  /* ---------- галерея: лайтбокс со свайпом (нативный скролл) ---------- */

  (function () {
    var items = [].slice.call(document.querySelectorAll('.g-item'));
    if (!items.length) return;
    var lightbox = document.getElementById('lightbox');
    var img = document.getElementById('lbImg');
    var cap = document.getElementById('lbCap');
    var btnClose = document.getElementById('lbClose');
    var btnPrev = document.getElementById('lbPrev');
    var btnNext = document.getElementById('lbNext');
    if (!lightbox || !img) return;
    var idx = 0;

    function labels() {
      if (btnClose) btnClose.setAttribute('aria-label', ui('close'));
      if (btnPrev) btnPrev.setAttribute('aria-label', ui('prev'));
      if (btnNext) btnNext.setAttribute('aria-label', ui('next'));
    }

    function show(i) {
      idx = (i + items.length) % items.length;
      var it = items[idx];
      var l = lang();
      var capText = it.getAttribute('data-cap-' + l) || it.getAttribute('data-cap-ru') || '';
      var credit = it.getAttribute('data-credit-' + l) || it.getAttribute('data-credit-ru') || '';
      img.src = it.getAttribute('data-full');
      img.alt = capText;
      cap.innerHTML = capText + (credit ? '<br>' + credit : '');
    }
    function open(i) {
      labels();
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

    document.addEventListener('chka-lang', function () {
      labels();
      if (!lightbox.hidden) show(idx);
    });
  })();

  /* ---------- окно 3D поверх страницы ----------

     Кнопок «Смотреть в 3D» на странице две (наверху и после хроники) —
     у обеих настоящий href="scene.html". Без JS (или если он не успел
     подключиться) клик просто открывает 3D как обычную страницу, со
     своей кнопкой возврата — это и есть надёжный запасной вариант.
     С JS клик перехватывается и вместо перехода открывается то же
     самое scene.html во всплывающем слое поверх страницы: обычный
     position:fixed-блок с крестиком, БЕЗ Fullscreen API браузера — в
     Safari на Mac он вёл себя непредсказуемо (сворачивал окно). */

  (function () {
    var cfg = window.CHKA_BUILDING || {};
    var openBtns = document.querySelectorAll('.btn-3d');
    var overlay = document.getElementById('sceneOverlay');
    var closeBtn = document.getElementById('sceneClose');
    var frame = document.getElementById('sceneFrame');
    if (!openBtns.length || !overlay || !frame || !cfg.scene) return;
    var loaded = false;

    if (closeBtn) closeBtn.setAttribute('aria-label', ui('closeScene'));
    document.addEventListener('chka-lang', function () {
      if (closeBtn) closeBtn.setAttribute('aria-label', ui('closeScene'));
    });

    function openScene(e) {
      if (e) e.preventDefault();
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
    openBtns.forEach(function (btn) { btn.addEventListener('click', openScene); });
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

    var i = 0, score = 0, onResult = false;

    function optText(o) { return typeof o === 'string' ? o : pick(o); }

    function renderQuestion() {
      onResult = false;
      var q = qs[i];
      var dots = '';
      for (var d = 0; d < qs.length; d++) dots += '<span class="' + (d < i ? 'done' : '') + '"></span>';
      var opts = q.options.map(function (raw, n) {
        return '<button class="q-opt" type="button" data-i="' + n + '">' + optText(raw) + '</button>';
      }).join('');
      root.innerHTML =
        '<div class="q-progress">' + dots + '</div>' +
        '<p class="q-text">' + pick(q.q) + '</p>' +
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
      var t = pick(cfg.share && cfg.share.text) || 'Score: {score}/{total}';
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

    var MSG = {
      full: { ru: 'Ты знаешь Кукурузник лучше многих ереванцев!', hy: 'Կուկուրուզնիկը ավելի լավ գիտես, քան շատերը', en: 'You know the Corncob better than most Yerevantsis!' },
      none: { ru: 'Есть куда расти — но теперь ты знаешь его историю.', hy: 'Հիմա գիտես նրա պատմությունը', en: 'Room to grow — but now you know its story.' },
      mid: { ru: 'Неплохо! Кукурузник запомнил.', hy: 'Վատ չէ, Կուկուրուզնիկը մնաց հիշողության մեջ', en: 'Not bad! You will remember the Corncob.' }
    };

    function renderResult() {
      onResult = true;
      var full = score === qs.length;
      var none = score === 0;
      var msg = pick(full ? MSG.full : none ? MSG.none : MSG.mid);
      root.innerHTML =
        '<div class="q-result">' +
        '<p class="q-score">' + score + ' / ' + qs.length + '</p>' +
        '<p class="q-msg">' + msg + '</p>' +
        '<button class="q-share" type="button">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="2.6"/><circle cx="6" cy="12" r="2.6"/><circle cx="18" cy="19" r="2.6"/><path d="M8.4 10.7l7.2-4M8.4 13.3l7.2 4"/></svg>' +
        ui('share') + '</button>' +
        '<button class="q-again" type="button">' + ui('again') + '</button>' +
        '</div>';
      window.ChkaDrawFrames && window.ChkaDrawFrames(root);
      root.querySelector('.q-share').addEventListener('click', function () {
        var text = shareText();
        if (navigator.share) {
          navigator.share({ title: pick(cfg.share && cfg.share.title) || document.title, text: text, url: location.href }).catch(function () {});
        } else if (navigator.clipboard) {
          navigator.clipboard.writeText(text + ' ' + location.href).then(function () {
            toast(ui('copied'));
          }).catch(function () { toast(text); });
        } else {
          toast(text);
        }
      });
      root.querySelector('.q-again').addEventListener('click', function () {
        i = 0; score = 0; renderQuestion();
      });
    }

    document.addEventListener('chka-lang', function () {
      if (onResult) renderResult(); else renderQuestion();
    });

    renderQuestion();
  })();
})();
