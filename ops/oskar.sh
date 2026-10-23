#!/bin/bash
# Oskar helper: started at boot by cron (@reboot). Starts the Node server and
# restarts it when it exits (crash) or stops answering (hang: 3 failed checks).
export PATH="/opt/homebrew/bin:/Users/macminim5/.local/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export HOME="/Users/macminim5"
cd /Oskar
LOG=/Oskar/logs/server.log
stop_server() { kill -9 $(lsof -nP -t -iTCP:3000 -sTCP:LISTEN) "$1" 2>/dev/null; }
while true; do
  stop_server
  echo "$(date '+%F %T') [oskar.sh] starting npm run dev" >> "$LOG"
  npm run dev >> "$LOG" 2>&1 &
  pid=$!
  sleep 180                       # first compile is slow; no checks before
  fails=0
  while kill -0 "$pid" 2>/dev/null; do
    if curl -s -o /dev/null -m 30 http://localhost:3000/api/dream; then fails=0; else fails=$((fails+1)); fi
    if [ "$fails" -ge 3 ]; then
      echo "$(date '+%F %T') [oskar.sh] no answer 3x — restarting" >> "$LOG"
      stop_server "$pid"; break
    fi
    sleep 60
  done
  echo "$(date '+%F %T') [oskar.sh] server stopped — restart in 10 s" >> "$LOG"
  sleep 10
done
