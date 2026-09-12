#!/bin/bash
# Двойной клик по этому файлу — Кукурузник открывается в браузере.
#
# Сервер нужен только для того, чтобы смотреть с телефона по Wi-Fi.
# Если сервер завести не получается, файл всё равно откроется напрямую.

cd "$(dirname "$0")" || exit 1
PORT=8777

# --- если есть python3, поднимаем сервер: он нужен для телефона ---
if python3 -c "" >/dev/null 2>&1; then

  IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)

  echo ""
  echo "  КУКУРУЗНИК"
  echo "  ----------------------------------------"
  echo "  На этом компьютере:  http://localhost:$PORT"
  if [ -n "$IP" ]; then
    echo "  С телефона (тот же Wi-Fi):  http://$IP:$PORT"
  fi
  echo "  ----------------------------------------"
  echo "  Остановить: закрой это окно или Ctrl+C"
  echo ""

  if lsof -ti tcp:$PORT >/dev/null 2>&1; then
    echo "  Сервер уже работает — просто открываю браузер."
    echo "  (это окно можно закрыть)"
    open "http://localhost:$PORT"
    exit 0
  fi

  sleep 1 && open "http://localhost:$PORT" &
  exec python3 -m http.server "$PORT"
fi

# --- python3 не работает: открываем файл напрямую, без сервера ---
open index.html

echo ""
echo "  КУКУРУЗНИК открыт в браузере."
echo ""
echo "  Сервер поднять не вышло: python3 сейчас заблокирован —"
echo "  macOS просит принять лицензию Xcode. Для показа на компьютере"
echo "  он и не нужен, а вот для телефона нужен."
echo ""
echo "  Чинится один раз. Выполни в Терминале и введи пароль от компьютера:"
echo ""
echo "      sudo xcodebuild -license accept"
echo ""
echo "  После этого запусти этот файл ещё раз — появится адрес для телефона."
echo ""
read -n 1 -s -r -p "  Нажми любую клавишу, чтобы закрыть это окно..."
echo ""
