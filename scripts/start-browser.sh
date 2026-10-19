
#!/usr/bin/env bash
set -Eeuo pipefail

export DISPLAY=:1

# Create a full-HD virtual desktop with XRandR resize support.
Xvfb :1 -screen 0 1920x1080x24 -ac +extension RANDR \
  >/tmp/nebula-xvfb.log 2>&1 &

XVFB_PID=$!

cleanup() {
  kill "$XVFB_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

ready=false

for i in $(seq 1 30); do
  if xdpyinfo -display :1 >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done

if [[ "$ready" != true ]]; then
  echo "Xvfb did not start. Check /tmp/nebula-xvfb.log"
  exit 1
fi

fluxbox >/tmp/nebula-fluxbox.log 2>&1 &

x11vnc \
  -display :1 \
  -localhost \
  -forever \
  -shared \
  -nopw \
  -rfbport 5900 \
  >/tmp/nebula-x11vnc.log 2>&1 &

websockify \
  --web=/usr/share/novnc \
  6080 127.0.0.1:5900 \
  >/tmp/nebula-websockify.log 2>&1 &

# Wait for desktop services before launching Chromium.
sleep 2

while true; do
  echo "Starting Chromium app window..."

  chromium \
    --no-sandbox \
    --disable-dev-shm-usage \
    --no-first-run \
    --no-default-browser-check \
    --disable-background-networking \
    --user-data-dir=/tmp/nebula-chromium \
    --remote-debugging-address=127.0.0.1 \
    --remote-debugging-port=9222 \
    --app=about:blank \
    >>/tmp/nebula-chromium.log 2>&1 || true

  echo "Chromium exited. Restarting in 2 seconds..."
  sleep 2
done
