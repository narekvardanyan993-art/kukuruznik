  // ================== запуск ==================

  function boot() {
    var sceneCanvas = document.getElementById('scene');
    var paperCanvas = document.getElementById('paper');
    var stage = document.getElementById('stage');
    var fpsEl = document.getElementById('fps');
    var autoBtn = document.getElementById('autoBtn');
    var resetBtn = document.getElementById('resetBtn');
    var hint = document.getElementById('hint');

    var model = global.Model.build({ ribs: 16, floors: 15 });
    var engine = new Engine(sceneCanvas, paperCanvas, model);

    /* Страховка на холодный запуск отдельным приложением: если самый
       первый resize() внутри конструктора застал окно нулевого
       размера (см. комментарий в resize()), пробуем на каждом кадре,
       пока размер не появится — и тогда сразу останавливаемся. Если
       всё было в порядке с самого начала, это один лишний дешёвый
       вызов и всё. Кадры без размера сами по себе ничего не рисуют
       (см. защиту в начале render()), так что ждать не страшно. */
    (function ensureSized(triesLeft) {
      if (engine.w && engine.h) return;
      engine.resize();
      if ((engine.w && engine.h) || triesLeft <= 0) return;
      requestAnimationFrame(function () { ensureSized(triesLeft - 1); });
    })(90);                                    // запас на полторы секунды при 60 fps

    /* ОТКРЫВАЮЩИЙ КАДР.

       Первое, что видит человек, должно быть готовым кадром, а не
       случайным ракурсом. Вечер, здание сбоку, площадка горит,
       Арарат в стороне — и камера сама медленно идёт вокруг, пока
       её не тронули. Достаточно нажать запись и не касаться экрана. */
    var state = { yaw: 1.42, pitch: 0.27, zoom: 1.02, idle: true };
    var controls = global.Controls.create(stage, state);
    controls.onFirstTouch(function () {
      hint.classList.add('gone');
      state.idle = false;          // человек взял управление — не мешаем
    });

    /* Звук нельзя запустить без касания — это правило браузера, не
       наше. Ловим самое первое касание где угодно на странице (по
       сцене или по любой кнопке) и один раз включаем звуковой движок. */
    function unlockSound() {
      document.removeEventListener('pointerdown', unlockSound);
      document.removeEventListener('touchend', unlockSound);
      document.removeEventListener('click', unlockSound);
      if (Snd.ensure()) Snd.startAmbient();
    }
    document.addEventListener('pointerdown', unlockSound, { passive: true });
    document.addEventListener('touchend', unlockSound, { passive: true });
    document.addEventListener('click', unlockSound, { passive: true });

    /* Дрон: медленный облёт с плавным подъёмом и наездом. Не «камера
       летит по маршруту», а спокойный круг — из такого кадра получается
       готовый ролик без единого касания. */
    var droneBtn = document.getElementById('droneBtn');
    var droneT = 0;
    droneBtn.addEventListener('click', function () {
      Snd.tap('drone');
      state.drone = !state.drone;
      droneBtn.setAttribute('aria-pressed', state.drone ? 'true' : 'false');
      toast(state.drone ? 'Облёт включён' : 'Облёт выключен');
      if (state.drone) {
        state.auto = false;
        autoBtn.setAttribute('aria-pressed', 'false');
      }
    });

    autoBtn.addEventListener('click', function () {
      Snd.tap('auto');
      state.auto = !state.auto;
      autoBtn.setAttribute('aria-pressed', state.auto ? 'true' : 'false');
      toast(state.auto ? 'Поворот включён' : 'Поворот выключен');
      if (state.auto) {
        state.drone = false;
        droneBtn.setAttribute('aria-pressed', 'false');
      }
    });
    resetBtn.addEventListener('click', function () {
      Snd.tap('reset');
      resetBtn.classList.remove('tapped');
      void resetBtn.offsetWidth;          // перезапуск анимации
      resetBtn.classList.add('tapped');
      controls.reset();
      toast('Вид сброшен');
      state.idle = false;
      state.auto = false;
      state.drone = false;
      autoBtn.setAttribute('aria-pressed', 'false');
      droneBtn.setAttribute('aria-pressed', 'false');
    });

    var resizeTimer = 0;
    function onResize() {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () { engine.resize(); }, 120);
    }
    global.addEventListener('resize', onResize);
    global.addEventListener('orientationchange', onResize);

    // Счётчик кадров. Текст в DOM пишем 4 раза в секунду, а не 60 —
    // каждое обращение к DOM заставляет браузер пересчитывать страницу.
    var last = 0, fpsAvg = 60, fpsClock = 0;

    function frame(now) {
      global.requestAnimationFrame(frame);

      if (!last) { last = now; return; }
      var dt = now - last;
      last = now;
      if (dt > 100) dt = 100;        // вернулись во вкладку — не прыгаем
      if (dt <= 0) return;

      state.time = now * 0.001;
      controls.update(dt);

      if (Math.abs(TOD - todTarget) > 0.0008) {
        TOD += (todTarget - TOD) * Math.min(1, dt * 0.0028);
        refreshTime(false);
      }
      Snd.updateAmbient();

      /* Пока экран не тронули, камера едет сама — очень медленно, чтобы
         это читалось как дыхание, а не как карусель. */
      if (state.idle && !state.auto && !state.drone) {
        state.yaw += 0.018 * dt * 0.001;
      }

      if (state.drone) {
        droneT += dt * 0.001;
        state.yaw += 0.085 * dt * 0.001;
        state.pitch = 0.34 + 0.21 * Math.sin(droneT * 0.17);
        state.zoom = 1.04 + 0.30 * Math.sin(droneT * 0.12 + 1.2);
      }
      engine.render(state);

      fpsAvg += (1000 / dt - fpsAvg) * 0.08;
      if (now - fpsClock > 250) {
        fpsClock = now;
        fpsEl.textContent = Math.round(fpsAvg) + ' fps';
        engine.setLod(fpsAvg);      // не тянет — рисуем меньше
      }
    }

    global.requestAnimationFrame(frame);
    var hintEl = global.document.getElementById('hint');
    if (hintEl) hintEl.textContent += ' · сборка ' + BUILD;

    /* Время суток не прыгает за пальцем, а ДОГОНЯЕТ его: солнце
       всходит и садится плавно, тени разворачиваются на глазах. Это
       самая заметная анимация во всей сцене, и стоит она почти ничего.

       Небо при этом пересобирается не каждый кадр, а когда время
       уехало заметно: в нижнем слое лежит зерно бумаги, и перерисовка
       его 60 раз в секунду была бы расточительством. */
    /* ПОЛНОЭКРАННЫЙ РЕЖИМ.

       Кнопка прячет всю панель — кадр остаётся чистым, можно снимать.
       Возврат: короткое касание экрана. Именно короткое: если считать
       любое касание, интерфейс будет выскакивать при каждом повороте
       здания пальцем. Поэтому смотрим, сдвинулся ли палец и сколько
       держали. */
    /* РАДИАЛЬНОЕ МЕНЮ.

       Три состояния, и всегда видно ровно одно: закрыто — кольцо —
       своя панель у пункта. Одна и та же кнопка ведёт назад на шаг:
       из панели в кольцо, из кольца в закрытое. Так на телефоне
       не нужно объяснять, как выйти, — выход всегда в одном месте,
       под большим пальцем.

       Касание сцены закрывает всё: меню не должно мешать смотреть. */
    var hud = document.getElementById('hud');
    var hudBtn = document.getElementById('hudBtn');
    var toastEl = document.getElementById('toast');
    var toastT = 0;
    var mode = '';                       // '' | 'ring' | 'sub'

    /* Пилюля вместо подписей под иконками: говорит, что именно
       включилось, и сама уходит через полторы секунды. */
    function toast(text) {
      toastEl.textContent = text;
      toastEl.classList.add('on');
      clearTimeout(toastT);
      toastT = setTimeout(function () { toastEl.classList.remove('on'); }, 1600);
    }

    /* Закрытие анимируется той же волной, что открытие, только в
       обратном порядке. CSS не умеет само по себе анимировать «на
       выход» с задержками (правило .ring работает лишь пока класс
       стоит), поэтому на миг закрытия вешаем .ringOut / .subOut, а
       через время, заведомо большее длительности анимации, снимаем —
       иначе класс мешал бы следующему открытию.  */
    var ringOutT = 0, subOutT = 0;

    function setMenu(m) {
      var prev = mode;
      mode = m;
      if (m !== 'ring') { clearTimeout(toastT); toastEl.classList.remove('on'); }

      if (prev === 'ring' && m !== 'ring') {
        hud.classList.add('ringOut');
        clearTimeout(ringOutT);
        ringOutT = setTimeout(function () { hud.classList.remove('ringOut'); }, 700);
      }
      if (prev === 'sub' && m !== 'sub') {
        hud.classList.add('subOut');
        clearTimeout(subOutT);
        subOutT = setTimeout(function () { hud.classList.remove('subOut'); }, 650);
      }
      if (m === 'ring') { clearTimeout(ringOutT); hud.classList.remove('ringOut'); }
      if (m === 'sub')  { clearTimeout(subOutT);  hud.classList.remove('subOut'); }

      hud.classList.toggle('ring', m === 'ring');
      hud.classList.toggle('sub', m === 'sub');
      document.body.classList.toggle('menu', m !== '');
      hudBtn.setAttribute('aria-expanded', m === '' ? 'false' : 'true');
    }

    hudBtn.addEventListener('click', function () {
      var next = mode === 'sub' ? 'ring' : (mode === '' ? 'ring' : '');
      Snd.tap('menu', next === '' ? 0.85 : 1.15);
      setMenu(next);
    });

    var weatherBtn = document.getElementById('weatherBtn');
    weatherBtn.addEventListener('click', function () {
      Snd.tap('weather');
      setMenu(mode === 'sub' ? 'ring' : 'sub');
    });

    var hideBtn = document.getElementById('hideBtn');
    var uiOff = false;

    function setUI(off) {
      uiOff = off;
      document.body.classList.toggle('ui-off', off);
      if (off && stage.requestFullscreen) {
        try { stage.requestFullscreen({ navigationUI: 'hide' }); } catch (e) {}
      } else if (!off && document.fullscreenElement && document.exitFullscreen) {
        try { document.exitFullscreen(); } catch (e) {}
      }
    }
    hideBtn.addEventListener('click', function () {
      Snd.tap('hide');
      setMenu('');
      toast('Полный экран');
      setUI(true);
    });

    /* Кнопка звука — отдельно от кольца меню: там и так впритык с
       пятью иконками, а звук нужен реже, чем остальное. */
    var soundBtn = document.getElementById('soundBtn');
    function paintSoundBtn() {
      soundBtn.setAttribute('aria-pressed', Snd.isMuted() ? 'false' : 'true');
    }
    soundBtn.addEventListener('click', function () {
      var willUnmute = Snd.isMuted();
      Snd.setMuted(!willUnmute);
      paintSoundBtn();
      if (willUnmute) Snd.tap('sound', 1.15);
    });
    paintSoundBtn();

    var tapX = 0, tapY = 0, tapT = 0;
    stage.addEventListener('pointerdown', function (e) {
      tapX = e.clientX; tapY = e.clientY; tapT = Date.now();
      if (mode !== '') setMenu('');
    });
    stage.addEventListener('pointerup', function (e) {
      if (!uiOff) return;
      var moved = Math.abs(e.clientX - tapX) + Math.abs(e.clientY - tapY);
      if (moved < 12 && Date.now() - tapT < 400) setUI(false);
    });

    var timeEl = document.getElementById('tod');
    var todTarget = TOD, lastBaked = -1;

    function refreshTime(force) {
      applyTime(TOD);
      if (force || Math.abs(TOD - lastBaked) > 0.018) {
        engine.drawPaper();
        lastBaked = TOD;
      }
      document.body.classList.toggle('night', NIGHT > 0.45);

      /* Шарик ползунка — само светило: тёплый днём, холодный ночью. */
      var w1 = [253, 226, 150], w2 = [214, 226, 250];
      var kk = Math.min(1, Math.max(0, (TOD - 0.25) / 0.55));
      document.documentElement.style.setProperty('--thumb',
        'rgb(' + ((w1[0] + (w2[0] - w1[0]) * kk) | 0) + ',' +
                 ((w1[1] + (w2[1] - w1[1]) * kk) | 0) + ',' +
                 ((w1[2] + (w2[2] - w1[2]) * kk) | 0) + ')');
      var me = document.getElementById('moon-edge');
      var se = document.getElementById('sun-edge');
      if (me) me.style.opacity = (0.32 + 0.55 * kk).toFixed(2);
      if (se) se.style.opacity = (0.92 - 0.55 * kk).toFixed(2);
    }

    /* Четыре готовых времени суток. Ползунок — для точной настройки,
       а кнопки — для показа: одно нажатие, и картинка уезжает из утра
       в ночь на глазах, потому что TOD догоняет цель плавно. */
    var chips = document.querySelectorAll('#sub .chip');

    function markChips(v) {
      for (var i = 0; i < chips.length; i++) {
        var d = Math.abs(+chips[i].getAttribute('data-v') - v);
        chips[i].setAttribute('aria-pressed', d < 3 ? 'true' : 'false');
      }
    }

    for (var ci = 0; ci < chips.length; ci++) {
      (function (btn) {
        btn.addEventListener('click', function () {
          var v = +btn.getAttribute('data-v');
          var kMap = { 12: 'morning', 30: 'day', 50: 'dusk', 92: 'night' };
          Snd.tap(kMap[v] || 'day');
          if (timeEl) timeEl.value = v;
          todTarget = v / 100;
          markChips(v);
          toast(btn.textContent);
        });
      })(chips[ci]);
    }

    if (timeEl) {
      todTarget = timeEl.value / 100;
      TOD = todTarget;
      markChips(+timeEl.value);
      timeEl.addEventListener('input', function () {
        todTarget = timeEl.value / 100;
        markChips(+timeEl.value);
      });
    }
    refreshTime(true);

    global.Kukuruznik = {
      engine: engine, state: state, controls: controls,
      build: BUILD, setTime: applyTime, snd: Snd
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

