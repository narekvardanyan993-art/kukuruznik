// core/ui.js — полигон: только самое нужное, чтобы страницу можно было открыть и проверить: кнопки времени суток («День», «Закат»,
// «Ночь»), погоды («Снег», «Дождь»), стрелки кадров и доступ для проверок window.__e2. Панель, плашка, точки, язык, открытка, надписи переезжают в П5–П6
// (docs/STANOK.md §7). ?break=tod — кнопки времени суток ничего не делают (красный случай гейта G7).
E2.UI = {
  init: function (cfg, fx) {
    var tod = fx.filter(function (e) { return e.name === 'tod'; })[0];
    function setTod(name) {
      if (!tod || E2.brk('tod') || !tod.set(name, { cfg: cfg })) return false;
      Array.prototype.forEach.call(document.querySelectorAll('[data-tod]'), function (b) { b.classList.toggle('on', b.getAttribute('data-tod') === name); });
      return true;
    }
    Array.prototype.forEach.call(document.querySelectorAll('[data-tod]'), function (b) { b.addEventListener('click', function () { setTod(b.getAttribute('data-tod')); }); });
    var wx = fx.filter(function (e) { return e.name === 'weather'; })[0];
    function setWx(name) {      // 'snow' | 'rain' | 'none'; повторное нажатие той же кнопки — выключить
      if (!wx || !wx.set(name)) return false;
      Array.prototype.forEach.call(document.querySelectorAll('[data-wx]'), function (b) { b.classList.toggle('on', b.getAttribute('data-wx') === name); });
      return true;
    }
    Array.prototype.forEach.call(document.querySelectorAll('[data-wx]'), function (b) {
      if (!wx) { b.style.display = 'none'; return; }
      b.addEventListener('click', function () { var n = b.getAttribute('data-wx'); setWx(wx.state.kind === n ? 'none' : n); });
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-go]'), function (b) { b.addEventListener('click', function () { E2.Stage.go(E2.Stage.frame() + (+b.getAttribute('data-go'))); }); });
    document.addEventListener('keydown', function (e) { if (e.key === 'ArrowRight') E2.Stage.go(E2.Stage.frame() + 1); if (e.key === 'ArrowLeft') E2.Stage.go(E2.Stage.frame() - 1); });
    window.__e2 = {
      version: cfg.engine.version,
      advance: function (ms, step) { return E2.Clock.advance(ms, step); },   // только ?vt=1
      now: function () { return E2.Clock.now(); }, redraw: function () { return E2.Clock.redraw(); },
      setWx: setWx, setTod: setTod, tod: function () { return tod ? { name: tod.state.name, p: tod.state.p, busy: tod.busy() } : null; },
      go: function (i) { return E2.Stage.go(i); }, tilt: function (x, y) { E2.Stage.tilt(x, y); },
      state: function () { return E2.Stage.state(); }, shaders: function () { return E2.Stage.shaders(); },
      pixels: function () { return E2.Stage.pixels(); }, errors: function () { return E2.errors.slice(); },
      loaded: function (i) { var f = E2.Frames.get(i); return !!f; },
      prepCfg: function () { return JSON.parse(JSON.stringify(E2.Frames.prepCfg())); },
      fx: function (name) { var e = E2.fxGet(name); return e && e.debug ? JSON.parse(JSON.stringify(e.debug(E2.Frames.get(E2.Stage.frame())))) : null; },
      project: function (u, v, d) { return E2.Stage.project(u, v, d); },
      off: function (name, on) { E2.offNow[name] = !!on; return true; }, still: function (on) { return E2.Stage.still(on); }
    };
  }
};
