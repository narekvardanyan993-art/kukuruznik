/* Страницы продажи надписи (/buy, /t, /i, /f, /pay, /thanks) — переключатель языка, переход на кассу, «показать друзьям».
   Делает tools/build_sale_pages.py вместе со страницами. Страница сама ничего не перекидывает, кроме /pay (data-page="pay"). */
(function () {
  var d = document, root = d.documentElement, page = d.body.getAttribute('data-page');
  var LANGS = ['hy', 'ru', 'en'];
  var MONTHS = {
    hy: ['հունվարի', 'փետրվարի', 'մարտի', 'ապրիլի', 'մայիսի', 'հունիսի', 'հուլիսի', 'օգոստոսի', 'սեպտեմբերի', 'հոկտեմբերի', 'նոյեմբերի', 'դեկտեմբերի'],
    ru: ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'],
    en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  };

  function curLang() { var l = root.getAttribute('data-lang'); return LANGS.indexOf(l) < 0 ? 'hy' : l; }

  function fmtDate(dt, l) {
    var day = dt.getDate(), m = MONTHS[l][dt.getMonth()];
    return l === 'en' ? m + ' ' + day : day + ' ' + m;
  }
  function fillDate() {
    var el = d.querySelector('.when');
    if (!el) return;
    var n = parseInt(el.getAttribute('data-days'), 10) || 2, dt = new Date();
    dt.setDate(dt.getDate() + n);
    el.textContent = fmtDate(dt, curLang());
  }

  function setLang(l, save) {
    if (LANGS.indexOf(l) < 0) return;
    root.setAttribute('data-lang', l);
    root.setAttribute('lang', l);
    if (save) { try { localStorage.setItem('chka-lang', l); } catch (e) {} }
    var bs = d.querySelectorAll('[data-set-lang]');
    for (var i = 0; i < bs.length; i++) bs[i].setAttribute('aria-pressed', bs[i].getAttribute('data-set-lang') === l ? 'true' : 'false');
    fillDate();
  }
  var sw = d.querySelectorAll('[data-set-lang]');
  for (var i = 0; i < sw.length; i++) sw[i].addEventListener('click', function (e) { setLang(e.currentTarget.getAttribute('data-set-lang'), true); });
  setLang(curLang(), false);

  /* /pay: 1 секунда на счётчик Cloudflare (он шлёт данные, когда страница загрузилась), потом касса Polar с utm_source канала */
  if (page === 'pay') {
    var box = d.querySelector('[data-polar]');
    var base = box.getAttribute('data-polar');
    var ok = (box.getAttribute('data-channels') || '').split(',');
    var m = location.search.match(/[?&]src=([a-z]+)(?:&|$)/), src = m && ok.indexOf(m[1]) >= 0 ? m[1] : 'site';
    var to = base + (base.indexOf('?') < 0 ? '?' : '&') + 'utm_source=' + src;
    var links = d.querySelectorAll('[data-pay-link]');
    for (var j = 0; j < links.length; j++) links[j].setAttribute('href', to);
    setTimeout(function () { location.replace(to); }, 1000);
  }

  /* /thanks: «показать друзьям» — меню «Поделиться» телефона, а если его нет — копируем адрес */
  var sh = d.querySelector('[data-share]');
  if (sh) {
    sh.addEventListener('click', function () {
      var url = sh.getAttribute('data-url'), l = curLang();
      var done = function () { sh.classList.add('done'); setTimeout(function () { sh.classList.remove('done'); }, 2200); };
      if (navigator.share) {
        navigator.share({ title: sh.getAttribute('data-title-' + l), text: sh.getAttribute('data-text-' + l), url: url }).catch(function () {});
        return;
      }
      if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(url).then(done, function () {}); return; }
      var t = d.createElement('textarea'); t.value = url; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0';
      d.body.appendChild(t); t.select();
      try { if (d.execCommand('copy')) done(); } catch (e) {}
      d.body.removeChild(t);
    });
  }
})();
