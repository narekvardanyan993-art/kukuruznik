#!/usr/bin/env python3
"""Заход 16 (e1.51, только код):
- details.js: надпись D «резьба в камне» — letters.carve {groove, light, ember1, ember2} (атласы ×8, fix16.py insc): желобок (multiply), верхний край
  светлее (screen), тление углей в желобке — два узора шума переливаются, медленное мерцание; буквы проступают по одной. Код только модулирует пиксели камня.
- viewer.js showVideo diff у слоя здания: где видео совпало с подложкой — здание стирается целиком (а не на долю «отличия от рисунка»):
  на руинах B больше нет бледных следов колоколен (светлый камень, похожий цветом на небо, оставался на (1 − a)).
- viewer.js открытка (телефон): лицо + оборот ОДНИМ нажатием — navigator.share({files: [лицо, оборот]}); двухшаговый путь e1.35 — только запасной,
  если share с двумя файлами вернул ошибку (или canShare его не берёт): плашка «Открытка готова» → лицо, потом «Сохранить оборот».
- schema: letters — либо dark/fire/glow (e1.46), либо carve.
Повторный запуск ничего не меняет (метки-охраны)."""
from pathlib import Path
V = Path('engine/viewer.js'); D = Path('engine/details.js'); S = Path('tools/building_schema.py')
v = V.read_text(); d = D.read_text(); s = S.read_text()

def rep(t, old, new, tag, guard=None):
    if new in t or (guard and guard in t): return t
    assert t.count(old) == 1, ('нет/не один фрагмент', tag, t.count(old))
    return t.replace(old, new)

# ---------- details.js: carve ----------
CARVE = r"""  // e1.51 carve (D, заход 16): буквы — резьба в камне. Атласы ×8 к пикселям кадра (pogos-petros/build/scripts/fix16.py insc), RGB без альфы:
  //   groove — multiply (белый фон): желобок темнее, нижняя кромка в тени; light — screen (чёрный фон): верхний край светлее (emboss по маске шрифта);
  //   ember1/ember2 — screen: тление в глубине желобка, два узора тёплого шума — их доли медленно переливаются, яркость мерцает плавно (низкие частоты).
  //   Слои рисуются операцией multiply / lighter — соседние клетки не затирают друг друга. Буквы проступают по одной (step), угли разгораются следом.
  function fxCarve(it, tt, len, a) {
    var C = it.carve, fe = V.entry(par.fr), gr = spImg(par.fr, C.groove), li = spImg(par.fr, C.light), e1 = spImg(par.fr, C.ember1), e2 = spImg(par.fr, C.ember2);
    if (!fe || !gr || !li || !e1 || !e2) return;
    var R = it.rect, a0 = spP(fe, R[0], R[1], it.bld), a1 = spP(fe, R[2], R[3], it.bld), sz = it.size || [1, 1];
    var kx = (a1[0] - a0[0]) / sz[0], ky = (a1[1] - a0[1]) / sz[1], st = it.step || 0.3, rise = it.rise || 0.8, off = len - (it.out || 3), cells = it.cells || [];
    var bd = blendLayer('multiply'), bs = blendLayer('screen'); bd.save(); bs.save();
    bd.globalCompositeOperation = 'multiply'; bs.globalCompositeOperation = 'lighter';
    for (var i = 0; i < cells.length; i++) {
      var c = cells[i], ti = tt - i * st; if (ti <= 0) continue;
      var endK = 1 - sstep(0, 1.4, tt - off - i * (it.outStep || 0.1)); if (endK <= 0) continue;
      var vis = sstep(0, rise, ti) * endK, heat = sstep(rise * 0.4, rise + (it.ignite || 0.9), ti) * (0.65 + 0.35 * Math.exp(-ti / (it.burn || 3))) * endK;
      var fl = 0.74 + 0.26 * (0.5 * Math.sin(tt * 0.9 + i * 2.3) + 0.3 * Math.sin(tt * 1.7 + i * 0.9) + 0.2 * Math.sin(tt * 2.9 + i * 4.1));   // медленное мерцание углей
      var m = 0.5 + 0.5 * Math.sin(tt * 0.7 + i * 1.9);   // какой узор углей сильнее — шум «переливается»
      var dx = a0[0] + c[4] * kx, dy = a0[1] + c[5] * ky, dw = c[2] * kx, dh = c[3] * ky, ek = (it.emberK == null ? 1 : it.emberK) * heat * fl;
      bd.globalAlpha = clamp(a * vis, 0, 1); bd.drawImage(gr, c[0], c[1], c[2], c[3], dx, dy, dw, dh);
      bs.globalAlpha = clamp(a * vis * (it.lightK == null ? 1 : it.lightK), 0, 1); bs.drawImage(li, c[0], c[1], c[2], c[3], dx, dy, dw, dh);
      bs.globalAlpha = clamp(a * ek * (1 - m), 0, 1); bs.drawImage(e1, c[0], c[1], c[2], c[3], dx, dy, dw, dh);
      bs.globalAlpha = clamp(a * ek * m, 0, 1); bs.drawImage(e2, c[0], c[1], c[2], c[3], dx, dy, dw, dh);
    }
    bd.restore(); bs.restore();
  }
"""
d = rep(d, "  function fxImageDraw(it, tt, len, a) {", CARVE + "  function fxImageDraw(it, tt, len, a) {", 'carve fn', guard='e1.51 carve (D, заход 16)')
d = rep(d, "      else if (it.kind === 'letters') fxLetters(it, tt, len, a);",
        "      else if (it.kind === 'letters') { if (it.carve) fxCarve(it, tt, len, a); else fxLetters(it, tt, len, a); }   // e1.51: carve — резьба в камне", 'carve dispatch')
