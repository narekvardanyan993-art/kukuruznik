// core/util.js — мелкие общие функции (без времени и случайности: они только в core/clock.js)
E2.clamp = function (v, a, b) { return v < a ? a : (v > b ? b : v); };
E2.sstep = function (a, b, x) { x = E2.clamp((x - a) / (b - a), 0, 1); return x * x * (3 - 2 * x); };
E2.glf = function (x) { return Number.isInteger(x) ? x.toFixed(1) : String(x); };              // число -> литерал GLSL
E2.v3 = function (a) { return 'vec3(' + a.map(E2.glf).join(', ') + ')'; };
E2.lerpK = function (k, dt) { return 1 - Math.pow(1 - k, dt / 16.667); };                       // сглаживание, не зависящее от частоты кадров
// Пружина как в iOS (response, damping): p 0..1 — доля времени оседания. Та же кривая, что у e1.62 (переходы кадров).
E2.spring = function (response, damping) {
  var w = 2 * Math.PI / response, z = damping, wd = w * Math.sqrt(1 - z * z);
  function x(t) { return 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + z * w / wd * Math.sin(wd * t)); }
  var T = 0, t, a = [], N = 256, i;
  for (t = 0; t < 3; t += 0.002) if (Math.abs(1 - x(t)) > 0.0015) T = t;
  for (i = 0; i <= N; i++) a.push(x(T * i / N));
  a[N] = 1;
  return function (p) { p = E2.clamp(p, 0, 1); var f = p * 256, k = f | 0; return k >= 256 ? 1 : a[k] + (a[k + 1] - a[k]) * (f - k); };
};
E2.EASE = E2.spring(0.65, 0.86);
E2.errors = [];
E2.err = function (where, e) { var m = where + ': ' + (e && e.message || e); if (E2.errors.length < 50) E2.errors.push(m); if (window.console) console.warn('[e2] ' + m); };
E2.safe = function (where, fn) { try { return fn(); } catch (e) { E2.err(where, e); } };
E2.query = function (name) { var m = new RegExp('[?&]' + name + '=([^&]*)').exec(location.search); return m ? decodeURIComponent(m[1]) : null; };
