#!/usr/bin/env python3
"""Замер стоимости кадра Ленина в облачном Chromium (swiftshader): JS-время колбэка кадра, время GPU (gl.finish),
байты/время заливок текстур. Сценарии как в check_site (measureFps) + все 5 кадров днём и ночью.
  python3 probe.py URL [--scen checksite|frames] [--finish] [--secs 3]
"""
import json, sys, time, argparse
from playwright.sync_api import sync_playwright

INIT = r"""
(() => {
  const S = window.__probe = { frames: [], cur: null, on: false, finish: %FINISH% };
  const gget = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (k, o) {
    const c = gget.call(this, k, o);
    if (c && (k === 'webgl' || k === 'experimental-webgl') && !window.__gl) {
      window.__gl = c;
      for (const fn of ['texImage2D', 'texSubImage2D']) {
        const orig = c[fn].bind(c);
        c[fn] = function (...a) { const t = performance.now(); const r = orig(...a); if (S.cur) { S.cur.up += performance.now() - t; S.cur.upN++; } return r; };
      }
    }
    return c;
  };
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = function (cb) {
    return raf(function (ts) {
      const rec = S.on ? { t: performance.now(), js: 0, gpu: 0, up: 0, upN: 0 } : null;
      S.cur = rec;
      const t0 = performance.now();
      try { cb(ts); } finally {
        if (rec) {
          rec.js += performance.now() - t0;
          if (S.finish && window.__gl) { const t1 = performance.now(); window.__gl.finish(); rec.gpu += performance.now() - t1; }
        }
        S.cur = null;
      }
      if (rec) S.frames.push(rec);
    });
  };
})();
"""

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('url')
    ap.add_argument('--scen', default='checksite')
    ap.add_argument('--finish', action='store_true')
    ap.add_argument('--secs', type=float, default=3)
    ap.add_argument('--cpu', type=float, default=1)
    ap.add_argument('--out')
    ap.add_argument('--dsf', type=float, default=2)
    a = ap.parse_args()
    res = {}
    with sync_playwright() as pw:
        b = pw.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'])
        ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=a.dsf, is_mobile=True, has_touch=True)
        ctx.add_init_script(INIT.replace('%FINISH%', 'true' if a.finish else 'false'))
        p = ctx.new_page()
        errs = []
        p.on('pageerror', lambda e: errs.append(str(e)))
        if a.cpu > 1:
            c = ctx.new_cdp_session(p); c.send('Emulation.setCPUThrottlingRate', {'rate': a.cpu})
        p.goto(a.url, wait_until='load', timeout=180000)
        for _ in range(600):
            if p.evaluate("document.documentElement.getAttribute('data-loaded') === 'all' && !!window.Details && !document.getElementById('stage').classList.contains('loading')"):
                break
            time.sleep(0.25)
        p.evaluate("(() => { const w = document.getElementById('welcome'); if (w) w.remove(); })()")

        def meas(tag):
            p.evaluate("window.__probe.frames = []; window.__probe.on = true")
            time.sleep(a.secs)
            fr = p.evaluate("(() => { const S = window.__probe; S.on = false; return S.frames; })()")
            if len(fr) < 2:
                res[tag] = {'n': len(fr)}; print(tag, 'нет кадров'); return
            dur = fr[-1]['t'] - fr[0]['t']
            js = sorted(f['js'] for f in fr); gp = sorted(f['gpu'] for f in fr)
            r = {'n': len(fr), 'fps': round((len(fr) - 1) * 1000 / dur, 1),
                 'js_avg': round(sum(js) / len(js), 2), 'js_p90': round(js[int(len(js) * 0.9)], 2), 'js_max': round(js[-1], 1),
                 'gpu_avg': round(sum(gp) / len(gp), 2), 'gpu_p90': round(gp[int(len(gp) * 0.9)], 2),
                 'up_avg': round(sum(f['up'] for f in fr) / len(fr), 2), 'up_frames': sum(1 for f in fr if f['upN'])}
            res[tag] = r
            print(tag.ljust(30), json.dumps(r, ensure_ascii=False), flush=True)

        det = lambda ks: p.evaluate("(ks) => ks.forEach((x) => { try { window.Details.test(x, 0.4); } catch (e) {} })", ks)
        if a.scen == 'checksite':
            time.sleep(1.5); meas('день, кадр 1')
            det(['birds', 'plane', 'butterfly']); meas('день + 3 детали')
            p.evaluate("document.querySelector('#todSeg [data-tod=night]').click()"); time.sleep(7.5)
            det(['plane', 'moths', 'winlight']); meas('ночь, кадр 1 + 3 детали')
            p.keyboard.press('ArrowRight'); time.sleep(2.5); meas('ночь, кадр 2')
            time.sleep(3); meas('ночь, кадр 2 (+3 с)')
        else:
            n = p.evaluate("document.querySelectorAll('.thumb, [data-frame]').length")
            for tod in ['day', 'night']:
                if tod == 'night':
                    p.evaluate("document.querySelector('#todSeg [data-tod=night]').click()"); time.sleep(7.5)
                for k in range(5):
                    if k:
                        p.keyboard.press('ArrowRight'); time.sleep(5)
                    else:
                        time.sleep(3)
                    meas('%s, кадр %d' % ('день' if tod == 'day' else 'ночь', k + 1))
                p.keyboard.press('ArrowRight'); time.sleep(3)
        res['errors'] = errs
        b.close()
    if a.out:
        json.dump(res, open(a.out, 'w'), ensure_ascii=False, indent=1)

main()
