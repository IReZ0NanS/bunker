#!/bin/zsh

SCRIPT_DIR=${0:A:h}
PID_FILE="$SCRIPT_DIR/.bunker.pid"
LOG_FILE="$SCRIPT_DIR/.bunker.log"
SITE_URL="http://localhost:3000"

cd "$SCRIPT_DIR" || exit 1
clear
echo "Бункер: запускаю сайт і сервер…"
echo

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Не знайдено Node.js. Встановіть Node.js 22.13 або новіший і запустіть цей файл ще раз."
  echo
  read "?Натисніть Enter, щоб закрити вікно…"
  exit 1
fi

if [[ -f "$PID_FILE" ]]; then
  RUNNING_PID=$(<"$PID_FILE")
  if [[ "$RUNNING_PID" == <-> ]] && kill -0 "$RUNNING_PID" 2>/dev/null; then
    echo "Бункер уже працює. Відкриваю сайт…"
    open "$SITE_URL"
    exit 0
  fi
  rm -f "$PID_FILE"
fi

if [[ ! -d "$SCRIPT_DIR/node_modules" ]]; then
  echo "Перший запуск: готую необхідні компоненти…"
  npm install
  if [[ $? -ne 0 ]]; then
    echo
    echo "Не вдалося підготувати компоненти."
    read "?Натисніть Enter, щоб закрити вікно…"
    exit 1
  fi
fi

nohup npm run dev -- --port 3000 >"$LOG_FILE" 2>&1 &
SERVER_PID=$!
echo "$SERVER_PID" >"$PID_FILE"

for attempt in {1..90}; do
  if curl -fsS "$SITE_URL" >/dev/null 2>&1; then
    echo "Готово. Відкриваю Бункер у браузері."
    open "$SITE_URL"
    exit 0
  fi

  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    break
  fi
  sleep 1
done

rm -f "$PID_FILE"
echo
echo "Сервер не запустився. Останні повідомлення:"
tail -n 20 "$LOG_FILE"
echo
read "?Натисніть Enter, щоб закрити вікно…"
exit 1
