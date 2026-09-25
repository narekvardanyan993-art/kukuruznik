/* ============================================================================
   ТЯЖЁЛАЯ ПОДГОТОВКА КАДРОВ — работает в Web Worker (главный поток не занят, приветствие и анимации идут плавно).
   Если Worker/OffscreenCanvas нет — тот же код выполняется в главном потоке (см. depth.html).

   Что делает: декодирует картинки (fetch + createImageBitmap), готовит карту глубины, вырезку здания, маски окон,
   окружение (небо, деревья, окна), «землю» (кадр с подложкой на месте здания) и тексуры закатa/ночи. Возвращает
   типизированные массивы (transfer), готовые для texImage2D.
   Функции ниже — тот же код, что раньше жил в depth.html (логика не менялась).
   ============================================================================ */
(function (root) {
  'use strict';
  var IN_WORKER = typeof importScripts === 'function';
  var CONFIG = {};
  var STATE = {};   // по номеру кадра: то, что нужно для закатa/ночи (маска здания, дневные пиксели, подложка, окна)

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function mkCanvas() { return IN_WORKER ? new OffscreenCanvas(1, 1) : document.createElement('canvas'); }
  function nw(img) { return img.naturalWidth || img.width; }
  function nh(img) { return img.naturalHeight || img.height; }

  // загрузка картинки: в воркере fetch + createImageBitmap (декодирование вне главного потока); в главном — Image.decode
  function load(url, tries) {
    tries = tries == null ? 2 : tries;
    var p;
    if (IN_WORKER) {
      p = fetch(url).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url); return r.blob(); })
        .then(function (b) { return createImageBitmap(b, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }); });
    } else {
      p = new Promise(function (res, rej) {
        var img = new Image();
        img.onload = function () { (img.decode ? img.decode().catch(function () {}) : Promise.resolve()).then(function () { res(img); }); };
        img.onerror = function () { rej(new Error('не загрузилось: ' + url)); };
        img.src = url;
      });
    }
    return p.catch(function (err) {
      if (tries <= 0) throw err;
      return new Promise(function (r) { setTimeout(r, 400); }).then(function () { return load(url, tries - 1); });
    });
  }

  // Не больше MAX_TEX_SIZE по длинной стороне — иначе iPhone выгружает
  // большие кадры из памяти. Возвращает {src, w, h}: src — img или canvas.
  function fitToCap(img) {
    var w = nw(img), h = nh(img), m = Math.max(w, h), cap = CONFIG.MAX_TEX_SIZE;
    if (m <= cap) return { src: img, w: w, h: h };
    var s = cap / m, c = mkCanvas();
    c.width = Math.max(1, Math.round(w * s));
    c.height = Math.max(1, Math.round(h * s));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return { src: c, w: c.width, h: c.height };
  }

  // Скользящий бокс-блюр по одной оси с зажатием краёв.
  function blurPass(src, dst, w, h, r, horiz) {
    var n = horiz ? w : h, lines = horiz ? h : w;
    var stride = horiz ? 1 : w, lineStride = horiz ? w : 1, div = 2 * r + 1;
    for (var l = 0; l < lines; l++) {
      var base = l * lineStride, sum = 0, k, i;
      for (k = -r; k <= r; k++) sum += src[base + Math.min(n - 1, Math.max(0, k)) * stride];
      for (i = 0; i < n; i++) {
        dst[base + i * stride] = (sum / div + 0.5) | 0;
        sum += src[base + Math.min(n - 1, i + r + 1) * stride] - src[base + Math.max(0, i - r) * stride];
      }
    }
  }
  function boxBlur(a, w, h, r) { // блюр на месте (две оси)
    var tmp = new Uint8Array(a.length);
    blurPass(a, tmp, w, h, r, true);
    blurPass(tmp, a, w, h, r, false);
  }

  // Карта глубины -> 1 канал: растягиваем контраст по 2–98 перцентилю
  // (плоскость фокуса всегда в середине диапазона), затем размываем
  // 3 проходами бокс-блюра (~CONFIG.DEPTH_BLUR_PX) — резкие ступеньки
  // глубины на границе здания и неба иначе рвут картинку.
  function prepareDepth(img) {
    var fit = fitToCap(img), w = fit.w, h = fit.h;
    var c = mkCanvas();
    c.width = w; c.height = h;
    var ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(fit.src, 0, 0, w, h);
    var px = ctx.getImageData(0, 0, w, h).data, n = w * h;
    var a = new Uint8Array(n), hist = new Uint32Array(256), i;
    for (i = 0; i < n; i++) { a[i] = px[i * 4]; hist[a[i]]++; }
    var lo = 0, hi = 255, acc = 0;
    for (i = 0; i < 256; i++) { acc += hist[i]; if (acc >= n * 0.02) { lo = i; break; } }
    acc = 0;
    for (i = 255; i >= 0; i--) { acc += hist[i]; if (acc >= n * 0.02) { hi = i; break; } }
    if (hi - lo < 8) { lo = 0; hi = 255; }
    var span = hi - lo;
    for (i = 0; i < n; i++) a[i] = clamp(Math.round((a[i] - lo) * 255 / span), 0, 255);
    var r = Math.max(1, Math.round(CONFIG.DEPTH_BLUR_PX / 2)), tmp = new Uint8Array(n);
    for (i = 0; i < 3; i++) {
      blurPass(a, tmp, w, h, r, true);
      blurPass(tmp, a, w, h, r, false);
    }
    return { w: w, h: h, d: a };
  }

  // Вырезка здания (RGBA, маска SAM): оставляем только самый большой
  // связный кусок (обрывки фона в маске не должны ехать вместе со зданием),
  // считаем маску окон (окна темнее своего окружения) и среднюю глубину
  // здания — по ней здание двигается целиком.
  function analyzeBuilding(img, depth, frameImg, bgImg) {
    var fit = fitToCap(img), w = fit.w, h = fit.h, n = w * h, i;
    var c = mkCanvas();
    c.width = w; c.height = h;
    var ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(fit.src, 0, 0, w, h);
    var id = ctx.getImageData(0, 0, w, h), px = id.data;

    // 1) самый большой связный кусок маски (alpha > 128)
    var lab = new Int32Array(n), stack = new Int32Array(n), sizes = [0], nl = 0, best = 0, bestSize = 0;
    for (i = 0; i < n; i++) {
      if (lab[i] || px[i * 4 + 3] <= 128) continue;
      nl++;
      var sp = 0, size = 0;
      stack[sp++] = i; lab[i] = nl;
      while (sp) {
        var p = stack[--sp], x = p % w, y = (p / w) | 0;
        size++;
        if (x > 0 && !lab[p - 1] && px[(p - 1) * 4 + 3] > 128) { lab[p - 1] = nl; stack[sp++] = p - 1; }
        if (x < w - 1 && !lab[p + 1] && px[(p + 1) * 4 + 3] > 128) { lab[p + 1] = nl; stack[sp++] = p + 1; }
        if (y > 0 && !lab[p - w] && px[(p - w) * 4 + 3] > 128) { lab[p - w] = nl; stack[sp++] = p - w; }
        if (y < h - 1 && !lab[p + w] && px[(p + w) * 4 + 3] > 128) { lab[p + w] = nl; stack[sp++] = p + w; }
      }
      if (size > bestSize) { bestSize = size; best = nl; }
    }
    // Пиксели чужих кусков и мягкий ореол вокруг них убираем; ореол главного
    // куска (label 0, но рядом с ним) оставляем как есть.
    var keep = new Uint8Array(n);
    for (i = 0; i < n; i++) keep[i] = lab[i] === best ? 1 : 0;
    var grown = new Uint8Array(n); // главный кусок, расширенный на 6 px — там мягкий край оставляем
    for (i = 0; i < n; i++) grown[i] = keep[i] * 255;
    boxBlur(grown, w, h, 6);
    for (i = 0; i < n; i++) if (!keep[i] && grown[i] === 0) px[i * 4 + 3] = 0;
    for (i = 0; i < n; i++) if (lab[i] && lab[i] !== best) px[i * 4 + 3] = 0;

    // 2) маска окон: темнее своего окружения (окно 9 px против 2 px)
    var L = new Uint8Array(n), sum = 0, cnt = 0;
    for (i = 0; i < n; i++) {
      var l = (0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]) | 0;
      L[i] = l;
      if (keep[i]) { sum += l; cnt++; }
    }
    var mean = cnt ? (sum / cnt) | 0 : 128;
    for (i = 0; i < n; i++) if (!keep[i]) L[i] = mean;
    var big = L.slice(), small = L.slice();
    // размеры окон зависят от масштаба кадра (крупный план — окна втрое больше): радиусы по ширине башни
    var bx0 = w, bx1 = 0;
    for (i = 0; i < n; i++) if (keep[i]) { var xq = i % w; if (xq < bx0) bx0 = xq; if (xq > bx1) bx1 = xq; }
    var kS = clamp((bx1 - bx0 + 1) / 170, 1, 3.4);
    boxBlur(big, w, h, Math.round(9 * kS));
    boxBlur(small, w, h, Math.round(2 * kS));
    var win = new Uint8Array(n);
    // порог подстраивается под контраст кадра: у тёплых/светлых башен окна менее контрастны
    var hist = new Uint32Array(256), hc = 0;
    for (i = 0; i < n; i++) if (keep[i]) { hist[Math.max(0, big[i] - small[i])]++; hc++; }
    var q90 = 40, acc2 = 0;
    for (i = 255; i >= 0; i--) { acc2 += hist[i]; if (acc2 >= hc * 0.10) { q90 = Math.max(12, i); break; } }
    for (i = 0; i < n; i++) {
      var dv = (big[i] - small[i]) / 255;
      var wv = clamp((dv * 255 - 0.35 * q90) / (0.6 * q90), 0, 1);
      win[i] = keep[i] ? (wv * (px[i * 4 + 3] / 255) * 255) | 0 : 0;
    }
    blurPass(win, small, w, h, 1, true); blurPass(small, win, w, h, 1, false); // мягкое свечение

    // 3) средняя глубина здания по маске
    var dsum = 0, dc = 0, dm = depth;
    for (i = 0; i < n; i++) {
      if (!keep[i]) continue;
      var xx = i % w, yy = (i / w) | 0;
      dsum += dm.d[clamp(((yy + 0.5) / h * dm.h) | 0, 0, dm.h - 1) * dm.w + clamp(((xx + 0.5) / w * dm.w) | 0, 0, dm.w - 1)];
      dc++;
    }
    var meanD = dc ? dsum / dc / 255 : 0.5;

    // 4) «земля»: цельный кадр (подиум, лестницы, всё вокруг), а на месте
    // самого здания — фон без здания. Здание поверх едет жёстко и открывает этот фон.
    function pixelsOf(im) {
      var cc = mkCanvas();
      cc.width = w; cc.height = h;
      var x2 = cc.getContext('2d', { willReadFrequently: true });
      x2.drawImage(im, 0, 0, w, h);
      return { cv: cc, ctx: x2, id: x2.getImageData(0, 0, w, h) };
    }
    var G = pixelsOf(frameImg), gp = G.id.data, bp = pixelsOf(bgImg).id.data;
    var dayPx = new Uint8ClampedArray(gp);   // дневные пиксели без заплатки — нужны, чтобы подогнать закат/ночь под подложку
    var hole = new Uint8Array(n);
    for (i = 0; i < n; i++) hole[i] = px[i * 4 + 3];
    boxBlur(hole, w, h, 3); // маска чуть шире здания: его ореол в землю не попадает
    for (i = 0; i < n; i++) {
      var ha = Math.min(255, hole[i] * 3) / 255;
      if (ha <= 0) continue;
      gp[i * 4] = gp[i * 4] * (1 - ha) + bp[i * 4] * ha;
      gp[i * 4 + 1] = gp[i * 4 + 1] * (1 - ha) + bp[i * 4 + 1] * ha;
      gp[i * 4 + 2] = gp[i * 4 + 2] * (1 - ha) + bp[i * 4 + 2] * ha;
    }
    // результат — массивы для GPU: земля RGB и здание RGBA с предумноженной альфой (края без тёмной каймы)
    var ground = new Uint8Array(n * 3), bldPm = new Uint8Array(n * 4);
    for (i = 0; i < n; i++) {
      ground[i * 3] = gp[i * 4]; ground[i * 3 + 1] = gp[i * 4 + 1]; ground[i * 3 + 2] = gp[i * 4 + 2];
      var aa = px[i * 4 + 3];
      bldPm[i * 4] = (px[i * 4] * aa + 127) / 255 | 0; bldPm[i * 4 + 1] = (px[i * 4 + 1] * aa + 127) / 255 | 0;
      bldPm[i * 4 + 2] = (px[i * 4 + 2] * aa + 127) / 255 | 0; bldPm[i * 4 + 3] = aa;
    }
    var alpha = new Uint8Array(n);
    for (i = 0; i < n; i++) alpha[i] = px[i * 4 + 3];
    return { w: w, h: h, ground: ground, bldPm: bldPm, alpha: alpha, dayPx: dayPx, plate: bp, win: { w: w, h: h, d: win }, meanD: meanD };
  }

  function rng(seed) { // mulberry32: одинаковые «случайные» окна при каждом запуске
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function rand(R, a, b) { return a + (b - a) * R(); }

  function readChannels(img, w, h) { // RGBA -> Uint8Array RGBA нужного размера
    var c = mkCanvas();
    c.width = w; c.height = h;
    var x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(img, 0, 0, w, h);
    return x.getImageData(0, 0, w, h).data;
  }

  function halfMax(src, w, h, stride, ch) { // уменьшение вдвое, берём максимум 2×2 (маска окон не тает)
    var w2 = (w + 1) >> 1, h2 = (h + 1) >> 1, out = new Uint8Array(w2 * h2), x, y;
    for (y = 0; y < h2; y++) for (x = 0; x < w2; x++) {
      var m = 0, dy, dx;
      for (dy = 0; dy < 2; dy++) for (dx = 0; dx < 2; dx++) {
        var sx = Math.min(w - 1, x * 2 + dx), sy = Math.min(h - 1, y * 2 + dy);
        var v = src[(sy * w + sx) * stride + ch];
        if (v > m) m = v;
      }
      out[y * w2 + x] = m;
    }
    return out;
  }

  function halfAvg(src, w, h, stride, ch) { // уменьшение вдвое средним 2×2: маска окон не «пухнет» за контур
    var w2 = (w + 1) >> 1, h2 = (h + 1) >> 1, out = new Uint8Array(w2 * h2), x, y;
    for (y = 0; y < h2; y++) for (x = 0; x < w2; x++) {
      var sum = 0, dy, dx;
      for (dy = 0; dy < 2; dy++) for (dx = 0; dx < 2; dx++) {
        sum += src[(Math.min(h - 1, y * 2 + dy) * w + Math.min(w - 1, x * 2 + dx)) * stride + ch];
      }
      out[y * w2 + x] = sum >> 2;
    }
    return out;
  }
  function hsh(a, b) { // детерминированный «случайный» hash: узор окон фиксирован для кадра
    var x = Math.imul(a ^ 0x9E3779B9, 0x85EBCA6B) ^ Math.imul((b + 0x7F4A7C15) | 0, 0xC2B2AE35);
    x ^= x >>> 15; x = Math.imul(x, 0x2C1B3C6D); x ^= x >>> 12; x = Math.imul(x, 0x297A2D39); x ^= x >>> 15;
    return (x >>> 0) / 4294967296;
  }

  // Каждое связное пятно маски — одно окно. Берём только уверенно распознанные (форма овала/прямоугольника,
  // нормальный размер). Свет — строго внутри окна: контурные пиксели остаются тусклыми, середина полная.
  function labelWindows(mask, w, h, thr, opt) {
    var n = w * h, lab = new Int32Array(n), stack = new Int32Array(n), out = [], nl = 0, i;
    for (i = 0; i < n; i++) {
      if (lab[i] || mask[i] <= thr) continue;
      var sp = 0, list = [], x0 = w, x1 = 0, y0 = h, y1 = 0;
      stack[sp++] = i; lab[i] = ++nl;
      while (sp) {
        var p = stack[--sp], x = p % w, y = (p / w) | 0;
        list.push(p);
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (x > 0 && !lab[p - 1] && mask[p - 1] > thr) { lab[p - 1] = nl; stack[sp++] = p - 1; }
        if (x < w - 1 && !lab[p + 1] && mask[p + 1] > thr) { lab[p + 1] = nl; stack[sp++] = p + 1; }
        if (y > 0 && !lab[p - w] && mask[p - w] > thr) { lab[p - w] = nl; stack[sp++] = p - w; }
        if (y < h - 1 && !lab[p + w] && mask[p + w] > thr) { lab[p + w] = nl; stack[sp++] = p + w; }
      }
      var bw = x1 - x0 + 1, bh = y1 - y0 + 1, aspect = bw / bh, fill = list.length / (bw * bh);
      if (list.length < 6 || bw * bh > 3000 || aspect > opt.amax || aspect < opt.amin || fill < opt.fill) continue;
      // Овал по рамке найденного пятна: свет строго внутри эллипса (мягкий край внутрь), ничего за контуром.
      // Пятно должно быть похоже на овал (заполнение ~0.6–0.95 рамки), иначе считаем распознавание неуверенным.
      if (fill > 0.97) continue;
      var cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = bw / 2 + 0.3, ry = bh / 2 + 0.3;
      var idx = [], val = [], yr, xr;
      for (yr = y0; yr <= y1; yr++) for (xr = x0; xr <= x1; xr++) {
        var ex = (xr - cx) / rx, ey = (yr - cy) / ry, r = Math.sqrt(ex * ex + ey * ey);
        if (r > 1) continue;
        idx.push(yr * w + xr); val.push(r < 0.7 ? 255 : (255 * (1 - (r - 0.7) / 0.3) * 0.75 + 30) | 0);
      }
      if (idx.length < 4) continue;
      out.push({ idx: new Int32Array(idx), val: new Uint8Array(val), bw: bw, bh: bh, cx: cx, cy: cy });
    }
    return out;
  }

  // Окружение кадра для GPU: карта глубины+небо+деревья (RGBA), окна с состояниями, звёзды, лампы.
  function prepareEnv(imgEnv, imgWin2, depth, bld, frameIdx) {
    var w = depth.w, h = depth.h, n = w * h, i;
    var env = readChannels(imgEnv, w, h), w2px = readChannels(imgWin2, w, h);
    var ew = (w + 1) >> 1, eh = (h + 1) >> 1, en = ew * eh;
    // GPU-текстура: R глубина, G небо, B высота дерева, A фаза (вдвое мельче)
    var gd = new Uint8Array(en * 4), x, y, skyCount = 0;
    for (y = 0; y < eh; y++) for (x = 0; x < ew; x++) {
      var o = y * ew + x, s0 = Math.min(h - 1, y * 2) * w + Math.min(w - 1, x * 2), s1 = Math.min(h - 1, y * 2 + 1) * w + Math.min(w - 1, x * 2 + 1);
      gd[o * 4] = (depth.d[s0] + depth.d[s1]) >> 1;
      gd[o * 4 + 1] = (env[s0 * 4] + env[s1 * 4]) >> 1;
      gd[o * 4 + 2] = (env[s0 * 4 + 1] + env[s1 * 4 + 1]) >> 1;
      gd[o * 4 + 3] = env[s0 * 4 + 2];
      if (gd[o * 4 + 1] > 127) skyCount++;
    }
    var skyFrac = skyCount / en;
    var cells = 32 * 57;
    var starQ = clamp(CONFIG.STARS / (cells * Math.max(0.05, skyFrac)), 0, 0.6);
    // окна: башня (маска из analyzeBuilding) и другие здания (win2)
    var maskT = halfAvg(bld.win.d, w, h, 1, 0), maskO = halfAvg(w2px, w, h, 4, 0);
    var emis = new Uint8Array(en * 4);
    for (i = 0; i < en; i++) { emis[i * 4 + 2] = maskT[i]; emis[i * 4 + 3] = maskO[i]; } // B, A — сами маски (закат)
    var seed = 1000003 * (frameIdx + 1) + 91733;          // свой узор на каждом кадре, но фиксированный
    var winsT = labelWindows(maskT, ew, eh, 55, { amin: 0.9, amax: 3.6, fill: 0.5 });
    // окна у краёв башни, видные меньше чем наполовину (узкие из-за изгиба), не зажигаем
    var widths = winsT.map(function (q) { return q.bw; }).sort(function (a, b) { return a - b; });
    var med = widths.length ? widths[widths.length >> 1] : 0;
    var areas = winsT.map(function (q) { return q.bw * q.bh; }).sort(function (a, b) { return a - b; });
    var a85 = areas.length ? areas[Math.floor(areas.length * 0.85)] : 0;
    winsT = winsT.filter(function (q) { var a = q.bw * q.bh; return q.bw >= 0.55 * med && a >= 0.4 * a85 && a <= 1.9 * a85; });
    var winsO = labelWindows(maskO, ew, eh, 100, { amin: 0.6, amax: 2.6, fill: 0.7 });
    var wins = [];
    [[winsT, 0, CONFIG.NIGHT_TOWER_LIT], [winsO, 1, CONFIG.NIGHT_OTHER_LIT]].forEach(function (g) {
      var frac = g[2][0] + (g[2][1] - g[2][0]) * hsh(seed, 1000 + g[1]);
      g[0].forEach(function (it) {
        var key = it.idx[0], lit = hsh(seed, key) < frac;
        var dim = lit && hsh(seed, key + 7) < 0.2;      // 20% горящих — тусклый свет, как за шторой
        wins.push({
          idx: it.idx, val: it.val, ch: g[1], on: lit, cur: lit ? 1 : 0,
          bright: dim ? 0.2 + 0.18 * hsh(seed, key + 13) : CONFIG.WINDOW_BRIGHT[0] + (CONFIG.WINDOW_BRIGHT[1] - CONFIG.WINDOW_BRIGHT[0]) * hsh(seed, key + 13),
          delay: hsh(seed, key + 3) * 0.88, lvl: 0, animT0: -1, animFrom: 0
        });
      });
    });
    return { gpuDepth: gd, ew: ew, eh: eh, emis: emis, wins: wins, skyFrac: skyFrac, starQ: starQ, dirty: false, winsT: winsT };
  }

  // ---------- один кадр: день ----------
  function prepDay(f, i) {
    return Promise.all([load(f.color), load(f.depth), load(f.bg.color), load(f.building.color), load(f.env), load(f.win2)]).then(function (imgs) {
      var depth = prepareDepth(imgs[1]);
      var bld = analyzeBuilding(imgs[3], depth, imgs[0], imgs[2]);
      var env = prepareEnv(imgs[4], imgs[5], depth, bld, i);
      // список окон башни (центр и размер, доли кадра) — для «живых» деталей ночью
      var winList = (env.winsT || []).map(function (q) { return { u: q.cx / env.ew, v: q.cy / env.eh, w: q.bw / env.ew, h: q.bh / env.eh }; });
      STATE[i] = { w: bld.w, h: bld.h, alpha: bld.alpha, dayPx: bld.dayPx, plate: bld.plate, ew: env.ew, eh: env.eh, winList: winList };
      var thumb = makeThumbBlob(imgs[0]);
      return Promise.resolve(thumb).then(function (tb) {
        var out = {
          w: bld.w, h: bld.h, depth: depth, kB: bld.meanD * 2 - 1, dB: bld.meanD,
          ground: bld.ground, bldPm: bld.bldPm, gpuDepth: env.gpuDepth, ew: env.ew, eh: env.eh, emis: env.emis,
          wins: env.wins, skyFrac: env.skyFrac, starQ: env.starQ, winList: winList, thumb: tb
        };
        return out;
      });
    });
  }

  function makeThumbBlob(img) {
    var c = mkCanvas(), w = 180, h = Math.round(w * nh(img) / nw(img));
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    if (c.convertToBlob) return c.convertToBlob({ type: 'image/jpeg', quality: 0.7 }).catch(function () { return null; });
    return new Promise(function (res) { c.toBlob(function (b) { res(b); }, 'image/jpeg', 0.7); });
  }

  // ---------- закат / ночь: картинка от Nano Banana, уже приведена к размеру кадра (tools/gemini_intake.py) ----------
  // Земля — картинка состояния, где на месте башни лежит дневная подложка, подогнанная по яркости под это состояние
  // (по кольцу вокруг башни); башня — сама картинка (альфа берётся из дневной вырезки в шейдере). Оба — RGB.
  function prepState(i, kind, url) {
    var S = STATE[i];
    if (!S) return Promise.reject(new Error('нет дневного кадра ' + i));
    return load(url, 1).then(function (img) {
      var w = S.w, h = S.h, n = w * h, k, q;
      var cc = mkCanvas(); cc.width = w; cc.height = h;
      var x2 = cc.getContext('2d', { willReadFrequently: true });
      x2.drawImage(img, 0, 0, w, h);
      var np = x2.getImageData(0, 0, w, h).data, D = S.dayPx, P = S.plate, alpha = S.alpha;
      var full = new Uint8Array(n * 3);
      for (q = 0; q < n; q++) { full[q * 3] = np[q * 4]; full[q * 3 + 1] = np[q * 4 + 1]; full[q * 3 + 2] = np[q * 4 + 2]; }
      // во сколько раз состояние темнее/ярче дня по кольцу вокруг башни (яркие горящие окна не считаем)
      var near = alpha.slice(), far = alpha.slice();
      boxBlur(near, w, h, 8); boxBlur(far, w, h, 26);
      var sn = [0, 0, 0], sd = [0, 0, 0];
      for (q = 0; q < n; q++) {
        if (!(far[q] > 0 && near[q] === 0)) continue;
        var lum = 0.299 * np[q * 4] + 0.587 * np[q * 4 + 1] + 0.114 * np[q * 4 + 2];
        if (lum > 190) continue;
        for (k = 0; k < 3; k++) { sn[k] += np[q * 4 + k]; sd[k] += D[q * 4 + k]; }
      }
      var ratio = [0, 1, 2].map(function (z) { return sd[z] > 0 ? clamp(sn[z] / sd[z], 0.05, 1.6) : 0.3; });
      // окна башни: горит ли (яркий тёплый центр) — для «живых» деталей
      var lit = null;
      if (kind === 'night') {
        lit = S.winList.map(function (wn) {
          var x = clamp(Math.round(wn.u * w), 0, w - 1), y = clamp(Math.round(wn.v * h), 0, h - 1), o = (y * w + x) * 4;
          return (0.299 * np[o] + 0.587 * np[o + 1] + 0.114 * np[o + 2]) > 150 ? 1 : 0;
        });
      }
      var hole = alpha.slice();
      boxBlur(hole, w, h, 3);
      var ground = new Uint8Array(n * 3);
      for (q = 0; q < n; q++) {
        var ha = Math.min(255, hole[q] * 3) / 255;
        for (k = 0; k < 3; k++) ground[q * 3 + k] = ha > 0 ? np[q * 4 + k] * (1 - ha) + P[q * 4 + k] * ratio[k] * ha : np[q * 4 + k];
      }
      return { ground: ground, full: full, lit: lit, w: w, h: h };
    });
  }

  function transferList(o) {
    var t = [], seen = [];
    (function walk(v) {
      if (!v || typeof v !== 'object') return;
      if (ArrayBuffer.isView(v)) { if (seen.indexOf(v.buffer) < 0) { seen.push(v.buffer); t.push(v.buffer); } return; }
      if (Array.isArray(v)) { v.forEach(walk); return; }
      if (v instanceof Blob) return;
      Object.keys(v).forEach(function (k) { walk(v[k]); });
    })(o);
    return t;
  }

  var API = {
    init: function (cfg) { CONFIG = cfg; return Promise.resolve(true); },
    day: function (f, i) { return prepDay(f, i); },
    state: function (i, kind, url) { return prepState(i, kind, url); }
  };

  if (IN_WORKER) {
    root.onmessage = function (e) {
      var m = e.data;
      Promise.resolve().then(function () { return API[m.method].apply(null, m.args); }).then(function (res) {
        root.postMessage({ id: m.id, ok: true, res: res }, transferList(res));
      }, function (err) { root.postMessage({ id: m.id, ok: false, err: String(err && err.message || err) }); });
    };
  } else {
    root.Prep = API;
  }
})(typeof self !== 'undefined' ? self : this);
