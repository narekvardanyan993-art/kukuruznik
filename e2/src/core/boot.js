// core/boot.js — старт: настройки здания (уже проверенные схемой и с подставленными умолчаниями — tools/stanok.py build) → сцена.
E2.boot = function () {
  var cfg = window.E2_BUILDING, el = document.getElementById('stage');
  if (!cfg || !el) { E2.err('boot', 'нет настроек здания или #stage'); return; }
  var on = cfg.effectsOn, fx = E2.fx.filter(function (e) { return on.indexOf(e.name) >= 0; });
  try {
    fx.forEach(function (e) { if (e.init) e.init(cfg); });
    E2.Stage.init(cfg, fx, el);
    E2.Frames.init(cfg, fx);
    E2.UI.init(cfg, fx);
  } catch (e) { E2.err('boot', e); document.documentElement.setAttribute('data-e2', 'error'); return; }
  var first = Math.min(Math.max(0, +(E2.query('f') || 0) | 0), cfg.frames.length - 1);
  E2.Frames.loadDay(first).then(function () { document.documentElement.setAttribute('data-e2', 'first'); if (first) E2.Stage.go(first); });
  E2.Frames.loadAll(first).then(function () { document.documentElement.setAttribute('data-e2', 'all'); });
};
