  /* ================== ЗВУК ==================

     Тактильные щелчки — у каждой кнопки свой голос, не просто своя
     высота, — и живая подложка, которая меняется вместе со временем
     суток. Всё чистый Web Audio, без единого аудиофайла.

     tap(kind, mul) вызывается из каждой кнопки со своим kind: у
     каждой — свой базовый тон, свой фильтр, своя длина затухания
     (см. VOICES ниже), а не просто общий щелчок на разной высоте.
     mul по-прежнему сдвигает высоту для состояний вкл/выкл одной и
     той же кнопки. */
  var Snd = (function () {
    var ctx = null, master = null, muted = false, ambientOn = false;
    var chirpTimer = 0, trafficGain = null;

    try {
      muted = localStorage.getItem('kk_muted') === '1';
    } catch (e) {}

    function ensureCtx() {
      if (ctx) return ctx;
      var AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return null;
      try {
        ctx = new AC();
      } catch (e) { return null; }
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 1;
      master.connect(ctx.destination);
      return ctx;
    }

    function unlock() {
      var c = ensureCtx();
      if (c && c.state === 'suspended') { try { c.resume(); } catch (e) {} }
      return c;
    }

    function noiseBuffer(c, seconds) {
      var len = Math.max(1, (c.sampleRate * seconds) | 0);
      var buf = c.createBuffer(1, len, c.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      return buf;
    }

    /* Голос каждой кнопки: базовый тон, частота фильтра, длина
       затухания, вес нижней "подоктавной" примеси (sub — она и даёт
       ощущение мягкости/веса). sweepTo — во что соскальзывает высота
       к концу ноты (по умолчанию 0.8). double/whoosh — редкие
       дополнительные краски у двух самых "механических" кнопок. */
    var VOICES = {
      menu:    { base: 640, filt: 2600, decay: 0.120, sub: 0.45 },
      weather: { base: 800, filt: 3600, decay: 0.100, sub: 0.28 },
      drone:   { base: 480, filt: 2000, decay: 0.170, sub: 0.55, sweepTo: 0.62 },
      auto:    { base: 700, filt: 3000, decay: 0.090, sub: 0.32, double: true },
      reset:   { base: 400, filt: 1600, decay: 0.180, sub: 0.62 },
      hide:    { base: 560, filt: 2200, decay: 0.140, sub: 0.38, whoosh: true },
      sound:   { base: 880, filt: 4200, decay: 0.160, sub: 0.22 },
      morning: { base: 920, filt: 3800, decay: 0.110, sub: 0.25 },
      day:     { base: 700, filt: 3000, decay: 0.110, sub: 0.35 },
      dusk:    { base: 560, filt: 2300, decay: 0.120, sub: 0.42 },
      night:   { base: 420, filt: 1700, decay: 0.150, sub: 0.55 }
    };

    // Один и тот же "мягкий тук" (два синуса), но с параметрами голоса.
    function playVoice(c, v, mul) {
      var t = c.currentTime;
      var base = v.base * mul;
      var g = c.createGain();
      var f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = v.filt;
      f.connect(g); g.connect(master);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.48, t + 0.010);
      g.gain.exponentialRampToValueAtTime(0.0001, t + v.decay);

      var o1 = c.createOscillator();
      o1.type = 'sine';
      o1.frequency.setValueAtTime(base, t);
      o1.frequency.exponentialRampToValueAtTime(base * (v.sweepTo || 0.8), t + v.decay * 0.7);
      o1.connect(f);

      var o2 = c.createOscillator();
      var g2 = c.createGain();
      g2.gain.value = v.sub;
      o2.type = 'sine';
      o2.frequency.value = base * 0.5;
      o2.connect(g2); g2.connect(f);

      var stopAt = t + v.decay + 0.02;
      o1.start(t); o1.stop(stopAt);
      o2.start(t); o2.stop(stopAt);
    }

    // Короткий шорох с падающей частотой — для кнопки полного экрана,
    // будто что-то плавно "задвигается".
    function playWhoosh(c) {
      var t = c.currentTime;
      var src = c.createBufferSource();
      src.buffer = noiseBuffer(c, 0.25);
      var bp = c.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(1200, t);
      bp.frequency.exponentialRampToValueAtTime(300, t + 0.22);
      bp.Q.value = 0.9;
      var g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.22, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
      src.connect(bp); bp.connect(g); g.connect(master);
      src.start(t); src.stop(t + 0.25);
    }

    function tap(kind, mul) {
      var c = unlock();
      if (!c) return;
      var v = VOICES[kind] || VOICES.menu;
      playVoice(c, v, mul || 1);
      if (v.double) {
        setTimeout(function () {
          var c2 = unlock();
          if (c2) playVoice(c2, v, (mul || 1) * 1.12);
        }, 70);
      }
      if (v.whoosh) playWhoosh(c);
    }

    /* Птицы утром и днём, сверчки ночью — выбор не жёстким порогом на
       NIGHT=0.5, а вероятностью от текущего NIGHT: переходная зона
       звучит как смесь, а не щелчок тумблера. Иногда добавляем вторую
       трель следом — "перекличка", а не одна и та же птица по таймеру. */
    function scheduleChirp() {
      clearTimeout(chirpTimer);
      var night = (typeof NIGHT === 'number') ? NIGHT : 0;
      var tod = (typeof TOD === 'number') ? TOD : 0.3;
      var morn = Math.max(0, 1 - Math.abs(tod - 0.12) / 0.22);
      var activity = Math.max(0.3, morn) * (1 - Math.min(0.65, night * 0.55));
      var wait = (3500 + Math.random() * 6500) / (0.45 + activity);
      chirpTimer = setTimeout(function () {
        if (ctx && !muted) {
          chirp();
          if (Math.random() < 0.3) {
            setTimeout(function () { if (ctx && !muted) chirp(); }, 320 + Math.random() * 480);
          }
        }
        scheduleChirp();
      }, wait);
    }

    function chirp() {
      var t = ctx.currentTime;
      var night = (typeof NIGHT === 'number') ? NIGHT : 0;
      var cricket = Math.random() < night;
      if (!cricket) {
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
          ng.gain.exponentialRampToValueAtTime(0.065, dt + 0.012);
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
          ng2.gain.exponentialRampToValueAtTime(0.034, dt2 + 0.004);
          ng2.gain.exponentialRampToValueAtTime(0.0001, dt2 + 0.03);
          o2.connect(ng2); ng2.connect(master);
          o2.start(dt2); o2.stop(dt2 + 0.04);
        }
      }
    }

    /* Подложка: тихий плавающий гул под сценой в любое время суток,
       мягкий "воздух" (гуляющий ветер, всегда чуть слышен) и слой
       машинного гула города — громкость последнего следует за тем же
       DUSK/NIGHT, что красит небо, через setTargetAtTime (плавное
       скольжение к цели, а не мгновенная подмена числа), поэтому
       смена звучит вместе со сменой света, а не отдельным щелчком. */
    function startAmbient() {
      if (!ctx || ambientOn) return;
      ambientOn = true;

      var pad = ctx.createGain();
      pad.gain.value = 0.032;
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

      // тихий воздух — гуляющий ветер, чуть колышется по громкости
      var windGain = ctx.createGain();
      windGain.gain.value = 0.018;
      windGain.connect(master);
      var windSrc = ctx.createBufferSource();
      windSrc.buffer = noiseBuffer(ctx, 4);
      windSrc.loop = true;
      var windBP = ctx.createBiquadFilter();
      windBP.type = 'bandpass'; windBP.frequency.value = 900; windBP.Q.value = 0.5;
      windSrc.connect(windBP); windBP.connect(windGain);
      windSrc.start();
      var gustLFO = ctx.createOscillator();
      var gustLFOGain = ctx.createGain();
      gustLFO.frequency.value = 0.045;
      gustLFOGain.gain.value = 0.010;
      gustLFO.connect(gustLFOGain); gustLFOGain.connect(windGain.gain);
      gustLFO.start();

      // гул города — фильтрованный шум, громкость решает updateAmbient()
      var noiseSrc = ctx.createBufferSource();
      noiseSrc.buffer = noiseBuffer(ctx, 3);
      noiseSrc.loop = true;
      var bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 220; bp.Q.value = 0.6;
      var lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 650;
      trafficGain = ctx.createGain();
      trafficGain.gain.value = 0;
      noiseSrc.connect(bp); bp.connect(lp); lp.connect(trafficGain); trafficGain.connect(master);
      noiseSrc.start();

      scheduleChirp();
    }

    /* Вызывается каждый кадр. setTargetAtTime вместо прямого
       присваивания — сглаживает саму передачу числа в звук, поверх
       того, что TOD и так подъезжает к цели плавно кадр за кадром:
       переход слышен как непрерывное скольжение. */
    function updateAmbient() {
      if (!ctx || !ambientOn || !trafficGain) return;
      var dusk = (typeof DUSK === 'number') ? DUSK : 0;
      var night = (typeof NIGHT === 'number') ? NIGHT : 0;
      var traffic = Math.min(0.55, 0.05 + dusk * 1.05 + night * 0.20);
      trafficGain.gain.setTargetAtTime(traffic * 0.055, ctx.currentTime, 0.8);
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
      ensure: unlock,
      tap: tap,
      startAmbient: startAmbient,
      updateAmbient: updateAmbient,
      setMuted: setMuted,
      isMuted: function () { return muted; }
    };
  })();

