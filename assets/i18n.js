/* Չկա — три языка (հայ/рус/eng), показан всегда только один.

   Как это устроено. У каждого переводимого куска — несколько соседних
   элементов с lang="hy" / lang="ru" / lang="en" И классом .i18n-inline
   или .i18n-block (какой уместен по типу элемента — строчный или
   блочный). Кто из них виден — решает ЧИСТЫЙ CSS в hub.css по атрибуту
   data-lang на <html>: показ/скрытие языка не ждёт этого файла и не
   мигает чужим языком, даже если скрипт подгрузится с задержкой.

   Этот файл — только: определить язык при первом заходе (по браузеру),
   запомнить выбор в localStorage и построить кнопки в меню: «А+»
   (крупный текст) и круглый переключатель ՀԱՅ/РУС/ENG.
   Сама подстановка data-lang ПОВТОРЕНА маленьким инлайн-скриптом в
   <head> каждой страницы — вот он и убирает мигание, этот файл лишь
   защитная копия той же логики плюс интерфейс переключателя. */
(function () {
  var KEY = 'chka-lang';
  var LANGS = ['hy', 'ru', 'en'];
  var LABELS = { hy: 'ՀԱՅ', ru: 'РУС', en: 'ENG' };

  function detect() {
    try {
      var saved = localStorage.getItem(KEY);
      if (saved && LANGS.indexOf(saved) !== -1) return saved;
    } catch (e) {}
    var nav = ((navigator.languages && navigator.languages[0]) || navigator.language || '').toLowerCase();
    for (var i = 0; i < LANGS.length; i++) {
      if (nav.indexOf(LANGS[i]) === 0) return LANGS[i];
    }
    return 'hy';
  }

  var current = document.documentElement.getAttribute('data-lang') || detect();
  document.documentElement.setAttribute('data-lang', current);

  function setLang(l) {
    if (LANGS.indexOf(l) === -1) return;
    current = l;
    document.documentElement.setAttribute('data-lang', l);
    document.documentElement.setAttribute('lang', l);
    try { localStorage.setItem(KEY, l); } catch (e) {}
    if (dial) dial.paint();
    document.dispatchEvent(new CustomEvent('chka-lang', { detail: l }));
  }

  var NAMES = { hy: 'Հայերեն', ru: 'Русский', en: 'English' };
  var UI = {
    lang: { hy: 'Լեզու', ru: 'Язык', en: 'Language' },
    bigger: { hy: 'Մեծ տառեր', ru: 'Крупный текст', en: 'Larger text' }
  };
  var dial = null;

  /* Круглая кнопка с текущим языком; остальные языки выезжают из неё
     вниз столбиком. Закрывается вторым нажатием, выбором, тапом мимо
     или клавишей Esc. */
  function buildSwitch() {
    var el = document.createElement('div');
    el.className = 'lang-switch';
    var cur = document.createElement('button');
    cur.type = 'button';
    cur.className = 'ctl lang-cur';
    cur.setAttribute('aria-expanded', 'false');
    el.appendChild(cur);
    var opts = [];
    LANGS.forEach(function (l) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'ctl lang-opt';
      b.setAttribute('data-l', l);
      b.setAttribute('lang', l);
      b.setAttribute('aria-label', NAMES[l]);
      b.textContent = LABELS[l];
      b.tabIndex = -1;
      b.addEventListener('click', function () { setLang(l); toggle(false); cur.focus(); });
      el.appendChild(b);
      opts.push(b);
    });
    function toggle(open) {
      el.classList.toggle('open', open);
      cur.setAttribute('aria-expanded', open ? 'true' : 'false');
      opts.forEach(function (b) { b.tabIndex = open && b.getAttribute('data-l') !== current ? 0 : -1; });
    }
    function paint() {
      cur.textContent = LABELS[current];
      cur.setAttribute('lang', current);
      cur.setAttribute('aria-label', UI.lang[current] + ': ' + NAMES[current]);
      var i = 0;
      opts.forEach(function (b) {
        var me = b.getAttribute('data-l') === current;
        b.hidden = me;
        if (!me) b.style.setProperty('--i', ++i);
      });
    }
    cur.addEventListener('click', function () { toggle(!el.classList.contains('open')); });
    document.addEventListener('pointerdown', function (e) {
      if (el.classList.contains('open') && !el.contains(e.target)) toggle(false);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && el.classList.contains('open')) { toggle(false); cur.focus(); }
    });
    dial = { paint: paint };
    paint();
    return el;
  }

  /* «А+» — весь текст крупнее на 15%. Выбор хранится в браузере и
     применяется до отрисовки маленьким скриптом в <head> страницы. */
  function buildFontButton() {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'ctl fs-btn';
    function paint() {
      var big = document.documentElement.classList.contains('fs-big');
      b.textContent = big ? 'A−' : 'A+';
      b.setAttribute('aria-pressed', big ? 'true' : 'false');
      b.setAttribute('aria-label', UI.bigger[current]);
    }
    b.addEventListener('click', function () {
      var big = !document.documentElement.classList.contains('fs-big');
      document.documentElement.classList.toggle('fs-big', big);
      try { localStorage.setItem('chka-fs', big ? 'big' : 'normal'); } catch (e) {}
      paint();
    });
    document.addEventListener('chka-lang', paint);
    paint();
    return b;
  }

  window.ChkaI18n = { get: function () { return current; }, set: setLang, LANGS: LANGS };

  function boot() {
    var mount = document.querySelector('[data-lang-switch]');
    if (mount && !mount.firstChild) {
      mount.classList.add('nav-ctrls');
      mount.appendChild(buildFontButton());
      mount.appendChild(buildSwitch());
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
