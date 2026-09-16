/* Չկա — страница здания: слайдер (через chka-common),
   окно 3D поверх страницы, мини-игра «угадай год». Всё, что рисует сам
   JS (игра), тоже на трёх языках — берёт текущий язык из
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

  /* Галерея фото (полноэкранный просмотр, жесты, зум) — отдельный
     файл assets/gallery.js. */

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
      var btn = e && e.currentTarget;
      if (btn && !window.ChkaReducedMotion) {
        btn.classList.remove('stamped');
        void btn.offsetWidth;
        btn.classList.add('stamped');
      }
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
      function addCheck(btn) {
        var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('class', 'q-check');
        svg.setAttribute('aria-hidden', 'true');
        svg.innerHTML = '<path d="M4 13l5 5L20 6" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>';
        btn.appendChild(svg);
      }
      buttons.forEach(function (btn) {
        btn.addEventListener('click', function () {
          var n = +btn.getAttribute('data-i');
          buttons.forEach(function (b) { b.disabled = true; });
          if (n === q.correct) { btn.classList.add('correct'); addCheck(btn); score++; }
          else {
            btn.classList.add('wrong');
            buttons[q.correct].classList.add('correct');
            addCheck(buttons[q.correct]);
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
