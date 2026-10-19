FROM mcr.microsoft.com/devcontainers/javascript-node:1-22-bookworm

USER root
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    chromium xvfb x11vnc fluxbox novnc websockify fonts-liberation dbus-x11 x11-utils \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

COPY scripts/start-browser.sh /usr/local/bin/start-nebula-browser
RUN chmod +x /usr/local/bin/start-nebula-browser
USER node