d = rep(d, "      [it.src, it.mask, it.dark, it.fire, it.glow, it.hole].concat(",
        "      [it.src, it.mask, it.dark, it.fire, it.glow, it.hole].concat(it.carve ? [it.carve.groove, it.carve.light, it.carve.ember1, it.carve.ember2] : [], ", 'carve preload')

# ---------- viewer.js: showVideo — у слоя здания «видео = подложка» стирает здание целиком ----------
v = rep(v, "      if (ke < 1) { o[q] = vdd[s4] * a * ke + o[q] * b1; o[q + 1] = vdd[s4 + 1] * a * ke + o[q + 1] * b1; o[q + 2] = vdd[s4 + 2] * a * ke + o[q + 2] * b1; o[q + 3] = 255 * a * ke + o[q + 3] * b1; continue; }\n",
        "      if (ke < 1) {   // e1.51: видео здесь = подложка → здание стирается на полную силу маски (а не на долю «отличия от рисунка»: светлый камень, похожий на небо, оставался бледным следом)\n"
        "        var ae = Math.max(a, al[k] * vis * (1 - ke)), be = 1 - ae;\n"
        "        o[q] = vdd[s4] * ae * ke + o[q] * be; o[q + 1] = vdd[s4 + 1] * ae * ke + o[q + 1] * be; o[q + 2] = vdd[s4 + 2] * ae * ke + o[q + 2] * be; o[q + 3] = 255 * ae * ke + o[q + 3] * be; continue;\n"
        "      }\n", 'showv erase')
# дифф-проверка: где видео похоже на рисунок, но совпало с подложкой — тоже стирать (раньше kd ≤ 0 → continue раньше проверки подложки)
v = rep(v, "kd = (dv - st.dlo) * st.dk; if (kd <= 0) continue; if (kd < 1) a *= kd * kd * (3 - 2 * kd); }   // e1.50 diff",
        "kd = (dv - st.dlo) * st.dk; if (kd <= 0 && !gr) continue; a *= kd <= 0 ? 0 : (kd < 1 ? kd * kd * (3 - 2 * kd) : 1); }   // e1.50 diff (e1.51: у слоя здания дальше — проверка подложки)", 'diff continue')

# ---------- viewer.js: открытка одним нажатием ----------
v = rep(v, "  var touchNoShare = TOUCH_DEV && !shareOK;   // телефон, но Web Share с файлами недоступен",
"""  var touchNoShare = TOUCH_DEV && !shareOK;   // телефон, но Web Share с файлами недоступен
  // e1.51 (просьба Нарека): лицо + оборот — ОДНИМ нажатием, navigator.share({files: [лицо, оборот]}); файлы собраны заранее (cardFilesPrep).
  // Запасной путь (двухшаговый, e1.35) — только если share с двумя файлами вернул ошибку или canShare их не берёт: дальше по файлу на нажатие
  // (плашка «Открытка готова» → лицо, потом «Сохранить оборот»). cardTwo держится до перезагрузки страницы.
  var cardTwo = false;
  function share2(files) {
    var p; try { p = navigator.share({ files: files }); } catch (e) { p = Promise.reject(e); }
    return p.then(hideToast, function (e) {
      if (e && e.name === 'AbortError') { hideToast(); return; }   // человек закрыл меню сам
      cardTwo = true; goStep(false);   // два файла не прошли — запасной путь: лицо по плашке (новый жест), потом «Сохранить оборот»
      showToast(files[0], function () { goStep(true); });
    });
  }""", 'share2', guard='var cardTwo = false;')
