/* Открытка «в сторис» (e1.27, s26): кадр с экрана → 1080×1920, музейная табличка, почтовый штемпель «Երևան» с датой, подпись chka.am/<здание>.
   Только рисование на 2D-холсте — без WebGL и без чтения холста, который уходит в текстуру (урок s15). Вызывается по нажатию, в цикле кадра не работает.

   ChkaPostcard.compose(src, o) → новый холст 1080×1920
     e1.28 (9б-1): o.no — номер экспоната («001») и o.noLabel («Экспонат»), o.rare — редкая открытка (красный штемпель и «✦ РЕДКАЯ» на табличке,
     o.rareLabel), o.year — «мой год» (на штемпеле вместо сегодняшней даты).
     e1.30 (9в): лицо — только название, годы и chka.am/<здание>, крупнее; номер экспоната, личный номер и «редкая» — на обороте (у редкой
     спереди только красный штемпель). Оборот — музейный: типографские рамки и линейки, выходные данные, марка, штемпель, «от руки» письмо и «Кому» (o.to).
     e1.29 (9б-2): o.time — «ЧЧ:ММ» под датой на штемпеле (по ползунку «Момент»), o.code — личный номер открытки («4F2K», ChkaPostcard.code(seed))
     рядом с номером экспоната. ChkaPostcard.composeBack(src, o) — оборот советской почтовой карточки 1080×1920 (адрес «Երևան, …», марка, штемпель,
     своя строка «от руки»); seed() = время + случайность (check_site подменяет и Date.now, и Math.random — только для вызовов из postcard.js). ChkaPostcard.seed() — новое зерно (Date.now здесь, а не в viewer.js:
     check_site подменяет Date.now только для postcard.js — открытки двух копий сайта одинаковые), ChkaPostcard.luck(seed) — «повезло»: редкая 1 из 15.
     src — холст 1080×1920 с картинкой (готовый кадр с экрана, уже обрезанный под 9:16 — viewer.js, captureView)
     o   — { lang, name, years, line, url, film, date, seed, font, mask }   (mask — карта слоя здания 108×192, 255 = здание: по ней табличка и штемпель обходят памятник, e1.27 s27; keep — такая же карта того, что нарисовал «праздник»: штемпель его не закрывает, e1.31)
     e1.32 (9д): старая бумага — o.paper (лицо: тонко поверх рисунка и плотнее по краям; табличка — кусок той же бумаги), o.paperBack (оборот);
     табличка без адреса — chka.am/<здание> мелко в нижней дуге штемпеля; оборот проще: бумага, «от руки», «Кому», марка + штемпель, одна строка выходных данных.
   ChkaPostcard.SAFE — безопасная зона TikTok + Instagram Stories (px открытки 1080×1920): всё, что рисуется поверх кадра, — внутри неё.
     Сверху 250 (полоса прогресса и имя в Stories), снизу 500 (подпись, звук и ник в TikTok — 484, поле ответа в Stories — 250),
     справа 150 (столбик лайков/комментариев TikTok — 140), слева 64 (TikTok — 44). Разметка зон — tests/lenin/report/s26/zones.png. */
