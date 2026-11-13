/* Витрина надписей v2 (/buy, /t, /i, /f, /pay, /thanks): язык, 4 шага, листание кадров, выбор места, текст (имя до max_len места или две буквы), ссылка оплаты, переход на кассу.
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
  function setLang(l, save) {
    if (LANGS.indexOf(l) < 0) return;
    root.setAttribute('data-lang', l);
    root.setAttribute('lang', l);
    if (save) { try { localStorage.setItem('chka-lang', l); } catch (e) {} }
    $$('[data-set-lang]').forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-set-lang') === l ? 'true' : 'false'); });
    fillDate();
    onLang.forEach(function (f) { f(); });
  }
  $$('[data-set-lang]').forEach(function (b) { b.addEventListener('click', function () { setLang(b.getAttribute('data-set-lang'), true); }); });

  /* ---------------- витрина: 4 шага ---------------- */
  if (page === 'shop') shop();

  function shop() {
    var body = d.body, src = body.getAttribute('data-src') || 'site';
    var steps = $$('.step'), progBtns = $$('[data-go]');
    var st = { step: 1, spot: null, a: '', b: '' };
    var payBtn = $('a.btn'), payBase = payBtn.getAttribute('href');

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
    function allowed(n) { return n <= 2 || (n === 3 && !!st.spot) || (n === 4 && !!st.spot && okText()); }

    function show(n, focus) {
      if (!allowed(n)) return;
      st.step = n;
      steps.forEach(function (s) { s.classList.toggle('on', +s.getAttribute('data-step') === n); });
      progBtns.forEach(function (b) {
        var k = +b.getAttribute('data-go');
        if (k === n) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
        b.classList.toggle('done', k < n);
        b.disabled = !allowed(k);
      });
      window.scrollTo(0, 0);
      if (n === 1) carve();
      if (n === 2) setTimeout(function () { go(idx(), true); }, 30);
      if (n === 3) { paint(); if (focus) setTimeout(function () { var i = $(st.spot && st.spot.type === 'couple' ? '#na' : '#n1'); if (i && matchMedia('(pointer: fine)').matches) i.focus(); }, 60); }
      if (n === 4) summary();
      var h = $('.step.on h1, .step.on h2');
      if (focus && h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
    }
    progBtns.forEach(function (b) { b.addEventListener('click', function () { show(+b.getAttribute('data-go'), true); }); });
    $$('[data-next]').forEach(function (b) { b.addEventListener('click', function () { show(st.step + 1, true); }); });
    $$('[data-back]').forEach(function (b) { b.addEventListener('click', function () { show(st.step - 1, true); }); });

    /* ① пример «до → после»: проявляется один раз, дальше — по нажатию */
    var ba = $('[data-ba]'), carved = false;
    function carve() { if (carved || !ba) return; carved = true; setTimeout(function () { ba.classList.add('after'); }, 700); }
    if (ba) $('.ba-btn', ba).addEventListener('click', function () { carved = true; ba.classList.toggle('after'); });

    /* ② кадры: свайп (родной скролл), стрелки, клавиши ← →, перетаскивание мышью, миниатюры */
    var track = $('.track'), frs = $$('.fr'), thumbs = $$('[data-fr]'), arrows = $$('.arr');
    function idx() { var w = frs[0].getBoundingClientRect().width || 1, x0 = frs[0].offsetLeft; return Math.max(0, Math.min(frs.length - 1, Math.round((track.scrollLeft) / (frs[1] ? frs[1].offsetLeft - x0 : w)))); }
    function mark(i) {
      thumbs.forEach(function (t, k) { t.setAttribute('aria-current', k === i ? 'true' : 'false'); });
      arrows.forEach(function (a) { a.disabled = (+a.getAttribute('data-dir') < 0 && i === 0) || (+a.getAttribute('data-dir') > 0 && i === frs.length - 1); });
    }
    function go(i, instant) {
      i = Math.max(0, Math.min(frs.length - 1, i));
      var x = frs[i].offsetLeft - frs[0].offsetLeft;
      if (track.scrollTo) track.scrollTo({ left: x, behavior: instant ? 'auto' : 'smooth' }); else track.scrollLeft = x;
      mark(i);
    }
    var tmr;
    track.addEventListener('scroll', function () { clearTimeout(tmr); tmr = setTimeout(function () { mark(idx()); }, 60); }, { passive: true });
    arrows.forEach(function (a) { a.addEventListener('click', function () { go(idx() + (+a.getAttribute('data-dir'))); }); });
    thumbs.forEach(function (t) { t.addEventListener('click', function () { go(+t.getAttribute('data-fr')); }); });
    d.addEventListener('keydown', function (e) {
      if (st.step !== 2 || e.altKey || e.ctrlKey || e.metaKey) return;
      var tg = e.target && e.target.tagName;
      if (tg === 'INPUT' || tg === 'TEXTAREA') return;
      if (e.key === 'ArrowRight') { e.preventDefault(); go(idx() + 1); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); go(idx() - 1); }
    });
    var drag = null, moved = false;
    track.addEventListener('pointerdown', function (e) {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      drag = { x: e.clientX, s: track.scrollLeft, i: idx() }; moved = false;
    });
    window.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var dx = e.clientX - drag.x;
      if (!moved && Math.abs(dx) > 6) { moved = true; track.classList.add('drag'); }
      if (moved) { track.scrollLeft = drag.s - dx; e.preventDefault(); }
    });
    window.addEventListener('pointerup', function (e) {
      if (!drag) return;
      var dx = e.clientX - drag.x, i = drag.i;
      drag = null;
      if (!moved) return;
      track.classList.remove('drag');
      go(Math.abs(dx) > 50 ? i + (dx < 0 ? 1 : -1) : i);
      setTimeout(function () { moved = false; }, 0);
    });
    track.addEventListener('click', function (e) { if (moved) { e.stopPropagation(); e.preventDefault(); } }, true);
    track.addEventListener('dragstart', function (e) { e.preventDefault(); });

    var spots = $$('.spot');
    spots.forEach(function (b) {
      b.addEventListener('click', function () {
        if (b.disabled) return;
        spots.forEach(function (x) { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
        var type = b.getAttribute('data-type');
        if (st.spot && st.spot.type !== type) { st.a = ''; st.b = ''; ['#n1', '#na', '#nb'].forEach(function (s) { var i = $(s); if (i) i.value = ''; }); }
        st.spot = { id: b.getAttribute('data-spot'), type: type, max: +b.getAttribute('data-max') || 1, el: b };
        if (type === 'name') {                       // имя длиннее нового лимита места — обрезаем (лимит у стен и мелких мест разный)
          st.a = glyphs(st.a).slice(0, st.spot.max).join('');
          var n1 = $('#n1'); if (n1) { n1.maxLength = st.spot.max; if (n1.value !== st.a) n1.value = st.a; }
        }
        selInfo(); counter(); update();
        var nx3 = $('.step[data-step="3"] [data-next]'); if (nx3) nx3.disabled = !okText();
        var nx = $('.step[data-step="2"] [data-next]'); if (nx) nx.disabled = false;
        progBtns.forEach(function (p) { p.disabled = !allowed(+p.getAttribute('data-go')); });
      });
    });
    function where() { return st.spot ? txt($('.wh', st.spot.el)) : ''; }       // короткое название места (кадра)
    function kind() { return st.spot ? txt($('.kinds [data-k="' + st.spot.type + '"]')) : ''; }   // «Имя на камне» / «Две буквы на дереве»
    function selInfo() {
      if (!st.spot) return;
      $('.sel-none').hidden = true; $('.sel-on').hidden = false;
      $('.sel-t').textContent = kind();                                           // одной строкой, и только после выбора
      var c = st.spot.type === 'couple';
      $('.g-name').hidden = c; $('.g-couple').hidden = !c;
      $('.h-name').hidden = c; $('.h-couple').hidden = !c;
    }
    function counter() {                                                         // «осталось N» под полем имени
      if (!st.spot || st.spot.type !== 'name') return;
      var left = Math.max(0, st.spot.max - glyphs(st.a).length);
      $$('.left-n').forEach(function (e) { e.textContent = left; });
    }

    /* ③ имя (до max_len места, счётчик «осталось N») или две буквы по одному полю; под примером художника — введённый текст крупно */
    function cleanName(v, max) { return glyphs(v.replace(/\s+/g, ' ').replace(/^\s+/, '').toUpperCase()).slice(0, max).join(''); }
    function oneLetter(inp) {                                                    // в поле одна буква: новая заменяет старую
      var g = glyphs(inp.value.replace(/\s+/g, '')), raw = g.length ? g[g.length - 1] : '';
      var v = raw.toUpperCase();
      if (glyphs(v).length > 1) v = raw;                                         // «և» в верхнем регистре — две буквы: оставляем как есть
      if (inp.value !== v) inp.value = v;
      return v;
    }
    function onInput() {
      var c = st.spot && st.spot.type === 'couple';
      if (c) { st.a = oneLetter($('#na')); st.b = oneLetter($('#nb')); }
      else { st.a = cleanName($('#n1').value, st.spot ? st.spot.max : 12).trim(); st.b = ''; }
      var bad = c ? (!!(st.a + st.b) && !(LETTER.test(st.a || 'x') && LETTER.test(st.b || 'x'))) : BAD.test(st.a);
      $('.bad').hidden = !bad;
      counter(); paint(); update();
      var nx = $('.step[data-step="3"] [data-next]'); if (nx) nx.disabled = !okText();
      progBtns.forEach(function (p) { p.disabled = !allowed(+p.getAttribute('data-go')); });
    }
    ['#n1', '#na', '#nb'].forEach(function (s) {
      var i = $(s); if (!i) return;
      i.addEventListener('input', onInput);
      i.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        if (s === '#na') { $('#nb').focus(); return; }
        if (okText()) show(4, true);
      });
    });
    $('.names').addEventListener('submit', function (e) { e.preventDefault(); });

    function shown() {                                                          // что показать под примером: имя, «Ա + Լ» или прочерк
      if (!st.spot) return '';
      if (st.spot.type === 'couple') return (st.a || st.b) ? (st.a || '…') + ' + ' + (st.b || '…') : '';
      return st.a;
    }
    function paint() {
      if (!st.spot) return;
      var kindName = st.spot.type === 'couple' ? 'couple' : 'name';
      $$('.ex').forEach(function (ex) { ex.setAttribute('data-kind', kindName); });
      var yv = $('.yv'), t = shown();
      yv.textContent = t || '—';
      yv.classList.toggle('empty', !t);
    }

    /* ④ итог; ссылка оплаты: /pay/?src=<канал>&spot=<место>&text=<текст> — меняется при выборе места и текста */
    function update() {
      var href = payBase;
      if (st.spot) href += '&spot=' + st.spot.id;
      if (okText()) href += '&text=' + encodeURIComponent(textOf());
      payBtn.setAttribute('href', href);
    }
    function summary() {
      paint();
      $('.sum-spot').textContent = st.spot ? where() : '—';
      $('.sum-text').textContent = textOf() || '—';
    }
    payBtn.addEventListener('click', function () {
      try { localStorage.setItem(KEY, JSON.stringify({ spot: st.spot ? st.spot.id : '', where: where(), text: textOf(), t: Date.now() })); } catch (e) {}
    });
    onLang.push(function () { if (st.spot) { selInfo(); summary(); } });
    setLang(curLang(), false);
    show(1, false);
  }

  /* ---------------- /pay: 1 секунда на счётчик Cloudflare, потом касса Polar ---------------- */
  if (page === 'pay') {
    setLang(curLang(), false);
    var box = d.querySelector('[data-polar]');
    var base = box.getAttribute('data-polar');
    var ok = (box.getAttribute('data-channels') || '').split(',');
    var m = location.search.match(/[?&]src=([a-z]+)(?:&|$)/), src = m && ok.indexOf(m[1]) >= 0 ? m[1] : 'site';
    var free = (box.getAttribute('data-spots') || '').split(','), f = (box.getAttribute('data-fields') || 'spot,inscription').split(',');
    var ms = location.search.match(/[?&]spot=([A-Z][0-9])(?:&|$)/), spot = ms && free.indexOf(ms[1]) >= 0 ? ms[1] : '';
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

  /* ---------------- /thanks: выбор покупателя и «показать друзьям» ---------------- */
  if (page === 'thanks') {
    setLang(curLang(), false);
    try {
      var p = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (p && p.text && Date.now() - p.t < 864e5) { var el = $('.th-sel'); $('b', el).textContent = (p.where ? p.where + ' · ' : '') + p.text; el.hidden = false; }
    } catch (e) {}
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