v = rep(v, """    if (shareOK) {   // e1.35: один файл на share; с оборотом — два нажатия (лицо, потом «Сохранить оборот»)
      var second = goBack && !!back, f = cardFileNow(second);""",
"""    if (shareOK) {   // e1.51: с оборотом — оба файла одним share; запасной путь (e1.35) — по файлу на нажатие (лицо, потом «Сохранить оборот»)
      if (back && !goBack && !cardTwo) {
        var f1 = cardFileNow(false), f2 = cardFileNow(true), both = f1 && f2 ? [f1, f2] : null, can = false;
        try { can = !!both && navigator.canShare({ files: both }); } catch (e) { can = false; }
        if (can) { share2(both); return; }
        if (both) cardTwo = true;   // два файла share не берёт — сразу двухшаговый путь
      }
      var second = goBack && !!back, f = cardFileNow(second);""", 'deliver one tap')
v = rep(v, """  function showToast(file) {   // file — файл или список (лицо + оборот); share не открылся без жеста — второе нажатие по плашке откроет его наверняка
    toastFile = file; if (!cardToast) return;""",
"""  var toastAfter = null;   // e1.51: что сделать после share по плашке (запасной путь: кнопка становится «Сохранить оборот»)
  function showToast(file, after) {   // file — файл или список (лицо + оборот); share не открылся без жеста — второе нажатие по плашке откроет его наверняка
    toastFile = file; toastAfter = after || null; if (!cardToast) return;""", 'toast after')
v = rep(v, "  if (cardToast) cardToast.addEventListener('click', function () { if (toastFile) shareFile(toastFile); });",
        "  if (cardToast) cardToast.addEventListener('click', function () {   // e1.51: список из двух файлов — share2 (с запасным путём); после share по плашке — toastAfter\n"
        "    var f = toastFile, af = toastAfter; toastAfter = null; if (!f) return;\n"
        "    if (Array.isArray(f) && f.length > 1 && !cardTwo) share2(f); else { shareFile(Array.isArray(f) ? f[0] : f); if (af) af(); }\n"
        "  });", 'toast click')
v = rep(v, "      if (shareOK) { var f = cardFileNow(false); if (f) { showToast(f); goStep(!!cfg.back); } }",
        "      if (shareOK) { var f = cardFileNow(false), fb2 = cfg.back && !cardTwo ? cardFileNow(true) : null; if (f && fb2) showToast([f, fb2]); else if (f) { showToast(f); goStep(!!cfg.back); } }   // e1.51: с оборотом — оба файла одной плашкой", 'slow path')
v = rep(v, "step: goBack ? 'back' : 'front',", "step: goBack ? 'back' : 'front', two: cardTwo,", 'state two')

# ---------- schema: letters — dark/fire/glow ИЛИ carve ----------
s = rep(s, """                    for kk in ('rect', 'size', 'dark', 'fire', 'glow', 'cells'):
                        if kk not in it: c.err(wl, 'letters: нет %s' % kk)""",
"""                    for kk in ('rect', 'size', 'cells') + (() if 'carve' in it else ('dark', 'fire', 'glow')):   # e1.51: carve — резьба (атласы fix16.py insc)
                        if kk not in it: c.err(wl, 'letters: нет %s' % kk)
                    if 'carve' in it:
                        cv = it['carve']
                        if not (isinstance(cv, dict) and all(isinstance(cv.get(q), str) and cv[q].startswith('show_') for q in ('groove', 'light', 'ember1', 'ember2'))):
                            c.err(wl + '.carve', '{groove, light, ember1, ember2} — картинки show_*')
                        elif isinstance(b.get('framesDir'), str):
                            for q in ('groove', 'light', 'ember1', 'ember2'): c.file(posixpath.join(b['framesDir'], cv[q]), '%s.carve.%s' % (wl, q), 'картинка')""", 'schema carve')
V.write_text(v); D.write_text(d); S.write_text(s)
Path('engine/VERSION').write_text('e1.51\n')
print('ok16')
