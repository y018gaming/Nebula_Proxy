# Nebula — Codespaces Browser Workspace

A dark blue/teal browser-style workspace for GitHub Codespaces. It includes:
- Express server and static UI
- Multiple UI tabs
- URL bar and search input
- Guarded server-side HTML/text fetching
- Separate `launcher.html` for opening the Codespaces app in a new `about:blank` tab

## Important limitations

This is a **starter page viewer**, not a full reverse proxy or full browser engine. It fetches public HTML/text and displays the result in a sandboxed iframe. Sites that rely on client-side JavaScript, login cookies, APIs, relative assets, WebSockets, streaming, or anti-embedding headers may not work correctly. The page viewer does not forward all browser requests through the server.

The fetch endpoint blocks private/internal addresses, refuses redirects, limits response size and time, and only accepts HTML/text. Do not expose this as an unrestricted public service. A forwarded port shared with friends can be accessed by anyone who has the URL if you make it public.

## Run in GitHub Codespaces

1. Create a new GitHub repository, for example `nebula-codespaces`.
2. Upload all files from this project, preserving the `.devcontainer` and `public` folders.
3. Open the repository and choose **Code → Codespaces → Create codespace on main**.
4. Wait for `npm install` to finish. If it does not run automatically, open the terminal and run:
   ```bash
   npm install
   npm start
   ```
5. Open the **Ports** tab. Port `3000` should appear. Click its forwarded address to open Nebula.
6. To use the separate launcher, open `launcher.html` locally in your browser, paste the forwarded Nebula URL, and click **Launch**. If your browser blocks the new tab, allow pop-ups and retry.

## Run locally

Requires Node.js 20 or newer.

```bash
npm install
npm start
```

Then visit http://localhost:3000.

## Searching and navigation

- Enter `https://example.com` to load a URL.
- Enter `example.com` to use HTTPS.
- Enter a phrase to search with Google.
- Use `+` to add tabs and `×` to close tabs.

## Security notes

- Keep the Codespaces port private unless you deliberately want to share it.
- Do not put secrets or credentials in URLs.
- Do not use this to access systems you are not authorized to access.
- The URL validation is a starter safeguard, not a substitute for a professionally reviewed SSRF-resistant proxy. For a public deployment, add authentication/rate limits, robust DNS-rebinding defenses, outbound network controls, and a mature proxy implementation.
