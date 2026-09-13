  /* ================== ЗВУК ==================

     Тактильные щелчки по кнопкам и живая подложка, которая меняется
     вместе со временем суток. Всё — чистый Web Audio, без единого
     аудиофайла: не грузится по сети, нечему подвиснуть на плохом
     интернете.

     Первая версия иногда молчала на телефоне: звук пытался
     стартовать только по одному конкретному жесту (pointerdown по
     сцене), а если человек первым делом нажимал кнопку меню — жеста
     в нужном месте не случалось. Теперь ensure()/tap() сами создают
     и будят AudioContext при первом же вызове, из какого угодно
     обработчика клика, и вдобавок слушаем сразу три типа жеста
     (pointerdown, touchend, click) — так надёжнее на iOS.

     Если звука всё равно не слышно — стоит проверить обычные вещи:
     боковой бегунок беззвучного режима на iPhone и громкость самого
     телефона. Safari по умолчанию слушается беззвучного бегунка для
     Web Audio, и это ограничение браузера, а не то, что можно
     обойти из кода страницы. */
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

    // Создаёт контекст, если его ещё нет, и сразу будит, если уснул —
    // вызывается и из общего "разлочивателя", и из каждого tap().
    function unlock() {
      var c = ensureCtx();
      if (c && c.state === 'suspended') { try { c.resume(); } catch (e) {} }
      return c;
    }

    /* Мягкий "тук": два синусa — основной и на октаву ниже, тише —
       вместо треугольника или пилы. Звук ровный и округлый, ближе к
       системному тапу iOS, чем к щелчку мыши. mul сдвигает высоту —
       чуть выше для "включил", чуть ниже для "выключил". */
    function tap(mul) {
      var c = unlock();
      if (!c) return;
      var t = c.currentTime;
      var base = 560 * (mul || 1);

      var g = c.createGain();
      var f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 2600;
      f.connect(g); g.connect(master);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.48, t + 0.010);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.120);

      var o1 = c.createOscillator();
      o1.type = 'sine';
      o1.frequency.setValueAtTime(base, t);
      o1.frequency.exponentialRampToValueAtTime(base * 0.8, t + 0.09);
      o1.connect(f);

      var o2 = c.createOscillator();
      var g2 = c.createGain();
      g2.gain.value = 0.45;
      o2.type = 'sine';
      o2.frequency.value = base * 0.5;
      o2.connect(g2); g2.connect(f);

      o1.start(t); o1.stop(t + 0.14);
      o2.start(t); o2.stop(t + 0.14);
    }

    function noiseBuffer(c, seconds) {
      var len = Math.max(1, (c.sampleRate * seconds) | 0);
      var buf = c.createBuffer(1, len, c.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      return buf;
    }

    /* Птицы утром и днём, сверчки ночью — выбор не жёстким порогом на
       NIGHT=0.5, а вероятностью от текущего NIGHT: у самой границы
       часть трелей ещё птичьи, часть уже сверчки, и смена звучит как
       переход, а не щелчок тумблера. Частота трелей тоже плывёт:
       утром живее, к дню реже. */
    function scheduleChirp() {
      clearTimeout(chirpTimer);
      var night = (typeof NIGHT === 'number') ? NIGHT : 0;
      var tod = (typeof TOD === 'number') ? TOD : 0.3;
      var morn = Math.max(0, 1 - Math.abs(tod - 0.12) / 0.22);
      var activity = Math.max(0.3, morn) * (1 - Math.min(0.65, night * 0.55));
      var wait = (3500 + Math.random() * 6500) / (0.45 + activity);
      chirpTimer = setTimeout(function () {
        if (ctx && !muted) chirp();
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

    /* Подложка: тихий плавающий гул под всей сценой в любое время
       суток, плюс отдельный слой машинного гула (фильтрованный шум —
       без единого файла), чья громкость следует за тем же DUSK/NIGHT,
       что красит небо и окна. Поэтому вечером звук сам "подъезжает"
       к картинке машинного гула города, а глубокой ночью стихает, и
       делает это ровно в такт со сменой освещения, а не отдельно. */
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

    /* Вызывается каждый кадр — дёшево, пара умножений и запись одного
       числа. Громкость машинного гула следует за TOD/DUSK/NIGHT,
       которые и так пересчитываются каждый кадр для цвета неба, так
       что звук меняется в тот же момент и с той же плавностью, что и
       картинка, а не отдельным резким переключением. */
    function updateAmbient() {
      if (!ctx || !ambientOn || !trafficGain) return;
      var dusk = (typeof DUSK === 'number') ? DUSK : 0;
      var night = (typeof NIGHT === 'number') ? NIGHT : 0;
      var traffic = Math.min(0.5, dusk * 1.15 + night * 0.22);
      trafficGain.gain.value = traffic * 0.055;
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

