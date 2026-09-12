/* controls.js — палец и инерция.
   Отвечает только за то, куда смотрит камера: угол по горизонтали (yaw),
   наклон (pitch) и приближение (zoom). Рисованием не занимается. */

(function (global) {
  'use strict';

  var DRAG_SPEED   = 0.0075;  // радиан на пиксель
  var FRICTION     = 0.945;   // затухание инерции за 1/60 секунды
  var MAX_SPIN     = 0.105;   // ограничение скорости, чтобы не срывало в блендер
  var PITCH_MAX    = 1.12;    // сверху — почти с высоты птичьего полёта
  var PITCH_MIN    = -0.06;   // снизу — не ниже горизонта, иначе видно изнанку земли
  var ZOOM_MIN     = 0.48;
  var ZOOM_MAX     = 4.00;
  var AUTO_SPEED   = 0.0055;  // скорость автоповорота, радиан за кадр

  function create(element, state) {
    var pointers = new Map();   // активные пальцы
    var lastX = 0, lastY = 0;
    var pinchDist = 0;
    var moveDX = 0, moveDY = 0, moveTime = 0;
    var onFirstTouch = null;

    state.yaw = state.yaw || 0.6;
    state.pitch = state.pitch || 0.22;
    state.zoom = state.zoom || 1;
    state.vyaw = 0;
    state.vpitch = 0;
    state.auto = false;
    state.dragging = false;

    function centerOf() {
      var x = 0, y = 0, n = 0;
      pointers.forEach(function (p) { x += p.x; y += p.y; n++; });
      return { x: x / n, y: y / n, n: n };
    }

    function distOf() {
      var arr = [];
      pointers.forEach(function (p) { arr.push(p); });
      if (arr.length < 2) return 0;
      var dx = arr[0].x - arr[1].x;
      var dy = arr[0].y - arr[1].y;
      return Math.sqrt(dx * dx + dy * dy);
    }

    function down(e) {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (element.setPointerCapture) {
        try { element.setPointerCapture(e.pointerId); } catch (err) {}
      }
      var c = centerOf();
      lastX = c.x; lastY = c.y;
      pinchDist = distOf();
      state.dragging = true;
      state.vyaw = 0;
      state.vpitch = 0;
      moveDX = 0; moveDY = 0;
      moveTime = e.timeStamp;
      if (onFirstTouch) { onFirstTouch(); onFirstTouch = null; }
    }

    function move(e) {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      var c = centerOf();
      var dx = c.x - lastX;
      var dy = c.y - lastY;
      lastX = c.x; lastY = c.y;

      // Щипок двумя пальцами — приближение
      if (c.n >= 2) {
        var d = distOf();
        if (pinchDist > 0 && d > 0) {
          state.zoom = clamp(state.zoom * (d / pinchDist), ZOOM_MIN, ZOOM_MAX);
        }
        pinchDist = d;
      }

      state.yaw += dx * DRAG_SPEED;
      state.pitch = clamp(state.pitch + dy * DRAG_SPEED, PITCH_MIN, PITCH_MAX);

      // Копим последнее движение — из него потом получится инерция
      var dt = e.timeStamp - moveTime;
      if (dt > 0) {
        var k = Math.min(1, dt / 60);
        moveDX = moveDX * (1 - k) + dx * k * (16.7 / dt) * 1.0;
        moveDY = moveDY * (1 - k) + dy * k * (16.7 / dt) * 1.0;
        moveTime = e.timeStamp;
      }
      if (e.cancelable) e.preventDefault();
    }

    function up(e) {
      pointers.delete(e.pointerId);
      if (pointers.size === 0) {
        state.dragging = false;
        // Если палец замер перед тем, как оторваться — инерции быть не должно,
        // иначе здание улетает уже после того, как его «поставили».
        var idle = e.timeStamp - moveTime;
        if (idle > 90) {
          state.vyaw = 0;
          state.vpitch = 0;
        } else {
          state.vyaw = clamp(moveDX * DRAG_SPEED, -MAX_SPIN, MAX_SPIN);
          state.vpitch = clamp(moveDY * DRAG_SPEED, -MAX_SPIN, MAX_SPIN);
        }
      } else {
        var c = centerOf();
        lastX = c.x; lastY = c.y;
        pinchDist = distOf();
      }
    }

    function wheel(e) {
      // На десктопе — колесо мыши. На телефоне не вызывается.
      state.zoom = clamp(state.zoom * (e.deltaY < 0 ? 1.09 : 1 / 1.09), ZOOM_MIN, ZOOM_MAX);
      if (e.cancelable) e.preventDefault();
    }

    element.addEventListener('pointerdown', down, { passive: true });
    element.addEventListener('pointermove', move, { passive: false });
    element.addEventListener('pointerup', up, { passive: true });
    element.addEventListener('pointercancel', up, { passive: true });
    element.addEventListener('wheel', wheel, { passive: false });

    // Safari на iOS умеет свой зум страницы двумя пальцами — глушим
    ['gesturestart', 'gesturechange', 'gestureend'].forEach(function (n) {
      element.addEventListener(n, function (e) { e.preventDefault(); }, { passive: false });
    });

    // Шаг физики. dt — сколько миллисекунд прошло с прошлого кадра,
    // чтобы на 120-герцовом айфоне крутилось с той же скоростью, что на 60.
    function update(dt) {
      var steps = dt / 16.667;

      if (state.auto && !state.dragging) {
        // Плавно подгоняем скорость к скорости автоповорота, без рывка
        state.vyaw += (AUTO_SPEED - state.vyaw) * Math.min(1, 0.05 * steps);
        state.yaw += state.vyaw * steps;
        state.vpitch *= Math.pow(FRICTION, steps);
        state.pitch = clamp(state.pitch + state.vpitch * steps, PITCH_MIN, PITCH_MAX);
      } else if (!state.dragging) {
        state.yaw += state.vyaw * steps;
        state.pitch = clamp(state.pitch + state.vpitch * steps, PITCH_MIN, PITCH_MAX);
        var f = Math.pow(FRICTION, steps);
        state.vyaw *= f;
        state.vpitch *= f;
        if (Math.abs(state.vyaw) < 0.00002) state.vyaw = 0;
        if (Math.abs(state.vpitch) < 0.00002) state.vpitch = 0;
      }

      // Держим угол в разумных пределах, чтобы число не росло вечно
      if (state.yaw > 1e4 || state.yaw < -1e4) state.yaw = state.yaw % (Math.PI * 2);
    }

    function reset() {
      state.yaw = 0.6;
      state.pitch = 0.22;
      state.zoom = 1;
      state.vyaw = 0;
      state.vpitch = 0;
    }

    function isMoving() {
      return state.dragging || state.auto ||
             Math.abs(state.vyaw) > 0 || Math.abs(state.vpitch) > 0;
    }

    return {
      update: update,
      reset: reset,
      isMoving: isMoving,
      onFirstTouch: function (fn) { onFirstTouch = fn; }
    };
  }

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  global.Controls = { create: create };

})(window);
