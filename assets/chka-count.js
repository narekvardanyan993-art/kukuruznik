/* Честный счётчик chka.am (Cloudflare Web Analytics) — ЕДИНСТВЕННОЕ место, где он подключается. Токен — в data-token тега <script>.
   Не считаем: устройство с меткой «это я» (localStorage chka_me=1; ставит ?me, снимает ?me=0), автоматику (navigator.webdriver:
   наши проверки и агенты), любой хост кроме chka.am (локальные проверки, превью). Всё в try/catch (приватный режим Safari). */
(function () {
  var me = false, q = location.search.match(/[?&]me(?:=([^&#]*))?(?=&|#|$)/), s = document.currentScript, tok = s && s.getAttribute('data-token');
  try {
    if (q) {
      if (q[1] === '0') { localStorage.removeItem('chka_me'); localStorage.removeItem('chka_owner'); }
      else { localStorage.setItem('chka_me', '1'); localStorage.setItem('chka_owner', '1'); }   // chka_owner — чтобы страницы со старым инлайн-сниппетом (движок e1/Кукурузник) тоже не считали
    }
    me = localStorage.getItem('chka_me') === '1' || localStorage.getItem('chka_owner') === '1';   // chka_owner — старая метка (до 25.11)
  } catch (e) { me = !!q && q[1] !== '0'; }
  if (q) {
    var off = q[1] === '0', lang = document.documentElement.getAttribute('lang') || 'ru';
    var T = { hy: ['Այս սարքը չի հաշվվում', 'Նշումը հեռացված է՝ սարքը հաշվվում է'], ru: ['это устройство не считается', 'метка снята — устройство считается'], en: ['this device is not counted', 'mark removed — this device is counted'] };
    var text = (T[lang] || T.ru)[off ? 1 : 0];
    var note = function () {
      var d = document.createElement('div');
      d.textContent = text;
      d.style.cssText = 'position:fixed;left:50%;bottom:12px;transform:translateX(-50%);z-index:2147483647;background:rgba(40,30,20,.88);color:#fff;font:12px/1.3 sans-serif;padding:6px 12px;border-radius:14px;pointer-events:none';
      document.body.appendChild(d);
      setTimeout(function () { d.remove(); }, 3000);
    };
    if (document.body) note(); else document.addEventListener('DOMContentLoaded', note);
  }
  if (me || navigator.webdriver || !tok || !/(^|\.)chka\.am$/.test(location.hostname)) return;
  var b = document.createElement('script');
  b.defer = true;
  b.src = 'https://static.cloudflareinsights.com/beacon.min.js';
  b.setAttribute('data-cf-beacon', JSON.stringify({ token: tok }));
  document.head.appendChild(b);
})();
