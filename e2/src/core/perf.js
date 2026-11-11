// core/perf.js — ступени качества (docs/STANOK.md §5.1–5.2): full → lite → min. Кнопки в интерфейсе нет; проверка: ?tier=lite|min.
// Замер fps идёт по НАСТОЯЩИМ часам (E2.Clock.real) и на картинку не влияет; под виртуальным временем (?vt=1) ступень не меняется.
// Ступень задаёт плотность пикселей, «дыхание» камеры, число частиц осадков (fx/weather.js) и небо: на минимальной теней облаков нет (fx/sky.js).
// Ветер и актёры встанут в этот порядок с их появлением (П3, П6).
E2.Perf = (function () {
  var TIERS = { full: { dpr: 2 }, lite: { dpr: 1.5 }, min: { dpr: 1 } }, ORDER = ['full', 'lite', 'min'];
  var forced = E2.query('tier'), tier = TIERS[forced] ? forced : 'full', auto = !TIERS[forced] && E2.query('perf') !== '0' && !E2.Clock.virtual;
  var n = 0, t0 = 0, low = 0, best = 0, minFps = 45, onChange = null;
  return {
    tier: function () { return tier; },
    dpr: function () { return Math.min(window.devicePixelRatio || 1, TIERS[tier].dpr); },
    onChange: function (fn) { onChange = fn; },
    frame: function () {                     // раз в кадр; окно 2,5 с; два медленных окна подряд — ступень вниз
      if (!auto) return;
      var t = E2.Clock.real();
      if (!t0) { t0 = t; n = 0; return; }
      n++;
      if (t - t0 < 2500) return;
      var fps = n * 1000 / (t - t0); t0 = t; n = 0;
      if (fps > best) best = fps;
      var floor = best < 35 ? 24 : minFps;   // iPhone в энергосбережении держит 30 — это норма, ступень не снижаем
      if (fps < floor) { if (++low >= 2 && tier !== 'min') { low = 0; tier = ORDER[ORDER.indexOf(tier) + 1]; if (onChange) onChange(tier); } } else low = 0;
    }
  };
})();
