/* ============================================================================
   ЖИВЫЕ ДЕТАЛИ — у каждого кадра и каждого времени суток свои 2–3 мелкие вещи (птицы, воздушный шар, самолёт со следом,
   бабочки, светлячки, мотыльки у фонарей, огоньки машин, окна башни). Всё в карандашно-акварельном стиле картинки:
   тонкие тёмные штрихи и мягкие заливки, ничего яркого. Каждые 8–15 с происходит что-то одно маленькое; не всё сразу.

   Один общий цикл анимации: этот модуль не крутит свой requestAnimationFrame — просмотрщик вызывает Details.frame(now)
   из своего единственного цикла. Пока вкладка скрыта, цикла нет. Если fps ниже порога — детали отключаются первыми
   (потом ветер).

   Флаги колышутся в шейдере (CONFIG.FLAGS), ветер в деревьях — там же; здесь — то, что нарисовано поверх картинки на 2D-холсте.
   ============================================================================ */
(function (root) {
  'use strict';

  // что происходит на каком кадре в какое время суток (первый кадр — 0)
  var DEFS = [
    { day: ['birds', 'plane', 'butterfly'], sunset: ['birds', 'plane'], night: ['plane', 'moths', 'winlight'] },
    { day: ['balloon', 'birds'], sunset: ['balloon', 'birds'], night: ['plane', 'moths', 'fireflies'] },
    { day: ['birds', 'plane'], sunset: ['plane', 'birds'], night: ['moths', 'winlight', 'plane'] },
    { day: ['butterfly', 'birds', 'plane'], sunset: ['birds', 'butterfly'], night: ['fireflies', 'moths', 'plane'] },
    { day: ['cars', 'birds', 'plane'], sunset: ['cars', 'plane', 'birds'], night: ['cars', 'plane', 'winlight'] },
    { day: ['birds', 'plane'], sunset: ['birds', 'plane'], night: ['moths', 'plane', 'winlight'] }
  ];
  // где на кадре чистое небо (доли кадра по вертикали: птицы и самолёты летят в этой полосе)
  var SKY = [[0.04, 0.34], [0.05, 0.36], [0.05, 0.36], [0.05, 0.36], [0.03, 0.16], [0.02, 0.06]];
  // газон: [u0, v0, u1, v1] — тут порхают бабочки и парят светлячки
  var LAWN = { 0: [0.06, 0.70, 0.94, 0.86], 1: [0.12, 0.72, 0.86, 0.82], 3: [0.08, 0.66, 0.92, 0.90] };
  // дальняя дорога (кадр 5): по ней едут огоньки машин
  var ROAD = { 4: [[0.00, 0.930], [0.16, 0.924], [0.26, 0.919], [0.38, 0.907], [0.48, 0.899], [0.56, 0.892], [0.62, 0.886]] };

  var V = null, cv = null, ctx = null, dpr = 1, W = 0, H = 0;
  var active = [], nextAt = 0, lastKey = null, lastFrame = -1, lastKind = '', drawn = false;

  function rnd(a, b) { return a + (b - a) * Math.random(); }
  function pick(a) { return a[(Math.random() * a.length) | 0]; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function env(t, up, down) { return Math.min(1, t / up, (1 - t) / down); }   // плавное появление и растворение (t: 0..1)

  // время суток: day / sunset / night, между ними (идёт переход) — null, новых событий нет
  function todKey() {
    var p = V.tod.p;
    if (p < 0.28) return 'day';
    if (p > 0.82 && p < 1.22) return 'sunset';
    if (p > 2.05) return 'night';
    return null;
  }
  function ink() { var k = todKey(); return k === 'sunset' ? '90,58,44' : (k === 'night' ? '190,200,225' : '58,51,42'); }

  function ensureCanvas() {
    if (cv) return;
    cv = document.createElement('canvas');
    cv.id = 'fxCanvas';
    cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;z-index:4;pointer-events:none';
    V.stage.insertBefore(cv, document.getElementById('hotspots'));   // над картинкой, под точками-подсказками
    ctx = cv.getContext('2d');
  }
  function fit() {
    var w = V.stage.clientWidth, h = V.stage.clientHeight, d = Math.min(window.devicePixelRatio || 1, 1.5);
    if (w === W && h === H && d === dpr) return;
    W = w; H = h; dpr = d;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  }
  function P(u, v, d) { return V.project(V.entry(V.frame()), u, v, d == null ? 0 : d); }   // точка кадра -> пиксели сцены

  function depthAt(f, u, v) {
    var dm = f.depth, x = Math.max(0, Math.min(dm.w - 1, Math.round(u * (dm.w - 1)))), y = Math.max(0, Math.min(dm.h - 1, Math.round(v * (dm.h - 1))));
    return dm.d[y * dm.w + x] / 255;
  }

  // ---------- спрайты (рисуем прямо на холсте) ----------
  function bird(x, y, s, flap, col, a) {   // птичка: два дужка-крыла, взмах — по flap (-1..1)
    ctx.strokeStyle = 'rgba(' + col + ',' + a + ')'; ctx.lineWidth = 1.15; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x - s, y + s * 0.15 * flap);
    ctx.quadraticCurveTo(x - s * 0.45, y - s * (0.55 + 0.35 * flap), x, y);
    ctx.quadraticCurveTo(x + s * 0.45, y - s * (0.55 + 0.35 * flap), x + s, y + s * 0.15 * flap);
    ctx.stroke();
  }

  var KINDS = {
    birds: function (fr) {   // стайка пересекает небо; на закате — так же, но темнее и теплее
      var band = SKY[fr], v0 = rnd(band[0], band[1]), dir = Math.random() < 0.5 ? 1 : -1;
      var n = 5 + ((Math.random() * 3) | 0), fl = [];
      for (var i = 0; i < n; i++) fl.push({ du: -dir * (i * rnd(0.014, 0.03)), dv: (i % 2 ? 1 : -1) * i * rnd(0.004, 0.011), ph: rnd(0, 6.28), sp: rnd(0.9, 1.15) });
      return { dur: rnd(15, 22) * 1000, u0: dir > 0 ? -0.08 : 1.08, u1: dir > 0 ? 1.08 : -0.08, v0: v0, v1: v0 + rnd(-0.04, 0.03), fl: fl,
        draw: function (e, t, now) {
          var col = ink(), a = 0.62 * env(t, 0.08, 0.08);
          for (var i = 0; i < e.fl.length; i++) {
            var b = e.fl[i], p = P(lerp(e.u0, e.u1, t) + b.du, lerp(e.v0, e.v1, t) + b.dv + 0.004 * Math.sin(t * 9 + b.ph), 0);
            bird(p[0], p[1], 4.2 * b.sp, Math.sin(now * 0.011 * b.sp + b.ph), col, a);
          }
        } };
    },
    plane: function (fr) {   // самолёт высоко в небе: днём и на закате — со следом, ночью — мигающий огонёк
      var band = SKY[fr], v0 = rnd(band[0], band[0] + (band[1] - band[0]) * 0.55), dir = Math.random() < 0.5 ? 1 : -1;
      return { dur: rnd(38, 54) * 1000, u0: dir > 0 ? -0.06 : 1.06, u1: dir > 0 ? 1.06 : -0.06, v0: v0, v1: v0 + rnd(0.03, 0.08), dir: dir,
        draw: function (e, t, now) {
          var k = todKey(), a = env(t, 0.06, 0.06), pos = function (tt) { return P(lerp(e.u0, e.u1, tt), lerp(e.v0, e.v1, tt), 0); };
          var p = pos(t);
          if (k === 'night') {   // огонёк: красный и белый вспышки
            var ph = (now / 1000) % 1.7, on = ph < 0.16 || (ph > 0.42 && ph < 0.52);
            var red = ph < 0.16;
            ctx.fillStyle = on ? (red ? 'rgba(255,120,110,' + 0.9 * a + ')' : 'rgba(255,250,240,' + 0.95 * a + ')') : 'rgba(255,255,255,' + 0.18 * a + ')';
            ctx.beginPath(); ctx.arc(p[0], p[1], on ? 1.7 : 0.9, 0, 6.283); ctx.fill();
            if (on) { ctx.fillStyle = red ? 'rgba(255,110,100,' + 0.16 * a + ')' : 'rgba(255,250,240,' + 0.16 * a + ')'; ctx.beginPath(); ctx.arc(p[0], p[1], 5, 0, 6.283); ctx.fill(); }
            return;
          }
          var trail = k === 'sunset' ? '255,224,205' : '255,255,255', N = 14;
          for (var i = 0; i < N; i++) {   // след: белая нить, тает к хвосту
            var t0 = t - (i / N) * 0.14, t1 = t - ((i + 1) / N) * 0.14;
            if (t1 < 0) break;
            var q0 = pos(t0), q1 = pos(t1);
            ctx.strokeStyle = 'rgba(' + trail + ',' + (0.6 * (1 - i / N) * a) + ')'; ctx.lineWidth = 1.3 * (1 - 0.5 * i / N);
            ctx.beginPath(); ctx.moveTo(q0[0], q0[1]); ctx.lineTo(q1[0], q1[1]); ctx.stroke();
          }
          ctx.strokeStyle = 'rgba(' + ink() + ',' + 0.7 * a + ')'; ctx.lineWidth = 1.2;
          var dx = e.dir * 4.2;   // силуэт: фюзеляж и крылья
          ctx.beginPath(); ctx.moveTo(p[0] - dx, p[1] + 0.4); ctx.lineTo(p[0] + dx, p[1] - 0.4);
          ctx.moveTo(p[0] - dx * 0.1, p[1]); ctx.lineTo(p[0] - dx * 0.6, p[1] - 3.2); ctx.moveTo(p[0] - dx * 0.1, p[1]); ctx.lineTo(p[0] - dx * 0.6, p[1] + 3.2);
          ctx.stroke();
        } };
    },
    balloon: function (fr) {   // воздушный шар медленно проплывает вдали (только кадр 2)
      var dir = Math.random() < 0.5 ? 1 : -1, v0 = rnd(0.16, 0.24);
      return { dur: rnd(70, 90) * 1000, u0: dir > 0 ? 0.04 : 0.98, u1: dir > 0 ? 0.98 : 0.04, v0: v0, v1: v0 - rnd(0.02, 0.05),
        draw: function (e, t, now) {
          var a = env(t, 0.08, 0.08), p = P(lerp(e.u0, e.u1, t), lerp(e.v0, e.v1, t) + 0.004 * Math.sin(now * 0.0007), 0), r = 8.5;
          var sun = todKey() === 'sunset';
          ctx.save(); ctx.translate(p[0], p[1]); ctx.globalAlpha = 0.9 * a;
          ctx.strokeStyle = 'rgba(58,51,42,0.75)'; ctx.lineWidth = 0.9;
          ctx.beginPath(); ctx.moveTo(-r * 0.55, r * 1.15); ctx.lineTo(-r * 0.22, r * 1.9); ctx.moveTo(r * 0.55, r * 1.15); ctx.lineTo(r * 0.22, r * 1.9); ctx.stroke();
          ctx.fillStyle = 'rgba(70,52,40,0.85)'; ctx.fillRect(-r * 0.3, r * 1.9, r * 0.6, r * 0.42);
          ctx.beginPath(); ctx.moveTo(0, r * 1.25); ctx.bezierCurveTo(-r * 1.25, r * 0.5, -r * 1.05, -r, 0, -r); ctx.bezierCurveTo(r * 1.05, -r, r * 1.25, r * 0.5, 0, r * 1.25);
          ctx.fillStyle = sun ? 'rgba(222,150,110,0.8)' : 'rgba(203,150,120,0.78)'; ctx.fill(); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(0, -r); ctx.quadraticCurveTo(-r * 0.5, 0, 0, r * 1.25); ctx.moveTo(0, -r); ctx.quadraticCurveTo(r * 0.5, 0, 0, r * 1.25); ctx.stroke();
          ctx.restore();
        } };
    },
    butterfly: function (fr) {   // бабочка порхает над газоном
      var L = LAWN[fr] || LAWN[3], u0 = rnd(L[0], L[2]), v0 = rnd(L[1], L[3]), du = rnd(-0.32, 0.32), dv = rnd(-0.08, 0.05), ph = rnd(0, 6.28);
      return { dur: rnd(11, 16) * 1000,
        draw: function (e, t, now) {
          var a = env(t, 0.12, 0.15), u = u0 + du * t + 0.02 * Math.sin(t * 14 + ph), v = v0 + dv * t + 0.012 * Math.sin(t * 19 + ph);
          var p = P(u, v, 0.55), w = Math.abs(Math.sin(now * 0.016 + ph)) * 3.6 + 0.6;
          ctx.fillStyle = 'rgba(232,214,150,' + 0.85 * a + ')'; ctx.strokeStyle = 'rgba(70,58,44,' + 0.6 * a + ')'; ctx.lineWidth = 0.7;
          ctx.beginPath(); ctx.ellipse(p[0] - w * 0.6, p[1] - 1, w, 2.4, -0.4, 0, 6.283); ctx.ellipse(p[0] + w * 0.6, p[1] - 1, w, 2.4, 0.4, 0, 6.283); ctx.fill(); ctx.stroke();
        } };
    },
    moths: function (fr) {   // мотыльки кружат у фонаря
      var f = V.entry(V.frame()), lamps = (f.lamps || []).filter(function (l) { return l.hv > 0.4; });
      if (!lamps.length) return null;
      var l = pick(lamps), ms = [];
      for (var i = 0; i < 3; i++) ms.push({ r: rnd(6, 13), w: rnd(2.2, 3.6), ph: rnd(0, 6.28), ry: rnd(0.55, 0.9) });
      return { dur: rnd(8, 12) * 1000,
        draw: function (e, t, now) {
          var a = env(t, 0.15, 0.2), c = P(l.hu, l.hv, l.hd);
          for (var i = 0; i < ms.length; i++) {
            var m = ms[i], x = c[0] + Math.cos(now * 0.001 * m.w + m.ph) * m.r + Math.sin(now * 0.0031 + m.ph) * 2, y = c[1] + Math.sin(now * 0.0013 * m.w + m.ph) * m.r * m.ry;
            ctx.fillStyle = 'rgba(255,236,190,' + (0.55 + 0.35 * Math.sin(now * 0.02 + m.ph)) * a + ')';
            ctx.beginPath(); ctx.ellipse(x, y, 1.5, 0.9, Math.sin(now * 0.02 + m.ph), 0, 6.283); ctx.fill();
          }
        } };
    },
    fireflies: function (fr) {   // светлячки над газоном: медленно плывут и мягко мигают
      var L = LAWN[fr] || LAWN[3], fs = [];
      for (var i = 0; i < 6; i++) fs.push({ u: rnd(L[0], L[2]), v: rnd(L[1], L[3]), du: rnd(-0.06, 0.06), dv: rnd(-0.03, 0.03), ph: rnd(0, 6.28), sp: rnd(0.9, 1.7) });
      return { dur: rnd(12, 17) * 1000,
        draw: function (e, t, now) {
          var a = env(t, 0.15, 0.2);
          for (var i = 0; i < fs.length; i++) {
            var f = fs[i], p = P(f.u + f.du * t, f.v + f.dv * t + 0.006 * Math.sin(now * 0.0009 * f.sp + f.ph), 0.5);
            var g = Math.max(0, Math.sin(now * 0.0018 * f.sp + f.ph)), al = g * g * 0.95 * a;
            ctx.fillStyle = 'rgba(214,236,150,' + al * 0.28 + ')'; ctx.beginPath(); ctx.arc(p[0], p[1], 4.2, 0, 6.283); ctx.fill();
            ctx.fillStyle = 'rgba(236,246,180,' + al + ')'; ctx.beginPath(); ctx.arc(p[0], p[1], 1.3, 0, 6.283); ctx.fill();
          }
        } };
    },
    cars: function (fr) {   // огоньки машин по дальней дороге
      var road = ROAD[fr]; if (!road) return null;
      var dir = Math.random() < 0.5 ? 1 : -1, n = 1 + ((Math.random() * 2) | 0), cs = [];
      for (var i = 0; i < n; i++) cs.push({ off: i * rnd(0.08, 0.16) });
      return { dur: rnd(16, 22) * 1000,
        draw: function (e, t, now) {
          var k = todKey(), a = env(t, 0.06, 0.06), f = V.entry(V.frame());
          for (var i = 0; i < cs.length; i++) {
            var tt = dir > 0 ? t - cs[i].off : 1 - t + cs[i].off; if (tt < 0 || tt > 1) continue;
            var seg = tt * (road.length - 1), s = Math.min(road.length - 2, seg | 0), f01 = seg - s;
            var u = lerp(road[s][0], road[s + 1][0], f01), v = lerp(road[s][1], road[s + 1][1], f01), p = P(u, v, depthAt(f, u, v));
            if (k === 'night') {
              ctx.fillStyle = 'rgba(255,240,205,' + 0.9 * a + ')'; ctx.beginPath(); ctx.arc(p[0] + dir * 1.4, p[1], 1.2, 0, 6.283); ctx.fill();
              ctx.fillStyle = 'rgba(255,120,100,' + 0.85 * a + ')'; ctx.beginPath(); ctx.arc(p[0] - dir * 1.6, p[1], 0.9, 0, 6.283); ctx.fill();
              ctx.fillStyle = 'rgba(255,236,190,' + 0.14 * a + ')'; ctx.beginPath(); ctx.arc(p[0] + dir * 2, p[1], 5, 0, 6.283); ctx.fill();
            } else {
              ctx.fillStyle = 'rgba(' + ink() + ',' + 0.7 * a + ')'; ctx.fillRect(p[0] - 2.2, p[1] - 1.2, 4.4, 2.2);
              ctx.fillStyle = 'rgba(255,250,235,' + 0.6 * a + ')'; ctx.fillRect(p[0] + (dir > 0 ? 1 : -2.2), p[1] - 1.2, 1.2, 1);
            }
          }
        } };
    },
    winlight: function (fr) {   // в окне башни зажигается и гаснет свет
      var f = V.entry(V.frame()), lit = f.nightLit, wl = f.winList;
      if (!wl || !wl.length) return null;
      var c = []; for (var i = 0; i < wl.length; i++) if (!lit || !lit[i]) c.push(wl[i]);
      if (!c.length) return null;
      var w = pick(c);
      return { dur: rnd(6, 10) * 1000,
        draw: function (e, t, now) {
          var a = env(t, 0.2, 0.25), fe = V.entry(V.frame()), p = V.project(fe, w.u, w.v, fe.dB), q = V.project(fe, w.u + w.w * 0.5, w.v + w.h * 0.5, fe.dB);
          var rx = Math.max(2, Math.abs(q[0] - p[0])), ry = Math.max(1.5, Math.abs(q[1] - p[1]));
          ctx.fillStyle = 'rgba(255,214,140,' + 0.9 * a + ')'; ctx.beginPath(); ctx.ellipse(p[0], p[1], rx, ry, 0, 0, 6.283); ctx.fill();
          ctx.fillStyle = 'rgba(255,214,140,' + 0.16 * a + ')'; ctx.beginPath(); ctx.ellipse(p[0], p[1], rx * 1.9, ry * 1.9, 0, 0, 6.283); ctx.fill();
        } };
    }
  };

  function spawn(fr, key) {
    var list = DEFS[fr] && DEFS[fr][key]; if (!list) return;
    var choices = list.filter(function (k) { return k !== lastKind; });
    var kind = pick(choices.length ? choices : list), e = KINDS[kind](fr);
    if (!e) { return; }
    e.kind = kind; e.t0 = performance.now(); lastKind = kind;
    active.push(e);
  }

  function frame(now) {
    if (!V) return;
    ensureCanvas(); fit();
    var fr = V.frame(), key = todKey();
    // смена кадра / перехода: старое растворяется само, новое не начинаем, пока не пройдёт переход
    if (fr !== lastFrame || key !== lastKey) { active = []; lastFrame = fr; lastKey = key; nextAt = now + rnd(2200, 4200); lastKind = ''; }
    if (V.fading() || !key) { if (drawn) { ctx.clearRect(0, 0, cv.width, cv.height); drawn = false; } return; }
    if (now >= nextAt && active.length < 2) { spawn(fr, key); nextAt = now + rnd(8000, 15000); }
    if (!active.length) { if (drawn) { ctx.clearRect(0, 0, cv.width, cv.height); drawn = false; } return; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H); drawn = true;
    for (var i = active.length - 1; i >= 0; i--) {
      var e = active[i], t = (now - e.t0) / e.dur;
      if (t >= 1) { active.splice(i, 1); continue; }
      e.draw(e, t, now);
    }
  }

  root.Details = {
    init: function (api) { V = api; },
    frame: frame,
    test: function (kind, tFrac) {   // для проверки: показать событие сразу (tFrac — с какой доли пути начать)
      var e = KINDS[kind](V.frame()); if (!e) return false;
      e.kind = kind; e.t0 = performance.now() - e.dur * (tFrac || 0.4); active.push(e); return true;
    },
    off: function () { active = []; if (ctx && drawn) { ctx.clearRect(0, 0, cv.width, cv.height); drawn = false; } }
  };
})(window);
