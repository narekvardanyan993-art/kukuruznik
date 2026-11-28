/* Лавка музея V1 «Бумага и чернила» (21.11.2026): /shop — приветствие, /buy /t /i /f — место (открытка, ‹ › точки + свайп, имя на бирке — не на рисунке),
   /w (обои), /pay, /thanks — свидетельство.
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
    $$('.when').forEach(function (el) {
      var n = parseInt(el.getAttribute('data-days'), 10) || 7, dt = new Date();
      dt.setDate(dt.getDate() + n);
      el.textContent = fmtDate(dt, curLang());
    });
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

  /* ---------------- надпись: 4 шага (материал → место → имя → оплата), каждый — один экран ---------------- */

  /* буквы по одной (чернила/перо V1): каждая — свой span; keep — оставить совпадающее начало без анимации (ввод) */
  var RM = matchMedia('(prefers-reduced-motion: reduce)').matches || /[?&]rm=1(?:&|$)/.test(location.search);
  if (RM) root.classList.add('rm');
  function letters(el, arr, base, per, keep) {
    var old = $$('.l', el), k = 0;
    if (keep) while (k < old.length && k < arr.length && old[k].getAttribute('data-c') === arr[k]) k++;
    old.slice(keep ? k : 0).forEach(function (x) { x.parentNode.removeChild(x); });
    old.slice(0, keep ? k : 0).forEach(function (x) { x.classList.add('k'); });
    var cut = $('.caret', el);
    arr.slice(keep ? k : 0).forEach(function (c, j) {
      var i = (keep ? k : 0) + j, sp = d.createElement('span');
      sp.className = 'l' + (c === '+' ? ' pl' : '');
      sp.setAttribute('data-c', c); sp.textContent = c;
      sp.style.animationDelay = (keep ? 0 : base + i * per) + 'ms';
      el.insertBefore(sp, cut || null);
    });
    return arr.length;
  }
  /* заголовок приветствия проявляется чернилами по буквам (буквы склеены по словам — перенос только между словами) */
  $$('[data-letters] .i18n-inline').forEach(function (el) {
    var words = el.textContent.split(' '), k = 0;
    el.textContent = '';
    words.forEach(function (w, j) {
      if (j) el.appendChild(d.createTextNode(' '));
      var ws = d.createElement('span'); ws.className = 'wd'; el.appendChild(ws);
      glyphs(w).forEach(function (c) { var sp = d.createElement('span'); sp.className = 'l'; sp.textContent = c; sp.style.animationDelay = (250 + k++ * 55) + 'ms'; ws.appendChild(sp); });
    });
  });

  function insc() {
    var payBtn = $('a.btn'), payBase = payBtn.getAttribute('href');
    var dots = $$('.spot'), card = $('.card'), ex = $('.ex'), inp = $('#nm'), nmv = $('.nmv'), tag = $('.tag'), sec = $('#spot');
    var PER = 120, BASE = 520;
    var st = { spot: null, a: '', b: '', step: 1 };
    var nextBtn = $('.wnext'), backBtn = $('.wback'), FINE = matchMedia('(hover: hover) and (pointer: fine)').matches;
    var caret = d.createElement('i'); caret.className = 'caret'; nmv.appendChild(caret);

    function word(k) { return txt($('.dict [data-k="' + k + '"]')); }
    function nameOf(id) { return txt($('.dict [data-name="' + id + '"]')); }
    function spotOf(b) {
      return { id: b.getAttribute('data-spot'), type: b.getAttribute('data-type'), max: +b.getAttribute('data-max') || 1, n: +b.getAttribute('data-n'),
               ex: b.getAttribute('data-ex'), exn: +b.getAttribute('data-exn'), mat: b.getAttribute('data-mat'), pos: b.getAttribute('data-pos'), sold: b.disabled, el: b };
    }
    function textOf() {
      if (!st.spot) return '';
      return st.spot.type === 'couple' ? (st.a && st.b ? st.a + ' + ' + st.b : '') : st.a;
    }
    function okText() {
      if (!st.spot || st.spot.sold) return false;
      if (st.spot.type === 'couple') return LETTER.test(st.a) && LETTER.test(st.b) && glyphs(st.a).length === 1 && glyphs(st.b).length === 1;
      var t = st.a;
      return !!t && !BAD.test(t) && glyphs(t).length <= st.spot.max;
    }
    function shown() {                                                           // что на бирке: имя или «А + Б»
      if (st.spot.type !== 'couple') return glyphs(st.a);
      return st.a || st.b ? [st.a || '', '+', st.b || ''].filter(function (c, i) { return c || i === 1; }) : [];
    }
    function limText() { return st.spot.type === 'couple' ? word('lim2') : word('lim').replace('#', st.spot.max); }
    function ph() { return sec.getAttribute('data-ph-' + curLang()) || ''; }
    function measure() { tag.style.setProperty('--w', Math.max(30, nmv.getBoundingClientRect().width - 6) + 'px'); }
    function setLen(n) { tag.setAttribute('data-len', n > 8 ? 'l' : n > 6 ? 'm' : 's'); tag.style.setProperty('--n', n); }

    /* место на открытке: пример художника (приближение к надписи), подписи, бирка */
    function render(anim) {
      var s = st.spot, c = s.type === 'couple', own = s.exn === s.n;
      dots.forEach(function (b) { b.setAttribute('aria-pressed', b === s.el ? 'true' : 'false'); });
      $('.of').textContent = word('of').replace('#', s.n);
      $('.no').textContent = '№ ' + s.n;
      $('.sn').textContent = nameOf(s.id);
      var want = '../assets/spots/' + s.ex;
      if (ex.getAttribute('src') !== want) ex.setAttribute('src', want);
      ex.setAttribute('style', s.pos);
      ex.setAttribute('alt', word('alt_ex').replace('#', nameOf(s.id)));
      $('.ex-own').hidden = !own; $('.ex-from').hidden = own; $('.exn').textContent = s.exn;
      $('.soldmark').hidden = !s.sold;
      $$('.l-name').forEach(function (e) { e.hidden = c; }); $$('.l-two').forEach(function (e) { e.hidden = !c; });
      $('.nd-name').hidden = c; $('.nd-two').hidden = !c;
      $('.need').hidden = true; $('.bad').hidden = true;
      inp.maxLength = c ? 2 : s.max;
      inp.disabled = s.sold;
      $('.s-meta').textContent = [word('m_' + s.mat), limText(), word('days')].join(' · ');
      var n = letters(nmv, shown(), BASE, PER, false);
      nmv.setAttribute('data-empty', n ? '0' : '1'); nmv.setAttribute('data-ph', c ? '' : ph());
      tag.style.setProperty('--per', PER + 'ms'); tag.style.setProperty('--base', BASE + 'ms'); setLen(n);
      measure();
      if (anim && !RM) { card.classList.remove('in'); void card.offsetWidth; card.classList.add('in'); }
      update();
    }
    function choose(b, anim) {
      var s = spotOf(b), type = s.type;
      if (st.spot && st.spot.type !== type) { st.a = ''; st.b = ''; }
      st.spot = s;
      if (type !== 'couple') st.a = glyphs(st.a).slice(0, s.max).join('');
      inp.value = type === 'couple' ? st.a + st.b : st.a;
      render(anim);
    }
    /* листание: только свободные места (проданное — точка с крестиком, disabled) */
    var order = dots.filter(function (b) { return !b.disabled; });
    var busy = false;
    function go(b, dir) {
      if (!b || b.disabled || busy || (st.spot && b === st.spot.el)) return;
      if (RM) { choose(b, false); return; }
      busy = true; card.setAttribute('data-dir', dir || (+b.getAttribute('data-n') > st.spot.n ? 'next' : 'prev'));
      card.classList.remove('in'); card.classList.add('out');
      setTimeout(function () { card.classList.remove('out'); card.style.removeProperty('--sx'); choose(b, true); busy = false; }, 300);
    }
    function step(k) {
      if (order.length < 2 || st.step > 1) return;                              // на шагах «имя» и «оплата» место уже выбрано — листать нельзя
      var i = order.indexOf(st.spot.el);
      go(order[(i + k + order.length) % order.length], k > 0 ? 'next' : 'prev');
    }
    $('.prev').addEventListener('click', function () { step(-1); });
    $('.next').addEventListener('click', function () { step(1); });
    if (order.length < 2) { $('.prev').hidden = true; $('.next').hidden = true; }
    dots.forEach(function (b) { b.addEventListener('click', function () { go(b); }); });
    d.addEventListener('keydown', function (e) { if (e.target === inp) return; if (e.key === 'ArrowLeft') step(-1); if (e.key === 'ArrowRight') step(1); });
    /* свайп по открытке */
    var stage = $('.stage'), x0 = null, y0 = 0, dx = 0;
    stage.addEventListener('pointerdown', function (e) { if (busy || st.step > 1) return; x0 = e.clientX; y0 = e.clientY; dx = 0; });
    stage.addEventListener('pointermove', function (e) {
      if (x0 === null) return; dx = e.clientX - x0;
      if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(e.clientY - y0)) { card.classList.add('drag'); card.style.setProperty('--sx', dx + 'px'); }
    });
    function up() {
      if (x0 === null) return; x0 = null; card.classList.remove('drag');
      if (Math.abs(dx) > 56) step(dx < 0 ? 1 : -1); else card.style.removeProperty('--sx');
      dx = 0;
    }
    stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up); stage.addEventListener('pointerleave', up);
    card.addEventListener('click', function (e) { if (card.classList.contains('drag')) e.preventDefault(); });

    /* ввод: имя — буквы заглавными до max; пара — ровно две буквы («А + Б»), по одной на каждого */
    function oneUp(c) { var v = c.toUpperCase(); return glyphs(v).length > 1 ? c : v; }      // «և» в верхнем регистре — две буквы: оставляем как есть
    inp.addEventListener('input', function () {
      var s = st.spot; if (!s) return;
      var c = s.type === 'couple', raw = inp.value;
      if (c) {
        var g = glyphs(raw.replace(/\s+/g, '')).slice(0, 2).map(oneUp);
        st.a = g[0] || ''; st.b = g[1] || '';
        $('.bad').hidden = !g.length || g.every(function (x) { return LETTER.test(x); });
        if (inp.value !== g.join('')) inp.value = g.join('');
      } else {
        var cv = glyphs(raw.replace(/\s+/g, ' ').replace(/^\s+/, '').toUpperCase()).slice(0, s.max).join('');
        if (inp.value !== cv) inp.value = cv;
        st.a = cv.trim(); st.b = '';
        $('.bad').hidden = !BAD.test(st.a);
      }
      var n = letters(nmv, shown(), 0, 0, true);
      nmv.setAttribute('data-empty', n ? '0' : '1'); setLen(n); measure();
      tag.classList.remove('typed'); void tag.offsetWidth; tag.classList.add('typed');
      if (okText()) $('.need').hidden = true;
      update();
    });
    inp.addEventListener('focus', function () { tag.classList.add('focus'); });
    inp.addEventListener('blur', function () { tag.classList.remove('focus'); });
    inp.addEventListener('keydown', function (e) { if (e.key !== 'Enter') return; e.preventDefault(); if (okText()) toStep(3); else $('.need').hidden = false; });
    tag.addEventListener('click', function () { if (st.spot && !st.spot.sold) toStep(2); });          // тап по бирке — сразу к имени
    tag.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tag.click(); } });

    /* шаги: 1 место · 2 имя · 3 проверка и оплата. Рисунок на всех шагах один и тот же и ничем не закрыт */
    function toStep(n) {
      if (n < 1 || n > 3 || !st.spot) return;
      if (n >= 2 && st.spot.sold) return;
      if (n === 3 && !okText()) n = 2;
      st.step = n;
      sec.setAttribute('data-step', n);
      $$('[data-s]', sec).forEach(function (e) {
        var on = +e.getAttribute('data-s') === n;
        if (e.hidden === on) { e.hidden = !on; if (on && !RM) { e.classList.remove('wz-in'); void e.offsetWidth; e.classList.add('wz-in'); } }
      });
      $$('.prog li', sec).forEach(function (li, i) { li.className = i + 1 < n ? 'done' : i + 1 === n ? 'on' : ''; });
      $$('.stn').forEach(function (e) { e.textContent = n; });
      backBtn.hidden = n === 1; nextBtn.hidden = n === 3; payBtn.hidden = n !== 3;
      $('.need').hidden = true;
      if (n === 3) { $('.sum-place').textContent = '№ ' + st.spot.n + ' · ' + nameOf(st.spot.id); $('.sum-name').textContent = textOf(); }
      if (n === 2 && FINE) setTimeout(function () { inp.focus(); }, 60);
      if (n !== 2 && d.activeElement === inp) inp.blur();
      update();
    }
    nextBtn.addEventListener('click', function () {
      if (st.step === 2 && !okText()) { $('.need').hidden = false; inp.focus(); return; }          // без имени дальше не пускаем: подсказка и поле
      toStep(st.step + 1);
    });
    backBtn.addEventListener('click', function () { toStep(st.step - 1); });

    /* ссылка оплаты: /pay/?src=<канал>&spot=<место>&text=<текст> — меняется при выборе места и текста */
    function update() {
      if (!st.spot) return;
      var href = payBase;
      if (st.spot && !st.spot.sold) href += '&spot=' + st.spot.id;
      if (okText()) href += '&text=' + encodeURIComponent(textOf());
      payBtn.setAttribute('href', href);
      payBtn.setAttribute('aria-disabled', okText() ? 'false' : 'true');
      nextBtn.setAttribute('aria-disabled', st.step === 2 && !okText() ? 'true' : 'false');
      if (st.step === 3) $('.sum-name').textContent = textOf();
    }
    payBtn.addEventListener('click', function (e) {
      if (!okText()) {                                                           // без имени к кассе не пускаем: подсказка и поле
        e.preventDefault();
        if (!st.spot || st.spot.sold) return;
        $('.need').hidden = false;
        inp.focus();
        return;
      }
      save({ item: 'insc', spot: st.spot.id, where: nameOf(st.spot.id), text: textOf() });
    });
    onLang.push(function () { if (st.spot) render(false); });
    setLang(curLang(), false);
    var qs = location.search.match(/[?&]s=([A-Z][0-9])(?:&|$)/), start = qs && order.filter(function (b) { return b.getAttribute('data-spot') === qs[1]; })[0];
    choose(start || $('.spot[aria-pressed="true"]') || order[0] || dots[0], true);
    if (d.fonts && d.fonts.ready) d.fonts.ready.then(measure);
  }
  if (page === 'insc') insc();

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
    var wb = $('a.btn'), ms0 = location.search.match(/[?&](?:src|utm_source)=(tiktok|instagram|facebook|youtube|pinterest)(?:&|$)/);
    if (ms0) wb.setAttribute('href', wb.getAttribute('href').replace('src=site', 'src=' + ms0[1]));
    wb.addEventListener('click', function () { save({ item: 'w' }); });
  }

  if (page === 'store') {
    setLang(curLang(), false);
    $$('[data-fs]').forEach(function (b) {   /* «A+» как на главной: весь текст крупнее на 15 %, выбор хранится в браузере (chka-fs) */
      function paint() { var big = root.classList.contains('fs-big'); b.textContent = big ? 'A−' : 'A+'; b.setAttribute('aria-pressed', big ? 'true' : 'false'); }
      b.addEventListener('click', function () {
        var big = !root.classList.contains('fs-big');
        root.classList.toggle('fs-big', big);
        try { localStorage.setItem('chka-fs', big ? 'big' : 'normal'); } catch (e) {}
        paint();
      });
      paint();
    });
  }

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

  /* ---------------- /thanks: свидетельство о надписи (имя — пером на бумаге свидетельства) или обои; «показать друзьям» ---------------- */
  if (page === 'thanks') {
    var p = null;
    try { p = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) {}
    var fresh = p && Date.now() - p.t < 864e5;
    var isW = /[?&]item=w(?:&|$)/.test(location.search) || (fresh && p.item === 'w');
    $('.th-insc').hidden = isW; $('.th-w').hidden = !isW; $('.th-b').hidden = isW;
    var info = fresh && p.item === 'insc' && p.text && p.spot ? $('.dict [data-spot="' + p.spot + '"]') : null;
    var fillCert = function () {
      if (!info) return;
      var c = $('.th-insc'), nm = $('.c-name', c);
      nm.style.fontSize = '';
      var fs = parseFloat(getComputedStyle(nm).fontSize), room = c.clientWidth - 44, w = nm.scrollWidth;
      if (w > room) nm.style.fontSize = Math.floor(fs * room / w) + 'px';
      $('.c-sn', c).textContent = txt(info);
      $('.c-mat', c).textContent = txt($('.dict [data-k="m_' + info.getAttribute('data-mat') + '"]'));
    };
    if (!isW && info) {
      var ci = $('.c-img');
      ci.setAttribute('src', '../assets/spots/' + info.getAttribute('data-ex'));
      ci.setAttribute('style', info.getAttribute('data-pos'));
      ['.c-name', '.c-lead', '.c-place', '.c-when'].forEach(function (s) { $(s).hidden = false; });
      $('.c-gen').hidden = true;
      letters($('.c-name'), glyphs(p.text), 1050, 130, false);
      onLang.push(fillCert);
    }
    setLang(curLang(), false);
    fillCert();
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
