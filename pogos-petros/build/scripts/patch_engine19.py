#!/usr/bin/env python3
"""Заход 19 (e1.54): подписи кадров на экране (шаг 6 ч.1 «Погос-Петроса»).
- viewer.js: CONFIG.CAPS = [{c: подпись кадра, s: подпись шоу}] по кадрам (строит build_pages, только если у здания look.captions: true).
  Табличка #frameCap создаётся скриптом (ни в page.html, ни в стилях страницы ничего не меняется — Ленин и Кукурузник побайтно те же):
  мелкая бумажная табличка Chka Serif внизу кадра над точками (телефон) / внизу картинки (ПК); pointer-events: none — кнопки, инфо-точки и жесты
  работают как раньше. Гаснет: на переходе между кадрами, пока открыта карточка точки, меню (телефон), во весь экран, до конца приветствия.
  Подпись шоу (showCaption) — на пике показа этого кадра (доля показа CAPS_SHOW, по умолчанию 0,30–0,80); на это время подпись кадра убрана.
  Язык — язык страницы (смена языка — мягкая смена текста).
- build_pages: look.captions -> CONFIG.CAPS; schema: look.captions (только true).
- engine/VERSION e1.54.
Повторный запуск ничего не меняет (метки-охраны)."""
from pathlib import Path
V = Path('engine/viewer.js'); S = Path('tools/building_schema.py'); BP = Path('tools/build_pages.py'); VER = Path('engine/VERSION')
v = V.read_text(); s = S.read_text(); bp = BP.read_text()

def rep(t, old, new, tag, guard):
    if guard in t:
        return t
    assert t.count(old) == 1, ('нет/не один фрагмент', tag, t.count(old))
    return t.replace(old, new)

CAP = r"""  // ---------- e1.54: подписи кадров (только если у здания look.captions → CONFIG.CAPS) ----------
  // Мелкая бумажная табличка Chka Serif внизу кадра. Создаётся здесь, не в page.html: у зданий без CAPS страница та же.
  var CAPS = CONFIG.CAPS || null, CAP_SHOW = CONFIG.CAPS_SHOW || [0.3, 0.8], capEl = null, capTxt = null, capCur = null, capTimer = 0, capReady = null;
  if (CAPS) {
    var capCss = document.createElement('style');
    capCss.textContent =
      '#frameCap{position:absolute;z-index:5;left:50%;bottom:calc(var(--safe-b) + var(--bar-h) + var(--s1) + 21px);width:max-content;max-width:calc(100% - 168px);box-sizing:border-box;' +
      'padding:5px 12px 6px;text-align:center;pointer-events:none;user-select:none;-webkit-user-select:none;background:rgba(248,241,224,.93);color:var(--ink);' +
      'border:1px solid rgba(47,42,37,.5);border-radius:2px;box-shadow:inset 0 0 0 2px rgba(248,241,224,.93),inset 0 0 0 3px rgba(47,42,37,.22),0 3px 8px rgba(60,45,20,.22);' +
      'font:600 11.5px/1.32 var(--font);letter-spacing:.02em;opacity:0;transform:translate(-50%,6px);transition:opacity 300ms var(--out),transform 520ms var(--spring)}' +
      '#frameCap.on{opacity:1;transform:translate(-50%,0)}' +
      '@media (min-width:1024px){#frameCap{bottom:14px;max-width:min(560px,calc(100% - 40px));font-size:13px;padding:6px 16px 7px}}' +
      '@media (prefers-reduced-motion:reduce){html:not([data-motion="on"]) #frameCap{transition:opacity 200ms linear;transform:translate(-50%,0)}}' +
      'body.immersive #frameCap{opacity:0 !important}';
    document.head.appendChild(capCss);
    capEl = document.createElement('div'); capEl.id = 'frameCap'; capEl.setAttribute('role', 'note');
    capTxt = document.createElement('span'); capEl.appendChild(capTxt); stage.appendChild(capEl);
  }
  function capWant(now) {   // что показать сейчас: ['f'|'s', {hy, ru, en}] или null
    var c = CAPS[frameIndex]; if (!c || fade) return null;
    var D = window.Details, run = !!(D && D.paradeBusy && D.paradeBusy());
    if (run && c.s) {   // идёт показ кадра с подписью шоу: подпись шоу — на пике, до и после — ничего
      var p = D.paradeProgress ? D.paradeProgress(now) : -1;
      return p >= CAP_SHOW[0] && p <= CAP_SHOW[1] ? ['s', c.s] : null;
    }
    return c.c ? ['f', c.c] : null;
  }
  function capSet(key, txt) {
    if (key === capCur) return; capCur = key; clearTimeout(capTimer);
    var vis = capEl.classList.contains('on');
    if (vis) capEl.classList.remove('on');
    if (!txt) return;
    var put = function () { capTxt.textContent = txt; capEl.classList.add('on'); };
    if (vis) capTimer = setTimeout(put, 280); else put();
  }
  function capStep(now) {   // из рендер-цикла; DOM трогаем только когда подпись сменилась
    if (!CAPS) return;
    var sheet = bodyEl.classList.contains('sheet-open') && !desktopMQ.matches;
    var want = capReady !== null && now >= capReady && !stage.classList.contains('loading') && !stage.classList.contains('reading') && !sheet &&
      !bodyEl.classList.contains('immersive') ? capWant(now) : null;
    capSet(want ? want[0] + frameIndex + currentLang : '', want ? (want[1][currentLang] || want[1].en || want[1].ru) : null);
  }

"""
v = rep(v, "  // ---------- рендер-цикл ----------\n  var t0 = performance.now();", CAP + "  // ---------- рендер-цикл ----------\n  var t0 = performance.now();", 'cap-block', 'e1.54: подписи кадров')
v = rep(v, "    // --- время суток: день→закат 2.5 с, закат→ночь 3 с",
        "    if (CAPS) safe('caption', function () { capStep(now); });   // e1.54: подпись кадра (до раннего возврата при открытой карточке точки)\n\n    // --- время суток: день→закат 2.5 с, закат→ночь 3 с",
        'cap-step', "safe('caption'")
