/* Չկա — превью: полноэкранная галерея фото.
   Берёт кнопки .g-item со страницы (data-full, data-w, data-h,
   data-cap-*, data-credit-*, data-year) и сама строит окно просмотра.
   Умеет: «вырастание» фото из миниатюры и возврат в неё, листание
   свайпом с плавным сдвигом, закрытие свайпом вниз, зум двойным тапом,
   щипком, колёсиком и кнопками +/−, инерцию при перетаскивании
   увеличенного фото, прячущуюся нижнюю панель. При «уменьшить
   движение» все анимации мгновенные. Стиль — переменные --gx-* из
   файла варианта. */
(function () {
  var items = [].slice.call(document.querySelectorAll('.g-item'));
  if (!items.length) return;

  var RM = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  var GAP = 24, MAX_S = 5, DT_MS = 280;

  function lang() { return (window.ChkaI18n && window.ChkaI18n.get()) || document.documentElement.getAttribute('data-lang') || 'hy'; }
  var UI = {
    hy: { close: 'Փակել', prev: 'Նախորդը', next: 'Հաջորդը', zin: 'Մեծացնել', zout: 'Փոքրացնել', dlg: 'Լուսանկար' },
    ru: { close: 'Закрыть', prev: 'Предыдущее фото', next: 'Следующее фото', zin: 'Приблизить', zout: 'Отдалить', dlg: 'Просмотр фото' },
    en: { close: 'Close', prev: 'Previous photo', next: 'Next photo', zin: 'Zoom in', zout: 'Zoom out', dlg: 'Photo viewer' }
  };
  function t(k) { return (UI[lang()] || UI.ru)[k]; }

  var ICON = {
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    prev: '<path d="M15 5l-7 7 7 7"/>',
    next: '<path d="M9 5l7 7-7 7"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>'
  };
  function btn(cls, icon) {
    return '<button class="gx-btn ' + cls + '" type="button"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' + ICON[icon] + '</svg></button>';
  }

  /* ---------- разметка окна ---------- */
  var root = document.createElement('div');
  root.className = 'gx';
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.innerHTML =
    '<div class="gx-backdrop"></div>' +
    '<div class="gx-viewport"><div class="gx-track">' +
      '<div class="gx-slide"><div class="gx-zoom"><img alt="" draggable="false"></div></div>' +
      '<div class="gx-slide"><div class="gx-zoom"><img alt="" draggable="false"></div></div>' +
      '<div class="gx-slide"><div class="gx-zoom"><img alt="" draggable="false"></div></div>' +
    '</div></div>' +
    '<div class="gx-top">' + btn('gx-close', 'close') + '</div>' +
    btn('gx-nav gx-prev', 'prev') + btn('gx-nav gx-next', 'next') +
    '<div class="gx-zoomctl">' + btn('gx-zin', 'plus') + btn('gx-zout', 'minus') + '</div>' +
    '<div class="gx-bar"><div class="gx-bar-in">' +
      '<div class="gx-row"><p class="gx-cap"></p><span class="gx-count" aria-live="polite"></span></div>' +
      '<p class="gx-credit"></p>' +
    '</div></div>';
  document.body.appendChild(root);
  var probe = document.createElement('div');
  probe.className = 'gx-probe';
  root.appendChild(probe);

  var backdrop = root.querySelector('.gx-backdrop');
  var viewport = root.querySelector('.gx-viewport');
  var track = root.querySelector('.gx-track');
  var slides = [].slice.call(root.querySelectorAll('.gx-slide'));
  var zooms = slides.map(function (s) { return s.querySelector('.gx-zoom'); });
  var imgs = slides.map(function (s) { return s.querySelector('img'); });
  var bClose = root.querySelector('.gx-close');
  var bPrev = root.querySelector('.gx-prev');
  var bNext = root.querySelector('.gx-next');
  var bIn = root.querySelector('.gx-zin');
  var bOut = root.querySelector('.gx-zout');
  var capEl = root.querySelector('.gx-cap');
  var countEl = root.querySelector('.gx-count');
  var creditEl = root.querySelector('.gx-credit');

  function labels() {
    root.setAttribute('aria-label', t('dlg'));
    bClose.setAttribute('aria-label', t('close'));
    bPrev.setAttribute('aria-label', t('prev'));
    bNext.setAttribute('aria-label', t('next'));
    bIn.setAttribute('aria-label', t('zin'));
    bOut.setAttribute('aria-label', t('zout'));
  }

  /* ---------- состояние ---------- */
  var idx = 0, isOpen = false, busy = false;
  var W = 0, H = 0;
  var box = [null, null, null];         // прямоугольник фото при масштабе 1 для каждого слайда
  var s = 1, tx = 0, ty = 0;            // зум текущего фото
  var dx = 0, dy = 0;                   // сдвиг ленты / свайп вниз
  var uiHidden = false;
  var lastFocus = null;

  function mod(n) { return (n + items.length) % items.length; }
  function dataOf(i) {
    var it = items[mod(i)];
    return {
      full: it.getAttribute('data-full'),
      thumb: (it.querySelector('img') || {}).currentSrc || (it.querySelector('img') || {}).src,
      w: +it.getAttribute('data-w') || 1, h: +it.getAttribute('data-h') || 1
    };
  }

  function insets() {
    var cs = getComputedStyle(probe);
    var sat = parseFloat(cs.paddingTop) || 0;
    var sab = parseFloat(cs.paddingBottom) || 0;
    var wide = W >= 700;
    return { l: wide ? 96 : 0, r: wide ? 96 : 0, t: sat + (wide ? 76 : 68), b: sab + (wide ? 118 : 128) };
  }
  function fit(d) {
    var p = insets();
    var aw = Math.max(50, W - p.l - p.r), ah = Math.max(50, H - p.t - p.b);
    var k = Math.min(aw / d.w, ah / d.h);
    var w = d.w * k, h = d.h * k;
    return { x: p.l + (aw - w) / 2, y: p.t + (ah - h) / 2, w: w, h: h };
  }

  function layout() {
    W = innerWidth; H = innerHeight;
    for (var k = 0; k < 3; k++) {
      var d = dataOf(idx + k - 1);
      var b = fit(d);
      box[k] = b;
      slides[k].style.transform = 'translate3d(' + (k - 1) * (W + GAP) + 'px,0,0)';
      var z = zooms[k];
      z.style.left = b.x + 'px'; z.style.top = b.y + 'px';
      z.style.width = b.w + 'px'; z.style.height = b.h + 'px';
    }
    render();
  }

  function loadInto(img, d) {
    img.src = d.thumb || d.full;
    if (!d.full || d.full === img.getAttribute('data-full')) { if (d.full) img.src = d.full; return; }
    img.setAttribute('data-full', d.full);
    var pre = new Image();
    pre.decoding = 'async';
    pre.onload = function () { if (img.getAttribute('data-full') === d.full) img.src = d.full; };
    pre.src = d.full;
  }

  function fillSlides() {
    for (var k = 0; k < 3; k++) {
      imgs[k].removeAttribute('data-full');
      loadInto(imgs[k], dataOf(idx + k - 1));
    }
    var it = items[idx], l = lang();
    var cap = it.getAttribute('data-cap-' + l) || it.getAttribute('data-cap-ru') || '';
    var year = it.getAttribute('data-year');
    imgs[1].alt = cap;
    capEl.innerHTML = '';
    var c = document.createElement('span'); c.className = 'gx-title'; c.textContent = cap; capEl.appendChild(c);
    if (year) { var y = document.createElement('span'); y.className = 'gx-year'; y.textContent = year; capEl.appendChild(y); }
    countEl.textContent = (idx + 1) + ' / ' + items.length;
    creditEl.innerHTML = it.getAttribute('data-credit-' + l) || it.getAttribute('data-credit-ru') || '';
    capEl.lang = l;
  }

  /* ---------- отрисовка ---------- */
  function clampT(nx, ny, sc, rubber) {
    var b = box[1];
    var sw = b.w * sc, sh = b.h * sc;
    function axis(v, size, full, origin, boxSize) {
      var lo, hi;
      if (size <= full) { lo = hi = (boxSize - size) / 2; }
      else { lo = full - size - origin; hi = -origin; }
      if (v < lo) return rubber ? lo - Math.pow(lo - v, 0.8) * 0.5 : lo;
      if (v > hi) return rubber ? hi + Math.pow(v - hi, 0.8) * 0.5 : hi;
      return v;
    }
    return { x: axis(nx, sw, W, b.x, b.w), y: axis(ny, sh, H, b.y, b.h) };
  }

  function render() {
    track.style.transform = 'translate3d(' + dx + 'px,0,0)';
    var k = 1 - Math.min(1, Math.abs(dy) / H) * 0.3;
    slides[1].style.transform = 'translate3d(0,' + dy + 'px,0) scale(' + k + ')';
    zooms[1].style.transform = 'translate3d(' + tx + 'px,' + ty + 'px,0) scale(' + s + ')';
    zooms[0].style.transform = zooms[2].style.transform = '';
    var fade = 1 - Math.min(1, Math.abs(dy) / (H * 0.55));
    backdrop.style.opacity = fade;
    root.classList.toggle('gx-dragging-down', dy !== 0);
    root.classList.toggle('gx-zoomed', s > 1.01);
    root.classList.toggle('gx-ui-hidden', uiHidden);
  }

  /* ---------- твины ---------- */
  var raf = 0;
  function stopAnim() { if (raf) cancelAnimationFrame(raf); raf = 0; }
  function tween(to, dur, done) {
    stopAnim();
    var from = { s: s, tx: tx, ty: ty, dx: dx, dy: dy };
    if (RM) dur = 0;
    var t0 = performance.now();
    function step(now) {
      var p = dur ? Math.min(1, (now - t0) / dur) : 1;
      var e = 1 - Math.pow(1 - p, 3);
      for (var key in to) {
        var v = from[key] + (to[key] - from[key]) * e;
        if (key === 's') s = v; else if (key === 'tx') tx = v; else if (key === 'ty') ty = v;
        else if (key === 'dx') dx = v; else if (key === 'dy') dy = v;
      }
      render();
      if (p < 1) raf = requestAnimationFrame(step);
      else { raf = 0; if (done) done(); }
    }
    raf = requestAnimationFrame(step);
  }

  function zoomTo(ns, fx, fy, dur) {
    ns = Math.max(1, Math.min(MAX_S, ns));
    var b = box[1];
    var lx = (fx - b.x - tx) / s, ly = (fy - b.y - ty) / s;
    var c = clampT(fx - b.x - ns * lx, fy - b.y - ns * ly, ns, false);
    if (ns <= 1.001) c = { x: 0, y: 0 };
    if (ns > 1.01) uiHidden = true; else uiHidden = false;
    tween({ s: ns, tx: c.x, ty: c.y }, dur == null ? 300 : dur);
  }
  function resetZoom(dur) { uiHidden = false; tween({ s: 1, tx: 0, ty: 0 }, dur == null ? 260 : dur); }

  /* ---------- навигация ---------- */
  function go(dir) {
    if (busy || !isOpen) return;
    if (s > 1.01) { s = 1; tx = ty = 0; }
    busy = true;
    tween({ dx: -dir * (W + GAP) }, 320, function () {
      idx = mod(idx + dir);
      dx = 0;
      fillSlides();
      layout();
      busy = false;
    });
  }

  /* ---------- открытие / закрытие ---------- */
  function thumbPic(i) { return items[i].querySelector('.g-pic') || items[i]; }

  function bringThumbIntoView(i) {
    var strip = items[i].parentElement;
    if (strip && strip.scrollWidth > strip.clientWidth) {
      var left = items[i].offsetLeft - (strip.clientWidth - items[i].offsetWidth) / 2;
      strip.scrollLeft = Math.max(0, left);
    }
  }

  function makeGhost(src, rect, radius) {
    var g = document.createElement('div');
    g.className = 'gx-ghost';
    var im = document.createElement('img');
    im.src = src;
    im.alt = '';
    g.appendChild(im);
    g.style.left = rect.x + 'px'; g.style.top = rect.y + 'px';
    g.style.width = rect.w + 'px'; g.style.height = rect.h + 'px';
    g.style.borderRadius = radius + 'px';
    root.appendChild(g);
    return g;
  }
  // трансформация, при которой прямоугольник rect «сидит» в миниатюре th (как object-fit: cover)
  function coverState(rect, th, radius) {
    var k = Math.max(th.width / rect.w, th.height / rect.h);
    var ix = Math.max(0, (rect.w - th.width / k) / 2), iy = Math.max(0, (rect.h - th.height / k) / 2);
    var mx = th.left + th.width / 2 - (rect.x + rect.w / 2);
    var my = th.top + th.height / 2 - (rect.y + rect.h / 2);
    return {
      transform: 'translate3d(' + mx + 'px,' + my + 'px,0) scale(' + k + ')',
      clip: 'inset(' + iy + 'px ' + ix + 'px ' + iy + 'px ' + ix + 'px round ' + (radius / k) + 'px)'
    };
  }
  function thumbRadius(i) { return parseFloat(getComputedStyle(thumbPic(i)).borderTopLeftRadius) || 0; }
  function onScreen(r) { return r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth && r.width > 0; }

  function open(i) {
    if (isOpen) return;
    idx = i; isOpen = true; busy = true;
    s = 1; tx = ty = dx = dy = 0; uiHidden = false;
    lastFocus = document.activeElement;
    labels();
    root.hidden = false;
    document.documentElement.classList.add('gx-lock');
    fillSlides();
    layout();
    var th = thumbPic(i).getBoundingClientRect();
    var rad = parseFloat(getComputedStyle(root).getPropertyValue('--gx-radius')) || 0;
    if (RM || !onScreen(th)) {
      root.classList.add('gx-open', 'gx-ready');
      busy = false;
      bClose.focus({ preventScroll: true });
      return;
    }
    root.classList.add('gx-animating');
    var g = makeGhost(dataOf(i).thumb, box[1], rad);
    var st = coverState(box[1], th, thumbRadius(i));
    g.style.transform = st.transform;
    g.style.clipPath = g.style.webkitClipPath = st.clip;
    items[i].classList.add('gx-source');
    void g.offsetWidth;
    root.classList.add('gx-open');
    requestAnimationFrame(function () {
      g.classList.add('gx-ghost-run');
      g.style.transform = 'translate3d(0,0,0) scale(1)';
      g.style.clipPath = g.style.webkitClipPath = 'inset(0px 0px 0px 0px round ' + rad + 'px)';
    });
    var finished = false;
    function end() {
      if (finished) return; finished = true;
      root.classList.add('gx-ready');
      root.classList.remove('gx-animating');
      items[i].classList.remove('gx-source');
      requestAnimationFrame(function () { g.remove(); });
      busy = false;
      bClose.focus({ preventScroll: true });
    }
    g.addEventListener('transitionend', end);
    setTimeout(end, 600);
  }

  function finishClose() {
    root.hidden = true;
    root.classList.remove('gx-open', 'gx-ready', 'gx-animating', 'gx-closing');
    document.documentElement.classList.remove('gx-lock');
    isOpen = false; busy = false;
    s = 1; tx = ty = dx = dy = 0;
    backdrop.style.opacity = '';
    render();
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
  }

  function close() {
    if (!isOpen || busy) return;
    busy = true;
    stopAnim();
    var i = idx;
    bringThumbIntoView(i);
    var th = thumbPic(i).getBoundingClientRect();
    if (RM || s > 1.01 || !onScreen(th)) {
      if (RM) return finishClose();
      root.classList.add('gx-closing');
      setTimeout(finishClose, 260);
      return;
    }
    var r = imgs[1].getBoundingClientRect();
    var rect = { x: r.left, y: r.top, w: r.width, h: r.height };
    var rad = (parseFloat(getComputedStyle(root).getPropertyValue('--gx-radius')) || 0) * (r.width / box[1].w);
    var g = makeGhost(imgs[1].currentSrc || imgs[1].src, rect, rad);
    g.style.clipPath = g.style.webkitClipPath = 'inset(0px 0px 0px 0px round ' + rad + 'px)';
    items[i].classList.add('gx-source');
    root.classList.add('gx-animating');
    root.classList.remove('gx-ready');
    backdrop.style.opacity = backdrop.style.opacity || 1;
    void g.offsetWidth;
    var st = coverState(rect, th, thumbRadius(i));
    requestAnimationFrame(function () {
      g.classList.add('gx-ghost-run');
      root.classList.add('gx-closing');
      g.style.transform = st.transform;
      g.style.clipPath = g.style.webkitClipPath = st.clip;
    });
    var finished = false;
    function end() {
      if (finished) return; finished = true;
      items[i].classList.remove('gx-source');
      g.remove();
      finishClose();
    }
    g.addEventListener('transitionend', end);
    setTimeout(end, 600);
  }

  /* ---------- жесты ---------- */
  var ptrs = new Map();
  var mode = null;           // 'swipe' | 'down' | 'pan' | 'pinch'
  var start = null, base = null;
  var vel = { x: 0, y: 0 }, lastMove = null;
  var pinch = null;
  var lastTap = null, tapTimer = 0;

  function pts() { return Array.from(ptrs.values()); }

  viewport.addEventListener('pointerdown', function (e) {
    if (!isOpen || busy) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    try { viewport.setPointerCapture(e.pointerId); } catch (err) {}
    stopAnim();
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 1) {
      mode = null;
      start = { x: e.clientX, y: e.clientY, t: performance.now() };
      base = { tx: tx, ty: ty, dx: dx, dy: dy };
      vel = { x: 0, y: 0 };
      lastMove = { x: e.clientX, y: e.clientY, t: start.t };
    } else if (ptrs.size === 2) {
      var p = pts();
      pinch = {
        d: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) || 1,
        s: s,
        cx: (p[0].x + p[1].x) / 2, cy: (p[0].y + p[1].y) / 2,
        tx: tx, ty: ty
      };
      if (mode === 'swipe' || mode === 'down') { dx = 0; dy = 0; }
      mode = 'pinch';
      root.classList.add('gx-grabbing');
    }
  });

  viewport.addEventListener('pointermove', function (e) {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    var now = performance.now();

    if (mode === 'pinch' && ptrs.size >= 2) {
      var p = pts();
      var d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) || 1;
      var cx = (p[0].x + p[1].x) / 2, cy = (p[0].y + p[1].y) / 2;
      var ns = pinch.s * d / pinch.d;
      if (ns < 1) ns = 1 - (1 - ns) * 0.4;
      if (ns > MAX_S) ns = MAX_S + (ns - MAX_S) * 0.3;
      var b = box[1];
      var lx = (pinch.cx - b.x - pinch.tx) / pinch.s, ly = (pinch.cy - b.y - pinch.ty) / pinch.s;
      s = ns;
      tx = cx - b.x - ns * lx;
      ty = cy - b.y - ns * ly;
      if (s > 1.05) uiHidden = true;
      render();
      return;
    }
    if (ptrs.size !== 1 || !start) return;

    var mx = e.clientX - start.x, my = e.clientY - start.y;
    var dtm = Math.max(1, now - lastMove.t);
    vel.x = 0.75 * ((e.clientX - lastMove.x) / dtm) + 0.25 * vel.x;
    vel.y = 0.75 * ((e.clientY - lastMove.y) / dtm) + 0.25 * vel.y;
    lastMove = { x: e.clientX, y: e.clientY, t: now };

    if (!mode) {
      if (Math.abs(mx) < 7 && Math.abs(my) < 7) return;
      if (s > 1.01) mode = 'pan';
      else if (Math.abs(mx) > Math.abs(my)) mode = 'swipe';
      else mode = my > 0 ? 'down' : 'swipe-up';
      root.classList.add('gx-grabbing');
    }
    if (mode === 'pan') {
      var c = clampT(base.tx + mx, base.ty + my, s, true);
      tx = c.x; ty = c.y;
    } else if (mode === 'swipe') {
      dx = base.dx + mx;
    } else if (mode === 'down') {
      dy = my > 0 ? my : my * 0.25;
      dx = mx * 0.35;
      slides[1].style.transformOrigin = '50% 50%';
    } else if (mode === 'swipe-up') {
      dy = Math.min(0, my) * 0.2;
    }
    if (mode === 'down') {
      track.style.transform = 'translate3d(0,0,0)';
      var k = 1 - Math.min(1, Math.abs(dy) / H) * 0.3;
      slides[1].style.transform = 'translate3d(' + dx + 'px,' + dy + 'px,0) scale(' + k + ')';
      backdrop.style.opacity = 1 - Math.min(1, dy / (H * 0.55));
      root.classList.add('gx-dragging-down');
      return;
    }
    render();
  });

  function inertia() {
    if (RM) { var c0 = clampT(tx, ty, s, false); tween({ tx: c0.x, ty: c0.y }, 0); return; }
    var vx = vel.x, vy = vel.y, prev = performance.now();
    function step(now) {
      var dt = Math.min(32, now - prev); prev = now;
      tx += vx * dt; ty += vy * dt;
      var decay = Math.pow(0.992, dt);
      vx *= decay; vy *= decay;
      var c = clampT(tx, ty, s, false);
      // за краем — тормозим сильнее и тянем обратно
      if (c.x !== tx) { vx *= 0.6; tx += (c.x - tx) * 0.18; }
      if (c.y !== ty) { vy *= 0.6; ty += (c.y - ty) * 0.18; }
      render();
      if (Math.abs(vx) + Math.abs(vy) > 0.02 || Math.abs(c.x - tx) > 0.5 || Math.abs(c.y - ty) > 0.5) raf = requestAnimationFrame(step);
      else { tx = c.x; ty = c.y; render(); raf = 0; }
    }
    raf = requestAnimationFrame(step);
  }

  function handleTap(x, y) {
    var now = performance.now();
    if (lastTap && now - lastTap.t < DT_MS && Math.hypot(x - lastTap.x, y - lastTap.y) < 40) {
      clearTimeout(tapTimer);
      lastTap = null;
      if (s > 1.01) resetZoom(); else zoomTo(2.6, x, y);
      return;
    }
    lastTap = { x: x, y: y, t: now };
    clearTimeout(tapTimer);
    tapTimer = setTimeout(function () {
      lastTap = null;
      uiHidden = !uiHidden;
      render();
    }, DT_MS);
  }

  function endPtr(e) {
    if (!ptrs.has(e.pointerId)) return;
    var p0 = ptrs.get(e.pointerId);
    ptrs.delete(e.pointerId);
    if (mode === 'pinch') {
      if (ptrs.size === 1) {
        // второй палец остался — продолжаем как перетаскивание
        var rest = pts()[0];
        start = { x: rest.x, y: rest.y, t: performance.now() };
        base = { tx: tx, ty: ty, dx: 0, dy: 0 };
        lastMove = { x: rest.x, y: rest.y, t: start.t };
        vel = { x: 0, y: 0 };
        mode = s > 1.01 ? 'pan' : null;
        return;
      }
      if (ptrs.size === 0) {
        root.classList.remove('gx-grabbing');
        mode = null;
        if (s <= 1.02) { resetZoom(); return; }
        if (s > MAX_S) { zoomTo(MAX_S, pinch.cx, pinch.cy, 220); return; }
        var c = clampT(tx, ty, s, false);
        tween({ tx: c.x, ty: c.y }, 240);
      }
      return;
    }
    if (ptrs.size) return;
    root.classList.remove('gx-grabbing');
    var m = mode; mode = null;
    var el = performance.now() - (start ? start.t : 0);
    if (!m) {
      if (e.type === 'pointerup' && el < 450) handleTap(p0.x, p0.y);
      return;
    }
    if (m === 'pan') { inertia(); return; }
    if (m === 'swipe') {
      var th = W * 0.18;
      if ((dx < -th || vel.x < -0.45) && dx < 0) go(1);
      else if ((dx > th || vel.x > 0.45) && dx > 0) go(-1);
      else tween({ dx: 0 }, 260);
      return;
    }
    if (m === 'down') {
      if (dy > 110 || (vel.y > 0.55 && dy > 20)) {
        close();
      } else {
        root.classList.remove('gx-dragging-down');
        var fromDx = dx; var fromDy = dy;
        dx = 0;
        track.style.transform = 'translate3d(0,0,0)';
        // возвращаем пружиной
        var t0 = performance.now();
        stopAnim();
        (function spring(now) {
          var p = RM ? 1 : Math.min(1, (now - t0) / 280);
          var e2 = 1 - Math.pow(1 - p, 3);
          var cx2 = fromDx * (1 - e2), cy2 = fromDy * (1 - e2);
          var k = 1 - Math.min(1, Math.abs(cy2) / H) * 0.3;
          slides[1].style.transform = 'translate3d(' + cx2 + 'px,' + cy2 + 'px,0) scale(' + k + ')';
          backdrop.style.opacity = 1 - Math.min(1, Math.abs(cy2) / (H * 0.55));
          if (p < 1) raf = requestAnimationFrame(spring); else { dy = 0; raf = 0; render(); }
        })(t0);
      }
      return;
    }
    if (m === 'swipe-up') { tween({ dy: 0 }, 200); }
  }
  viewport.addEventListener('pointerup', endPtr);
  viewport.addEventListener('pointercancel', endPtr);
  viewport.addEventListener('lostpointercapture', endPtr);

  // Safari: не даём странице прокручиваться и масштабироваться под окном
  root.addEventListener('touchmove', function (e) { if (isOpen) e.preventDefault(); }, { passive: false });
  ['gesturestart', 'gesturechange'].forEach(function (n) {
    root.addEventListener(n, function (e) { e.preventDefault(); });
  });

  viewport.addEventListener('wheel', function (e) {
    if (!isOpen || busy) return;
    e.preventDefault();
    if (e.ctrlKey || Math.abs(e.deltaY) >= Math.abs(e.deltaX)) {
      var f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0022));
      var ns = Math.max(1, Math.min(MAX_S, s * f));
      var b = box[1];
      var lx = (e.clientX - b.x - tx) / s, ly = (e.clientY - b.y - ty) / s;
      s = ns;
      var c = ns <= 1.001 ? { x: 0, y: 0 } : clampT(e.clientX - b.x - ns * lx, e.clientY - b.y - ns * ly, ns, false);
      tx = c.x; ty = c.y;
      uiHidden = s > 1.01;
      render();
    }
  }, { passive: false });

  /* ---------- кнопки и клавиатура ---------- */
  function center() { return { x: W / 2, y: box[1].y + box[1].h / 2 }; }
  bClose.addEventListener('click', close);
  bPrev.addEventListener('click', function () { go(-1); });
  bNext.addEventListener('click', function () { go(1); });
  bIn.addEventListener('click', function () { var c = center(); zoomTo(s * 1.7, c.x, c.y); });
  bOut.addEventListener('click', function () { var c = center(); if (s / 1.7 <= 1.05) resetZoom(); else zoomTo(s / 1.7, c.x, c.y); });

  document.addEventListener('keydown', function (e) {
    if (!isOpen) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
    else if (e.key === '+' || e.key === '=') { var c = center(); zoomTo(s * 1.5, c.x, c.y); }
    else if (e.key === '-') { var c2 = center(); if (s / 1.5 <= 1.05) resetZoom(); else zoomTo(s / 1.5, c2.x, c2.y); }
    else if (e.key === '0') resetZoom();
    else if (e.key === 'Tab') {
      var f = [].slice.call(root.querySelectorAll('button, a[href]')).filter(function (x) { return x.offsetParent !== null; });
      if (!f.length) return;
      var i = f.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    }
  });

  window.addEventListener('resize', function () {
    if (!isOpen) return;
    s = 1; tx = ty = dx = dy = 0;
    layout();
  });

  document.addEventListener('chka-lang', function () { labels(); if (isOpen) fillSlides(); });

  items.forEach(function (it, i) {
    it.addEventListener('click', function (e) { e.preventDefault(); open(i); });
  });

  window.ChkaGallery = { open: open, close: close };
})();
