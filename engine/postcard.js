/* Открытка «в сторис» (e1.27, s26): кадр с экрана → 1080×1920, музейная табличка, почтовый штемпель «Երևան» с датой, подпись chka.am/<здание>.
   Только рисование на 2D-холсте — без WebGL и без чтения холста, который уходит в текстуру (урок s15). Вызывается по нажатию, в цикле кадра не работает.

   ChkaPostcard.compose(src, o) → новый холст 1080×1920
     src — холст 1080×1920 с картинкой (готовый кадр с экрана, уже обрезанный под 9:16 — viewer.js, captureView)
     o   — { lang, name, years, line, url, film, date, seed, font }
   ChkaPostcard.SAFE — безопасная зона TikTok + Instagram Stories (px открытки 1080×1920): всё, что рисуется поверх кадра, — внутри неё.
     Сверху 250 (полоса прогресса и имя в Stories), снизу 500 (подпись, звук и ник в TikTok — 484, поле ответа в Stories — 250),
     справа 150 (столбик лайков/комментариев TikTok — 140), слева 64 (TikTok — 44). Разметка зон — tests/lenin/report/s26/zones.png. */
(function () {
  'use strict';
  var W = 1080, H = 1920;
  var SAFE = { l: 64, t: 250, r: 150, b: 500 };   // отступы от краёв
  var INK = '#2b2622', PAPER = '#f3ead6';
  // Штемпель: верхняя дуга всегда «ԵՐԵՎԱՆ», нижняя — страна на языке подписи.
  var STAMP_TOP = 'ԵՐԵՎԱՆ';
  var STAMP_BOTTOM = { hy: 'ՀԱՅԱՍՏԱՆ', ru: 'АРМЕНИЯ', en: 'ARMENIA' };

  function rng(seed) {   // mulberry32 — повторяемое «случайное» (зерно плёнки, бумага, износ штемпеля)
    var a = (seed >>> 0) || 1;
    return function () { a = (a + 0x6D2B79F5) | 0; var t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function mk(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function fnt(o, wgt, px) { return wgt + ' ' + Math.round(px) + 'px ' + o.font; }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  // ---------- текст: перенос по словам в N строк, кегль уменьшается, пока не влезет ----------
  function fitLines(x, text, wgt, px, minPx, maxW, maxLines, o) {
    var words = String(text).split(/\s+/).filter(Boolean);
    for (var s = px; s >= minPx; s -= 2) {
      x.font = fnt(o, wgt, s);
      var lines = [], cur = '';
      for (var i = 0; i < words.length; i++) {
        var t = cur ? cur + ' ' + words[i] : words[i];
        if (x.measureText(t).width <= maxW || !cur) cur = t; else { lines.push(cur); cur = words[i]; }
      }
      if (cur) lines.push(cur);
      var fits = lines.length <= maxLines && lines.every(function (l) { return x.measureText(l).width <= maxW; });
      if (fits) return { px: s, lines: lines };
    }
    x.font = fnt(o, wgt, minPx);   // не влезло и в самом мелком — режем последнюю строку многоточием
    var out = [], c2 = '';
    words.forEach(function (w) { var t = c2 ? c2 + ' ' + w : w; if (x.measureText(t).width <= maxW || !c2) c2 = t; else { out.push(c2); c2 = w; } });
    if (c2) out.push(c2);
    out = out.slice(0, maxLines);
    var last = out[out.length - 1];
    while (last.length > 1 && x.measureText(last + '…').width > maxW) last = last.slice(0, -1);
    out[out.length - 1] = last + (out.join(' ').length < String(text).length ? '…' : '');
    return { px: minPx, lines: out };
  }

  // ---------- плёнка: тёплое выцветание, виньетка, зерно, редкие пылинки ----------
  function filmLook(x, r) {
    var img = x.getImageData(0, 0, W, H), d = img.data;
    for (var i = 0; i < d.length; i += 4) {
      var R = d[i], G = d[i + 1], B = d[i + 2], L = R * 0.3 + G * 0.59 + B * 0.11;
      // 14% к сепии, приподнятые тени, чуть приглушённый контраст
      R = R + (L * 1.07 + 6 - R) * 0.14; G = G + (L * 0.95 + 2 - G) * 0.14; B = B + (L * 0.78 - 4 - B) * 0.14;
      d[i] = 14 + R * 0.93; d[i + 1] = 11 + G * 0.93; d[i + 2] = 10 + B * 0.9;
    }
    x.putImageData(img, 0, 0);
    var g = x.createRadialGradient(W / 2, H * 0.46, H * 0.3, W / 2, H * 0.5, H * 0.72);
    g.addColorStop(0, 'rgba(40,26,12,0)'); g.addColorStop(1, 'rgba(40,26,12,0.42)');
    x.save(); x.globalCompositeOperation = 'multiply'; x.fillStyle = g; x.fillRect(0, 0, W, H); x.restore();
    x.save();   // пылинки и один тонкий волосок — едва заметно
    for (var k = 0; k < 7; k++) {
      x.fillStyle = r() < 0.5 ? 'rgba(255,250,236,0.45)' : 'rgba(30,22,14,0.35)';
      x.beginPath(); x.ellipse(r() * W, r() * H, 0.8 + r() * 1.8, 0.6 + r() * 1.2, r() * 3, 0, 6.283); x.fill();
    }
    x.strokeStyle = 'rgba(255,248,230,0.18)'; x.lineWidth = 0.9;
    var sx = W * (0.15 + r() * 0.7), sy = H * (0.1 + r() * 0.3);
    x.beginPath(); x.moveTo(sx, sy); x.quadraticCurveTo(sx + 6 - r() * 12, sy + 160, sx + 4 - r() * 8, sy + 330); x.stroke();
    x.restore();
  }
  var grainTile = null;   // плитка зерна 512×512 — одна на страницу (нажатие не тратит время на шум заново)
  function grain(x, r, amount) {   // зерно поверх всего (overlay); плитка сдвигается случайно — повтор не виден
    if (!grainTile) {
      var rg = rng(7), t = mk(512, 512), tx = t.getContext('2d'), im = tx.createImageData(512, 512), d = im.data;
      for (var i = 0; i < d.length; i += 4) { var v = 128 + (rg() + rg() + rg() - 1.5) * 120; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
      tx.putImageData(im, 0, 0); grainTile = t;
    }
    var ox = -Math.floor(r() * 512), oy = -Math.floor(r() * 512);
    x.save(); x.globalCompositeOperation = 'overlay'; x.globalAlpha = amount;
    for (var y = oy; y < H; y += 512) for (var xx = ox; xx < W; xx += 512) x.drawImage(grainTile, xx, y);
    x.restore();
  }

  // ---------- музейная табличка ----------
  function paperTexture(w, h, r) {
    var c = mk(w, h), x = c.getContext('2d');
    x.fillStyle = PAPER; x.fillRect(0, 0, w, h);
    var im = x.getImageData(0, 0, w, h), d = im.data;
    for (var i = 0; i < d.length; i += 4) { var n = (r() - 0.5) * 9; d[i] += n; d[i + 1] += n; d[i + 2] += n * 0.8; }
    x.putImageData(im, 0, 0);
    x.strokeStyle = 'rgba(120,96,60,0.06)'; x.lineWidth = 1;   // волокна бумаги
    for (var k = 0; k < 60; k++) { var px = r() * w, py = r() * h, a = r() * 6.283, L = 8 + r() * 26; x.beginPath(); x.moveTo(px, py); x.lineTo(px + Math.cos(a) * L, py + Math.sin(a) * L); x.stroke(); }
    var g = x.createLinearGradient(0, 0, 0, h);   // свет сверху, чуть темнее к низу — бумага лежит на стене, а не плоская заливка
    g.addColorStop(0, 'rgba(255,255,255,0.10)'); g.addColorStop(1, 'rgba(90,70,40,0.07)');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    return c;
  }
  function pencilRect(x, a, b, w, h, r) {   // двойная карандашная рамка: линии чуть неровные и не сходятся точно в углах
    x.save(); x.strokeStyle = 'rgba(43,38,34,0.62)'; x.lineCap = 'round';
    [[0, 1.6], [5, 0.8]].forEach(function (p) {
      var i = p[0]; x.lineWidth = p[1];
      var pts = [[a + i, b + i], [a + w - i, b + i], [a + w - i, b + h - i], [a + i, b + h - i]];
      for (var k = 0; k < 4; k++) {
        var p0 = pts[k], p1 = pts[(k + 1) % 4], ox = (r() - 0.5) * 3, oy = (r() - 0.5) * 3;
        var dx = p1[0] - p0[0], dy = p1[1] - p0[1], len = Math.hypot(dx, dy), ex = dx / len * 3, ey = dy / len * 3;
        x.beginPath(); x.moveTo(p0[0] - ex, p0[1] - ey);
        x.quadraticCurveTo((p0[0] + p1[0]) / 2 + ox, (p0[1] + p1[1]) / 2 + oy, p1[0] + ex * 0.6, p1[1] + ey * 0.6); x.stroke();
      }
    });
    x.restore();
  }
  function plaque(x, o, r, map) {
    var pad = 36, maxW = 660, inner = maxW - pad * 2;
    var T = fitLines(x, o.name, 650, 54, 32, inner, 2, o);
    var yearsPx = 32;
    var L = o.line ? fitLines(x, o.line, 400, 30, 22, inner, 2, o) : null;
    var urlPx = 24;
    // высота: заголовок, годы, своя строка, черта, адрес
    var h = pad + T.lines.length * T.px * 1.18 + (o.years ? 12 + yearsPx * 1.2 : 0) + (L ? 18 + L.lines.length * L.px * 1.3 : 0) + 26 + 2 + 18 + urlPx + pad - 6;
    // ширина — по самому длинному тексту (табличка не шире нужного), но не уже 460
    var need = 0;
    x.font = fnt(o, 650, T.px); T.lines.forEach(function (l) { need = Math.max(need, x.measureText(l).width); });
    if (o.years) { x.font = fnt(o, 400, yearsPx); need = Math.max(need, x.measureText(o.years).width + yearsPx * 0.08 * o.years.length); }
    if (L) { x.font = fnt(o, 400, L.px); L.lines.forEach(function (l) { need = Math.max(need, x.measureText(l).width); }); }
    var w = Math.min(maxW, Math.max(400, Math.ceil(need) + pad * 2));
    var py0 = H - SAFE.b - 40 - h, pl = SAFE.l + 28, pr = W - SAFE.r - 28 - w;   // запас под тень таблички — тень тоже внутри зоны
    // слева, если там не больше рисунка, чем справа (запас 15%), — табличка не ложится на сам памятник
    var px0 = map && map.busy(pr, py0, pr + w, py0 + h) * 1.15 < map.busy(pl, py0, pl + w, py0 + h) ? pr : pl;
    // тень от таблички на стене + сама бумага
    x.save(); x.shadowColor = 'rgba(15,10,5,0.38)'; x.shadowBlur = 24; x.shadowOffsetY = 8;
    x.fillStyle = PAPER; x.fillRect(px0, py0, w, h); x.restore();
    x.drawImage(paperTexture(Math.round(w), Math.round(h), r), px0, py0);
    x.strokeStyle = 'rgba(43,38,34,0.28)'; x.lineWidth = 1; x.strokeRect(px0 + 0.5, py0 + 0.5, w - 1, h - 1);
    pencilRect(x, px0 + 12, py0 + 12, w - 24, h - 24, r);
    // тексты
    var y = py0 + pad + 4;
    x.fillStyle = INK; x.textAlign = 'left'; x.textBaseline = 'top';
    x.font = fnt(o, 650, T.px);
    T.lines.forEach(function (l) { x.fillText(l, px0 + pad, y); y += T.px * 1.18; });
    if (o.years) {
      y += 12; x.font = fnt(o, 400, yearsPx); x.fillStyle = 'rgba(43,38,34,0.82)';
      if ('letterSpacing' in x) { x.letterSpacing = Math.round(yearsPx * 0.08) + 'px'; x.fillText(o.years, px0 + pad, y); x.letterSpacing = '0px'; } else x.fillText(o.years, px0 + pad, y);
      y += yearsPx * 1.2;
    }
    if (L) {
      y += 18; x.font = fnt(o, 400, L.px); x.fillStyle = 'rgba(70,52,36,0.92)';
      L.lines.forEach(function (l) { x.fillText(l, px0 + pad, y); y += L.px * 1.3; });
    }
    y += 26;
    x.strokeStyle = 'rgba(43,38,34,0.45)'; x.lineWidth = 1.2;   // карандашная черта
    x.beginPath(); x.moveTo(px0 + pad, y); x.quadraticCurveTo(px0 + pad + 90, y - 1.2, px0 + pad + 180, y + 0.4); x.stroke();
    y += 18;
    x.font = fnt(o, 500, urlPx); x.fillStyle = 'rgba(43,38,34,0.72)';
    x.fillText(o.url, px0 + pad, y);
    return { x: px0, y: py0, w: w, h: h };
  }

  // ---------- почтовый штемпель ----------
  function arcText(x, text, cx, cy, rad, mid, outward, px, spacing) {
    // текст по дуге: mid — угол середины надписи; outward — читается снаружи (верх) или изнутри (низ)
    var widths = [], total = 0;
    for (var i = 0; i < text.length; i++) { var w = x.measureText(text[i]).width + spacing; widths.push(w); total += w; }
    total -= spacing;
    var ang = mid + (outward ? -1 : 1) * (total / 2) / rad;
    for (var j = 0; j < text.length; j++) {
      var a = ang + (outward ? 1 : -1) * (widths[j] - spacing) / 2 / rad;
      x.save(); x.translate(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
      x.rotate(a + (outward ? Math.PI / 2 : -Math.PI / 2));
      x.fillText(text[j], 0, 0); x.restore();
      ang += (outward ? 1 : -1) * widths[j] / rad;
    }
  }
  function stamp(o, r, ink) {
    var S = 300, c = mk(S, S), x = c.getContext('2d'), cx = S / 2, cy = S / 2, R = 108;
    x.strokeStyle = x.fillStyle = ink;
    x.lineWidth = 5; x.beginPath(); x.arc(cx, cy, R, 0, 6.283); x.stroke();
    x.lineWidth = 2.4; x.beginPath(); x.arc(cx, cy, R - 40, 0, 6.283); x.stroke();
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.font = fnt(o, 700, 25);
    arcText(x, STAMP_TOP, cx, cy, R - 20, -Math.PI / 2, true, 25, 6);
    x.font = fnt(o, 700, 19);
    arcText(x, STAMP_BOTTOM[o.lang] || STAMP_BOTTOM.en, cx, cy, R - 20, Math.PI / 2, false, 19, 4);
    [Math.PI, 0].forEach(function (a) { x.beginPath(); x.arc(cx + Math.cos(a) * (R - 20), cy + Math.sin(a) * (R - 20), 3.2, 0, 6.283); x.fill(); });   // точки-разделители
    var d = o.date || new Date();
    x.lineWidth = 2.2;   // дата между двумя чертами (как на советских штемпелях)
    x.beginPath(); x.moveTo(cx - 66, cy - 22); x.lineTo(cx + 66, cy - 22); x.moveTo(cx - 66, cy + 22); x.lineTo(cx + 66, cy + 22); x.stroke();
    x.font = fnt(o, 700, 27);
    x.fillText(pad2(d.getDate()) + '.' + pad2(d.getMonth() + 1) + '.' + d.getFullYear(), cx, cy + 1);
    // износ: ссадины краски (штемпель бьётся неровно) — «вырезаем» пятнышки
    x.save(); x.globalCompositeOperation = 'destination-out';
    for (var k = 0; k < 900; k++) { x.globalAlpha = 0.25 + r() * 0.6; x.beginPath(); x.arc(r() * S, r() * S, 0.6 + r() * 1.9, 0, 6.283); x.fill(); }
    var wipe = x.createLinearGradient(0, 0, S, S * 0.4);   // одна сторона пропечаталась слабее
    wipe.addColorStop(0, 'rgba(0,0,0,0)'); wipe.addColorStop(1, 'rgba(0,0,0,0.38)');
    x.globalAlpha = 1; x.fillStyle = wipe; x.fillRect(0, 0, S, S);
    x.restore();
    return c;
  }
  function waves(x, x0, x1, yc, r, ink) {   // волнистые линии гашения сбоку от штемпеля
    x.save(); x.strokeStyle = ink; x.globalAlpha = 0.86; x.lineWidth = 3.6; x.lineCap = 'round';
    for (var k = -2; k <= 2; k++) {
      var y = yc + k * 21;
      x.beginPath(); x.moveTo(x0, y);
      for (var px = x0; px <= x1; px += 6) x.lineTo(px, y + Math.sin((px - x0) / 15 + k * 0.6) * 5.5);
      x.stroke();
    }
    x.globalCompositeOperation = 'destination-out';
    for (var j = 0; j < 160; j++) { x.globalAlpha = 0.3 + r() * 0.6; x.beginPath(); x.arc(x0 + r() * (x1 - x0), yc - 50 + r() * 100, 0.7 + r() * 1.8, 0, 6.283); x.fill(); }
    x.restore();
  }
  // Куда класть штемпель и табличку: туда, где на кадре меньше всего рисунка (небо, пустая площадь), — а не на сам памятник.
  // Карта «занятости» — перепады яркости на копии 108×192 (своя маленькая копия, не холст движка).
  function busyMap(src) {
    var w = 108, h = 192, c = mk(w, h), x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(src, 0, 0, w, h);
    var d = x.getImageData(0, 0, w, h).data, L = new Float32Array(w * h), G = new Float32Array(w * h);
    for (var i = 0; i < w * h; i++) L[i] = (d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11) / 255;
    for (var yy = 1; yy < h - 1; yy++) for (var xx = 1; xx < w - 1; xx++) { var k = yy * w + xx; G[k] = Math.abs(L[k + 1] - L[k - 1]) + Math.abs(L[k + w] - L[k - w]); }
    function avg(A, x0, y0, x1, y1) {   // среднее по прямоугольнику в px открытки
      var a = Math.max(0, Math.floor(x0 / 10)), b = Math.max(0, Math.floor(y0 / 10)), e = Math.min(w, Math.ceil(x1 / 10)), f = Math.min(h, Math.ceil(y1 / 10)), s = 0, n = 0;
      for (var q = b; q < f; q++) for (var p = a; p < e; p++) { s += A[q * w + p]; n++; }
      return n ? s / n : 0;
    }
    return { busy: function (x0, y0, x1, y1) { return avg(G, x0, y0, x1, y1); }, light: function (x0, y0, x1, y1) { return avg(L, x0, y0, x1, y1); } };
  }
  function stampPlace(map) {
    var best = null, R = 118;
    [[W - SAFE.r - 124, SAFE.t + 140, -1, 0], [SAFE.l + 124, SAFE.t + 140, 1, 0.02], [W - SAFE.r - 124, SAFE.t + 400, -1, 0.05], [SAFE.l + 124, SAFE.t + 400, 1, 0.06]].forEach(function (c) {
      var cx = c[0], cy = c[1], dir = c[2], wx0 = dir < 0 ? cx - 360 : cx + 130, wx1 = dir < 0 ? cx - 130 : cx + 360;
      var sc = map.busy(cx - R, cy - R, cx + R, cy + R) + 0.5 * map.busy(wx0, cy - 55, wx1, cy + 75) + c[3];   // верх и правый край — чуть предпочтительнее
      if (!best || sc < best.sc) best = { cx: cx, cy: cy, dir: dir, sc: sc, L: map.light(cx - R, cy - R, cx + R, cy + R) };
    });
    return best;
  }
  function postmark(x, o, r, pl) {
    var cx = pl.cx, cy = pl.cy, dir = pl.dir, rot = dir < 0 ? -0.2 : 0.16;
    // чернила: тёмно-фиолетовые почтовые; на тёмном (ночь) — светлые, иначе штемпеля не видно
    var dark = pl.L < 0.42, ink = dark ? 'rgb(238,228,206)' : 'rgb(44,48,88)';
    var lay = mk(W, 440), lx = lay.getContext('2d');   // гашение рисуем на своём слое — ссадины не режут картинку
    lx.translate(0, -(cy - 220));
    lx.save(); lx.translate(cx, cy); lx.rotate(rot); lx.translate(-cx, -cy);
    if (dir < 0) waves(lx, cx - 360, cx - 130, cy, r, ink); else waves(lx, cx + 130, cx + 360, cy, r, ink);
    lx.drawImage(stamp(o, r, ink), cx - 150, cy - 150);
    lx.restore();
    x.save(); x.globalAlpha = dark ? 0.78 : 0.84; x.globalCompositeOperation = dark ? 'source-over' : 'multiply'; x.drawImage(lay, 0, cy - 220); x.restore();
    return { x: dir < 0 ? cx - 360 : cx - 118, y: cy - 118, w: 478, h: 236 };
  }

  function compose(src, o) {
    o = o || {};
    o.font = o.font || '"Chka Serif", "Noto Serif", serif';
    o.lang = o.lang || 'hy';
    var seed = o.seed != null ? o.seed : (Date.now() & 0xffffff);
    var r = rng(seed);
    var c = mk(W, H), x = c.getContext('2d', { willReadFrequently: !!o.film });   // отдельный холст открытки, не текстура
    x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    x.drawImage(src, 0, 0, W, H);
    if (o.film) filmLook(x, r);
    var map = busyMap(c);   // по кадру (после плёнки — та же картинка, что увидит глаз)
    var boxes = { postmark: postmark(x, o, r, stampPlace(map)), plaque: plaque(x, o, r, map) };
    if (o.grain !== false) { if (o.film) grain(x, r, 0.2); else grain(x, r, 0.06); }   // лёгкое зерно и без плёнки: табличка и штемпель «лежат» в одной фактуре с рисунком
    c.__boxes = boxes;   // для проверки безопасных зон (tools: report s26)
    return c;
  }

  window.ChkaPostcard = { W: W, H: H, SAFE: SAFE, compose: compose };
})();
