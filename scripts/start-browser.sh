```bash
#!/usr/bin/env bash
set -Eeuo pipefail

# Nebula virtual desktop configuration
DISPLAY_NUM="${DISPLAY_NUM:-:99}"
SCREEN_WIDTH="${SCREEN_WIDTH:-1920}"
SCREEN_HEIGHT="${SCREEN_HEIGHT:-1080}"
SCREEN_DEPTH="${SCREEN_DEPTH:-24}"

export DISPLAY="$DISPLAY_NUM"

# Start the virtual X display with RandR support.
Xvfb "$DISPLAY_NUM" \
  -screen 0 "${SCREEN_WIDTH}x${SCREEN_HEIGHT}x${SCREEN_DEPTH}" \
  -ac +extension RANDR \
  -nolisten tcp \
  > /tmp/nebula-xvfb.log 2>&1 &

XVFB_PID=$!

cleanup() {
  echo "Stopping Nebula desktop..."
  kill "$BROWSER_PID" "$WEBSOCKIFY_PID" "$VNC_PID" "$FLUXBOX_PID" "$XVFB_PID" \
    2>/dev/null || true
}

trap cleanup EXIT INT TERM

# Wait for Xvfb to become available.
for attempt in $(seq 1 30); do
  if xdpyinfo -display "$DISPLAY_NUM" >/dev/null 2>&1; then
    break
  fi

  if [ "$attempt" -eq 30 ]; then
    echo "Xvfb did not start. Check /tmp/nebula-xvfb.log."
    exit 1
  fi

  sleep 1
done

# Start the lightweight window manager.
fluxbox > /tmp/nebula-fluxbox.log 2>&1 &
FLUXBOX_PID=$!

# Expose the virtual desktop through VNC.
# -xrandr enables RandR resize support when available.
x11vnc \
  -display "$DISPLAY_NUM" \
  -localhost \
  -forever \
  -shared \
  -nopw \
  -xrandr \
  -rfbport 5900 \
  > /tmp/nebula-x11vnc.log 2>&1 &
VNC_PID=$!

# Expose VNC through WebSockets for noVNC.
websockify \
  --web=/usr/share/novnc \
  6080 \
  localhost:5900 \
  > /tmp/nebula-websockify.log 2>&1 &
WEBSOCKIFY_PID=$!

# Give the desktop services time to start.
sleep 2

# Restart Chromium if it closes or crashes.
while true; do
  echo "Starting Nebula Chromium..."

  chromium \
    --no-sandbox \
    --disable-dev-shm-usage \
    --disable-background-networking \
    --disable-component-update \
    --disable-sync \
    --disable-translate \
    --disable-features=Translate,MediaRouter \
    --disable-session-crashed-bubble \
    --no-first-run \
    --no-default-browser-check \
    --disable-infobars \
    --app=about:blank \
    --remote-debugging-address=127.0.0.1 \
    --remote-debugging-port=9222 \
    --user-data-dir=/tmp/nebula-chromium \
    > /tmp/nebula-chromium.log 2>&1 &

  BROWSER_PID=$!

  # Wait for Chromium to exit.
  wait "$BROWSER_PID" || true
  echo "Chromium exited. Restarting in 2 seconds..."
  sleep 2
done
```