(function () {
  'use strict';
  var W = 1080, H = 1920;
  var SAFE = { l: 64, t: 250, r: 150, b: 500 };   // отступы от краёв
  var INK = '#2b2622', PAPER = '#f3ead6', RARE = '#a3271f', LUCK = 1 / 15;
  // Штемпель: верхняя дуга всегда «ԵՐԵՎԱՆ», нижняя — chka.am/<здание> (e1.32; без адреса — страна на языке подписи).
  var STAMP_TOP = 'ԵՐԵՎԱՆ';
  var STAMP_BOTTOM = { hy: 'ՀԱՅԱՍՏԱՆ', ru: 'АРМЕНИЯ', en: 'ARMENIA' };

  function rng(seed) {   // mulberry32 — повторяемое «случайное» (зерно плёнки, бумага, износ штемпеля)
    var a = (seed >>> 0) || 1;
    return function () { a = (a + 0x6D2B79F5) | 0; var t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function mk(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  // e1.35: временный холст освобождать сразу (iOS держит память холстов до сборки мусора, общий лимит ~384 МБ — лицо открытки
  // создавало 3 полноразмерных холста на каждую сборку; при нехватке Safari молча отдаёт пустой холст)
  function free(c) { if (c) { c.width = 0; c.height = 0; } }
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

  // ---------- старая бумага (e1.32): текстура engine/paper/*.webp (viewer грузит её при открытии окна) ----------
  // Лицо: бумага тонко поверх рисунка (умножение — пожелтение, волокна, пятнышки) и плотнее у краёв (потёртая кромка), рисунок читается.
  var edgeMask = null;
  function paperEdgeMask() {   // альфа кромки: 0.9 у самого края → 0 на 90 px внутрь (одна на страницу)
    if (edgeMask) return edgeMask;
    var c = mk(W, H), x = c.getContext('2d'), E = 90;
    [[0, 0, E, 0, 0, 0, E, H], [W, 0, W - E, 0, W - E, 0, E, H], [0, 0, 0, E, 0, 0, W, E], [0, H, 0, H - E, 0, H - E, W, E]].forEach(function (q) {
      var g = x.createLinearGradient(q[0], q[1], q[2], q[3]); g.addColorStop(0, 'rgba(0,0,0,0.9)'); g.addColorStop(0.35, 'rgba(0,0,0,0.35)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      x.globalCompositeOperation = 'lighter'; x.fillStyle = g; x.fillRect(q[4], q[5], q[6], q[7]);
    });
    return (edgeMask = c);
  }
  function agedPaper(x, paper) {
    x.save(); x.globalCompositeOperation = 'multiply'; x.globalAlpha = 0.34; x.drawImage(paper, 0, 0, W, H); x.restore();
    var e = mk(W, H), ex = e.getContext('2d');
    ex.drawImage(paper, 0, 0, W, H); ex.globalCompositeOperation = 'destination-in'; ex.drawImage(paperEdgeMask(), 0, 0);
    x.drawImage(e, 0, 0); free(e);
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
  // Два размера таблички: обычный и компактный (для крупных планов, где свободного места нет). g — масштаб промежутков между строками.
  var PQ = {
    full: { pad: 42, maxW: 740, tMax: 76, tMin: 48, tLines: 2, yearsPx: 44, lMax: 30, lMin: 22, lLines: 2, urlPx: 32, g: 1.15, minW: 440 },   // e1.30: всё крупнее (на телефоне читается)
    compact: { pad: 32, maxW: 620, tMax: 60, tMin: 38, tLines: 2, yearsPx: 36, lMax: 24, lMin: 18, lLines: 1, urlPx: 28, g: 0.85, minW: 360 },
    mini: { pad: 24, maxW: 330, tMax: 44, tMin: 32, tLines: 2, yearsPx: 32, lMax: 20, lMin: 16, lLines: 2, urlPx: 24, g: 0.7, minW: 230 }   // крайний случай: памятник на всю ширину кадра
  };
  function plaquePlan(x, o, V) {   // размеры: тексты по ширине, высота, ширина — рисовать пока не нужно
    var inner = V.maxW - V.pad * 2, g = V.g;
    var T = fitLines(x, o.name, 650, V.tMax, V.tMin, inner, V.tLines, o);
    var L = o.line ? fitLines(x, o.line, 400, V.lMax, V.lMin, inner, V.lLines, o) : null;
    // высота: заголовок, годы, своя строка (e1.32: адреса на табличке нет — он в нижней дуге штемпеля)
    var h = V.pad + T.lines.length * T.px * 1.18 + (o.years ? 12 * g + V.yearsPx * 1.2 : 0) + (L ? 18 * g + L.lines.length * L.px * 1.3 : 0) + V.pad - 4;
    // ширина — по самому длинному тексту (табличка не шире нужного), но не уже minW
    var need = 0;
    x.font = fnt(o, 650, T.px); T.lines.forEach(function (l) { need = Math.max(need, x.measureText(l).width); });
    if (o.years) { x.font = fnt(o, 400, V.yearsPx); need = Math.max(need, x.measureText(o.years).width + V.yearsPx * 0.08 * o.years.length); }
    if (L) { x.font = fnt(o, 400, L.px); L.lines.forEach(function (l) { need = Math.max(need, x.measureText(l).width); }); }
    return { V: V, T: T, L: L, h: h, w: Math.min(V.maxW, Math.max(V.minW, Math.ceil(need) + V.pad * 2)) };
  }
  // Где табличка: низ безопасной зоны; слева или справа (где меньше рисунка), обычная; если на её месте здание/памятник — компактная,
  // и снова слева/справа/по центру; потом мини (≈ 250 px). Всё ещё мешает — поднимаем табличку выше (до 300 px, шаг 60) и повторяем.
  // Нигде нет свободного места (памятник на всю ширину кадра) — внизу, где самого здания закрыто меньше всего.
  function plaquePlace(x, o, map, bm, plans) {
    var best = null, bestZero = null;
    [0, 60, 120, 180, 240, 300].forEach(function (up, ui) {
      if (ui > 0 && (!bm || bestZero)) return;   // выше — только при карте здания и пока нет места без здания
      plans.forEach(function (pl, vi) {
        var py0 = H - SAFE.b - 40 - pl.h - up, w = pl.w, h = pl.h;   // запас под тень таблички — тень тоже внутри зоны
        var xl = SAFE.l + 28, xr = W - SAFE.r - 28 - w, xc = Math.round((xl + xr) / 2);
        var sides = vi === 0 ? [xl, xr] : [xl, xr, xc];   // обычная — слева/справа; компактная и мини — ещё и по центру
        sides.forEach(function (px0, si) {
          var cells = bm ? bm.cells(px0, py0, px0 + w, py0 + h) : 0, raw = bm ? bm.raw(px0, py0, px0 + w, py0 + h) : 0;
          var busy = map ? map.busy(px0, py0, px0 + w, py0 + h) : 0;
          // справа, если там не больше рисунка, чем слева (запас 15%) — табличка не ложится на сам памятник
          var sc = busy * (px0 === xr && si === 1 ? 1.15 : (px0 === xc ? 1.3 : 1));
          var c = { pl: pl, x: px0, y: py0, cells: cells, raw: raw, sc: sc, vi: vi, up: up };
          if (cells === 0) { if (!bestZero || (up === bestZero.up && vi === bestZero.vi && sc < bestZero.sc)) bestZero = c; }
          if (up === 0 && (!best || (cells > 0 && best.cells > 0 && (c.raw < best.raw || (c.raw === best.raw && c.cells < best.cells))))) best = c;   // запасной: внизу, меньше всего самого здания
        });
      });
    });
    return bestZero || best;
  }
  function plaque(x, o, r, pos) {
    var pl = pos.pl, V = pl.V, g = V.g, T = pl.T, L = pl.L, pad = V.pad, yearsPx = V.yearsPx, w = pl.w, h = pl.h, px0 = pos.x, py0 = pos.y;
    // тень от таблички на стене + сама бумага
    x.save(); x.shadowColor = 'rgba(15,10,5,0.38)'; x.shadowBlur = 24; x.shadowOffsetY = 8;
    x.fillStyle = PAPER; x.fillRect(px0, py0, w, h); x.restore();
    if (o.paper && o.paper.width) { var sx = r() * (o.paper.width - w * 0.6) * 0.8, sy = r() * (o.paper.height - h * 0.6) * 0.8; x.drawImage(o.paper, sx, sy, Math.min(o.paper.width - sx, w * 0.6), Math.min(o.paper.height - sy, h * 0.6), px0, py0, w, h); }   // e1.32: кусок той же старой бумаги
    else x.drawImage(paperTexture(Math.round(w), Math.round(h), r), px0, py0);
    x.strokeStyle = 'rgba(43,38,34,0.28)'; x.lineWidth = 1; x.strokeRect(px0 + 0.5, py0 + 0.5, w - 1, h - 1);
    pencilRect(x, px0 + 12, py0 + 12, w - 24, h - 24, r);
    // тексты
    var y = py0 + pad + 4;
    x.fillStyle = INK; x.textAlign = 'left'; x.textBaseline = 'top';
    x.font = fnt(o, 650, T.px);
    T.lines.forEach(function (l) { x.fillText(l, px0 + pad, y); y += T.px * 1.18; });
    if (o.years) {
      y += 12 * g; x.font = fnt(o, 400, yearsPx); x.fillStyle = 'rgba(43,38,34,0.82)';
      if ('letterSpacing' in x) { x.letterSpacing = Math.round(yearsPx * 0.08) + 'px'; x.fillText(o.years, px0 + pad, y); x.letterSpacing = '0px'; } else x.fillText(o.years, px0 + pad, y);
      y += yearsPx * 1.2;
    }
    if (L) {
      y += 18 * g; x.font = fnt(o, 400, L.px); x.fillStyle = 'rgba(70,52,36,0.92)';
      L.lines.forEach(function (l) { x.fillText(l, px0 + pad, y); y += L.px * 1.3; });
    }
    return { x: px0, y: py0, w: w, h: h, size: V === PQ.full ? 'full' : (V === PQ.compact ? 'compact' : 'mini'), up: pos.up || 0 };
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
    var bot = o.url ? String(o.url).toUpperCase() : (STAMP_BOTTOM[o.lang] || STAMP_BOTTOM.en);   // e1.32: снизу — chka.am/<здание> мелко (вместо страны)
    var bpx = bot.length > 14 ? 15 : 17; x.font = fnt(o, 700, bpx);
    arcText(x, bot, cx, cy, R - 19, Math.PI / 2, false, bpx, bot.length > 14 ? 1.5 : 3);
    if (bot.length <= 14) [Math.PI, 0].forEach(function (a) { x.beginPath(); x.arc(cx + Math.cos(a) * (R - 20), cy + Math.sin(a) * (R - 20), 3.2, 0, 6.283); x.fill(); });   // точки-разделители
    var d = o.date || new Date();
    x.lineWidth = 2.2;   // дата между двумя чертами (как на советских штемпелях)
    x.beginPath(); x.moveTo(cx - 66, cy - 22); x.lineTo(cx + 66, cy - 22); x.moveTo(cx - 66, cy + 22); x.lineTo(cx + 66, cy + 22); x.stroke();
    if (o.year) { x.font = fnt(o, 700, 36); x.fillText(String(o.year), cx, cy + 2); }   // «мой год» (e1.28) — год крупно, без дня и месяца
    else { x.font = fnt(o, 700, 27); x.fillText(pad2(d.getDate()) + '.' + pad2(d.getMonth() + 1) + '.' + d.getFullYear(), cx, cy + 1); }
    if (o.time) { x.font = fnt(o, 700, 20); x.fillText(String(o.time), cx, cy + 42); }   // e1.29: часы:минуты «Момента» — под нижней чертой
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
  // Карта «здание»: o.mask — альфа слоя здания, уже спроецированная в открытку (viewer.js, cardBuildingMask): 108×192 клеток по 10 px,
  // 255 — здание/памятник. Расширяем на BLD_R клеток (запас у края предмета). Нет карты (слой не загрузился) → null: ставим по «занятости».
  var MW = 108, MH = 192, BLD_R = 2;
  function bldMap(mask) {
    if (!mask || mask.length !== MW * MH) return null;
    var a = new Uint8Array(MW * MH), d = new Uint8Array(MW * MH), n = 0, i, y, x0, dy, dx;
    for (i = 0; i < a.length; i++) if (mask[i] > 70) { a[i] = 1; n++; }
    if (!n) return null;
    for (y = 0; y < MH; y++) for (x0 = 0; x0 < MW; x0++) {
      if (!a[y * MW + x0]) continue;
      for (dy = -BLD_R; dy <= BLD_R; dy++) for (dx = -BLD_R; dx <= BLD_R; dx++) {
        if (dx * dx + dy * dy > BLD_R * BLD_R + 1) continue;
        var qx = x0 + dx, qy = y + dy; if (qx >= 0 && qx < MW && qy >= 0 && qy < MH) d[qy * MW + qx] = 1;
      }
    }
    return {
      mask: a, dil: d,
      cells: function (x0_, y0_, x1_, y1_) {   // сколько клеток прямоугольника (px открытки) занято расширенным зданием
        var p0 = Math.max(0, Math.floor(x0_ / 10)), q0 = Math.max(0, Math.floor(y0_ / 10)), p1 = Math.min(MW, Math.ceil(x1_ / 10)), q1 = Math.min(MH, Math.ceil(y1_ / 10)), c = 0;
        for (var q = q0; q < q1; q++) for (var p = p0; p < p1; p++) c += d[q * MW + p];
        return c;
      },
      raw: function (x0_, y0_, x1_, y1_) {   // клетки самого здания (без запаса) — когда свободного места нет и надо закрыть как можно меньше
        var p0 = Math.max(0, Math.floor(x0_ / 10)), q0 = Math.max(0, Math.floor(y0_ / 10)), p1 = Math.min(MW, Math.ceil(x1_ / 10)), q1 = Math.min(MH, Math.ceil(y1_ / 10)), c = 0;
        for (var q = q0; q < q1; q++) for (var p = p0; p < p1; p++) c += a[q * MW + p];
        return c;
      },
      disc: function (cx, cy, R) {   // то же для круга
        var p0 = Math.max(0, Math.floor((cx - R) / 10)), q0 = Math.max(0, Math.floor((cy - R) / 10)), p1 = Math.min(MW, Math.ceil((cx + R) / 10)), q1 = Math.min(MH, Math.ceil((cy + R) / 10)), c = 0;
        for (var q = q0; q < q1; q++) for (var p = p0; p < p1; p++) { var ex = p * 10 + 5 - cx, ey = q * 10 + 5 - cy; if (ex * ex + ey * ey <= R * R) c += d[q * MW + p]; }
        return c;
      }
    };
  }
  function boxInside(b) { return b.x >= SAFE.l + 4 && b.y >= SAFE.t + 4 && b.x + b.w <= W - SAFE.r - 4 && b.y + b.h <= H - SAFE.b - 4; }
  function hit(a, b) { return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h; }
  // Геометрия штемпеля: круг R 118 и полоса волнистых линий (130…360 от центра, ±52 по высоте), всё повёрнуто (оттиск «кривой») и сжато в k.
  // Точки полосы — для замера «сколько здания под линиями» и «сколько рисунка» (повёрнутая полоса уходит вниз на 57–71 px — прямоугольником не измерить).
  function stampGeom(cx, cy, dir, k, waves) {
    var rot = dir < 0 ? -0.2 : 0.16, cs = Math.cos(rot), sn = Math.sin(rot), pts = [], x0 = cx - 118 * k, y0 = cy - 118 * k, x1 = cx + 118 * k, y1 = cy + 118 * k;
    if (waves) for (var d = 130; d <= 360; d += 23) for (var e = -52; e <= 52; e += 26) {
      var vx = dir * d * k, vy = e * k, px = cx + vx * cs - vy * sn, py = cy + vx * sn + vy * cs;
      pts.push([px, py]); x0 = Math.min(x0, px - 6); y0 = Math.min(y0, py - 8); x1 = Math.max(x1, px + 6); y1 = Math.max(y1, py + 8);
    }
    return { pts: pts, box: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } };
  }
  // Штемпель: круг + волнистые линии сбоку. С картой здания — четыре угла и сетка запасных мест по всей безопасной зоне. Порядок вариантов:
  // полный (1) → 0,8 → без волн (1) → без волн (0,8): берём первый, для которого нашлось место, где под кругом и линиями нет здания (с запасом);
  // внутри варианта — где меньше рисунка. Нет такого места нигде — там, где здания закрыто меньше всего. Без карты — четыре угла и полный, как раньше.
  function stampPlace(map, bm, avoid, kp) {
    var best = null, R = 118;
    var cand = [[W - SAFE.r - 124, SAFE.t + 140, -1, 0], [SAFE.l + 124, SAFE.t + 140, 1, 0.02], [W - SAFE.r - 124, SAFE.t + 400, -1, 0.05], [SAFE.l + 124, SAFE.t + 400, 1, 0.06]];
    if (bm) [188, 330, 497, 664, 806].forEach(function (cx) {
      [390, 520, 660, 800, 940, 1080, 1220, 1290].forEach(function (cy) {
        var pr = 0.1 + (cy - 390) * 0.00005;
        if (cx > W / 2 + 40) cand.push([cx, cy, -1, pr]); else if (cx < W / 2 - 40) cand.push([cx, cy, 1, pr]); else { cand.push([cx, cy, -1, pr + 0.01]); cand.push([cx, cy, 1, pr + 0.01]); }
      });
    });
    var variants = bm ? [[1, true], [0.8, true], [1, false], [0.8, false]] : [[1, true]];
    variants.forEach(function (vk, vi) {
      var k = vk[0], waves = vk[1];
      cand.forEach(function (c) {
        var cx = c[0], cy = c[1], dir = c[2], g = stampGeom(cx, cy, dir, k, waves);
        if (!boxInside(g.box) || (avoid && hit(g.box, { x: avoid.x - 24, y: avoid.y - 24, w: avoid.w + 48, h: avoid.h + 48 }))) return;
        var cells = 0, wb = 0;
        if (bm) cells = bm.disc(cx, cy, R * k) + g.pts.reduce(function (n, q) { return n + bm.cells(q[0] - 6, q[1] - 6, q[0] + 6, q[1] + 6); }, 0);
        if (kp) cells += 6 * (kp.disc(cx, cy, R * k) + g.pts.reduce(function (n, q) { return n + kp.cells(q[0] - 6, q[1] - 6, q[0] + 6, q[1] + 6); }, 0));   // e1.31: «праздник» (лента дыма, знамя) — главное на кадре, штемпель его не закрывает
        g.pts.forEach(function (q) { wb += map.busy(q[0] - 8, q[1] - 8, q[0] + 8, q[1] + 8); });
        var sc = map.busy(cx - R * k, cy - R * k, cx + R * k, cy + R * k) + (g.pts.length ? 0.5 * wb / g.pts.length : 0) + c[3];   // верх и правый край — чуть предпочтительнее
        var better = !best;
        if (best) {
          if (cells === 0 || best.cells === 0) better = cells === 0 && (best.cells !== 0 || (vi === best.vi && sc < best.sc));
          else better = cells < best.cells || (cells === best.cells && vi === best.vi && sc < best.sc);
        }
        if (better) best = { cx: cx, cy: cy, dir: dir, k: k, waves: waves, vi: vi, cells: cells, sc: sc, box: g.box, L: map.light(cx - R * k, cy - R * k, cx + R * k, cy + R * k) };
      });
    });
    if (!best) { var g0 = stampGeom(W - SAFE.r - 124, SAFE.t + 140, -1, 1, true); best = { cx: W - SAFE.r - 124, cy: SAFE.t + 140, dir: -1, k: 1, waves: true, cells: 0, sc: 0, box: g0.box, L: map.light(W - SAFE.r - 242, SAFE.t + 22, W - SAFE.r - 6, SAFE.t + 258) }; }   // запасной вариант (в штатных случаях не нужен)
    return best;
  }
  function postmark(x, o, r, pl) {
    var cx = pl.cx, cy = pl.cy, dir = pl.dir, k = pl.k || 1, rot = dir < 0 ? -0.2 : 0.16;
    // чернила: тёмно-фиолетовые почтовые; на тёмном (ночь) — светлые, иначе штемпеля не видно
    var dark = pl.L < 0.42, ink = dark ? (o.rare ? 'rgb(255,200,184)' : 'rgb(238,228,206)') : (o.rare ? 'rgb(156,38,34)' : 'rgb(44,48,88)');   // редкая — красный штемпель
    var lay = mk(W, 440), lx = lay.getContext('2d');   // гашение рисуем на своём слое — ссадины не режут картинку
    lx.translate(0, -(cy - 220));
    lx.save(); lx.translate(cx, cy); lx.rotate(rot); lx.scale(k, k); lx.translate(-cx, -cy);
    if (pl.waves !== false) { if (dir < 0) waves(lx, cx - 360, cx - 130, cy, r, ink); else waves(lx, cx + 130, cx + 360, cy, r, ink); }
    lx.drawImage(stamp(o, r, ink), cx - 150, cy - 150);
    lx.restore();
    x.save(); x.globalAlpha = dark ? 0.78 : 0.84; x.globalCompositeOperation = dark ? 'source-over' : 'multiply'; x.drawImage(lay, 0, cy - 220); x.restore(); free(lay);
    return { x: pl.box.x, y: pl.box.y, w: pl.box.w, h: pl.box.h, k: k };
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
    if (o.paper && o.paper.width) agedPaper(x, o.paper);   // e1.32: старая бумага поверх рисунка и по краям
    var map = busyMap(c);   // по кадру (после плёнки — та же картинка, что увидит глаз)
    var bm = bldMap(o.mask);   // здание/памятник из слоя здания (может не быть — тогда только «занятость»)
    // сначала табличка (низ зоны), потом штемпель — вне плашки и вне здания
    var ppos = plaquePlace(x, o, map, bm, [plaquePlan(x, o, PQ.full), plaquePlan(x, o, PQ.compact), plaquePlan(x, o, PQ.mini)]);
    var spl = stampPlace(map, bm, { x: ppos.x, y: ppos.y, w: ppos.pl.w, h: ppos.pl.h }, bldMap(o.keep));
    var boxes = { postmark: postmark(x, o, r, spl), plaque: plaque(x, o, r, ppos) };
    boxes.bld = { plaqueCells: ppos.cells, stampCells: spl.cells, haveMask: !!bm };
    if (o.grain !== false) { if (o.film) grain(x, r, 0.2); else grain(x, r, 0.06); }   // лёгкое зерно и без плёнки: табличка и штемпель «лежат» в одной фактуре с рисунком
    c.__boxes = boxes;   // для проверки безопасных зон (tools: report s26)
    return c;
  }


  // ---------- оборот (e1.32, 9д): проще — старая бумага, один шрифт сайта, чернила одного тона ----------
  // Только: письмо «от руки» (своя строка или привет из Еревана), строка «Кому» (o.to «от руки»; пусто — чистая линейка), марка (кусок кадра
  // в перфорации) + штемпель поверх неё, одна мелкая строка выходных данных: экспонат № / личный номер / дата. Рамок, заголовка, «Куда»,
  // индекса, штампа «РЕДКАЯ» больше нет; у редкой штемпель красный (как на лице). Рукопись — выцветшие сине-фиолетовые чернила, печать — тёмно-коричневая.
  var BACK_T = {
    hy: { to: 'Ում', hi: 'Ջերմ բարևներ Երևանից', card: 'Բացիկ', fact: 'Փաստ' },
    ru: { to: 'Кому', hi: 'Привет из Еревана!', card: 'Открытка', fact: 'Факт' },
    en: { to: 'To', hi: 'Greetings from Yerevan!', card: 'Postcard', fact: 'Fact' }
  };
  var HAND = 'rgb(78,72,142)', PRINT = 'rgb(78,54,36)', RULE = 'rgba(78,54,36,0.45)';
  function hand(x, o, text, x0, y0, maxW, px, r, lineH) {   // «от руки»: курсив шрифта сайта, у каждого слова свой наклон, кегль и строка
    x.save(); x.fillStyle = HAND; x.globalAlpha = 0.84; x.textBaseline = 'alphabetic'; x.textAlign = 'left';
    var words = String(text).split(/\s+/).filter(Boolean), cx = x0, cy = y0;
    words.forEach(function (w) {
      var sz = px * (0.96 + r() * 0.08);
      x.font = 'italic 400 ' + Math.round(sz) + 'px ' + o.font;
      var ww = x.measureText(w).width;
      if (cx > x0 && cx + ww > x0 + maxW) { cx = x0 + r() * 8; cy += lineH; }
      x.save(); x.translate(cx, cy + (r() - 0.5) * 4); x.rotate(-0.03 + (r() - 0.5) * 0.04); x.fillText(w, 0, 0); x.restore();
      cx += ww + px * 0.32;
    });
    x.restore();
    return cy;
  }
  function perfRect(x, a, b, w, h, rad) {   // перфорация марки: по краю полукруглые вырезы
    x.beginPath(); x.rect(a, b, w, h);
    var step = rad * 2.6;
    for (var px = a + rad * 1.3; px < a + w; px += step) { x.moveTo(px + rad, b); x.arc(px, b, rad, 0, 6.283); x.moveTo(px + rad, b + h); x.arc(px, b + h, rad, 0, 6.283); }
    for (var py = b + rad * 1.3; py < b + h; py += step) { x.moveTo(a + rad, py); x.arc(a, py, rad, 0, 6.283); x.moveTo(a + w + rad, py); x.arc(a + w, py, rad, 0, 6.283); }
  }
  function rule(x, x0, y, x1, wdt) { x.strokeStyle = RULE; x.lineWidth = wdt || 1.3; x.beginPath(); x.moveTo(x0, y); x.lineTo(x1, y); x.stroke(); }
  function composeBack(src, o) {
    o = o || {};
    o.font = o.font || '"Chka Serif", "Noto Serif", serif';
    o.lang = o.lang || 'hy';
    var seed = o.seed != null ? o.seed : (Date.now() & 0xffffff), r = rng(seed ^ 0x51ed), T = BACK_T[o.lang] || BACK_T.en;
    var c = mk(W, H), x = c.getContext('2d');
    var pb = o.paperBack || o.paper;
    if (pb && pb.width) x.drawImage(pb, 0, 0, W, H); else x.drawImage(paperTexture(W, H, r), 0, 0);   // старая бумага на весь лист
    var L0 = SAFE.l + 46, T0 = SAFE.t + 40, R0 = W - SAFE.r - 46, B0 = H - SAFE.b - 40;   // всё — внутри безопасной зоны
    // марка: кусок кадра в перфорации, правый верхний угол
    var sw0 = 250, sh0 = 306, sx0 = R0 - sw0, sy0 = T0 + 6;
    x.save(); x.translate(sx0 + sw0 / 2, sy0 + sh0 / 2); x.rotate(0.025); x.translate(-sw0 / 2, -sh0 / 2);
    x.save(); x.shadowColor = 'rgba(60,40,20,0.22)'; x.shadowBlur = 5; x.shadowOffsetY = 1.5; x.fillStyle = '#f6efdc'; perfRect(x, 0, 0, sw0, sh0, 6); x.fill('evenodd'); x.restore();
    var iw = sw0 - 30, ih = sh0 - 30, cropW = src.width * 0.62, cropH = cropW * ih / iw;
    var mcx = 0.5, mcy = 0.4, topY = null;   // в марке — здание целиком: рамка по карте слоя здания (если есть)
    if (o.mask && o.mask.length === MW * MH) {
      var bx0 = MW, by0 = MH, bx1 = -1, by1 = -1;
      for (var q = 0; q < o.mask.length; q++) if (o.mask[q] > 70) { var qx = q % MW, qy = Math.floor(q / MW); bx0 = Math.min(bx0, qx); bx1 = Math.max(bx1, qx); by0 = Math.min(by0, qy); by1 = Math.max(by1, qy); }
      if (bx1 > bx0 + 4 && by1 > by0 + 4) {
        mcx = (bx0 + bx1 + 1) / 2 / MW; mcy = (by0 + by1 + 1) / 2 / MH; topY = by0 / MH * src.height;   // верх здания (голова статуи) не срезать
        var need = Math.max((by1 - by0 + 1) / MH * src.height * 1.12, (bx1 - bx0 + 1) / MW * src.width * 1.12 * ih / iw);
        cropH = Math.min(src.height, src.width * ih / iw, Math.max(cropH * 0.7, need)); cropW = cropH * iw / ih;
      }
    }
    var cx0 = Math.min(src.width - cropW, Math.max(0, src.width * mcx - cropW / 2)), cy0 = Math.min(src.height - cropH, Math.max(0, src.height * mcy - cropH / 2));
    if (topY != null && cy0 > topY - cropH * 0.06) cy0 = Math.max(0, topY - cropH * 0.06);
    x.drawImage(src, cx0, cy0, cropW, cropH, 15, 15, iw, ih);
    x.save(); x.globalCompositeOperation = 'multiply'; x.fillStyle = 'rgba(236,220,186,0.35)'; x.fillRect(15, 15, iw, ih); x.restore();   // марка тоже выцвела
    x.strokeStyle = 'rgba(78,54,36,0.5)'; x.lineWidth = 1; x.strokeRect(15.5, 15.5, iw - 1, ih - 1);
    x.restore();
    // штемпель поверх нижнего левого угла марки (у редкой — красный)
    var pcx = sx0 + 6, pcy = sy0 + sh0 - 40, ink = o.rare ? 'rgb(156,38,34)' : PRINT;
    var lay = mk(W, 440), l2 = lay.getContext('2d');
    l2.translate(0, -(pcy - 220)); l2.save(); l2.translate(pcx, pcy); l2.rotate(-0.22); l2.translate(-pcx, -pcy);
    l2.drawImage(stamp(o, r, ink), pcx - 150, pcy - 150); l2.restore();
    x.save(); x.globalAlpha = 0.82; x.globalCompositeOperation = 'multiply'; x.drawImage(lay, 0, pcy - 220); x.restore(); free(lay);
    // письмо «от руки»: ниже марки, на всю ширину
    var msg = o.line && String(o.line).trim() ? String(o.line).trim() : T.hi;
    var handEnd = hand(x, o, msg, L0, sy0 + sh0 + 170, R0 - L0, 66, r, 98);
    // короткий факт о здании (building.json postcard.fact, e1.34): печатным шрифтом, под чертой — отдельно от письма «от руки»
    var fact = o.fact && typeof o.fact === 'object' ? (o.fact[o.lang] || o.fact.en || '') : (o.fact || '');
    var ty = B0 - 170;
    if (fact) {
      var fy0 = handEnd + 56;
      rule(x, L0, fy0, R0, 1.1);
      x.font = fnt(o, 700, 22); x.fillStyle = PRINT; x.globalAlpha = 0.68; x.textAlign = 'left'; x.textBaseline = 'alphabetic';
      if ('letterSpacing' in x) { x.letterSpacing = '1.4px'; x.fillText(T.fact.toUpperCase(), L0, fy0 + 34); x.letterSpacing = '0px'; } else x.fillText(T.fact.toUpperCase(), L0, fy0 + 34);
      x.globalAlpha = 1;
      var fl = fitLines(x, fact, 400, 30, 22, R0 - L0, 4, o);
      x.font = fnt(o, 400, fl.px); x.fillStyle = PRINT; x.globalAlpha = 0.86;
      var fyy = fy0 + 34 + 28;
      fl.lines.forEach(function (l) { x.fillText(l, L0, fyy); fyy += fl.px * 1.34; });
      x.globalAlpha = 1;
      ty = Math.max(ty, fyy + 26);
    }
    // «Кому»: печатная подпись и линейка; имя «от руки» на ней
    x.font = fnt(o, 500, 30); x.fillStyle = PRINT; x.globalAlpha = 0.9; x.textAlign = 'left'; x.textBaseline = 'alphabetic';
    x.fillText(T.to, L0, ty); var tW = x.measureText(T.to).width + 18; x.globalAlpha = 1;
    rule(x, L0 + tW, ty + 8, R0, 1.4);
    if (o.to && String(o.to).trim()) hand(x, o, String(o.to).trim(), L0 + tW + 14, ty - 4, R0 - L0 - tW - 20, 46, r, 70);
    // одна мелкая строка выходных данных: экспонат № / личный номер / дата
    var d = o.date || new Date(), ds = o.year ? String(o.year) : pad2(d.getDate()) + '.' + pad2(d.getMonth() + 1) + '.' + d.getFullYear();
    x.font = fnt(o, 500, 20); x.fillStyle = PRINT; x.globalAlpha = 0.7; x.textAlign = 'left'; x.textBaseline = 'alphabetic';
    x.fillText([o.no ? (o.noLabel || '') + ' № ' + o.no : '', o.code ? T.card + ' № ' + o.code : '', ds].filter(Boolean).join('  ·  '), L0, B0);
    x.globalAlpha = 1;
    if (o.grain !== false) grain(x, r, 0.05);
    c.__boxes = { card: { x: L0 - 4, y: T0 - 4, w: R0 - L0 + 8, h: B0 - T0 + 8 } };
    return c;
  }
  function x0ls() { return mk(1, 1).getContext('2d'); }
  // зерно открытки: одно на окно (превью и сохранённая — одна и та же картинка); время + случайность (e1.29) — из него же личный номер
  function newSeed() { return ((Date.now() & 0xffffff) ^ Math.floor(Math.random() * 0x1000000)) & 0xffffff; }
  var CODE_A = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';   // без 0/O, 1/I — номер читается однозначно
  function code(seed) { var r = rng(((seed >>> 0) ^ 0xc0de) >>> 0), s = ''; for (var i = 0; i < 4; i++) s += CODE_A[Math.floor(r() * 32)]; return s; }
  function luck(seed) { var r = rng(((seed >>> 0) ^ 0x9e3779b9) >>> 0); r(); return r() < LUCK; }   // «повезло» — редкая открытка без особой погоды
  window.ChkaPostcard = { W: W, H: H, SAFE: SAFE, compose: compose, composeBack: composeBack, seed: newSeed, luck: luck, code: code };
})();
