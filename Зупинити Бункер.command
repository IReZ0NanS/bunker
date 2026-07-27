#!/bin/zsh

SCRIPT_DIR=${0:A:h}
PID_FILE="$SCRIPT_DIR/.bunker.pid"

cd "$SCRIPT_DIR" || exit 1
clear
echo "Бункер: зупиняю сайт і сервер…"
echo

if [[ ! -f "$PID_FILE" ]]; then
  echo "Бункер уже зупинено."
  sleep 2
  exit 0
fi

SERVER_PID=$(<"$PID_FILE")
if [[ "$SERVER_PID" != <-> ]]; then
  rm -f "$PID_FILE"
  echo "Файл запуску застарів. Бункер вважається зупиненим."
  sleep 2
  exit 0
fi

pkill -TERM -P "$SERVER_PID" 2>/dev/null
kill "$SERVER_PID" 2>/dev/null

for attempt in {1..20}; do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    rm -f "$PID_FILE"
    echo "Готово. Бункер зупинено."
    sleep 2
    exit 0
  fi
  sleep 0.25
done

pkill -KILL -P "$SERVER_PID" 2>/dev/null
kill -KILL "$SERVER_PID" 2>/dev/null
rm -f "$PID_FILE"
echo "Готово. Бункер зупинено."
sleep 2
