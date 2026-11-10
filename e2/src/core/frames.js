// core/frames.js — загрузка кадров: первый (день) сразу, остальное по одному в фоне. Тяжёлая подготовка картинок — core/prep.js
// (Web Worker, если есть; иначе в главном потоке). Какие файлы и текстуры нужны — говорит каждый эффект (frameFiles, upload, states).
E2.Frames = (function () {
  var store = [], dayP = [], stateP = [], cfg = null, fx = [], G = null, prep = null, prepCfg = null;
  function abs(u) { return new URL(u, location.href).href; }
  function absAll(o) { var r = {}; Object.keys(o).forEach(function (k) { r[k] = typeof o[k] === 'string' ? abs(o[k]) : absAll(o[k]); }); return r; }
  function makePrep() {
    var FW = cfg.look.frameSize[0], FH = cfg.look.frameSize[1];
    var pc = { MAX_TEX_SIZE: 1600, STARS: 120, STAR_CELLS: [Math.max(1, Math.round(FW / 24)), Math.max(1, Math.round(FH / 24))], FRAME_SIZE: cfg.look.frameSize,
      // свет окон и ночь — эффект lights (П2); пока постоянные e1.62, на день и закат не влияют
      NIGHT_MAIN_LIT: [0, 0], NIGHT_OTHER_LIT: [0.4, 0.6], WINDOW_BRIGHT: [0.6, 1], NIGHT_WINS: cfg.frames.map(function () { return false; }), NIGHT_MAIN_WINS: false, NIGHT_EDGE: 'solid', FIG_ON: false };
    fx.forEach(function (e) { if (e.prepCfg) { var a = e.prepCfg(cfg); Object.keys(a).forEach(function (k) { pc[k] = a[k]; }); } });
    prepCfg = pc;
    var url = abs(cfg.engine.base + 'prep.js?v=' + cfg.engine.version), worker = null, pend = {}, seq = 0, mainP = null;
    function viaMain(method, args) {
      if (!mainP) mainP = new Promise(function (res, rej) {
        var sc = document.createElement('script');
        sc.src = url; sc.onload = function () { window.Prep.init(pc).then(res); }; sc.onerror = function () { rej(new Error('prep.js не загрузился')); };
        document.head.appendChild(sc);
      });
      return mainP.then(function () { return window.Prep[method].apply(null, args); });
    }
    if (window.Worker && window.OffscreenCanvas && window.createImageBitmap && E2.query('noworker') !== '1') {
      try {
        worker = new Worker(url);
        worker.onmessage = function (e) { var m = e.data, q = pend[m.id]; delete pend[m.id]; if (q) { if (m.ok) q.res(m.res); else q.rej(new Error(m.err)); } };
        worker.onerror = function () { worker = null; Object.keys(pend).forEach(function (id) { var q = pend[id]; delete pend[id]; viaMain(q.method, q.args).then(q.res, q.rej); }); };
        worker.postMessage({ id: ++seq, method: 'init', args: [pc] });
      } catch (err) { worker = null; }
    }
    return function (method, args) {
      if (!worker) return viaMain(method, args);
      return new Promise(function (res, rej) { var id = ++seq; pend[id] = { res: res, rej: rej, method: method, args: args }; worker.postMessage({ id: id, method: method, args: args }); });
    };
  }
  function loadDay(i) {
    if (dayP[i]) return dayP[i];
    var f = cfg.frames[i], files = {};
    fx.forEach(function (e) { if (e.frameFiles) { var a = absAll(e.frameFiles(f)); Object.keys(a).forEach(function (k) { files[k] = a[k]; }); } });
    dayP[i] = prep('day', [files, i]).then(function (r) {
      var entry = { idx: i, name: f.name, cfg: f, w: r.w, h: r.h, depthMap: r.depth };
      var chain = Promise.resolve();
      fx.forEach(function (e) { if (e.upload) chain = chain.then(function () { e.upload(G, entry, r); return E2.Clock.pause(); }); });
      return chain.then(function () { store[i] = entry; return entry; });
    });
    dayP[i].catch(function (err) { E2.err('кадр ' + (i + 1), err); dayP[i] = null; });
    return dayP[i];
  }
  function loadStates(i) {   // версии кадра (закат; ночь — П2): в фоне; пока их нет, кадр живёт без них
    if (stateP[i]) return stateP[i];
    stateP[i] = loadDay(i).then(function (entry) {
      var chain = Promise.resolve();
      fx.forEach(function (e) {
        (e.states ? e.states(cfg.frames[i]) : []).forEach(function (st) {
          chain = chain.then(function () { return prep('state', [i, st[0], abs(st[1])]); })
            .then(function (r) { e.uploadState(G, entry, st[0], r); return E2.Clock.pause(); })
            .catch(function (err) { E2.err('кадр ' + (i + 1) + ' ' + st[0], err); });
        });
      });
      return chain;
    });
    return stateP[i];
  }
  return {
    init: function (c, effects) { cfg = c; fx = effects; G = E2.GL; prep = makePrep(); },
    get: function (i) { return store[i]; },
    count: function () { return cfg.frames.length; },
    prepCfg: function () { return prepCfg; },   // что получила подготовка картинок (гейт G8: ключ-эхо)
    loadDay: loadDay, loadStates: loadStates,
    loadAll: function (first) {   // первый кадр, его версии, затем остальные по одному
      var order = [first]; for (var i = 0; i < cfg.frames.length; i++) if (i !== first) order.push(i);
      return order.reduce(function (p, i) { return p.then(function () { return loadDay(i); }).then(function () { return loadStates(i); }); }, Promise.resolve());
    },
    reset: function () { store.length = 0; dayP = []; stateP = []; }
  };
})();
