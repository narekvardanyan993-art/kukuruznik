// core/clock.js — ЕДИНСТВЕННЫЙ источник времени и случайности движка (docs/STANOK.md §2.2, гейт G6).
// Всё, что движется, берёт время из Clock.now() и случайные числа из Clock.rng(seed). Настоящие часы, таймеры браузера,
// requestAnimationFrame и Math.random разрешены ТОЛЬКО в этом файле — гейт G6 ищет их по остальным модулям.
// Режим проверки ?vt=1: кадры не идут сами, время двигает window.__e2.advance(ms) ровными шагами — два прогона дают одинаковые пиксели.
E2.Clock = (function () {
  var virtual = /[?&]vt=1/.test(location.search);
  var now = 0, t0 = null, loop = null, timers = [], frames = 0;
  function fire(t) {
    now = t; frames++;
    if (timers.length) {
      var due = timers.filter(function (q) { return q.at <= now; });
      timers = timers.filter(function (q) { return q.at > now; });
      due.forEach(function (q) { try { q.fn(now); } catch (e) { E2.err('clock.after', e); } });
    }
    if (loop) loop(now);
  }
  function tick(ts) {
    if (t0 === null) t0 = ts;
    fire(ts - t0);
    window.requestAnimationFrame(tick);
  }
  return {
    virtual: virtual,
    now: function () { return now; },                       // мс от старта движка
    frames: function () { return frames; },
    start: function (fn) { loop = fn; if (!virtual) window.requestAnimationFrame(tick); },
    advance: function (ms, step) {                          // только ?vt=1: шаги по step мс (по умолчанию 32)
      if (!virtual) return false;
      step = step || 32;
      for (var n = Math.ceil(ms / step), i = 0; i < n; i++) fire(now + step);
      return true;
    },
    redraw: function () { if (virtual) fire(now); return virtual; },   // только ?vt=1: перерисовать тот же момент (проверки сравнивают один момент с частью движка и без)
    after: function (ms, fn) { timers.push({ at: now + ms, fn: fn }); },   // «через ms» по часам движка (не setTimeout)
    rng: function (seed) {                                  // mulberry32: одна и та же последовательность для одного seed
      return function () {
        seed |= 0; seed = seed + 0x6D2B79F5 | 0;
        var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
      };
    },
    real: function () { return performance.now(); },        // настоящие часы — ТОЛЬКО для замера fps (core/perf.js), на картинку не влияют
    pause: function () { return new Promise(function (r) { setTimeout(r, 0); }); }   // уступить поток при загрузке кадров (не движение)
  };
})();
