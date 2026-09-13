# -*- coding: utf-8 -*-
"""Сборка: склеивает куски из src/ обратно в js/engine.js и js/model.js.

   Зачем так. Весь движок — одна замкнутая функция: палитра, время суток и
   десятки цветов видны всем рисующим кускам только потому, что они лежат
   внутри неё. Разрежь это на настоящие модули — и половина кода перестанет
   видеть свои переменные, придётся переписывать сотни мест. Поэтому режем
   ИСХОДНИК, а браузеру отдаём один склеенный файл: править можно кусок в
   10 КБ вместо простыни в 115 КБ, а поведение не меняется ни на байт.

   Порядок склейки — по имени файла, отсюда номера в начале имён.

   Запуск:  python3 build.py
            python3 build.py --check   (ничего не пишет, только сравнивает)
"""
import os, sys, hashlib

HERE = os.path.dirname(os.path.abspath(__file__))
JOBS = [('src/engine', 'js/engine.js'), ('src/model', 'js/model.js')]

BANNER = (
    '/* ВНИМАНИЕ: этот файл СОБРАН автоматически из src/%s/.\n'
    '   Правки здесь пропадут при следующей сборке — правь куски в src/,\n'
    '   потом запусти:  python3 build.py                                   */\n')

check = '--check' in sys.argv
bad = 0

for srcdir, out in JOBS:
    d = os.path.join(HERE, srcdir)
    names = sorted(n for n in os.listdir(d) if n.endswith('.js'))
    body = ''.join(open(os.path.join(d, n), encoding='utf-8').read() for n in names)
    text = BANNER % os.path.basename(srcdir) + body
    path = os.path.join(HERE, out)
    old = open(path, encoding='utf-8').read() if os.path.exists(path) else ''
    same = (old == text)
    if check:
        print(('совпадает   ' if same else 'РАЗОШЛОСЬ   ') + out)
        bad += 0 if same else 1
    else:
        if not same:
            open(path, 'w', encoding='utf-8').write(text)
        print('%s %s  <- %d кусков, %d строк' % (
            'собран  ' if not same else 'без изменений', out, len(names), text.count('\n')))

sys.exit(1 if bad else 0)
