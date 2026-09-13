  /* ================== ЗВУК ==================

     Тактильные щелчки по кнопкам и тихая подложка для атмосферы.
     Всё — чистый Web Audio, без единого аудиофайла: не нужно тащить
     чужой сэмпл, ничего не грузится по сети, ничему не «не
     догрузиться» на плохом интернете. Звук стартует только по первому
     касанию экрана — раньше браузер (особенно Safari) всё равно не
     даст, это его собственное правило, а не наше решение. */
  var Snd = (function () {
    var ctx = null, master = null, muted = false, ambientOn = false;
    var chirpTimer = 0;

    try {
      muted = localStorage.getItem('kk_muted') === '1';
    } catch (e) {}

    function ensure() {
      if (ctx) return ctx;
      var AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 1;
      master.connect(ctx.destination);
      return ctx;
    }

    /* Короткий "тук" — как системный тап в iOS: щелчок с быстрым
       затуханием и лёгким фильтром, чтобы не резал ухо. mul сдвигает
       высоту тона — чуть выше для "включил", чуть ниже для "выключил". */
    function tap(mul) {
      if (!ctx) return;
      if (ctx.state === 'suspended') ctx.resume();
      var t = ctx.currentTime;
      var o = ctx.createOscillator();
      var g = ctx.createGain();
      var f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 4200;
      o.type = 'triangle';
      var base = 720 * (mul || 1);
      o.frequency.setValueAtTime(base, t);
      o.frequency.exponentialRampToValueAtTime(base * 0.72, t + 0.05);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.34, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.075);
      o.connect(f); f.connect(g); g.connect(master);
      o.start(t); o.stop(t + 0.09);
    }

    /* Редкие "птицы" днём / "сверчки" ночью — привязаны к тому же NIGHT,
       что красит окна и небо, так что звук не спорит с картинкой. */
    function scheduleChirp() {
      clearTimeout(chirpTimer);
      var wait = 3500 + Math.random() * 6500;
      chirpTimer = setTimeout(function () {
        if (ctx && !muted) chirp();
        scheduleChirp();
      }, wait);
    }

    function chirp() {
      var t = ctx.currentTime;
      var night = (typeof NIGHT === 'number') ? NIGHT : 0;
      if (night < 0.5) {
        var notes = 2 + (Math.random() < 0.5 ? 1 : 0);
        for (var i = 0; i < notes; i++) {
          var o = ctx.createOscillator();
          var ng = ctx.createGain();
          o.type = 'sine';
          var f0 = 2100 + Math.random() * 900;
          var dt = t + i * 0.09;
          o.frequency.setValueAtTime(f0, dt);
          o.frequency.exponentialRampToValueAtTime(f0 * 1.35, dt + 0.05);
          ng.gain.setValueAtTime(0.0001, dt);
          ng.gain.exponentialRampToValueAtTime(0.05, dt + 0.012);
          ng.gain.exponentialRampToValueAtTime(0.0001, dt + 0.09);
          o.connect(ng); ng.connect(master);
          o.start(dt); o.stop(dt + 0.11);
        }
      } else {
        var reps = 5 + (Math.random() * 4 | 0);
        for (var k = 0; k < reps; k++) {
          var o2 = ctx.createOscillator();
          var ng2 = ctx.createGain();
          o2.type = 'square';
          o2.frequency.value = 3600 + Math.random() * 200;
          var dt2 = t + k * 0.045;
          ng2.gain.setValueAtTime(0.0001, dt2);
          ng2.gain.exponentialRampToValueAtTime(0.028, dt2 + 0.004);
          ng2.gain.exponentialRampToValueAtTime(0.0001, dt2 + 0.03);
          o2.connect(ng2); ng2.connect(master);
          o2.start(dt2); o2.stop(dt2 + 0.04);
        }
      }
    }

    /* Мягкая подложка: два расстроенных низких тона под медленным
       плавающим фильтром — почти на грани слышимости, просто чтобы
       кадр не был немым. */
    function startAmbient() {
      if (!ctx || ambientOn) return;
      ambientOn = true;
      var pad = ctx.createGain();
      pad.gain.value = 0.028;
      pad.connect(master);
      [98, 123.5].forEach(function (f, i) {
        var o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = f;
        var lfo = ctx.createOscillator();
        var lfoGain = ctx.createGain();
        lfo.frequency.value = 0.05 + i * 0.017;
        lfoGain.gain.value = 2.2;
        lfo.connect(lfoGain); lfoGain.connect(o.frequency);
        o.connect(pad);
        lfo.start(); o.start();
      });
      scheduleChirp();
    }

    function setMuted(m) {
      muted = !!m;
      try { localStorage.setItem('kk_muted', muted ? '1' : '0'); } catch (e) {}
      if (master && ctx) {
        master.gain.cancelScheduledValues(ctx.currentTime);
        master.gain.linearRampToValueAtTime(muted ? 0 : 1, ctx.currentTime + 0.08);
      }
    }

    return {
      ensure: ensure,
      tap: tap,
      startAmbient: startAmbient,
      setMuted: setMuted,
      isMuted: function () { return muted; }
    };
  })();

