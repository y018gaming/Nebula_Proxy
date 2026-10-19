#!/usr/bin/env bash
set -euo pipefail

# The remote desktop services bind to loopback only; the Node app gates access.
export DISPLAY=:1
Xvfb :1 -screen 0 1440x900x24 -ac +extension RANDR >/tmp/nebula-xvfb.log 2>&1 &
for i in $(seq 1 30); do
  if xdpyinfo -display :1 >/dev/null 2>&1; then break; fi
  sleep 1
done
fluxbox >/tmp/nebula-fluxbox.log 2>&1 &
x11vnc -display :1 -localhost -forever -shared -nopw -rfbport 5900 >/tmp/nebula-x11vnc.log 2>&1 &
websockify --web=/usr/share/novnc 6080 127.0.0.1:5900 >/tmp/nebula-websockify.log 2>&1 &

# Chrome's debugging endpoint is loopback-only and is never port-forwarded.
chromium \
  --no-sandbox \
  --disable-dev-shm-usage \
  --no-first-run \
  --no-default-browser-check \
  --user-data-dir=/tmp/nebula-chromium \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port=9222 \
  --start-maximized \
  about:blank >/tmp/nebula-chromium.log 2>&1 &

wait
