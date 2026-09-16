/* Չկա — три языка (հայ/рус/eng), показан всегда только один.

   Как это устроено. У каждого переводимого куска — несколько соседних
   элементов с lang="hy" / lang="ru" / lang="en" И классом .i18n-inline
   или .i18n-block (какой уместен по типу элемента — строчный или
   блочный). Кто из них виден — решает ЧИСТЫЙ CSS в hub.css по атрибуту
   data-lang на <html>: показ/скрытие языка не ждёт этого файла и не
   мигает чужим языком, даже если скрипт подгрузится с задержкой.

   Этот файл — только: определить язык при первом заходе (по браузеру),
   запомнить выбор в localStorage и построить переключатель ՀԱՅ/РУС/ENG.
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
    document.querySelectorAll('.lang-switch button').forEach(function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-l') === l ? 'true' : 'false');
    });
    document.dispatchEvent(new CustomEvent('chka-lang', { detail: l }));
  }

  function buildSwitch() {
    var el = document.createElement('div');
    el.className = 'lang-switch';
    el.setAttribute('role', 'group');
    el.setAttribute('aria-label', 'Language / Լեզու / Язык');
    LANGS.forEach(function (l) {
      var b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('data-l', l);
      b.setAttribute('aria-pressed', l === current ? 'true' : 'false');
      b.textContent = LABELS[l];
      b.addEventListener('click', function () { setLang(l); });
      el.appendChild(b);
    });
    return el;
  }

  window.ChkaI18n = { get: function () { return current; }, set: setLang, LANGS: LANGS };

  function boot() {
    var mount = document.querySelector('[data-lang-switch]');
    if (mount && !mount.firstChild) mount.appendChild(buildSwitch());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
