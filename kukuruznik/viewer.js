/* ==========================================================================================================
   ПРОСМОТРЩИК «3D-фото» — основной скрипт. Вынесен из depth.html в отдельный файл, чтобы браузер мог разбирать и
   компилировать его в фоне (defer), пока показывается приветствие: разбор ~90 КБ JS на слабом телефоне — это
   сотни миллисекунд главного потока. CONFIG и приветствие остаются в самом HTML (они нужны первыми).
   ========================================================================================================== */
(function () {
  'use strict';

  var stage = document.getElementById('stage');
  var canvas = document.getElementById('gl');
  var prevBtn = document.getElementById('prevBtn');
  var nextBtn = document.getElementById('nextBtn');
  var dotsEl = document.getElementById('dots');
  var fbEl = document.getElementById('fallback');
  var panelBtn = document.getElementById('panelBtn');

  // hiddenFrames — кадры-брак, которые не показываем; список точек режем так же
  var HS = [], LAMPS = [];
  var FRAMES = CONFIG.FRAMES.filter(function (_, i) {
    var keep = CONFIG.hiddenFrames.indexOf(i) < 0;
    if (keep) { HS.push(CONFIG.HOTSPOTS[i] || []); LAMPS.push(CONFIG.LAMPS[i] || []); }
    return keep;
  });

  // ---------- общие функции ----------
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  // Пружина как в iOS (response 0.65 с, damping ratio 0.86): ступенчатый отклик, оседание ~0.5%.
  // Время оседания считаем численно; p (0..1) — доля этого времени, поэтому любую длительность
  // (кроссфейд, время суток, возврат в центр) можно прогнать по той же кривой.
  var springTable = (function () {
    var w = 2 * Math.PI / CONFIG.SPRING_RESPONSE, z = CONFIG.SPRING_DAMPING, wd = w * Math.sqrt(1 - z * z);
    function x(t) { return 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + z * w / wd * Math.sin(wd * t)); }
    var T = 0, t;
    for (t = 0; t < 3; t += 0.002) if (Math.abs(1 - x(t)) > 0.0015) T = t;
    var a = [], N = 256, i;
    for (i = 0; i <= N; i++) a.push(x(T * i / N));
    a[N] = 1;
    return a;
  })();
  function EASE(p) {
    p = clamp(p, 0, 1);
    var f = p * 256, i = f | 0;
    return i >= 256 ? 1 : springTable[i] + (springTable[i + 1] - springTable[i]) * (f - i);
  }
  // prefers-reduced-motion: выключаем только фоновое движение (дыхание, облака, птицы); переходы и автопокачивание работают
  var reduceMQ = window.matchMedia('(prefers-reduced-motion: reduce)');
  var motionForce = /[?&]motion=1/.test(location.search);   // ?motion=1 — для проверки: показать всё движение при включённом «Уменьшить движение»
  function reduced() { return reduceMQ.matches && !motionForce; }
  // Сглаживание, не зависящее от частоты кадров: k — доля пути за кадр на 60 fps.
  function lerpK(k, dt) { return 1 - Math.pow(1 - k, dt / 16.667); }

  // ---------- язык (общий с сайтом: тот же ключ localStorage) ----------
  var currentLang = chkaLang();

  var pageTitleEl = document.getElementById('barTitle');
  var langButtons = document.querySelectorAll('#langSeg button');

  function setI18n(el, key) { el.textContent = CONFIG.UI_I18N[key][currentLang]; }

  var wl = null;   // приветствие + загрузка (компонент test-assets/welcome-loader.js) — создаётся ниже, сразу
  function applyLang() {
    var t = CONFIG.UI_I18N;
    setI18n(pageTitleEl, 'title');
    document.getElementById('homeBtn').setAttribute('aria-label', t.home[currentLang]);
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var key = el.getAttribute('data-i18n');
      if (t[key]) setI18n(el, key);
    });
    document.querySelectorAll('[data-i18n-title]').forEach(function (el) {   // подписи кнопок без текста: aria-label и всплывающая подсказка
      var key = el.getAttribute('data-i18n-title');
      if (t[key]) { el.setAttribute('aria-label', t[key][currentLang]); el.title = t[key][currentLang]; }
    });
    if (wl) wl.setLang(currentLang);
    panelBtn.setAttribute('aria-label', t.menu[currentLang]);
    document.title = t.pageTitle[currentLang];
    ['prevSide', 'prevBtn'].forEach(function (id) { document.getElementById(id).setAttribute('aria-label', t.prevFrame[currentLang]); });
    ['nextSide', 'nextBtn'].forEach(function (id) { document.getElementById(id).setAttribute('aria-label', t.nextFrame[currentLang]); });
    // справка о здании: 3 строки из уже утверждённых фактов
    var about = document.getElementById('aboutText');
    about.innerHTML = '';
    ['tower1', 'tower2', 'architects'].forEach(function (k) {
      var pe = document.createElement('p');
      pe.textContent = CONFIG.I18N[k][currentLang];
      about.appendChild(pe);
    });
    langButtons.forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-lang') === currentLang); });
    document.documentElement.lang = currentLang;
  }

  langButtons.forEach(function (b) {
    b.addEventListener('click', function () {
      currentLang = b.getAttribute('data-lang');
      try { localStorage.setItem('chka-lang', currentLang); } catch (e) {}
      applyLang();
      closePopup();
    });
  });
  applyLang();

  // ---------- приветствие и загрузка: появляется сразу, держится, пока всё не загрузится (минимум 3 с), потом плавно уходит сам ----------
  var isTouchDevice = window.matchMedia ? window.matchMedia('(pointer: coarse)').matches
    : (('ontouchstart' in window) || (navigator.maxTouchPoints > 0));
  wl = window.__wl;
  wl.attach(stage);   // с этого момента приветствие только поверх картинки, панель видна

  // iOS даёт запрос на наклон только из обработчика касания. Приветствие больше не ждёт касания (оно уходит само), поэтому запрос
  // идёт при ПЕРВОМ касании чего угодно на странице (click), один раз. Android и ПК разрешения не просят.
  function askTilt() {
    document.removeEventListener('click', askTilt, true);
    DeviceOrientationEvent.requestPermission().then(function (state) {
      if (state === 'granted') startGyro(); // отказ — остаётся управление пальцем
    }).catch(function (err) { console.warn('Гироскоп: разрешение не выдано —', err && err.message); });
  }
  if (typeof DeviceOrientationEvent !== 'undefined' && isTouchDevice) {
    if (window.isSecureContext === false) console.warn('Гироскоп недоступен: страница открыта не по https (небезопасный контекст).');
    else if (typeof DeviceOrientationEvent.requestPermission === 'function') document.addEventListener('click', askTilt, true);
  }

  // ---------- WebGL (если нет — остаётся двухслойный DOM-вариант) ----------
  var wantGL = !/[?&]nogl=1/.test(location.search); // ?nogl=1 — принудительно проверить откат
  var gl = null;
  if (wantGL) {
    gl = canvas.getContext('webgl', { antialias: false, alpha: false, premultipliedAlpha: false })
      || canvas.getContext('experimental-webgl');
  }
  var useGL = !!gl;
  if (!useGL) canvas.style.display = 'none';

  // Кадр = два слоя, оба берутся из одного цельного набора:
  //  • фон и земля (bg — кадр без здания) сдвигаются попиксельно по карте
  //    глубины (X и Y), карта заранее размыта (prepareDepth);
  //  • здание (вырезка по маске SAM) двигается ЦЕЛИКОМ — один общий сдвиг
  //    по его средней глубине, поэтому башня никогда не гнётся.
  // Первый проход рисует сцену в текстуру (цвет + маска окон в альфе),
  // второй — время суток (закат/ночь) поверх готовой картинки.
  var VERT = [
    'attribute vec2 aPos;',
    'varying vec2 vUv;',   // координаты картинки (y вниз)
    'varying vec2 vTc;',   // координаты текстуры (y вверх)
    'void main() {',
    '  vTc = aPos * 0.5 + 0.5;',
    '  vUv = vec2(vTc.x, 1.0 - vTc.y);',
    '  gl_Position = vec4(aPos, 0.0, 1.0);',
    '}'
  ].join('\n');

  // Закат и ночь (v10–v11) — картинки, а не процедурные: на кадр по две текстуры на состояние («земля» с подложкой и башня),
  // с днём 8 юнитов на кадр, 16 на два кадра при переходе. Если видеокарта даёт меньше — картинки не используются
  // (откат на закат и ночь v8).
  var NI = useGL && gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) >= 16;
  var UB0 = NI ? 8 : 4;   // первый юнит кадра B
  function vec3lit(a) { return 'vec3(' + a.map(function (x) { return x.toFixed(4); }).join(',') + ')'; }
  var SCENE_FRAG = [
    'precision highp float;',
    'varying vec2 vUv;',
    // день (v12): цвета неба и настройки зелени — из CONFIG.DAY
    'const vec3 DAY_SKY_TOP = ' + vec3lit(CONFIG.DAY.SKY_TOP) + ';',
    'const vec3 DAY_SKY_HOR = ' + vec3lit(CONFIG.DAY.SKY_HOR) + ';',
    'const float GREEN_HUE = ' + CONFIG.DAY.GREEN_HUE.toFixed(4) + ';',
    'const float GREEN_PULL = ' + CONFIG.DAY.GREEN_PULL.toFixed(4) + ';',
    'const float GREEN_SAT = ' + CONFIG.DAY.GREEN_SAT.toFixed(4) + ';',
    'const float DAY_MIX = ' + CONFIG.DAY.MIX.toFixed(4) + ';',   // 0 — как v11, 1 — как v12
    'uniform vec2 uCloudK;',      // сила тени облаков на кадрах A и B
    'uniform vec4 uSkyRef;',      // кадр A: яркость исходной вымывки неба (x) и нижняя граница неба, доля высоты (y); кадр B — z, w
    // на кадр: земля (0), карта глубины+окружения (1), здание (2), окна (3)
    'uniform sampler2D uBgA; uniform sampler2D uDepthA; uniform sampler2D uBldA; uniform sampler2D uEmA;',
    'uniform sampler2D uBgB; uniform sampler2D uDepthB; uniform sampler2D uBldB; uniform sampler2D uEmB;',
    NI ? 'uniform sampler2D uSGA; uniform sampler2D uSBA; uniform sampler2D uNGA; uniform sampler2D uNBA;' : '',   // кадр A: закат (земля, башня), ночь (земля, башня)
    NI ? 'uniform sampler2D uSGB; uniform sampler2D uSBB; uniform sampler2D uNGB; uniform sampler2D uNBB;' : '',   // кадр B
    NI ? 'uniform vec2 uHasA; uniform vec2 uHasB;' : '',         // x — есть картинка заката, y — есть картинка ночи
    NI ? 'uniform float uSunMix; uniform float uNightMix;' : '', // день→закат (2.5 с), закат→ночь (3 с): плавное растворение
    'uniform vec4  uCropA; uniform vec4 uCropB; uniform vec4 uFlagA; uniform vec4 uFlagB;',   // обрезка кадров A/B: x0, y0, ширина, высота (доли)
    'uniform vec2  uKdA;',        // здание кадра A: x = k (-1..1), y = средняя глубина 0..1
    'uniform vec2  uKdB;',
    'uniform vec2  uStarQ;',      // доля ячеек со звездой для кадров A/B (зависит от площади неба)
    'uniform float uMix;',        // 0 = кадр A, 1 = кадр B
    'uniform vec2  uShift;',      // max-сдвиг * наклон + «дыхание», в долях картинки
    'uniform float uZoom;',       // добавка к масштабу для самых ближних (0..0.02)
    'uniform float uScale;',      // общий масштаб (1.05), чтобы не видеть краёв
    'uniform vec2  uCoverScale;', // "cover"-обрезка кадра под экран
    'uniform vec2  uCoverOffset;',
    'uniform float uTime;',        // настоящее время (ветер, мерцание звёзд)
    'uniform float uCloudT;',      // время облаков (замирает при «уменьшении движения»)
    'uniform float uSunset;',     // 0..1
    'uniform float uNightSky;',   // небо темнеет первым (0..1)
    'uniform float uNightGnd;',   // потом земля
    'uniform float uStars;',      // звёзды проявляются последними
    'uniform vec2  uFadeZoom;',   // масштаб уходящего/приходящего кадра при переходе
    'uniform float uAspect;',     // ширина/высота экрана
    'uniform float uWindAmp;',    // амплитуда ветра на макушке дерева, в долях картинки
    'uniform float uWindOn;',     // 1 — ветер включён
    'uniform vec2  uCellPx;',     // размер ячейки звёздной сетки в пикселях экрана
    'uniform vec4  uShoot;',      // падающая звезда: старт xy (экран 0..1), направление xy
    'uniform vec2  uShootP;',     // x = прогресс 0..1 (<0 — нет), y = длина пролёта
    '',
    'float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }',
    'vec3 rgb2hsv(vec3 c) {',
    '  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);',
    '  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));',
    '  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));',
    '  float d = q.x - min(q.w, q.y);',
    '  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);',
    '}',
    'vec3 hsv2rgb(vec3 c) {',
    '  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);',
    '  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);',
    '  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);',
    '}',
    // Мягкое пятно тени от облака: смещённый и чуть "разлохмаченный"
    // синусами круг, край размыт smoothstep — не ровный диск.
    'float blob(vec2 uv, vec2 center, vec2 radius) {',
    '  vec2 d = (uv - center) / radius;',
    '  float wobble = 0.15 * sin(d.x * 6.0 + center.x * 9.0) * sin(d.y * 5.0 + center.y * 7.0);',
    '  float dist = length(d) + wobble;',
    '  return smoothstep(1.0, 0.15, dist);',
    '}',
    // Две тени от облаков не спеша ползут по кадру слева направо,
    // один полный проход ~40с, без всякой другой анимации.
    'float cloudShadow(vec2 uv, float t) {',
    '  float cycle1 = 40.0;',
    '  float p1 = fract(t / cycle1);',
    '  float b1 = blob(uv, vec2(mix(-0.35, 1.35, p1), 0.58), vec2(0.30, 0.17));',
    '  float cycle2 = 53.0;',
    '  float p2 = fract((t + cycle1 * 0.5) / cycle2);',
    '  float b2 = blob(uv, vec2(mix(-0.35, 1.35, p2), 0.32), vec2(0.22, 0.13));',
    '  return clamp(b1 + b2, 0.0, 1.0);',
    '}',
    '',
    // Готовый цвет пикселя одного кадра: параллакс, ветер, закат, ночь.
    'vec4 shadeFrame(sampler2D bg, sampler2D depth, sampler2D bld, sampler2D em, vec2 kd, float starQ, vec2 skyRef, vec4 crop, vec4 flag,' + (NI ? ' sampler2D sg, sampler2D sb, sampler2D ng, sampler2D nb, vec2 has,' : '') + ' vec2 uv, vec2 sc) {',
    '  uv = crop.xy + uv * crop.zw;',   // обрезка белого края бумаги: показываем только внутренний прямоугольник кадра
    // фон и земля: у каждого пикселя свой сдвиг (3 итерации против «резины» на краях)
    '  vec2 p = uv;',
    '  for (int i = 0; i < 3; i++) {',
    '    float d = texture2D(depth, p).r;',                  // 0 = далеко, 1 = близко
    '    float k = d * 2.0 - 1.0;',                           // -1..1, 0 — плоскость фокуса
    '    p = 0.5 + (uv - 0.5) / (1.0 + uZoom * d) - k * uShift;',
    '  }',
    '  vec4 env = texture2D(depth, p);',                      // r глубина, g небо, b высота дерева, a фаза дерева
    // ветер: чем выше точка дерева, тем сильнее сдвиг; корень неподвижен; у каждого дерева своя фаза и период 5–7 с
    '  if (uWindOn > 0.5 && env.b > 0.004) {',
    '    float per = 5.0 + 2.0 * fract(env.a * 7.13);',
    '    p.x += uWindAmp * env.b * sin(uTime * 6.2832 / per + env.a * 19.0);',
    '  }',
    // флаги колышутся: небольшая волна только внутри прямоугольника флага
    '  if (flag.z > 0.0 && uWindOn > 0.5 && p.x > flag.x && p.x < flag.x + flag.z && p.y > flag.y && p.y < flag.y + flag.w) {',
    '    p.y += 0.0011 * sin(uTime * 3.4 + p.x * 210.0);',
    '    p.x += 0.0008 * sin(uTime * 2.7 + p.y * 300.0);',
    '  }',
    '  vec2 pc = clamp(p, 0.0, 1.0);',
    '  vec3 c = texture2D(bg, pc).rgb;',
    '  float sky = env.g;',
    '  vec4 eg = texture2D(em, pc);',                         // окна других зданий: g = свет ночью, a = сама маска
    // здание: один общий сдвиг и масштаб на весь предмет — жёсткое тело
    '  vec2 pb = 0.5 + (uv - 0.5) / (1.0 + uZoom * kd.y) - kd.x * uShift;',
    '  vec4 b = texture2D(bld, pb);',                         // цвет уже умножен на альфу
    '  vec4 eb = texture2D(em, pb);',                         // окна башни: r = свет ночью, b = сама маска
    '  c = b.rgb + c * (1.0 - b.a);',
    '  float inv = 1.0 - b.a;',
    '  sky *= inv;',
    // ---- день (v12): небо светло-голубое, зелень насыщеннее. Рисунок (штрих, мазки, облака, бумага) сохраняется: небо — умножением
    // на голубой, зелень — сдвигом оттенка и насыщенности только у жёлто-зелёных тонов. Закат и ночь — свои картинки, ниже. ----
    '  {',
    '    vec3 cOrig = c;',
    '    float lum0 = dot(c, vec3(0.299, 0.587, 0.114));',
    '    float rel = lum0 / skyRef.x;',                                                     // 1 — вымывка неба, >1 облако, <1 штрих
    '    vec3 skyCol = mix(DAY_SKY_TOP, DAY_SKY_HOR, smoothstep(0.02, 0.42, uv.y));',
    '    vec3 tinted = skyCol * clamp(rel, 0.0, 1.06);',
    '    tinted = mix(tinted, vec3(min(1.0, lum0 * 1.05 + 0.02)), smoothstep(1.03, 1.12, rel) * 0.75);',   // облака остаются белыми
    // светлая «бумажная» кромка вырезки здания (несколько пикселей вокруг контура): у дневного неба она была незаметна, у голубого — видна;
    // краевые пиксели вырезки, светлые как небо, красим в цвет неба
    '    float haloW = 0.0;',
    '    if (b.a > 0.05 && b.a < 0.999 || (b.a >= 0.999 && rel > 0.90)) {',
    '      vec2 hd = vec2(4.5 / 768.0, 4.5 / 1365.0);',
    '      float mn = min(min(texture2D(bld, pb + vec2(hd.x, 0.0)).a, texture2D(bld, pb - vec2(hd.x, 0.0)).a), min(texture2D(bld, pb + vec2(0.0, hd.y)).a, texture2D(bld, pb - vec2(0.0, hd.y)).a));',
    '      haloW = (1.0 - smoothstep(0.3, 0.95, mn)) * smoothstep(0.90, 1.02, rel);',
    '    }',
    // такая же светлая кромка вокруг деревьев и предметов у неба: пиксели рядом с маской неба (в пределах ~4–8 пикселей кадра), светлые как небо
    '    float ringW = 0.0;',
    '    if (sky < 0.5 && rel > 0.92) {',
    '      vec2 e1 = vec2(2.0 / 384.0, 2.0 / 683.0), e2 = e1 * 2.0;',
    '      float sn = max(max(texture2D(depth, p + vec2(e1.x, 0.0)).g, texture2D(depth, p - vec2(e1.x, 0.0)).g), max(texture2D(depth, p + vec2(0.0, e1.y)).g, texture2D(depth, p - vec2(0.0, e1.y)).g));',
    '      sn = max(sn, max(max(texture2D(depth, p + vec2(e2.x, 0.0)).g, texture2D(depth, p - vec2(e2.x, 0.0)).g), max(texture2D(depth, p + vec2(0.0, e2.y)).g, texture2D(depth, p - vec2(0.0, e2.y)).g)));',
    '      ringW = smoothstep(0.3, 0.8, sn) * (1.0 - inv * 0.0) * smoothstep(0.92, 1.0, rel);',
    '    }',
    '    float skyW = max(max(smoothstep(0.35, 0.85, sky), haloW), ringW);',
    '    skyW *= (1.0 - smoothstep(0.10, 0.19, c.r - c.b)) * (1.0 - smoothstep(skyRef.y - 0.03, skyRef.y + 0.01, uv.y)) * (1.0 - smoothstep(0.12, 0.28, env.r));',   // и не ближе неба по глубине (маска местами заходит на башню)                                // тёплые дальние холмы остаются тёплыми
    '    c = mix(c, mix(c, tinted, smoothstep(0.55, 0.85, rel)), skyW);',                // тёмный карандашный штрих — как был
    '    vec3 hv = rgb2hsv(c);',
    '    float gw = smoothstep(0.10, 0.16, hv.x) * (1.0 - smoothstep(0.36, 0.45, hv.x)) * smoothstep(0.06, 0.16, hv.y) * smoothstep(0.18, 0.40, hv.z) * (1.0 - skyW);',
    '    hv.x = mix(hv.x, GREEN_HUE, gw * GREEN_PULL);',
    '    hv.y = clamp(hv.y * (1.0 + gw * (GREEN_SAT - 1.0)) + gw * 0.05, 0.0, 1.0);',
    '    c = mix(c, hsv2rgb(hv), step(0.001, gw));',
    '    c = mix(cOrig, c, DAY_MIX);',
    '  }',
    '  float winNight = eb.r * b.a + eg.g * inv;',
    '  float winBase = max(eb.b * b.a, eg.a * inv);',
    NI ? '  float hasSv = has.x, hasNv = has.y;' : '  float hasSv = 0.0, hasNv = 0.0;',
    // ---- закат: тёплый оранжево-розовый тон, свечение с одной стороны, окна отражают закат ----
    '  if (uSunset > 0.001 && hasSv < 0.5) {',
    '    vec3 warm = c * vec3(1.05, 0.87, 0.68);',
    '    vec3 skyTint = mix(vec3(1.0, 0.60, 0.64), vec3(1.0, 0.68, 0.40), smoothstep(0.10, 0.62, sc.y));',
    '    warm = mix(warm, c * skyTint * 1.02 + skyTint * 0.05, sky * 0.85);',
    '    vec2 gd = (sc - vec2(1.08, 0.52)) * vec2(uAspect * 0.9, 1.0);',
    '    warm += vec3(1.0, 0.52, 0.22) * exp(-dot(gd, gd) * 5.0) * 0.24;',
    '    warm += vec3(1.0, 0.74, 0.44) * winBase * 0.22;',
    '    c = mix(c, warm, uSunset);',
    '  }',
    // ---- ночной кадр-картинка: дневной кадр плавно растворяется в ночной (земля — в координатах фона, башня — в своих) ----
    // закат-картинка: день растворяется в закат (земля — в координатах фона, башня — в своих)
    NI ? '  if (hasSv > 0.5 && uSunMix > 0.001) c = mix(c, texture2D(sb, pb).rgb * b.a + texture2D(sg, pc).rgb * inv, uSunMix);' : '',
    // ночь-картинка: закат (или день) растворяется в ночь; тёмное темнее (CONFIG.NIGHT_DIM), свет окон и фонарей — как нарисован
    NI ? '  if (hasNv > 0.5 && uNightMix > 0.001) {' : '',
    NI ? '    vec3 cn = texture2D(nb, pb).rgb * b.a + texture2D(ng, pc).rgb * inv;' : '',
    NI ? '    cn *= mix(' + CONFIG.NIGHT_DIM.toFixed(3) + ', 1.0, smoothstep(0.30, 0.60, dot(cn, vec3(0.299, 0.587, 0.114))));' : '',
    NI ? '    c = mix(c, cn, uNightMix);' : '',
    NI ? '  }' : '',
    // ---- ночь: без картинки вся сцена тёмно-синяя (30–35%), небо темнее земли, огни; звёзды — поверх всегда ----
    '  if (uNightSky > 0.001 || uNightGnd > 0.001 || uStars > 0.001) {',
    '    vec3 nc = hasNv > 0.5 ? c : mix(mix(c, c * vec3(0.27, 0.34, 0.56), uNightGnd), mix(c, c * vec3(0.14, 0.20, 0.40), uNightSky), sky);',
    '    float star = 0.0;',
    '    if (sky > 0.02 && starQ > 0.0) {',
    '      vec2 g = pc * vec2(32.0, 57.0);',
    '      vec2 cell = floor(g);',
    '      if (h21(cell) < starQ) {',
    '        vec2 sp = vec2(0.15 + 0.7 * h21(cell + 7.3), 0.15 + 0.7 * h21(cell + 19.1));',
    '        float r = 0.5 + 1.0 * h21(cell + 3.7);',                    // радиус 0.5–1.5 px
    '        float dpx = length((fract(g) - sp) * uCellPx);',
    '        float per = 3.0 + 4.0 * h21(cell + 11.9);',                // мерцание: период 3–7 с
    '        float tw = 0.62 + 0.38 * sin(uTime * 6.2832 / per + h21(cell + 5.5) * 6.2832);',
    '        star = smoothstep(r, 0.0, dpx) * tw * (0.55 + 0.45 * h21(cell + 2.2));',
    '      }',
    '    }',
    '    if (uShootP.x >= 0.0) {',                                        // падающая звезда (в экранных координатах)
    '      vec2 head = uShoot.xy + uShoot.zw * uShootP.y * uShootP.x;',
    '      vec2 tl = uShoot.zw * 0.11;',
    '      vec2 pa = (sc - (head - tl)) * vec2(uAspect, 1.0);',
    '      vec2 ba = tl * vec2(uAspect, 1.0);',
    '      float hh = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);',
    '      star += smoothstep(0.004, 0.0, length(pa - ba * hh)) * hh * sin(3.1416 * uShootP.x) * 1.5;',
    '    }',
    '    nc += vec3(0.86, 0.92, 1.0) * star * sky * uStars;',
    '    nc += vec3(1.0, 0.80, 0.42) * winNight * 1.05 + vec3(1.0, 0.70, 0.30) * winNight * winNight * 0.25;',
    '    c = nc;',
    '  }',
    '  return vec4(c, sky);',   // a — доля неба в точке (тень облака на небо не кладём)
    '}',
    '',
    'void main() {',
    '  vec2 uv = vUv * uCoverScale + uCoverOffset;',
    '  uv = 0.5 + (uv - 0.5) / uScale;',
    '  vec2 uvA = 0.5 + (uv - 0.5) / uFadeZoom.x;',
    '  vec4 sa = shadeFrame(uBgA, uDepthA, uBldA, uEmA, uKdA, uStarQ.x, uSkyRef.xy, uCropA, uFlagA, ' + (NI ? 'uSGA, uSBA, uNGA, uNBA, uHasA, ' : '') + 'uvA, vUv);',
    '  if (uMix > 0.0) {',
    '    vec2 uvB = 0.5 + (uv - 0.5) / uFadeZoom.y;',
    '    sa = mix(sa, shadeFrame(uBgB, uDepthB, uBldB, uEmB, uKdB, uStarQ.y, uSkyRef.zw, uCropB, uFlagB, ' + (NI ? 'uSGB, uSBB, uNGB, uNBB, uHasB, ' : '') + 'uvB, vUv), uMix);',
    '  }',
    '  vec3 c = sa.rgb;',
    '  float shadow = cloudShadow(uv, uCloudT);',
    '  c *= (1.0 - mix(uCloudK.x, uCloudK.y, uMix) * shadow * (1.0 - sa.a) * (1.0 - uNightGnd));',
    '  gl_FragColor = vec4(c, 1.0);',
    '}'
  ].join('\n');

  // Второй проход: длинные тени на закате и фонари ночью (тёплый ореол + светлое пятно на земле).
  var POST_FRAG = [
    'precision highp float;',
    'varying vec2 vTc;',
    'uniform sampler2D uScene;',
    'uniform float uSunset;',   // 0..1
    'uniform float uNight;',    // 0..1
    'uniform float uAspect;',
    'uniform vec3 uLampH[16];', // ореол у лампы: x,y (текстурные координаты), z = яркость
    'uniform vec3 uLampB[16];', // пятно света на земле под лампой
    'float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }',
    'void main() {',
    '  vec3 c = texture2D(uScene, vTc).rgb;',
    '  if (uSunset > 0.001) {',
    // тени длиннее: тёмное «стекает» вдоль направления от низкого солнца
    '    vec2 dir = vec2(1.0, -0.28) * 0.012;',
    '    float smear = 0.0;',
    '    for (int i = 1; i <= 10; i++) {',
    '      vec3 tap = texture2D(uScene, vTc - dir * float(i)).rgb;',
    '      smear += smoothstep(0.62, 0.30, lum(tap)) * (1.0 - float(i) / 11.0);',
    '    }',
    '    smear = clamp(smear / 4.0, 0.0, 1.0);',
    '    float l = lum(c);',
    '    vec3 dk = c * (1.0 - 0.5 * smear) * mix(1.0, 0.68, smoothstep(0.50, 0.22, l));',   // длинные и темнее
    '    c = mix(c, dk, uSunset);',
    '  }',
    '  if (uNight > 0.001) {',
    '    for (int i = 0; i < 16; i++) {',
    '      vec3 lh = uLampH[i];',
    '      if (lh.z > 0.001) {',
    '        vec2 d = (vTc - lh.xy) * vec2(uAspect, 1.0);',
    '        float r2 = dot(d, d);',
    '        c += vec3(1.0, 0.74, 0.36) * (exp(-r2 / 0.00016) * 0.85 + exp(-r2 / 0.0020) * 0.20) * lh.z;',
    '      }',
    '      vec3 lb = uLampB[i];',
    '      if (lb.z > 0.001) {',
    '        vec2 d = vTc - lb.xy;',
    '        d.x *= uAspect;',
    '        c += vec3(1.0, 0.82, 0.5) * exp(-(d.x * d.x / 0.0010 + d.y * d.y / 0.00012)) * lb.z * 0.24;',
    '      }',
    '    }',
    '  }',
    '  gl_FragColor = vec4(c, 1.0);',
    '}'
  ].join('\n');

  var scenePrg = null, postPrg = null;
  var US = {}, UP = {};
  var fbo = null, sceneTex = null, fboW = 0, fboH = 0;

  var parExt = useGL ? gl.getExtension('KHR_parallel_shader_compile') : null;   // компиляция в фоне, если умеет браузер

  function compileShader(type, src) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    return sh;
  }
  function startProgram(frag) {   // компиляция и линковка запускаются, но не ждём ответа драйвера
    var prog = gl.createProgram(), vs = compileShader(gl.VERTEX_SHADER, VERT), fs = compileShader(gl.FRAGMENT_SHADER, frag);
    gl.attachShader(prog, vs); gl.attachShader(prog, fs);
    gl.bindAttribLocation(prog, 0, 'aPos');
    gl.linkProgram(prog);
    return { prog: prog, vs: vs, fs: fs };
  }
  function finishProgram(h, names, out) {   // готово? -> проверяем ошибки, берём адреса uniform-ов
    if (!gl.getProgramParameter(h.prog, gl.LINK_STATUS)) {
      throw new Error((gl.getShaderInfoLog(h.vs) || '') + (gl.getShaderInfoLog(h.fs) || '') + (gl.getProgramInfoLog(h.prog) || ''));
    }
    gl.useProgram(h.prog);
    names.forEach(function (n) { out[n] = gl.getUniformLocation(h.prog, n); });
    return h.prog;
  }
  function whenCompiled(hs) {   // ждём в фоне, короткими проверками (без блокировки главного потока)
    return new Promise(function (res) {
      (function poll() {
        var done = !parExt || hs.every(function (h) { return gl.getProgramParameter(h.prog, parExt.COMPLETION_STATUS_KHR); });
        if (done) res(); else setTimeout(poll, 30);
      })();
    });
  }

  var SCENE_NAMES = ['uBgA', 'uDepthA', 'uBldA', 'uEmA', 'uBgB', 'uDepthB', 'uBldB', 'uEmB',
    'uKdA', 'uKdB', 'uSkyRef', 'uCloudK', 'uCropA', 'uCropB', 'uFlagA', 'uFlagB', 'uStarQ', 'uMix', 'uShift', 'uZoom', 'uScale', 'uCoverScale', 'uCoverOffset', 'uTime', 'uCloudT',
    'uSunset', 'uNightSky', 'uNightGnd', 'uStars', 'uFadeZoom', 'uAspect', 'uWindAmp', 'uWindOn', 'uCellPx', 'uShoot', 'uShootP']
    .concat(NI ? ['uSGA', 'uSBA', 'uNGA', 'uNBA', 'uSGB', 'uSBB', 'uNGB', 'uNBB', 'uHasA', 'uHasB', 'uSunMix', 'uNightMix'] : []);

  function initGLProgram() {   // возвращает Promise: шейдеры компилируются в фоне, приветствие и анимации не замирают
    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    var hs = startProgram(SCENE_FRAG), hp = startProgram(POST_FRAG);
    return whenCompiled([hs, hp]).then(function () {
      scenePrg = finishProgram(hs, SCENE_NAMES, US);
      // юниты: кадр A = 0..7 (земля, глубина+окружение, здание, окна, закат: земля/башня, ночь: земля/башня),
      // кадр B = 8..15. Сами текстуры подставляются при отрисовке — подгрузки во время показа нет.
      var uA = ['uBgA', 'uDepthA', 'uBldA', 'uEmA', 'uSGA', 'uSBA', 'uNGA', 'uNBA'], uB = ['uBgB', 'uDepthB', 'uBldB', 'uEmB', 'uSGB', 'uSBB', 'uNGB', 'uNBB'];
      uA.forEach(function (n, i) { if (US[n]) gl.uniform1i(US[n], i); });
      uB.forEach(function (n, i) { if (US[n]) gl.uniform1i(US[n], i + UB0); });
      gl.uniform1f(US.uScale, CONFIG.BASE_SCALE);
      postPrg = finishProgram(hp, ['uScene', 'uSunset', 'uNight', 'uAspect', 'uLampH', 'uLampB'], UP);
      gl.uniform1i(UP.uScene, 0);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      fbo = null; sceneTex = null; fboW = 0; fboH = 0;
    });
  }

  function makeTexture(filter) {
    var tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    return tex;
  }

  function uploadL(d) { // одноканальная карта
    var tex = makeTexture(gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, d.w, d.h, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, d.d);
    return tex;
  }

  // Заливает в GPU данные кадра, подготовленные воркером (prep.js): типизированные массивы. Каждая текстура — отдельной
  // короткой задачей (между ними пауза), чтобы главный поток не замирал: приветствие и анимации идут плавно.
  function tick() { return new Promise(function (r) { setTimeout(r, 0); }); }
  function texRGB(w, h, data) {
    var t = makeTexture(gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, w, h, 0, gl.RGB, gl.UNSIGNED_BYTE, data);
    return t;
  }
  function texRGBA(w, h, data) {
    var t = makeTexture(gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    return t;
  }
  function uploadDay(f, r) {
    var steps = [
      function () { f.bgTex = texRGB(r.w, r.h, r.ground); },                 // земля: кадр с подложкой на месте здания
      function () { f.depthTex = texRGBA(r.ew, r.eh, r.gpuDepth); },         // R глубина, G небо, B высота дерева, A фаза (вдвое мельче)
      function () { f.bldTex = texRGBA(r.w, r.h, r.bldPm); },                // здание, цвет уже умножен на альфу
      function () { f.emTex = texRGBA(r.ew, r.eh, r.emis); }                 // окна: R/G свет ночью (башня/другие здания), B/A сами маски
    ];
    return steps.reduce(function (p, st) { return p.then(function () { st(); return tick(); }); }, Promise.resolve());
  }
  function uploadState(f, kind, r) {   // kind: 's' закат | 'n' ночь; ground — земля, full — вся картинка (башня берётся по альфе дня)
    f[kind + 'G'] = texRGB(r.w, r.h, r.ground);
    return tick().then(function () { f[kind + 'B'] = texRGB(r.w, r.h, r.full); return tick(); });
  }

  function uploadEm(f) {
    if (!f || !f.emDirty) return;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, f.emTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, f.ew, f.eh, gl.RGBA, gl.UNSIGNED_BYTE, f.emis);
    f.emDirty = false;
  }

  function bindFrame(f, unit0) {
    var t = [f.bgTex, f.depthTex, f.bldTex, f.emTex];
    for (var i = 0; i < 4; i++) {
      gl.activeTexture(gl.TEXTURE0 + unit0 + i);
      gl.bindTexture(gl.TEXTURE_2D, t[i]);
    }
    if (NI) {   // закат и ночь: юниты +4..+7; если картинки ещё нет — заглушка (шейдер её не читает: has = 0)
      var st = [f.sG || f.bgTex, f.sB || f.bgTex, f.nG || f.bgTex, f.nB || f.bgTex];
      for (i = 0; i < 4; i++) {
        gl.activeTexture(gl.TEXTURE0 + unit0 + 4 + i);
        gl.bindTexture(gl.TEXTURE_2D, st[i]);
      }
    }
  }

  function ensureFbo(w, h) {
    if (fbo && fboW === w && fboH === h) return;
    if (sceneTex) gl.deleteTexture(sceneTex);
    if (fbo) gl.deleteFramebuffer(fbo);
    sceneTex = makeTexture(gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, sceneTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    fboW = w; fboH = h;
  }

  // s = состояние кадра: fa/fb (готовые кадры), mix, shiftX/Y, zoom, t
  function drawGL(fa, fb, mix, shiftX, shiftY, zoom, t, tAmb) {
    ensureFbo(canvas.width, canvas.height);
    gl.viewport(0, 0, canvas.width, canvas.height);
    uploadEm(fa); uploadEm(fb);
    var aspect = canvas.width / canvas.height, visW = coverUvW / CONFIG.BASE_SCALE, visH = coverUvH / CONFIG.BASE_SCALE;
    // --- проход 1: сцена (параллакс, ветер, закат, ночь) -> текстура ---
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.useProgram(scenePrg);
    bindFrame(fa, 0);
    if (fb) bindFrame(fb, UB0);
    gl.uniform4fv(US.uCropA, fa.crop); gl.uniform4fv(US.uFlagA, fa.flag);
    gl.uniform2f(US.uKdA, fa.kB, fa.dB);
    if (fb) { gl.uniform2f(US.uKdB, fb.kB, fb.dB); gl.uniform4fv(US.uCropB, fb.crop); gl.uniform4fv(US.uFlagB, fb.flag); }
    gl.uniform2f(US.uStarQ, fa.starQ, fb ? fb.starQ : 0);
    gl.uniform2f(US.uCloudK, CONFIG.CLOUD_SHADOW[fa.idx] || 0.12, fb ? (CONFIG.CLOUD_SHADOW[fb.idx] || 0.12) : 0.12);
    gl.uniform4f(US.uSkyRef, CONFIG.DAY.SKY_REF[fa.idx] || 0.86, CONFIG.DAY.SKY_END[fa.idx] || 0.55,
      fb ? (CONFIG.DAY.SKY_REF[fb.idx] || 0.86) : 0.86, fb ? (CONFIG.DAY.SKY_END[fb.idx] || 0.55) : 0.55);
    if (NI) {
      gl.uniform2f(US.uHasA, fa.sG ? 1 : 0, fa.nG ? 1 : 0); gl.uniform2f(US.uHasB, fb && fb.sG ? 1 : 0, fb && fb.nG ? 1 : 0);
      gl.uniform1f(US.uSunMix, tod.sun); gl.uniform1f(US.uNightMix, tod.night);
    }
    gl.uniform2f(US.uShift, shiftX, shiftY);
    gl.uniform1f(US.uZoom, zoom);
    gl.uniform1f(US.uMix, mix);
    gl.uniform1f(US.uTime, tAmb);
    gl.uniform1f(US.uCloudT, t);
    gl.uniform1f(US.uSunset, tod.s);
    gl.uniform1f(US.uNightSky, tod.sky);
    gl.uniform1f(US.uNightGnd, tod.gnd);
    gl.uniform1f(US.uStars, tod.stars);
    gl.uniform2f(US.uFadeZoom, fx.zoomA, fx.zoomB);
    gl.uniform1f(US.uAspect, aspect);
    gl.uniform1f(US.uWindAmp, fx.windAmp);
    gl.uniform1f(US.uWindOn, fx.windOn ? 1 : 0);
    gl.uniform2f(US.uCellPx, canvas.width / (32 * visW), canvas.height / (57 * visH));
    gl.uniform4f(US.uShoot, fx.shoot[0], fx.shoot[1], fx.shoot[2], fx.shoot[3]);
    gl.uniform2f(US.uShootP, fx.shootP, fx.shootLen);
    gl.uniform2f(US.uCoverScale, coverUvW, coverUvH);
    gl.uniform2f(US.uCoverOffset, coverOffX, coverOffY);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    // --- проход 2: длинные тени (закат) и фонари (ночь) -> экран ---
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.useProgram(postPrg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sceneTex);
    gl.uniform1f(UP.uSunset, (NI && fa.sG && (!fb || fb.sG)) ? 0 : tod.s);   // длинные тени процедурного заката; у закатной картинки они нарисованы
    gl.uniform1f(UP.uNight, tod.lights);
    gl.uniform1f(UP.uAspect, aspect);
    gl.uniform3fv(UP.uLampH, fx.lampH);
    gl.uniform3fv(UP.uLampB, fx.lampB);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  var glLost = false, glReadyP = Promise.resolve();
  var tod = { p: 0, s: 0, sky: 0, gnd: 0, stars: 0, lights: 0, night: 0, sun: 0 }; // время суток; p: 0 день, 1 закат, 2.17 ночь
  if (useGL) {
    glReadyP = initGLProgram();
    glReadyP.catch(function (err) { console.warn('WebGL shader failed, fallback:', err); });
    canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); glLost = true; });
    canvas.addEventListener('webglcontextrestored', function () {
      try {
        glReadyP = initGLProgram();
        // текстуры заново: CPU-копии картинок мы не держим (память iPhone) — прогоняем конвейер заново, начиная с видимого кадра
        var keep = frameIndex;
        store.length = 0; dayP = []; stateP = [];
        loadDay(keep).then(function () { resize(true); glLost = false; startBackground(); });
      } catch (err) { console.warn('WebGL restore failed', err); }
    });
  }

  // (загрузка и подготовка кадров — в конце файла, «старт»; тяжёлая обработка — в prep.js, в Web Worker)

  function rng(seed) { // mulberry32: одинаковые «случайные» окна при каждом запуске
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function rand(R, a, b) { return a + (b - a) * R(); }

  // Свет окон на текущий момент: ночь (0..1) со сдвигом по окнам, свои включения/выключения.
  // Возвращает true, если поменялись пиксели (тогда текстуру окон нужно залить в GPU).
  function updateWindows(f, night, nowMs) {
    var dirty = false, e = f.emis, ch;
    for (var i = 0; i < f.wins.length; i++) {
      var w = f.wins[i];
      if (w.animT0 >= 0) {
        var p = (nowMs - w.animT0) / CONFIG.WINDOW_FADE_MS, target = w.on ? 1 : 0;
        w.cur = w.animFrom + (target - w.animFrom) * clamp(EASE(p), 0, 1);
        if (p >= 1) { w.cur = target; w.animT0 = -1; }
      }
      var gate = clamp((night - w.delay) / 0.12, 0, 1); // окна зажигаются по одному в течение 2 с
      var lvl = w.cur * gate * w.bright;
      if (Math.abs(lvl - w.lvl) > 0.003 || (lvl === 0 && w.lvl !== 0)) {
        w.lvl = lvl; ch = w.ch;
        for (var k = 0; k < w.idx.length; k++) e[w.idx[k] * 4 + ch] = (w.val[k] * lvl + 0.5) | 0;
        dirty = true;
      }
    }
    return dirty;
  }

  var store = [];          // готовые кадры: {bgTex, depthTex, bldTex, winTex, depth, kB, dB, thumb, w, h}

  function depthAtMap(dm, u, v) {
    var x = clamp(Math.round(u * (dm.w - 1)), 0, dm.w - 1);
    var y = clamp(Math.round(v * (dm.h - 1)), 0, dm.h - 1);
    return dm.d[y * dm.w + x] / 255;
  }

  // ---------- загрузка кадров: сначала только первый (день), остальное — потом, в фоне, по одному, в простое ----------
  // Вся тяжёлая обработка (декодирование, глубина, вырезка, маски, закат и ночь) — в Web Worker (prep.js): главный поток
  // не занят, приветствие и анимации идут плавно. Если Worker/OffscreenCanvas нет — тот же код в главном потоке.
  var prep = (function () {
    var worker = null, pend = {}, seq = 0, mainReadyP = null;
    var cfg = {
      MAX_TEX_SIZE: CONFIG.MAX_TEX_SIZE, DEPTH_BLUR_PX: CONFIG.DEPTH_BLUR_PX, STARS: CONFIG.STARS,
      NIGHT_TOWER_LIT: CONFIG.NIGHT_TOWER_LIT, NIGHT_OTHER_LIT: CONFIG.NIGHT_OTHER_LIT, WINDOW_BRIGHT: CONFIG.WINDOW_BRIGHT, DAY: CONFIG.DAY
    };
    function viaMain(method, args) {
      if (!mainReadyP) {
        mainReadyP = new Promise(function (res, rej) {
          var sc = document.createElement('script');
          sc.src = 'prep.js'; sc.onload = function () { window.Prep.init(cfg).then(res); }; sc.onerror = function () { rej(new Error('prep.js не загрузился')); };
          document.head.appendChild(sc);
        });
      }
      return mainReadyP.then(function () { return window.Prep[method].apply(null, args); });
    }
    if (window.Worker && window.OffscreenCanvas && window.createImageBitmap && !/[?&]noworker=1/.test(location.search)) {
      try {
        worker = new Worker('prep.js');
        worker.onmessage = function (e) {
          var m = e.data, q = pend[m.id]; delete pend[m.id];
          if (q) { if (m.ok) q.res(m.res); else q.rej(new Error(m.err)); }
        };
        worker.onerror = function (e) {   // воркер не поднялся: всё, что ждало, переезжает в главный поток
          console.warn('prep.js: воркер недоступен, считаю в главном потоке', e && e.message);
          worker = null;
          Object.keys(pend).forEach(function (id) { var q = pend[id]; delete pend[id]; viaMain(q.method, q.args).then(q.res, q.rej); });
        };
        worker.postMessage({ id: ++seq, method: 'init', args: [cfg] });
      } catch (err) { worker = null; }
    }
    return {
      call: function (method, args) {
        if (!worker) return viaMain(method, args);
        return new Promise(function (res, rej) {
          var id = ++seq; pend[id] = { res: res, rej: rej, method: method, args: args };
          worker.postMessage({ id: id, method: method, args: args });
        });
      }
    };
  })();

  function makeLayers(entry, r) {   // откат без WebGL: слои-канвасы (фон и здание)
    var n = r.w * r.h, i;
    function cv() { var c = document.createElement('canvas'); c.width = r.w; c.height = r.h; return c; }
    var bg = cv(), b = cv(), bx = bg.getContext('2d'), by = b.getContext('2d');
    var bi = bx.createImageData(r.w, r.h), yi = by.createImageData(r.w, r.h);
    for (i = 0; i < n; i++) {
      bi.data[i * 4] = r.ground[i * 3]; bi.data[i * 4 + 1] = r.ground[i * 3 + 1]; bi.data[i * 4 + 2] = r.ground[i * 3 + 2]; bi.data[i * 4 + 3] = 255;
      var a = r.bldPm[i * 4 + 3];
      yi.data[i * 4] = a ? Math.min(255, r.bldPm[i * 4] * 255 / a) : 0; yi.data[i * 4 + 1] = a ? Math.min(255, r.bldPm[i * 4 + 1] * 255 / a) : 0;
      yi.data[i * 4 + 2] = a ? Math.min(255, r.bldPm[i * 4 + 2] * 255 / a) : 0; yi.data[i * 4 + 3] = a;
    }
    bx.putImageData(bi, 0, 0); by.putImageData(yi, 0, 0);
    entry.layers = { bg: bg, building: b };
  }

  function lampsFor(list, i, depth) {
    var out = [];
    (list || []).forEach(function (l, j) {
      var R = rng(500 + i * 31 + j);
      out.push({
        hu: l[0], hv: l[1], bu: l[2], bv: l[3], hd: depthAtMap(depth, l[0], l[1]), bd: depthAtMap(depth, l[2], l[3]),
        phase: R() * 6.2832, period: rand(R, CONFIG.LAMP_PERIOD_S[0], CONFIG.LAMP_PERIOD_S[1]), delay: R() * 0.88
      });
    });
    return out;
  }

  var dayP = [], stateP = [];
  function loadDay(i) {          // день: всё, что нужно, чтобы кадр показать и двигать
    if (dayP[i]) return dayP[i];
    dayP[i] = prep.call('day', [FRAMES[i], i]).then(function (r) {
      var entry = {
        w: r.w, h: r.h, depth: r.depth, thumb: r.thumb ? URL.createObjectURL(r.thumb) : '', dB: r.dB, kB: r.kB,
        ew: r.ew, eh: r.eh, emis: r.emis, wins: r.wins, skyFrac: r.skyFrac, starQ: r.starQ, emDirty: false,
        lamps: lampsFor(LAMPS[i], i, r.depth), winList: r.winList, nightLit: null, haloK: 1, idx: i,
        flag: new Float32Array(CONFIG.FLAGS[i] || [0, 0, 0, 0]),
        crop: (function (c) { return new Float32Array([c[0], c[1], c[2] - c[0], c[3] - c[1]]); })(CONFIG.CROP[i] || [0, 0, 1, 1])
      };
      var up = useGL ? uploadDay(entry, r) : Promise.resolve(makeLayers(entry, r));
      return up.then(function () { store[i] = entry; if (window.__fillThumb) window.__fillThumb(i); return entry; });
    });
    dayP[i].catch(function () { dayP[i] = null; });
    return dayP[i];
  }
  function loadStates(i) {       // закат и ночь (картинки): потом, в фоне; пока их нет — процедурные (v8)
    if (!NI) return Promise.resolve(null);
    if (stateP[i]) return stateP[i];
    stateP[i] = loadDay(i).then(function (entry) {
      var f = FRAMES[i], chain = Promise.resolve();
      ['sunset', 'night'].forEach(function (kind) {
        if (!f[kind]) return;
        chain = chain.then(function () { return prep.call('state', [i, kind, f[kind]]); }).then(function (r) {
          return uploadState(entry, kind === 'sunset' ? 's' : 'n', r).then(function () {
            if (kind === 'night') {   // ночь-картинка: свои окна и фонари, без процедурных
              entry.wins = []; entry.nightLit = r.lit;
              var nl = lampsFor(CONFIG.NIGHT_LAMPS[i], i, entry.depth);
              if (nl.length) { entry.lamps = nl; entry.haloK = CONFIG.NIGHT_HALO[i] == null ? 1 : CONFIG.NIGHT_HALO[i]; }
            }
          });
        }).catch(function (err) { console.warn('кадр ' + (i + 1) + ': ' + kind + ' не загрузился, остаётся процедурный —', err && err.message); });
      });
      return chain;
    });
    return stateP[i];
  }

  function idle(fn) { if (window.requestIdleCallback) requestIdleCallback(fn, { timeout: 2500 }); else setTimeout(fn, 250); }
  function loadDetails() {   // живые детали — отдельный файл, подгружается после первого кадра
    var sc = document.createElement('script');
    sc.src = 'details.js'; sc.onload = function () { window.Details.init(window.__viewer); };
    document.head.appendChild(sc);
  }
  function startBackground() {   // по одному, в простое, не при скрытой вкладке
    loadDetails();
    var q = [function () { return loadStates(0); }], i;
    for (i = 1; i < FRAMES.length; i++) (function (k) { q.push(function () { return loadDay(k); }); })(i);
    for (i = 1; i < FRAMES.length; i++) (function (k) { q.push(function () { return loadStates(k); }); })(i);
    (function next() {
      if (!q.length) { document.documentElement.setAttribute('data-loaded', 'all'); return; }   // всё загружено (для проверочных скриптов)
      if (document.hidden) { document.addEventListener('visibilitychange', function once() { document.removeEventListener('visibilitychange', once); next(); }); return; }
      idle(function () { var job = q.shift(); job().then(next, next); });
    })();
  }

  // Что нужно живым деталям (details.js): текущий кадр, время суток, проекция точки кадра на сцену.
  window.__viewer = {
    stage: stage, tod: tod,
    frame: function () { return frameIndex; }, fading: function () { return !!fade; }, entry: function (i) { return store[i]; },
    project: function (f, u, v, d) {
      var ld = lastDraw || { shiftX: 0, shiftY: 0, zoom: 0 };
      var q = projectImg(u, v, d, d * 2 - 1, ld.shiftX, ld.shiftY, ld.zoom, f.crop);
      return [q[0] * stage.clientWidth, q[1] * stage.clientHeight];
    }
  };

  // ---------- размер холста ----------
  var natW = 1080, natH = 1920; // перезапишется по первому кадру
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  // "cover"-масштаб/офсет — и в JS, чтобы точки-подсказки считали
  // экранную позицию той же формулой, что и шейдер.
  var coverUvW = 1, coverUvH = 1, coverOffX = 0, coverOffY = 0;
  var lastCssW = 0, lastCssH = 0;

  function resize(force) {
    var cssW = stage.clientWidth, cssH = stage.clientHeight;
    if (!force && cssW === lastCssW && cssH === lastCssH) return;
    lastCssW = cssW; lastCssH = cssH;
    if (useGL) {
      var w = Math.round(cssW * dpr), h = Math.round(cssH * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w; canvas.height = h;
      }
    }
    // "cover": как CSS background-size: cover — без искажений, лишнее обрезается.
    var factor = Math.max(cssW / natW, cssH / natH);
    coverUvW = cssW / (natW * factor);
    coverUvH = cssH / (natH * factor);
    coverOffX = (1 - coverUvW) / 2;
    coverOffY = (1 - coverUvH) / 2;
  }
  window.addEventListener('resize', function () { resize(true); if (window.__penFit) window.__penFit(); });
  window.addEventListener('orientationchange', function () { setTimeout(function () { resize(true); }, 200); });

  function setNaturalSize(w, h) {
    natW = w; natH = h;
    document.documentElement.style.setProperty('--natW', String(w));
    document.documentElement.style.setProperty('--natH', String(h));
    resize(true);
  }

  // ---------- откат без WebGL: два слоя (фон + здание) на кадр ----------
  var fbFrames = []; // [{el, bg, bld}]

  function buildFallbackDom() {
    fbEl.hidden = false;
    FRAMES.forEach(function (_, i) {
      var wrap = document.createElement('div');
      wrap.className = 'fb-frame';
      var bg = store[i].layers.bg, bld = store[i].layers.building;
      bg.className = 'fb-layer'; bld.className = 'fb-layer';
      wrap.appendChild(bg); wrap.appendChild(bld);
      fbEl.appendChild(wrap);
      fbFrames.push({ el: wrap, bg: bg, bld: bld });
    });
  }

  // ---------- кадры: индексы, переход, точки ----------
  var frameIndex = 0;
  var fade = null;      // {from, to, t0}
  var mixState = 0;

  function buildDots() {
    dotsEl.innerHTML = '';
    FRAMES.forEach(function (_, i) {
      var d = document.createElement('span');
      if (i === frameIndex) d.className = 'on';
      dotsEl.appendChild(d);
    });
  }

  function markDot(i) {
    var kids = dotsEl.children, th = thumbsEl.children;
    for (var k = 0; k < kids.length; k++) kids[k].classList.toggle('on', k === i);
    for (k = 0; k < th.length; k++) th[k].classList.toggle('on', k === i);
  }

  // ---------- точки-подсказки ----------
  var hotspotsEl = document.getElementById('hotspots');
  var hsPopup = document.getElementById('hsPopup');
  var activeHotspots = []; // [{el, hs, d, k}] для текущего кадра

  var hsText = document.getElementById('hsText');
  var hsBack = document.getElementById('hsBack');
  var hsCloseTimer = null;
  var lastPointerType = 'mouse';

  function closePopup() {
    clearTimeout(hsCloseTimer); hsCloseTimer = null;
    hsPopup.classList.remove('show');   // обратная анимация 300 мс
    stage.classList.remove('reading');  // фон возвращается
    hsPopup._forDot = null;
  }
  // Ставит карточку над точкой (или под ней, если сверху нет места) и не даёт
  // вылезти за края; хвостик всегда указывает на точку.
  function placePopup(a) {
    var w = hsPopup.offsetWidth, h = hsPopup.offsetHeight, cssW = stage.clientWidth;
    var left = a.x - w / 2, cl = clamp(left, 8, Math.max(8, cssW - 8 - w));
    var below = a.y - 11 - 16 - h < 56; // 56 — шапка с кнопкой «на сайт»
    hsPopup.classList.toggle('below', below);
    hsPopup.style.left = a.x + 'px';
    hsPopup.style.top = (below ? a.y + 11 : a.y - 11) + 'px';
    hsPopup.style.setProperty('--shift', (cl - left) + 'px');
  }

  function openPopup(hs, dotEl) {
    clearTimeout(hsCloseTimer); hsCloseTimer = null;
    hsText.textContent = (CONFIG.I18N[hs.key] && CONFIG.I18N[hs.key][currentLang]) || '';
    hsPopup._forDot = dotEl;
    var a = activeHotspots.filter(function (x) { return x.el === dotEl; })[0];
    if (a) placePopup(a);
    hsPopup.classList.add('show');
    stage.classList.add('reading');
  }

  hsBack.addEventListener('click', closePopup);

  // Глубина точки — из той же (размытой) карты, что читает шейдер.
  function depthAt(frameIdx, u, v) {
    var dm = store[frameIdx] && store[frameIdx].depth;
    if (!dm) return 0.5;
    var x = clamp(Math.round(u * (dm.w - 1)), 0, dm.w - 1);
    var y = clamp(Math.round(v * (dm.h - 1)), 0, dm.h - 1);
    return dm.d[y * dm.w + x] / 255;
  }

  function buildHotspots(frameIdx) {
    hotspotsEl.innerHTML = '';
    activeHotspots = [];
    (HS[frameIdx] || []).forEach(function (hs) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'hs-dot';
      btn.setAttribute('aria-label', (CONFIG.I18N[hs.key] && CONFIG.I18N[hs.key][currentLang]) || hs.key);
      btn.addEventListener('pointerdown', function (e) { lastPointerType = e.pointerType; });
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var isOpen = hsPopup.classList.contains('show') && hsPopup._forDot === btn;
        // и на ПК, и на телефоне подсказка открывается только кликом/тапом по точке
        if (isOpen) closePopup();
        else openPopup(hs, btn);
      });
      hotspotsEl.appendChild(btn);
      var d, k;
      if (useGL && hs.layer === 'building') { d = store[frameIdx].dB; k = store[frameIdx].kB; }   // здание — жёстко, общий сдвиг
      else if (useGL) { d = depthAt(frameIdx, hs.u, hs.v); k = d * 2 - 1; }                       // фон/земля — по пикселю
      else { d = 0; k = hs.layer === 'building' ? CONFIG.FALLBACK_LAYER_K : -CONFIG.FALLBACK_LAYER_K; }
      activeHotspots.push({ el: btn, hs: hs, d: d, k: k });
    });
    // показать с лёгкой задержкой, чтобы не мигали поверх кроссфейда
    requestAnimationFrame(function () {
      activeHotspots.forEach(function (a) { a.el.classList.add('show'); });
    });
  }

  function hideHotspots() {
    closePopup();
    activeHotspots.forEach(function (a) { a.el.classList.remove('show'); });
  }

  document.addEventListener('pointerdown', function (e) {
    if (hsPopup.classList.contains('show') && !hsPopup.contains(e.target) && e.target !== hsPopup._forDot) {
      closePopup();
    }
  });

  // Та же формула, что в шейдере, но «вперёд»: где на экране окажется
  // точка (u,v) исходной картинки при текущем сдвиге/наклоне.
  function updateHotspotPositions(sx, sy, zoom) {
    if (!activeHotspots.length) return;
    var cssW = stage.clientWidth, cssH = stage.clientHeight, S = CONFIG.BASE_SCALE;
    activeHotspots.forEach(function (a) {
      var z = 1 + zoom * a.d;
      var px = 0.5 + (a.hs.u + a.k * sx - 0.5) * z;
      var py = 0.5 + (a.hs.v + a.k * sy - 0.5) * z;
      var cr = store[frameIndex] && store[frameIndex].crop;
      if (cr) { px = (px - cr[0]) / cr[2]; py = (py - cr[1]) / cr[3]; }   // обратно из обрезанного прямоугольника
      px = 0.5 + (px - 0.5) * S;
      py = 0.5 + (py - 0.5) * S;
      var screenU = (px - coverOffX) / coverUvW;
      var screenV = (py - coverOffY) / coverUvH;
      a.x = screenU * cssW; a.y = screenV * cssH;
      a.el.style.transform = 'translate(' + a.x + 'px,' + a.y + 'px)';
      if (hsPopup._forDot === a.el && hsPopup.classList.contains('show')) placePopup(a); // карточка едет вместе с точкой
    });
  }

  function goTo(newIndex) {
    if (fade || !store[0]) return;
    var n = FRAMES.length;
    newIndex = ((newIndex % n) + n) % n;
    if (newIndex === frameIndex) return;
    if (!store[newIndex]) { loadDay(newIndex).then(function () { goTo(newIndex); }); return; }   // ещё грузится в фоне — дождёмся
    hideHotspots();
    fade = { from: frameIndex, to: newIndex, t0: null };
    markDot(newIndex);
  }

  // ---------- ввод ----------
  // curX/curY — текущий наклон -1..1 (то, что видно на экране);
  // targetX/Y — куда он плавно едет (гироскоп, мышь).
  var targetX = 0, targetY = 0, curX = 0, curY = 0;
  var ret = null;             // плавный возврат в центр после пальца
  var pointerActive = false, dragId = null;
  var dragStartX = 0, dragStartY = 0, dragBaseX = 0, dragBaseY = 0, dragStartT = 0;

  function setTiltFromClient(clientX, clientY) { // мышь: абсолютная позиция
    var r = stage.getBoundingClientRect();
    targetX = clamp((clientX - (r.left + r.width / 2)) / (r.width / 2), -1, 1);
    targetY = clamp((clientY - (r.top + r.height / 2)) / (r.height / 2), -1, 1);
  }

  stage.addEventListener('pointerdown', function (e) {
    demoStop();
    if (e.pointerType === 'mouse') { setTiltFromClient(e.clientX, e.clientY); return; }
    // Палец: перетаскивание на всю ширину экрана = полный диапазон сдвига.
    pointerActive = true;
    dragId = e.pointerId;
    ret = null;
    dragStartX = e.clientX; dragStartY = e.clientY;
    dragBaseX = curX; dragBaseY = curY;
    dragStartT = performance.now();
  });

  stage.addEventListener('pointermove', function (e) {
    if (e.pointerType === 'mouse') {
      demoStop();
      setTiltFromClient(e.clientX, e.clientY);
      return;
    }
    if (!pointerActive || e.pointerId !== dragId) return;
    var W = stage.clientWidth || 1;
    targetX = clamp(dragBaseX + 2 * (e.clientX - dragStartX) / W, -1, 1);
    targetY = clamp(dragBaseY + 2 * (e.clientY - dragStartY) / W, -1, 1);
  });

  function releasePointer(e) {
    if (e.pointerType === 'mouse' || !pointerActive || e.pointerId !== dragId) return;
    pointerActive = false;
    dragId = null;
    // Быстрый росчерк по горизонтали — смена кадра; медленное перетаскивание
    // только двигает объём.
    var dx = e.clientX - dragStartX, dy = e.clientY - dragStartY;
    var quick = performance.now() - dragStartT < CONFIG.SWIPE_MAX_MS;
    if (e.type === 'pointerup' && quick && Math.abs(dx) > CONFIG.SWIPE_MIN_PX && Math.abs(dx) > 1.5 * Math.abs(dy)) {
      goTo(frameIndex + (dx < 0 ? 1 : -1));
    }
    // плавный возврат в центр за RETURN_MS (или к гироскопу, если он включён)
    targetX = gyroActive ? gyroTargetX : 0;
    targetY = gyroActive ? gyroTargetY : 0;
    ret = { t0: null, fx: curX, fy: curY };
  }
  stage.addEventListener('pointerup', releasePointer);
  stage.addEventListener('pointercancel', releasePointer);

  stage.addEventListener('mouseleave', function () { targetX = 0; targetY = 0; });

  [prevBtn, document.getElementById('prevSide')].forEach(function (b) { b.addEventListener('click', function () { goTo(frameIndex - 1); }); });
  [nextBtn, document.getElementById('nextSide')].forEach(function (b) { b.addEventListener('click', function () { goTo(frameIndex + 1); }); });
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { if (hsPopup.classList.contains('show')) closePopup(); else closeSheet(); }
    else if (e.key === 'ArrowLeft') goTo(frameIndex - 1);
    else if (e.key === 'ArrowRight') goTo(frameIndex + 1);
  });

  // ---------- гироскоп ----------
  var gyroActive = false, gyroBaseBeta = null, gyroBaseGamma = null;
  var gyroTargetX = 0, gyroTargetY = 0, gyroGotEvent = false;

  function onOrientation(e) {
    if (e.beta === null || e.gamma === null || e.beta === undefined) return;
    gyroGotEvent = true;
    if (gyroBaseBeta === null) { gyroBaseBeta = e.beta; gyroBaseGamma = e.gamma; }
    var dGamma = e.gamma - gyroBaseGamma; // лево/право
    var dBeta = e.beta - gyroBaseBeta;    // к себе / от себя
    gyroTargetX = clamp(dGamma / CONFIG.MAX_TILT_X_DEG, -1, 1);
    gyroTargetY = clamp(dBeta / CONFIG.MAX_TILT_Y_DEG, -1, 1);
    if (!pointerActive) { targetX = gyroTargetX; targetY = gyroTargetY; }
  }

  function startGyro() {
    if (gyroActive) return;
    gyroActive = true;
    window.addEventListener('deviceorientation', onOrientation);
  }

  var hasOrientation = typeof DeviceOrientationEvent !== 'undefined';
  var needsPermission = hasOrientation && typeof DeviceOrientationEvent.requestPermission === 'function';

  // ---------- приветствие и доступ к наклону ----------
  if (!needsPermission && hasOrientation && isTouchDevice && window.isSecureContext !== false) {
    startGyro(); // Android и прочие — разрешение не нужно
  }

  // ---------- ночные эффекты, ветер, контроль fps ----------
  var fx = {
    windAmp: 0, windOn: true, zoomA: 1, zoomB: 1,
    shoot: [0, 0, 0, 0], shootP: -1, shootLen: 0.3,
    lampH: new Float32Array(48), lampB: new Float32Array(48)
  };
  var perfLevel = 0;                 // 0 — всё; 1 — выключены живые детали и падающие звёзды; 2 — ещё и ветер
  var perfOn = !/[?&]perf=0/.test(location.search);
  var fpsFrames = 0, fpsT0 = 0, perfSince = 0, perfLow = 0, perfGood = 0, perfRecov = 0;
  var nextToggleAt = 0, nextShootAt = 0, shootT0 = -1, secondPending = false;
  var fxRng = rng(99);

  // Куда на экране (доли ширины/высоты сцены) попадёт точка картинки при текущем сдвиге — та же формула, что в шейдере.
  function projectImg(u, v, d, k, sx, sy, zoom, crop) {
    var z = 1 + zoom * d, S = CONFIG.BASE_SCALE;
    var px = 0.5 + (u + k * sx - 0.5) * z, py = 0.5 + (v + k * sy - 0.5) * z;
    if (crop) { px = (px - crop[0]) / crop[2]; py = (py - crop[1]) / crop[3]; }   // обратно из обрезанного прямоугольника
    px = 0.5 + (px - 0.5) * S; py = 0.5 + (py - 0.5) * S;
    return [(px - coverOffX) / coverUvW, (py - coverOffY) / coverUvH];
  }

  // Фонари: ореол у лампы и светлое пятно на земле под ней; «дыхание» яркости ±8%, у каждого свой период 4–6 с.
  function fillLamps(fa, fb, mix, sx, sy, zoom, tAmb) {
    var H = fx.lampH, B = fx.lampB, n = 0;
    function add(f, wgt) {
      if (!f || wgt <= 0.001) return;
      f.lamps.forEach(function (l) {
        if (n >= 16) return;
        var gate = clamp((tod.lights - l.delay) / 0.12, 0, 1);   // фонари зажигаются по одному
        var I = gate * (1 + CONFIG.LAMP_BREATH * Math.sin(tAmb * 2 * Math.PI / l.period + l.phase)) * wgt * (f.haloK || 1);
        var h = projectImg(l.hu, l.hv, l.hd, l.hd * 2 - 1, sx, sy, zoom, f.crop);
        var b = projectImg(l.bu, l.bv, l.bd, l.bd * 2 - 1, sx, sy, zoom, f.crop);
        H[n * 3] = h[0]; H[n * 3 + 1] = 1 - h[1]; H[n * 3 + 2] = I;
        B[n * 3] = b[0]; B[n * 3 + 1] = 1 - b[1]; B[n * 3 + 2] = I;
        n++;
      });
    }
    add(fa, fb ? 1 - mix : 1);
    add(fb, mix);
    for (; n < 16; n++) { H[n * 3 + 2] = 0; B[n * 3 + 2] = 0; }
  }

  // Окна, раз в 8–12 с одно случайное окно плавно зажигается/гаснет (1.5 с); падающие звёзды раз в 40–60 с.
  function stepNightFx(fa, fb, now) {
    [fa, fb].forEach(function (f) {
      if (f && updateWindows(f, tod.lights, now)) f.emDirty = true;
    });
    if (tod.lights > 0.95) {
      if (nextToggleAt === 0) nextToggleAt = now + rand(fxRng, CONFIG.WINDOW_TOGGLE_S[0], CONFIG.WINDOW_TOGGLE_S[1]) * 1000;
      else if (now >= nextToggleAt) {
        if (!fb && fa.wins.length) {
          var towerOnly = fa.wins.filter(function (w) { return w.ch === 0; });
          var pool = (towerOnly.length && fxRng() < 0.75) ? towerOnly : fa.wins;
          var w = pool[(fxRng() * pool.length) | 0];
          w.on = !w.on; w.animFrom = w.cur; w.animT0 = now;
        }
        nextToggleAt = now + rand(fxRng, CONFIG.WINDOW_TOGGLE_S[0], CONFIG.WINDOW_TOGGLE_S[1]) * 1000;
      }
    } else nextToggleAt = 0;

    if (perfLevel < 1 && tod.stars > 0.7) {
      if (shootT0 < 0) {
        if (nextShootAt === 0) nextShootAt = now + rand(fxRng, CONFIG.SHOOT_EVERY_S[0], CONFIG.SHOOT_EVERY_S[1]) * 1000;
        else if (now >= nextShootAt) {
          var dirX = (fxRng() < 0.5 ? -1 : 1) * rand(fxRng, 0.75, 0.95), dirY = rand(fxRng, 0.30, 0.48);
          fx.shoot = [rand(fxRng, 0.2, 0.8), rand(fxRng, 0.04, 0.3), dirX, dirY];
          shootT0 = now;
          if (!secondPending && fxRng() < 0.4) { secondPending = true; nextShootAt = now + rand(fxRng, 1500, 3000); }
          else { secondPending = false; nextShootAt = now + rand(fxRng, CONFIG.SHOOT_EVERY_S[0], CONFIG.SHOOT_EVERY_S[1]) * 1000; }
        }
      }
    } else { nextShootAt = 0; }
    if (shootT0 >= 0) {
      var p = (now - shootT0) / CONFIG.SHOOT_MS;
      if (p >= 1 || perfLevel >= 1) { shootT0 = -1; fx.shootP = -1; } else fx.shootP = p;
    } else fx.shootP = -1;
  }

  // Цель — 60 fps. Если средний fps ниже PERF_MIN_FPS (45): сначала выключаем ветер, потом падающие звёзды.
  function perfCheck(now, busy) {
    if (!perfOn) return;
    if (!perfSince) perfSince = now;
    if (busy || !fpsT0 || now - perfSince < 4000) { fpsT0 = now; fpsFrames = 0; return; } // разогрев 4 с, переходы, чтение — не считаем
    fpsFrames++;
    var dt = now - fpsT0;
    if (dt >= 2500) {
      var fps = fpsFrames * 1000 / dt;
      if (fps < CONFIG.PERF_MIN_FPS && document.visibilityState === 'visible') {
        perfGood = 0;
        if (perfLevel < 2 && ++perfLow >= 2) {   // два медленных окна подряд (5 с): одиночная заминка (окно на заднем плане, вкладка) не считается
          perfLow = 0; perfLevel++;              // сначала отключаем детали (и падающие звёзды), потом ветер
          console.info('fps ' + fps.toFixed(1) + ' < ' + CONFIG.PERF_MIN_FPS + ' -> отключаю ' + (perfLevel === 1 ? 'живые детали и падающие звёзды' : 'ветер'));
        }
      } else {
        perfLow = 0;
        if (perfLevel >= 1 && fps >= 56 && ++perfGood >= Math.min(24, 4 + 2 * perfRecov)) {   // 10 с ровных 56+ fps без деталей — возвращаем; после каждого срыва ждём дольше (до 60 с), чтобы детали не «мигали»
          perfGood = 0; perfRecov++; perfLevel--;
          console.info('fps ровный -> возвращаю ' + (perfLevel === 0 ? 'живые детали' : 'ветер'));
        } else if (fps < 56) perfGood = 0;
      }
      fpsT0 = now; fpsFrames = 0;
    }
  }

  // ---------- демо-наклон: при первом показе картинки один мягкий наклон (~1.5 с) и возврат — видно, что она двигается ----------
  // Запускается, когда приветствие начало уходить. Не запускается, если картинка уже реагирует на руку (гироскоп даёт наклон,
  // палец/мышь на сцене) и при «уменьшении движения»; любое касание или движение мыши по сцене его прерывает.
  var demo = null;
  function demoStart() {
    if (demo || reduced() || pointerActive || gyroGotEvent || stage.classList.contains('reading') || stage.classList.contains('loading')) return;
    demo = { t0: null, dur: 1500, ax: 1.0, ay: -0.3 };
  }
  function demoStop() {
    if (!demo) return;
    demo = null;
    targetX = gyroActive ? gyroTargetX : 0; targetY = gyroActive ? gyroTargetY : 0;
  }
  window.__demoTilt = function () { setTimeout(demoStart, 250); };   // после начала растворения приветствия

  // ---------- кнопка «Парад» (флаг Армении): три истребителя и дымные следы, рисует details.js ----------
  // Нажатие: если открыт не кадр 1 — плавный переход на кадр 1, потом показ. Повторные нажатия во время показа игнорируются.
  // При fps < 45 (детали отключены) и при «уменьшении движения» кнопка скрыта.
  var flagBtns = document.querySelectorAll('.flag-btn');
  var paradeBusy = false, paradeWant = null;
  var flagOnFrame = true;
  function flagFrameStep() {   // кнопка живёт только на кадре 1; при переходе на другой кадр гаснет сразу
    var on = frameIndex === 0 && !fade;
    if (on === flagOnFrame) return;
    flagOnFrame = on;
    flagBtns.forEach(function (b) { b.classList.toggle('off-frame', !on); });
  }
  // Кнопка не исчезает никогда (только гаснет на кадрах 2–6). На слабом устройстве (fps < 45), при «уменьшении движения» и без WebGL
  // показывается упрощённый парад: флаг Армении просто проявляется в небе, чуть колышется и растворяется (simpleParade).
  function flagUpdate() { flagBtns.forEach(function (b) { b.hidden = false; }); }
  function simpleParade(done) {
    var el = document.createElement('div');
    el.className = 'flag-lite'; el.setAttribute('aria-hidden', 'true');
    el.innerHTML = '<svg viewBox="0 0 46 34" width="140" height="103"><g stroke-linejoin="round">' +
      '<path class="fb fb1" d="M4 4 Q13 1 23 4 Q33 7 42 4 L42 12 Q33 15 23 12 Q13 9 4 12 Z" fill="#d90012"/>' +
      '<path class="fb fb2" d="M4 12 Q13 9 23 12 Q33 15 42 12 L42 20 Q33 23 23 20 Q13 17 4 20 Z" fill="#1c4cc0"/>' +
      '<path class="fb fb3" d="M4 20 Q13 17 23 20 Q33 23 42 20 L42 28 Q33 31 23 28 Q13 25 4 28 Z" fill="#f2a800"/>' +
      '<path d="M4 4 Q13 1 23 4 Q33 7 42 4 L42 28 Q33 31 23 28 Q13 25 4 28 Z" fill="none" stroke="#2f2a25" stroke-width="1.1" opacity=".75"/>' +
      '<path d="M3 2 L3.4 33" fill="none" stroke="#2f2a25" stroke-width="1.6" stroke-linecap="round"/></g></svg>';
    stage.appendChild(el);
    var finished = false;
    function end() { if (finished) return; finished = true; if (el.parentNode) el.parentNode.removeChild(el); done(); }
    el.addEventListener('animationend', function (e) { if (e.animationName === 'liteFlag') end(); });
    setTimeout(end, 9000);   // страховка
  }
  function setParadeBusy(v) {
    paradeBusy = v;
    flagBtns.forEach(function (b) { b.setAttribute('aria-disabled', v ? 'true' : 'false'); b.classList.toggle('busy', v); });
  }
  flagBtns.forEach(function (b) {
    b.addEventListener('click', function () {
      if (paradeBusy || frameIndex !== 0 || fade) return;
      closePopup(); closeSheet();
      setParadeBusy(true);
      paradeWant = { since: performance.now(), shown: null };
    });
  });
  (reduceMQ.addEventListener ? reduceMQ.addEventListener('change', flagUpdate) : reduceMQ.addListener(flagUpdate));
  function paradeStep(now) {   // из рендер-цикла: довести до кадра 1, дать ему осесть, запустить показ
    if (!paradeWant) return;
    if (now - paradeWant.since > 9000) { paradeWant = null; setParadeBusy(false); return; }   // что-то не так — не зависаем
    if (fade) return;
    if (frameIndex !== 0) { goTo(0); return; }
    if (paradeWant.shown === null) paradeWant.shown = now;
    if (now - paradeWant.shown < 450) return;
    paradeWant = null;
    var done = function () { setParadeBusy(false); };
    var full = useGL && perfLevel < 1 && !reduced() && window.Details && window.Details.parade;
    if (!(full && window.Details.parade(done))) simpleParade(done);   // слабое устройство, «уменьшить движение», нет WebGL или занято — упрощённый парад
  }

  // ---------- рендер-цикл ----------
  var t0 = performance.now();
  var lastNow = null;
  var lastDraw = null;

  function frame(now) {
    var dt = lastNow === null ? 16.667 : clamp(now - lastNow, 1, 64);
    lastNow = now;
    var rm = reduced();
    var t = rm ? 0 : (now - t0) / 1000;   // облака замирают при «уменьшении движения»
    var retMs = CONFIG.RETURN_MS;

    // --- кроссфейд ---
    if (fade) {
      if (fade.t0 === null) fade.t0 = now;
      var p = (now - fade.t0) / CONFIG.FRAME_CROSSFADE_MS;
      if (p >= 1) {
        frameIndex = fade.to;
        fade = null;
        mixState = 0;
        fx.zoomA = 1; fx.zoomB = 1;
        markDot(frameIndex);
        buildHotspots(frameIndex);
      } else {
        mixState = clamp(EASE(p), 0, 1);
        fx.zoomA = 1 + 0.06 * mixState;    // уходящий кадр медленно приближается и растворяется,
        fx.zoomB = 1.04 - 0.04 * mixState; // следующий проявляется из лёгкого отдаления
      }
    }

    // --- время суток: день→закат 2.5 с, закат→ночь 3 с (небо, потом земля, с середины по одному окна и фонари 2 с,
    // звёзды последними); обратно — в обратном порядке. Время бежит равномерно, по краям мягко.
    if (todAnim) {
      if (todAnim.t0 === null) todAnim.t0 = now;
      var dur = Math.max(1, Math.abs(todAnim.T1 - todAnim.T0) * 1000);
      var tf = clamp((now - todAnim.t0) / dur, 0, 1);
      var tfe = 0.5 * tf + 0.5 * tf * tf * (3 - 2 * tf);
      applyTod(todP(todAnim.T0 + (todAnim.T1 - todAnim.T0) * tfe));
      if (tf >= 1) { applyTod(todAnim.p1); todAnim = null; }
    }

    // Пока открыта карточка подсказки, картинка за ней стоит: точки и карточка не «плывут» за мышью,
    // GPU не тратится на размытый фон.
    if (stage.classList.contains('reading') && !fade && !todAnim) { fpsT0 = 0; requestAnimationFrame(frame); return; }

    // --- демо-наклон (один раз): туда-обратно по синусоиде; дальше управление возвращается мыши/гироскопу ---
    if (demo) {
      if (demo.t0 === null) demo.t0 = now;
      var dp = (now - demo.t0) / demo.dur;
      if (dp >= 1) demoStop();
      else { var dk = Math.sin(Math.PI * dp); targetX = demo.ax * dk; targetY = demo.ay * dk; }
    }
    paradeStep(now); flagFrameStep();

    // --- наклон ---
    if (ret) {
      if (ret.t0 === null) ret.t0 = now;
      var e = EASE((now - ret.t0) / retMs);
      curX = ret.fx + (targetX - ret.fx) * e;
      curY = ret.fy + (targetY - ret.fy) * e;
      if (now - ret.t0 >= CONFIG.RETURN_MS) ret = null;
    } else if (pointerActive) {
      var kf = lerpK(0.35, dt); // палец: почти без отставания
      curX += (targetX - curX) * kf;
      curY += (targetY - curY) * kf;
    } else {
      var ks = lerpK(CONFIG.SMOOTH, dt);
      curX += (targetX - curX) * ks;
      curY += (targetY - curY) * ks;
    }

    var tiltX = clamp(curX, -1, 1);
    var tiltY = clamp(curY, -1, 1);

    var ba = rm ? 0 : CONFIG.BREATH_AMPLITUDE;
    var breathX = ba * Math.sin(t * 2 * Math.PI / CONFIG.BREATH_PERIOD_S);
    var breathY = ba * Math.cos(t * 2 * Math.PI / (CONFIG.BREATH_PERIOD_S * 0.7));
    var shiftX = tiltX * CONFIG.MAX_SHIFT_X + breathX;
    var shiftY = tiltY * CONFIG.MAX_SHIFT_Y + breathY;
    // наклон к себе (вниз) — ближние части чуть увеличиваются
    var zoom = CONFIG.ZOOM_NEAR * clamp(tiltY, 0, 1);

    resize(false);

    var fa = store[fade ? fade.from : frameIndex];
    var fb = fade ? store[fade.to] : null;
    if (!fa || (fade && !fb)) { requestAnimationFrame(frame); return; }   // кадр ещё не восстановлен

    if (useGL) {
      var tAmb = (now - t0) / 1000; // настоящее время: ветер, мерцание звёзд, «дыхание» фонарей
      fx.windOn = CONFIG.WIND && perfLevel < 2;
      fx.windAmp = CONFIG.WIND_AMP_PX * (fb ? CONFIG.WIND_K[fa.idx] + (CONFIG.WIND_K[fb.idx] - CONFIG.WIND_K[fa.idx]) * mixState : CONFIG.WIND_K[fa.idx]) * (coverUvW / CONFIG.BASE_SCALE) / Math.max(1, stage.clientWidth);
      stepNightFx(fa, fb, now);
      fillLamps(fa, fb, mixState, shiftX, shiftY, zoom, tAmb);
      stage.classList.toggle('is-night', tod.sky > 0.5);
      var nightNow = tod.night > 0.5 ? '1' : '0';
      if (document.documentElement.getAttribute('data-night') !== nightNow) document.documentElement.setAttribute('data-night', nightNow);   // тёмная подложка кнопок на телефоне
      perfCheck(now, !!(fade || todAnim || (window.Details && window.Details.paradeBusy && window.Details.paradeBusy())));
      lastDraw = { fa: fa, fb: fb, mix: mixState, shiftX: shiftX, shiftY: shiftY, zoom: zoom, t: t, tAmb: tAmb };
      if (!glLost) drawGL(fa, fb, mixState, shiftX, shiftY, zoom, t, tAmb);
      if (window.Details && window.Details.frame) { if (perfLevel < 1 && !rm) window.Details.frame(now); else window.Details.off(); }   // живые детали: тот же цикл, не свой rAF
    } else {
      var cssW = stage.clientWidth, cssH = stage.clientHeight;
      var kb = CONFIG.FALLBACK_LAYER_K;
      var ia = fade ? fade.from : frameIndex, ib = fade ? fade.to : -1;
      fbFrames.forEach(function (ff, i) {
        var on = i === ia || i === ib;
        ff.el.style.opacity = i === ia ? '1' : (i === ib ? String(mixState) : '0');
        ff.el.style.visibility = on ? 'visible' : 'hidden';
        if (!on) return;
        var bx = (kb * shiftX / coverUvW) * cssW, by = (kb * shiftY / coverUvH) * cssH;
        ff.bld.style.transform = 'translate(' + bx + 'px,' + by + 'px) scale(' + CONFIG.BASE_SCALE + ')';
        ff.bg.style.transform = 'translate(' + (-bx) + 'px,' + (-by) + 'px) scale(' + CONFIG.BASE_SCALE + ')';
      });
    }

    if (!fade) updateHotspotPositions(shiftX, shiftY, useGL ? zoom : 0);

    requestAnimationFrame(frame);
  }

  // ---------- панель: время суток, миниатюры, настройки, открытка ----------
  var bodyEl = document.body;
  var desktopMQ = window.matchMedia('(min-width: 1024px)');
  var scrimEl = document.getElementById('scrim');
  var thumbsEl = document.getElementById('thumbs');

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  // Выделение меняется мгновенно, в том же кадре, что и запуск смены (без CSS-перехода фона —
  // в WebKit он не перерисовывался, пока рядом рисует WebGL); reflow принудительно.
  function segMark(segId, attr, value) {
    var seg = document.getElementById(segId);
    seg.querySelectorAll('button').forEach(function (b) {
      var on = b.getAttribute(attr) === value;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    void seg.offsetWidth;
  }

  // свернуть/развернуть (ПК) и шторка (телефон)
  if (lsGet('chka-panel') === 'collapsed') bodyEl.classList.add('panel-collapsed');
  function closeSheet() { bodyEl.classList.remove('sheet-open'); }
  panelBtn.addEventListener('click', function () {
    document.documentElement.classList.add('panel-anim');   // анимации закрытия/иконки включаются только после первого нажатия (не при загрузке)
    if (desktopMQ.matches) lsSet('chka-panel', bodyEl.classList.toggle('panel-collapsed') ? 'collapsed' : 'open');
    else bodyEl.classList.toggle('sheet-open');
  });
  scrimEl.addEventListener('click', closeSheet);
  (desktopMQ.addEventListener ? desktopMQ.addEventListener('change', closeSheet) : desktopMQ.addListener(closeSheet));

  // время суток: p = 0 день, 1 закат, 2.1667 ночь (последние 0.1667 — доезжают огни и звёзды)
  var TOD_P = { day: 0, sunset: 1, night: 2.1667 };
  var todAnim = null;
  function sstep(a, b, x) { x = clamp((x - a) / (b - a), 0, 1); return x * x * (3 - 2 * x); }
  function todT(p) { return p <= 1 ? CONFIG.DAY_SUNSET_S * p : CONFIG.DAY_SUNSET_S + CONFIG.SUNSET_NIGHT_S * (p - 1); }
  function todP(T) { return T <= CONFIG.DAY_SUNSET_S ? T / CONFIG.DAY_SUNSET_S : 1 + (T - CONFIG.DAY_SUNSET_S) / CONFIG.SUNSET_NIGHT_S; }
  function applyTod(p) {
    var q = p - 1;
    tod.p = p;
    tod.s = p <= 1 ? p : 1 - sstep(0.3, 0.9, q);          // тёплый тон держится, пока темнеет
    tod.sky = q > 0 ? sstep(0.0, 0.55, q) : 0;            // сначала небо
    tod.gnd = q > 0 ? sstep(0.3, 0.9, q) : 0;             // потом земля
    tod.lights = clamp((p - 1.5) / 0.667, 0, 1);          // с середины перехода, в течение 2 с
    tod.stars = q > 0 ? sstep(0.75, 1.1667, q) : 0;       // звёзды — последними
    tod.night = q > 0 ? sstep(0.0, 1.1667, q) : 0;        // ночной кадр проявляется все 3 с перехода
    tod.sun = clamp(p, 0, 1);                             // закатный кадр проявляется все 2.5 с перехода день→закат
  }
  function setTod(name) {
    var p1 = TOD_P[name];
    if (p1 === undefined) return;
    todAnim = { t0: null, T0: todT(tod.p), T1: todT(p1), p1: p1 };
    segMark('todSeg', 'data-tod', name);
    if (!useGL) fbEl.setAttribute('data-tod', name);
  }
  document.querySelectorAll('#todSeg button').forEach(function (b) {
    b.addEventListener('click', function () { setTod(b.getAttribute('data-tod')); });
  });

  // миниатюры кадров
  function buildThumbs() {
    thumbsEl.innerHTML = '';
    FRAMES.forEach(function (_, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = i === frameIndex ? 'on' : '';
      b.setAttribute('aria-label', (i + 1) + ' / ' + FRAMES.length);
      var im = new Image();
      im.alt = ''; if (store[i]) im.src = store[i].thumb;
      b.appendChild(im);
      b.addEventListener('click', function () { goTo(i); });
      thumbsEl.appendChild(b);
    });
  }
  window.__fillThumb = function (i) {   // кадр догрузился в фоне — показываем его миниатюру
    var b = thumbsEl && thumbsEl.children[i];
    if (b && b.firstChild && !b.firstChild.getAttribute('src') && store[i]) b.firstChild.src = store[i].thumb;
  };

  // полный экран
  var fsBtn = document.getElementById('fsBtn');
  // iPhone (iOS Safari) полноэкранный режим для страниц не поддерживает — кнопку прячем. iPad и остальные — работают.
  var isIPhone = /iPhone|iPod/.test(navigator.userAgent);
  var fsApi = !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);
  if (isIPhone || !fsApi || !(document.fullscreenEnabled || document.webkitFullscreenEnabled)) {
    fsBtn.hidden = true;
    fsBtn.parentNode.hidden = true;   // и её пустая секция в панели
  }
  fsBtn.addEventListener('click', function () {
    var el = document.documentElement;
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    } else {
      (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
    }
  });
  // Вход и выход (кнопка, Esc, жест) меняют размер окна: пересчитываем картинку, точки и панель.
  // Размеры устаканиваются не сразу (особенно в Safari на iPad), поэтому пересчёт идёт несколько раз.
  function onFullscreenChange() {
    closePopup();
    [0, 120, 400].forEach(function (ms) {
      setTimeout(function () { resize(true); }, ms);   // точки-подсказки пересчитываются в каждом кадре сами
    });
  }
  document.addEventListener('fullscreenchange', onFullscreenChange);
  document.addEventListener('webkitfullscreenchange', onFullscreenChange);

  // открытка: PNG текущего вида + подпись карандашным шрифтом внизу
  var cardBtn = document.getElementById('cardBtn');
  if (!useGL) cardBtn.hidden = true;
  cardBtn.addEventListener('click', function () {
    if (!useGL || glLost || !lastDraw) return;
    var d = lastDraw;
    // Буфер WebGL читается только сразу после отрисовки — рисуем ещё раз и копируем тут же.
    // Для открытки рисуем крупнее (~1080 px по ширине), потом возвращаем размер холста.
    var W0 = canvas.width, H0 = canvas.height, kq = clamp(1080 / W0, 1, 2.5);
    canvas.width = Math.round(W0 * kq); canvas.height = Math.round(H0 * kq);
    drawGL(d.fa, d.fb, d.mix, d.shiftX, d.shiftY, d.zoom, d.t, d.tAmb);
    var W = canvas.width, H = canvas.height;
    var c = document.createElement('canvas');
    c.width = W; c.height = H;
    var x = c.getContext('2d');
    x.drawImage(canvas, 0, 0);
    canvas.width = W0; canvas.height = H0; // следующий кадр цикла перерисует холст
    var caption = CONFIG.UI_I18N.title[currentLang] + ' · chka.am';
    var FONT = '"Kukuruznik Serif", "Noto Serif", serif';
    var ready = (document.fonts && document.fonts.load) ? document.fonts.load('700 40px "Kukuruznik Serif"', caption).catch(function () {}) : Promise.resolve();
    ready.then(function () {
      var capH = Math.round(H * 0.085), lw = Math.max(2, Math.round(W / 300));
      x.fillStyle = '#f5ecda';
      x.fillRect(0, H - capH, W, capH);
      x.fillStyle = 'rgba(47,42,37,0.75)';
      x.fillRect(0, H - capH, W, lw); // черта над подписью
      var fs = Math.round(capH * 0.5);
      x.font = '700 ' + fs + 'px ' + FONT;
      while (x.measureText(caption).width > W * 0.92 && fs > 10) { fs -= 2; x.font = '700 ' + fs + 'px ' + FONT; }
      x.fillStyle = '#2f2a25';
      x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText(caption, W / 2, H - capH / 2 + lw);
      c.toBlob(function (blob) {
        if (!blob) return;
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'kukuruznik-1979.png';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
      }, 'image/png');
    });
  });

  // размер текста: крупный (по умолчанию) / обычный
  function setTextSize(v) {
    v = v === 'normal' ? 'normal' : 'large';
    document.documentElement.setAttribute('data-textsize', v);
    segMark('sizeSeg', 'data-size', v);
    lsSet('chka-textsize', v);
  }
  document.querySelectorAll('#sizeSeg button').forEach(function (b) {
    b.addEventListener('click', function () { setTextSize(b.getAttribute('data-size')); });
  });
  setTextSize(lsGet('chka-textsize'));

  // ---------- старт ----------
  // Сначала грузим и показываем только первый кадр (день). Остальные кадры, закат, ночь — потом, в фоне, по одному, в простое.
  // (Откат без WebGL грузит все кадры сразу: слои для CSS-варианта нужны заранее.)
  // Первый кадр при сбое сети пробуем ещё раз (до 3 попыток): иначе на плохой связи экран загрузки остался бы навсегда.
  function withRetry(make, tries) {
    return make().catch(function (err) {
      if (tries <= 1) throw err;
      console.warn('кадр не загрузился, пробую ещё раз —', err && err.message);
      return new Promise(function (r) { setTimeout(r, 700); }).then(function () { return withRetry(make, tries - 1); });
    });
  }
  var firstP = useGL ? Promise.all([withRetry(function () { return loadDay(0); }, 3), glReadyP])
    : Promise.all(FRAMES.map(function (_, i) { return withRetry(function () { return loadDay(i); }, 3); }));
  firstP.then(function () {
    if (!useGL) buildFallbackDom();
    setNaturalSize(store[0].w, store[0].h);
    buildDots();
    buildThumbs();
    buildHotspots(0);
    frame(performance.now());            // первая отрисовка, потом убираем экран загрузки —
    stage.classList.remove('loading');   // пустого кадра не бывает, даже если вкладка в фоне
    wl.loaded();                         // приветствие держится ещё, если прошло меньше 3 с; потом уходит само
    flagUpdate();
    if (useGL) startBackground();
  }).catch(function (err) {
    console.error(err);
    wl.fail('Не удалось загрузить кадры: ' + (err && err.message ? err.message : err));
  });

})();
