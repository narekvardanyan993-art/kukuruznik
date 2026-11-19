/* Лавка музея (концепт A, 19.11.2026): /shop, /buy /t /i /f (надпись — один экран: место → имя → кнопка), /w (обои), /pay, /thanks.
   Делает tools/build_sale_pages.py вместе со страницами. Страница сама ничего не перекидывает, кроме /pay (data-page="pay"). */
(function () {
  var d = document, root = d.documentElement, page = d.body.getAttribute('data-page');
  var LANGS = ['hy', 'ru', 'en'];
  var MONTHS = {
    hy: ['հունվարի', 'փետրվարի', 'մարտի', 'ապրիլի', 'մայիսի', 'հունիսի', 'հուլիսի', 'օգոստոսի', 'սեպտեմբերի', 'հոկտեմբերի', 'նոյեմբերի', 'դեկտեմբերի'],
    ru: ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'],
    en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  };
  var KEY = 'chka-sale-pick';
  var BAD = /[^\p{L}\p{M}' \-]/u;          // в имени — только буквы (любой алфавит), пробел, дефис, апостроф
  var LETTER = /^\p{L}\p{M}*$/u;            // пара: ровно одна буква (любой алфавит)
  var SEG = window.Intl && Intl.Segmenter ? new Intl.Segmenter() : null;
  function glyphs(v) { return SEG ? Array.from(SEG.segment(v), function (x) { return x.segment; }) : Array.from(v); }

  function curLang() { var l = root.getAttribute('data-lang'); return LANGS.indexOf(l) < 0 ? 'hy' : l; }
  function $(s, el) { return (el || d).querySelector(s); }
  function $$(s, el) { return Array.prototype.slice.call((el || d).querySelectorAll(s)); }
  function txt(el) { var s = el && el.querySelector('[lang="' + curLang() + '"]'); return s ? s.textContent : (el ? el.textContent : ''); }
  function save(o) { try { o.t = Date.now(); localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) {} }

  function fmtDate(dt, l) {
    var day = dt.getDate(), m = MONTHS[l][dt.getMonth()];
    return l === 'en' ? m + ' ' + day : day + ' ' + m;
  }
  function fillDate() {
    var el = $('.when');
    if (!el) return;
    var n = parseInt(el.getAttribute('data-days'), 10) || 7, dt = new Date();
    dt.setDate(dt.getDate() + n);
    el.textContent = fmtDate(dt, curLang());
  }
  var onLang = [];
  function setLang(l, keep) {
    if (LANGS.indexOf(l) < 0) return;
    root.setAttribute('data-lang', l);
    root.setAttribute('lang', l);
    if (keep) { try { localStorage.setItem('chka-lang', l); } catch (e) {} }
    $$('[data-set-lang]').forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-set-lang') === l ? 'true' : 'false'); });
    fillDate();
    onLang.forEach(function (f) { f(); });
  }
  $$('[data-set-lang]').forEach(function (b) { b.addEventListener('click', function () { setLang(b.getAttribute('data-set-lang'), true); }); });

  /* ---------------- надпись: место → имя → кнопка, один экран ---------------- */
  if (page === 'insc') insc();

  function insc() {
    var payBtn = $('a.btn'), payBase = payBtn.getAttribute('href');
    var pols = $$('.pol'), exImg = $('.ex-img'), mine = $('.mine'), mineImg = $('.mine-img');
    var st = { spot: null, a: '', b: '' };
    var n1 = $('#n1'), na = $('#na'), nb = $('#nb'), form = $('.names');

    function word(k) { return txt($('.dict [data-k="' + k + '"]')); }
    function nameOf(id) { return txt($('.dict [data-name="' + id + '"]')); }
    function textOf() {
      if (!st.spot) return '';
      return st.spot.type === 'couple' ? (st.a && st.b ? st.a + ' + ' + st.b : '') : st.a;
    }
    function okText() {
      if (!st.spot) return false;
      if (st.spot.type === 'couple') return LETTER.test(st.a) && LETTER.test(st.b) && glyphs(st.a).length === 1 && glyphs(st.b).length === 1;
      var t = st.a;
      return !!t && !BAD.test(t) && glyphs(t).length <= st.spot.max;
    }
    function limText() { return st.spot.type === 'couple' ? word('lim_two') : word('lim').replace('#', st.spot.max); }

    function pick(b, first) {
      if (!b || b.disabled) return;
      pols.forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
      var type = b.getAttribute('data-type');
      if (st.spot && st.spot.type !== type) { st.a = ''; st.b = ''; [n1, na, nb].forEach(function (i) { i.value = ''; }); }
      st.spot = { id: b.getAttribute('data-spot'), type: type, max: +b.getAttribute('data-max') || 1, n: +b.getAttribute('data-n'),
                  ex: b.getAttribute('data-ex'), exn: +b.getAttribute('data-exn'), mat: b.getAttribute('data-mat'), vw: b.style.getPropertyValue('--vw') || '1' };
      var c = type === 'couple';
      if (!c) { st.a = glyphs(st.a).slice(0, st.spot.max).join(''); n1.maxLength = st.spot.max; if (n1.value !== st.a) n1.value = st.a; }
      $('.g-name').hidden = c; $('.g-couple').hidden = !c;
      $('.l-name').hidden = c; $('.l-two').hidden = !c;
      $('.nd-name').hidden = c; $('.nd-two').hidden = !c;
      // пример художника: свой у места или ближайшего похожего — с честной подписью «с места № N» и вырезкой самого места рядом
      var want = '../assets/spots/' + st.spot.ex, own = st.spot.exn === st.spot.n;
      if (exImg.getAttribute('src') !== want) {
        exImg.classList.add('swap');
        var im = new Image();
        im.onload = im.onerror = function () { exImg.setAttribute('src', want); exImg.classList.remove('swap'); };
        im.src = want;
      }
      exImg.setAttribute('alt', word(c ? 'alt_pair' : 'alt_name'));
      $('.ex-own').hidden = !own; $('.ex-from').hidden = own;
      $('.exn').textContent = st.spot.exn;
      mine.hidden = own;
      $('.pic', mine).style.setProperty('--vw', st.spot.vw);
      mineImg.setAttribute('src', '../assets/spots/' + st.spot.id + '.webp');
      $('.need').hidden = true;
      update();
      if (!first && b.scrollIntoView && matchMedia('(max-width: 899px)').matches) b.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    }
    pols.forEach(function (b) { b.addEventListener('click', function () { pick(b, false); }); });

    function cleanName(v, max) { return glyphs(v.replace(/\s+/g, ' ').replace(/^\s+/, '').toUpperCase()).slice(0, max).join(''); }   // буквы режутся в камне заглавными (как NAREK в примере)
    function oneLetter(inp) {                                                    // в поле одна буква: новая заменяет старую
      var g = glyphs(inp.value.replace(/\s+/g, '')), raw = g.length ? g[g.length - 1] : '';
      var v = raw.toUpperCase();
      if (glyphs(v).length > 1) v = raw;                                         // «և» в верхнем регистре — две буквы: оставляем как есть
      if (inp.value !== v) inp.value = v;
      return v;
    }
    function onInput() {
      if (!st.spot) return;
      var c = st.spot.type === 'couple';
      if (c) { st.a = oneLetter(na); st.b = oneLetter(nb); }
      else {
        var cv = cleanName(n1.value, st.spot.max);
        if (n1.value !== cv) { var pos = n1.selectionStart; n1.value = cv; try { n1.setSelectionRange(pos, pos); } catch (e) {} }
        st.a = cv.trim(); st.b = '';
      }
      var bad = c ? (!!(st.a + st.b) && !(LETTER.test(st.a || 'x') && LETTER.test(st.b || 'x'))) : BAD.test(st.a);
      $('.bad').hidden = !bad;
      if (okText()) $('.need').hidden = true;
      update();
    }
    [n1, na, nb].forEach(function (i) {
      i.addEventListener('input', onInput);
      i.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        if (i === na) { nb.focus(); return; }
        if (okText()) payBtn.click(); else i.blur();
      });
    });
    na.addEventListener('input', function () { if (na.value) nb.focus(); });
    form.addEventListener('submit', function (e) { e.preventDefault(); });

    /* бирка у рисунка, счётчик, ссылка оплаты: /pay/?src=<канал>&spot=<место>&text=<текст> — меняется при выборе места и текста */
    function update() {
      if (!st.spot) return;
      var t = textOf(), typed = st.spot.type === 'couple' ? (st.a || st.b) : st.a;
      $('.t-your').hidden = !typed;
      var yv = $('.t-yours');
      yv.hidden = !typed;
      yv.textContent = st.spot.type === 'couple' ? (st.a || '…') + ' + ' + (st.b || '…') : st.a;
      $('.t-n').textContent = typed ? '' : nameOf(st.spot.id);
      $('.t-n').hidden = !!typed;
      $('.t-lim').textContent = typed ? nameOf(st.spot.id) + ' · ' + word(st.spot.mat) : limText();
      $('.lim').textContent = limText();
      $('.cnt').textContent = st.spot.type === 'name' && st.a ? glyphs(st.a).length + '/' + st.spot.max : '';
      var ph = n1.getAttribute('placeholder'), want = form.getAttribute('data-ph-' + curLang());
      if (ph !== want) n1.setAttribute('placeholder', want);
      var href = payBase;
      if (st.spot) href += '&spot=' + st.spot.id;
      if (okText()) href += '&text=' + encodeURIComponent(textOf());
      payBtn.setAttribute('href', href);
      payBtn.setAttribute('aria-disabled', okText() ? 'false' : 'true');
      return t;
    }
    payBtn.addEventListener('click', function (e) {
      if (!okText()) {                                                           // без имени к кассе не пускаем: подсказка и поле
        e.preventDefault();
        if (!st.spot) return;
        $('.need').hidden = false;
        var i = st.spot.type === 'couple' ? (st.a ? nb : na) : n1;
        i.focus();
        return;
      }
      save({ item: 'insc', spot: st.spot.id, where: nameOf(st.spot.id), text: textOf() });
    });
    onLang.push(function () { if (st.spot) update(); });
    setLang(curLang(), false);
    pick($('.pol[aria-pressed="true"]') || pols.filter(function (b) { return !b.disabled; })[0], true);
  }

  /* ---------------- обои: превью крупно по нажатию, канал из адреса ---------------- */
  if (page === 'wall') {
    setLang(curLang(), false);
    var big = $('.wpstage .p2 img'), ths = $$('.th');
    ths.forEach(function (b) {
      b.addEventListener('click', function () {
        ths.forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
        var p = big.parentNode;
        p.classList.remove('lock');
        big.setAttribute('src', b.getAttribute('data-big'));
        big.setAttribute('width', '480'); big.setAttribute('height', '1040');
      });
    });
    var wb = $('a.btn'), ms0 = location.search.match(/[?&](?:src|utm_source)=(tiktok|instagram|facebook)(?:&|$)/);
    if (ms0) wb.setAttribute('href', wb.getAttribute('href').replace('src=site', 'src=' + ms0[1]));
    wb.addEventListener('click', function () { save({ item: 'w' }); });
  }

  if (page === 'store') setLang(curLang(), false);

  /* ---------------- /pay: 1 секунда на счётчик Cloudflare, потом касса Polar (надпись или обои) ---------------- */
  if (page === 'pay') {
    setLang(curLang(), false);
    var box = d.querySelector('[data-polar]');
    var wall = /[?&]item=w(?:&|$)/.test(location.search);
    var base = box.getAttribute(wall ? 'data-polar-w' : 'data-polar');
    var ok = (box.getAttribute('data-channels') || '').split(',');
    var m = location.search.match(/[?&]src=([a-z]+)(?:&|$)/), src = m && ok.indexOf(m[1]) >= 0 ? m[1] : 'site';
    var free = (box.getAttribute('data-spots') || '').split(','), f = (box.getAttribute('data-fields') || 'spot,inscription').split(',');
    var ms = location.search.match(/[?&]spot=([A-Z][0-9])(?:&|$)/), spot = !wall && ms && free.indexOf(ms[1]) >= 0 ? ms[1] : '';
    var mt = location.search.match(/[?&]text=([^&]*)/), text = '';
    if (mt) { try { text = decodeURIComponent(mt[1].replace(/\+/g, ' ')); } catch (e) { text = ''; } }
    text = text.replace(/[^\p{L}\p{M}' +\-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, +box.getAttribute('data-max') || 19);
    var to = base + (base.indexOf('?') < 0 ? '?' : '&') + 'utm_source=' + src;
    if (spot) to += '&custom_field_data.' + f[0] + '=' + spot;
    if (spot && text) to += '&custom_field_data.' + f[1] + '=' + encodeURIComponent(text);
    if (spot) to += '&reference_id=' + encodeURIComponent(spot + (text ? ':' + text : ''));
    var links = d.querySelectorAll('[data-pay-link]');
    for (var j = 0; j < links.length; j++) links[j].setAttribute('href', to);
    setTimeout(function () { location.replace(to); }, 1000);
  }

  /* ---------------- /thanks: что купили (надпись или обои) и «показать друзьям» ---------------- */
  if (page === 'thanks') {
    setLang(curLang(), false);
    var p = null;
    try { p = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) {}
    var fresh = p && Date.now() - p.t < 864e5;
    var isW = /[?&]item=w(?:&|$)/.test(location.search) || (fresh && p.item === 'w');
    $('.th-insc').hidden = isW; $('.th-w').hidden = !isW;
    if (!isW && fresh && p.text) { var el = $('.th-sel'); $('b', el).textContent = (p.where ? p.where + ' · ' : '') + p.text; el.hidden = false; }
  }
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
