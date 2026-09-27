/* ============================================================================
   ФОН-СТЕНА НА ПК (v12.2): армянские заглавные буквы (Noto Serif Armenian, OFL — данные в wall-data.js) и несколько тонких символов
   (знак вечности, гранат ×2 — на окнах шире 1280 px, фрагмент орнамента хачкара, силуэт Арарата) — тон в тон с бумагой, много пустой бумаги.

   Расстановка считается под размер окна: ни одна буква и ни один символ не заходят под экспонат (рамка, стрелки, табличка) и панель.
   Пересчёт при смене размера окна, размера рамки и сворачивании панели: старая расстановка остаётся, пока не готова новая, и заменяется разом.
   На телефоне стены нет.
   ============================================================================ */
(function () {
  'use strict';
  var D = window.WALL_DATA;
  if (!D) return;
  var NS = 'http://www.w3.org/2000/svg';
  var mq = window.matchMedia('(min-width: 1024px)');
  var svg = null, timer = 0;
  var GAP = 28;   // пустое поле вокруг экспоната и панели, px

  function rng(seed) {   // mulberry32: одинаковая расстановка при одинаковом размере окна
    return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; var t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  function box(el) { var r = el && el.getBoundingClientRect(); return r && r.width ? { l: r.left, t: r.top, r: r.right, b: r.bottom } : null; }
  function hit(a, b, pad) { return a.l < b.r + pad && a.r > b.l - pad && a.t < b.b + pad && a.b > b.t - pad; }

  function ensure() {
    if (svg) return;
    svg = document.createElementNS(NS, 'svg');
    svg.id = 'wall'; svg.setAttribute('aria-hidden', 'true');
    var defs = document.createElementNS(NS, 'defs');
    D.letters.forEach(function (l, i) {
      var p = document.createElementNS(NS, 'path');
      p.id = 'wL' + i; p.setAttribute('d', l[1]); p.setAttribute('vector-effect', 'non-scaling-stroke');
      defs.appendChild(p);
    });
    svg.appendChild(defs);
    document.body.insertBefore(svg, document.body.firstChild);
  }

  function build() {
    if (!mq.matches) { if (svg) svg.classList.remove('on'); return; }
    ensure();
    var W = window.innerWidth, H = window.innerHeight;
    // занятое: панель (колонка) и экспонат целиком — рамка, стрелки по бокам, табличка
    var collapsed = document.body.classList.contains('panel-collapsed');
    var busy = [{ l: 0, t: 0, r: collapsed ? 56 : 416, b: H }];
    ['frame', 'prevSide', 'nextSide', 'plaque'].forEach(function (id) { var b = box(document.getElementById(id)); if (b) busy.push(b); });
    var ex = busy.slice(1);
    var eL = ex.length ? Math.min.apply(null, ex.map(function (b) { return b.l; })) : W / 2, eR = ex.length ? Math.max.apply(null, ex.map(function (b) { return b.r; })) : W / 2;
    var leftW = eL - busy[0].r - 2 * GAP, rightW = W - eR - 2 * GAP;   // ширина свободных полос по бокам
    var R = rng(9001 + W * 7 + H);
    var keep = 14;   // от края окна
    var placed = [];
    function tryPut(w, h, pad) {   // случайное свободное место для прямоугольника w×h в боковых полосах; null — не нашлось
      if (leftW < w && rightW < w) return null;
      for (var n = 0; n < 240; n++) {
        var left = R() < Math.max(0, leftW) / (Math.max(0, leftW) + Math.max(0, rightW) + 1);
        if (left && leftW < w) left = false; else if (!left && rightW < w) left = true;
        var x0 = left ? busy[0].r + GAP : eR + GAP, x1 = left ? eL - GAP : W - keep;
        var c = { l: x0 + R() * Math.max(0, x1 - x0 - w), t: keep + R() * Math.max(0, H - 2 * keep - h) };
        c.r = c.l + w; c.b = c.t + h;
        var ok = c.l >= keep && c.r <= W - keep && c.b <= H - keep;
        for (var i = 0; ok && i < busy.length; i++) if (hit(c, busy[i], GAP)) ok = false;
        for (i = 0; ok && i < placed.length; i++) if (hit(c, placed[i], pad)) ok = false;
        if (ok) { placed.push(c); return c; }
      }
      return null;
    }
    var sym = D.sym, k = Math.max(0.6, Math.min(1.25, (Math.max(leftW, 0) + Math.max(rightW, 0)) / 560)), out = [];
    // символы — по одному-двум. Арарат — тонкой линией у нижнего края в самой широкой свободной полосе
    var araW = Math.min(420, Math.max(leftW, rightW) - 10);
    if (araW > 96) {
      var right = rightW >= leftW, ax = right ? eR + GAP + (rightW - araW) / 2 : busy[0].r + GAP + (leftW - araW) / 2, ah = araW * sym.ararat.h / sym.ararat.w;
      var ara = { l: ax, t: H - keep - ah, r: ax + araW, b: H - keep };
      placed.push(ara);
      out.push({ sym: 'ararat', x: ax, y: ara.t, sc: araW / sym.ararat.w, ox: 0, oy: 0 });
    }
    var syms = [['arevakhach', 0.85 * k], ['cross', 0.9 * k], ['pomegranate', 0.8 * k], ['pomegranate', 0.55 * k]];
    if (W <= 1280) syms = syms.filter(function (s) { return s[0] !== 'pomegranate'; });   // на узких окнах (1280 и уже) гранат не показываем
    syms.forEach(function (s) {
      var d = sym[s[0]], w = d.w * s[1], h = d.h * s[1], c = tryPut(w, h, 46 * k);
      if (c) out.push({ sym: s[0], x: c.l + w / 2, y: c.t + h / 2 - d.oy * s[1], sc: s[1] });
    });
    // буквы: 36 штук разного размера (мелкие, много воздуха); если места мало — уменьшаем, пока не встанут 32+
    var base = [58, 50, 50, 42, 42, 42, 34, 34, 34, 34, 28, 28, 28, 28, 28, 24, 24, 24, 24, 24, 24, 20, 20, 20, 20, 20, 20, 18, 18, 18, 18, 18, 18, 16, 16, 16];
    var order = D.letters.map(function (_, i) { return i; });
    for (var i = order.length - 1; i > 0; i--) { var j = (R() * (i + 1)) | 0, t = order[i]; order[i] = order[j]; order[j] = t; }
    var kl = Math.max(0.6, Math.min(1.5, (Math.max(leftW, 0) + Math.max(rightW, 0)) / 420)), letters = [];
    var keepPlaced = placed.length;
    for (var pass = 0; pass < 10; pass++) {
      placed.length = keepPlaced; letters = [];
      for (var n = 0; n < base.length; n++) {
        var size = base[n] * kl, li = order[n % order.length], adv = D.letters[li][0] * size / 714;
        var c = tryPut(adv, size, 26 * kl + size * 0.5);
        if (c) letters.push({ i: li, size: size, x: c.l + adv / 2, y: c.b, rot: (R() - 0.5) * 6 });
      }
      if (letters.length >= 32) break;
      kl *= 0.88;
    }
    // рисуем
    while (svg.lastChild && svg.lastChild.tagName !== 'defs') svg.removeChild(svg.lastChild);
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H); svg.setAttribute('width', W); svg.setAttribute('height', H);
    var g = document.createElementNS(NS, 'g'); g.setAttribute('class', 'w');
    var html = '';
    out.forEach(function (o) {
      html += '<g transform="translate(' + o.x.toFixed(1) + ' ' + o.y.toFixed(1) + ') scale(' + o.sc.toFixed(3) + ')">' + sym[o.sym].svg + '</g>';
    });
    letters.forEach(function (l) {
      var sc = l.size / 714, adv = D.letters[l.i][0];
      var tf = 'translate(' + l.x.toFixed(1) + ' ' + l.y.toFixed(1) + ') rotate(' + l.rot.toFixed(1) + ') translate(' + (-adv * sc / 2).toFixed(2) + ' 0) scale(' + sc.toFixed(5) + ')';
      html += '<use href="#wL' + l.i + '" transform="' + tf + '" stroke-width="0.9"/>';
      if (l.size >= 44) html += '<use href="#wL' + l.i + '" transform="translate(' + (l.x + l.size * 0.012).toFixed(1) + ' ' + (l.y + l.size * 0.012).toFixed(1) + ') rotate(' + l.rot.toFixed(1) + ') translate(' + (-adv * sc / 2).toFixed(2) + ' 0) scale(' + sc.toFixed(5) + ')" stroke-width="0.7" opacity="0.4"/>';
    });
    g.innerHTML = html; svg.appendChild(g);
    svg.setAttribute('data-letters', letters.length); svg.setAttribute('data-symbols', out.length);
    requestAnimationFrame(function () { svg.classList.add('on'); });
  }

  function schedule(ms) {   // пересчёт через ms; пока новая расстановка не готова, старая остаётся на месте (не гаснет), потом заменяется разом
    clearTimeout(timer); timer = setTimeout(build, ms);
  }
  window.addEventListener('resize', function () { schedule(300); });
  (mq.addEventListener ? mq.addEventListener('change', function () { schedule(50); }) : mq.addListener(function () { schedule(50); }));
  new MutationObserver(function () { schedule(1000); }).observe(document.body, { attributes: true, attributeFilter: ['class'] });   // панель свернули/развернули: колонка едет 0.9 с
  var fr = document.getElementById('frame');
  if (fr && window.ResizeObserver) new ResizeObserver(function () { schedule(300); }).observe(fr);   // рамка получила свой размер (кадр загрузился, полный экран)
  schedule(400);
  window.__wallRelayout = function () { clearTimeout(timer); build(); };   // для проверки
})();
