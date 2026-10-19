# Nebula — Remote Browser for GitHub Codespaces

Nebula v2 runs a real Chromium browser inside your Codespace and streams its desktop to a custom dark blue/teal interface using noVNC. It is much more compatible with JavaScript-heavy sites than the earlier HTML-fetch viewer.

## Important limits and safety

- This is a remote browser, **not a guarantee that blocked sites will be accessible**. The client network must still allow the Nebula/Codespaces address, and site owners or network administrators may restrict access.
- Use it only where you are authorized to run remote browsing. Follow school/work acceptable-use rules.
- Keep the forwarded port **Private**. Never change it to Public or share the password. The app requires a password and keeps the VNC and Chrome debugging ports on loopback.
- GitHub organization policy can restrict Codespaces port forwarding or dev-container setup. See https://docs.github.com/en/codespaces/developing-in-a-codespace/forwarding-ports-in-your-codespace
- Chromium is running in a remote Linux environment. Some sites may reject cloud-hosting IPs, require additional authentication, or not support remote desktop interaction perfectly.
- Do not use this as a public multi-user service. The current build is intended for one private user/session.

## Setup in GitHub Codespaces

1. Download/extract this project and upload the **contents** of the folder to a GitHub repository (keep `.devcontainer/` and `scripts/`).
2. Open the repository on GitHub, select **Code → Codespaces → Create codespace on main**.
3. Because this project uses a custom dev-container image to install Chromium, Xvfb and noVNC, build/rebuild the container when prompted. The first build can take several minutes.
4. In the Codespaces terminal, set a password of at least 12 characters and start Nebula:

   ```bash
   export NEBULA_PASSWORD='replace-this-with-a-long-private-password'
   npm install
   npm start
   ```

   Keep this terminal running. If the Codespace restarts, set `NEBULA_PASSWORD` again before `npm start`.
5. Open the **Ports** tab. Port `3000` should appear as **Private**. If not, right-click it and select **Port Visibility → Private**. Open the forwarded URL.
6. Sign in with the password you set. Wait for the remote desktop to load.

## First test

1. In Nebula's address bar, enter `https://example.com` and press Enter/Go. The remote Chromium desktop should navigate.
2. Try `https://www.wikipedia.org` and then `https://www.google.com`.
3. Click inside the remote desktop to use the actual Chromium window. You can also use its own address bar and tabs. The Nebula toolbar provides navigation, reload and new-tab shortcuts.
4. Test JavaScript with a normal interactive site, then sign in only to accounts you are comfortable using in a remote session.

## Troubleshooting

- **Container build fails:** open the Codespaces build log. The image needs Debian packages `chromium`, `xvfb`, `x11vnc`, `fluxbox`, `novnc`, and `websockify`; organization image/package policies may interfere.
- **Blank/black desktop:** wait 10–20 seconds and refresh. In the terminal, check `/tmp/nebula-chromium.log`, `/tmp/nebula-websockify.log`, and `/tmp/nebula-x11vnc.log`.
- **"Chromium is still starting":** wait a few seconds and retry. Check `/tmp/nebula-chromium.log`.
- **Remote desktop won't connect:** verify port 3000 is Private and that the page is signed in. The internal VNC service is not meant to be opened as a separate forwarded port.
- **A website still doesn't load:** test whether it loads in Chromium's own address bar. If the site blocks cloud-hosted IPs, requires a feature unsupported in the remote environment, or the Codespaces connection is filtered, Nebula cannot guarantee access.
- **Password changed:** stop the server with Ctrl+C, export the new `NEBULA_PASSWORD`, then restart `npm start`.

## Files

- `.devcontainer/Dockerfile` — installs remote desktop/browser dependencies.
- `scripts/start-browser.sh` — starts Chromium, Xvfb, Fluxbox, x11vnc and noVNC's websocket bridge.
- `server.js` — authenticated Nebula UI server, navigation API and private reverse proxy to noVNC.
- `public/` — Nebula interface.
- `launcher.html` — optional simple launcher from the original project; it is not needed for the remote desktop itself.
