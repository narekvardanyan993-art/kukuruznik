// Лист шрифта: название, приветствие, подсказка, панель на трёх языках (docs/font-sheet.png).
//   node tools/font_sheet.mjs      (сервер :8080 из корня репозитория)
import puppeteer from 'puppeteer';
import fs from 'fs';

const html = fs.readFileSync('test-assets/depth.html', 'utf8');
const ff = html.match(/@font-face[\s\S]*?(?=:root)/)[0].replace(/url\(fonts\//g, 'url(fonts/');
const T = {
  hy: { name: 'Կուկուռուզնիկ, 1979', welcome: 'Բարի գալուստ ինտերակտիվ «Կուկուռուզնիկ»', tap: 'Հպիր՝ սկսելու համար', hint: 'Քաշիր մատով կամ մկնիկով · սահեցրու՝ կադրը փոխելու համար',
        tod: 'Օրվա ժամը', d: 'Ցերեկ', s: 'Մայրամուտ', n: 'Գիշեր', frames: 'Կադրեր', fs: 'Լիաէկրան', card: 'Պահել բացիկը', size: 'Տառերի չափը', about: 'Շենքի մասին',
        text: 'Երիտասարդական պալատ, բացվել է 1979-ին։ Ժողովրդի մեջ՝ «Կուկուռուզնիկ»', more: 'Ավելին ›', lang: 'Հայերեն' },
  ru: { name: 'Кукурузник, 1979', welcome: 'Добро пожаловать в интерактивный Кукурузник', tap: 'коснись, чтобы начать', hint: 'Веди пальцем / мышью · свайп — сменить кадр',
        tod: 'Время суток', d: 'День', s: 'Закат', n: 'Ночь', frames: 'Кадры', fs: 'Полный экран', card: 'Сохранить открытку', size: 'Размер текста', about: 'О здании',
        text: 'Дом молодёжи, открыт в 1979. В народе — Кукурузник', more: 'подробнее ›', lang: 'Русский' },
  en: { name: 'Kukuruznik, 1979', welcome: 'Welcome to the interactive Kukuruznik', tap: 'tap to begin', hint: 'Drag with finger / mouse · swipe to change frame',
        tod: 'Time of day', d: 'Day', s: 'Sunset', n: 'Night', frames: 'Views', fs: 'Full screen', card: 'Save postcard', size: 'Text size', about: 'About the building',
        text: 'Youth Palace, opened in 1979. Nicknamed "the Corncob"', more: 'more ›', lang: 'English' }
};
const col = (l) => { const t = T[l]; return `<section>
  <div class="lang">${t.lang}</div>
  <div class="bar">${t.name}</div>
  <div class="welcome">${t.welcome}</div><div class="tap">${t.tap}</div>
  <div class="hint">${t.hint}</div>
  <div class="panel"><h3>${t.tod}</h3><div class="seg"><b>${t.d}</b><span>${t.s}</span><span>${t.n}</span></div>
  <h3>${t.frames}</h3><div class="btn">${t.fs}</div><div class="btn">${t.card}</div><h3>${t.size}</h3>
  <h3>${t.about}</h3><p>${t.text}</p><a>${t.more}</a></div></section>`; };
const page = `<!doctype html><meta charset="utf-8"><style>${ff}
:root{--font:"Kukuruznik Serif",Georgia,serif;--paper:#f5ecda;--ink:#2f2a25}
body{margin:0;background:#f5ecda;color:#2f2a25;font:15px/1.4 var(--font);padding:32px;display:grid;grid-template-columns:repeat(3,400px);gap:32px}
section{border:2px solid #2f2a25;border-radius:22px 8px 18px 10px/10px 18px 8px 22px;padding:24px;background:#f5ecda;box-shadow:3px 4px 0 rgba(47,42,37,.14)}
.lang{font:600 13px var(--font);opacity:.5;margin-bottom:16px}
.bar{font:700 18px/1.2 var(--font);text-align:center;padding:12px;border-top:2px solid #2f2a25;border-bottom:2px solid #2f2a25;margin-bottom:24px}
.welcome{font:700 30px/1.25 var(--font);text-align:center}.tap{font:600 20px/1.3 var(--font);opacity:.75;text-align:center;margin:8px 0 24px}
.hint{font:400 13px/1.3 var(--font);text-align:center;background:rgba(47,42,37,.08);border-radius:16px;padding:8px 16px;margin-bottom:24px}
h3{font:700 20px/1.2 var(--font);margin:16px 0 8px}
.seg{display:grid;grid-template-columns:repeat(3,1fr);border:2px solid #2f2a25;border-radius:12px 6px 12px 6px/6px 12px 6px 12px;overflow:hidden;font:600 15px var(--font)}
.seg>*{padding:12px 4px;text-align:center;border-right:1px solid rgba(47,42,37,.5)}.seg b{background:#2f2a25;color:#f5ecda}
.btn{border:2px solid #2f2a25;border-radius:12px 6px 12px 6px/6px 12px 6px 12px;padding:12px 16px;text-align:center;font:700 18px var(--font);margin-bottom:8px}
p{font-size:15px;margin:0 0 8px;line-height:1.35}a{font:700 15px var(--font);text-decoration:underline}</style>
${['hy','ru','en'].map(col).join('')}`;
fs.writeFileSync('test-assets/_fontsheet.html', page);
const b = await puppeteer.launch({ headless: 'new' });
const p = await b.newPage(); await p.setViewport({ width: 1340, height: 900, deviceScaleFactor: 1.5 });
await p.goto('http://localhost:8080/test-assets/_fontsheet.html', { waitUntil: 'load' });
await p.evaluate(() => document.fonts.ready); await new Promise((r) => setTimeout(r, 400));
const h = await p.evaluate(() => document.body.scrollHeight);
await p.setViewport({ width: 1340, height: h, deviceScaleFactor: 1.5 });
await p.screenshot({ path: 'docs/font-sheet.png' });
await b.close(); fs.unlinkSync('test-assets/_fontsheet.html');
console.log('docs/font-sheet.png');