v = rep(v, "    wl.loaded();                         // приветствие держится ещё",
        "    capReady = performance.now() + 3300;   // e1.54: подпись — после приветствия\n    wl.loaded();                         // приветствие держится ещё", 'cap-ready', 'capReady = performance.now()')
V.write_text(v)

# ---------- build_pages ----------
bp = rep(bp, "    if look.get('gusts'):", "    if look.get('captions'):   # e1.54: подписи кадров/шоу на экране (только если задано у здания — у остальных CONFIG тот же)\n        C['CAPS'] = [{'c': f.get('caption'), 's': f.get('showCaption')} for f in fr]\n    if look.get('gusts'):", 'bp-caps', "C['CAPS']")
BP.write_text(bp)

# ---------- schema ----------
s = rep(s, "optional=('hotspots', 'showNight', 'nightEdge', 'bronzeKeep', 'snow', 'gusts', 'noon'))", "optional=('hotspots', 'showNight', 'nightEdge', 'bronzeKeep', 'snow', 'gusts', 'noon', 'captions'))", 'sc-opt', "'noon', 'captions'")
s = rep(s, "    if look and 'nightEdge' in look and look['nightEdge'] != 'solid':",
        "    if look and 'captions' in look:   # e1.54: подписи кадров на экране\n"
        "        if look['captions'] is not True:\n"
        "            c.err('look.captions', 'только true (показывать подписи кадров frames[].caption и подписи шоу showCaption на экране) или поле не задавать')\n"
        "        elif not any(isinstance(f, dict) and f.get('caption') for f in b['frames']):\n"
        "            c.err('look.captions', 'включено, но ни у одного кадра нет подписи frames[].caption')\n"
        "    if look and 'nightEdge' in look and look['nightEdge'] != 'solid':", 'sc-check', "look.captions', 'только true")
S.write_text(s)
VER.write_text('e1.54\n')
print('OK patch_engine19')
