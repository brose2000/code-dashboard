# SETUP — step-by-step for first-time install

This walks you from zero to "I logged in and see my tmux sessions on a public URL". Estimated time: 15–20 minutes if everything goes smoothly.

## 0. Decide where to host

You need a Linux host (VM, dedicated server, Raspberry Pi, OrbStack VM, anything) with:
- A user account
- Node.js 22+ and tmux 3.x
- `claude` CLI installed and logged in under that user (run `claude login` interactively once)
- A way to terminate TLS in front (Caddy, nginx, Cloudflare Tunnel, Tailscale Serve — your pick)

The host will run a Next.js process bound to `localhost:8101` (or whatever port you choose). Your reverse-proxy handles the public TLS endpoint.

## 1. Create a Google OAuth Client

1. Go to https://console.cloud.google.com/apis/credentials
2. Create a project if you don't have one (any name).
3. **Configure consent screen** (one-time):
   - User type: External
   - App name: `code-dashboard` (or whatever)
   - User support email: yours
   - Scopes: pick `openid`, `userinfo.email`
   - Test users: add your Google email
4. **Create credentials → OAuth client ID**:
   - Application type: Web application
   - Name: `code-dashboard`
   - Authorized JavaScript origins: `https://code.example.com` (your public URL)
   - Authorized redirect URIs: `https://code.example.com/api/auth/callback/google`
5. Save and copy the **Client ID** and **Client Secret** somewhere safe.

## 2. Clone and install

```bash
git clone https://github.com/brose2000/code-dashboard.git
cd code-dashboard
npm install
```

## 3. Configure `.env.production`

```bash
cp .env.production.example .env.production
$EDITOR .env.production
```

Fill in:

```bash
AUTH_URL=https://code.example.com
NEXTAUTH_URL=https://code.example.com
AUTH_SECRET=$(openssl rand -base64 32)    # generate fresh
GOOGLE_CLIENT_ID=<from step 1>
GOOGLE_CLIENT_SECRET=<from step 1>
ALLOWED_EMAIL=you@example.com             # comma-separated for multi-user
NEXT_PUBLIC_TMUXY_ORIGIN=http://localhost:9000   # see step 4
```

Keep this file out of git. The default `.gitignore` already covers it.

## 4. Install tmuxy (for the "open" button)

[tmuxy](https://github.com/flplima/tmuxy) lets you view a tmux session in the browser. The "open" button on each session points there.

Quickest: build from source (see tmuxy repo), then run:

```bash
tmuxy-server --host 0.0.0.0 --port 9000
```

Skip this if you don't care about in-browser terminals — you can still create/resume/reset sessions via this dashboard.

## 5. Build + run

```bash
set -a; source .env.production; set +a
npm run build
PORT=8101 HOSTNAME=127.0.0.1 NODE_ENV=production node .next/standalone/server.js
```

The app listens on `localhost:8101`. Don't expose this port directly — let your reverse proxy do TLS.

## 6. Reverse proxy

### Caddy (easiest)

```caddy
code.example.com {
    reverse_proxy localhost:8101 {
        header_up X-Forwarded-Proto https
        header_up X-Forwarded-Host {host}
    }
}
```

Caddy obtains a Let's Encrypt cert automatically. Reload with `sudo systemctl reload caddy`.

### Other options

- **Cloudflare Tunnel**: `cloudflared tunnel route dns <tunnel-id> code.example.com` + ingress rule `localhost:8101`.
- **nginx**: stock reverse proxy with `proxy_pass http://localhost:8101;` and a Let's Encrypt cert from certbot.

## 7. Run as a service (optional but recommended)

```bash
mkdir -p ~/.config/systemd/user
cp ops/code-dashboard.service ~/.config/systemd/user/
# Edit if your paths differ from defaults

# So the service starts on boot, even without an interactive login
sudo loginctl enable-linger $USER

systemctl --user daemon-reload
systemctl --user enable --now code-dashboard
systemctl --user status code-dashboard
```

For convenience, `ops/deploy.sh` does build → rsync → restart in one shot.

## 8. First login

1. Open `https://code.example.com` in your browser.
2. Click **Sign in with Google**.
3. Approve the OAuth consent. You should land on the dashboard.

If you see `invalid_client`: the redirect URI in Google Cloud doesn't match `AUTH_URL`. Make them exactly identical (scheme + host, no trailing slash).

## 9. Smoke test

1. Click **+ New session**. Pick a name like `test-1`, leave the rest default. Submit.
2. The session should appear in the list with `claude` badge.
3. Click **open** — a new tab opens to tmuxy showing the claude prompt.
4. Open Claude Desktop. In **Recents** you should see `[test-1]` — click it to attach.
5. Type something in Claude Desktop. The reply shows up. Sessions sync across devices.

## 10. (Optional) Watchdog

Auto-restart sessions whose `claude` process died:

```bash
cp ops/code-watchdog.sh ~/bin/
cp ops/code-watchdog.{service,timer} ~/.config/systemd/user/
chmod +x ~/bin/code-watchdog.sh
systemctl --user daemon-reload
systemctl --user enable --now code-watchdog.timer
```

Default: checks every 5 minutes. Skips sessions named `main` and `tmuxy`.

## Done

You can now create/resume/reset Claude Code sessions from any device that can reach `code.example.com`. The actual conversations live in Anthropic's backend; this dashboard just orchestrates the local tmux+claude processes.

## Where to go next

- Customise the look — it's plain shadcn/Tailwind in `src/components/SessionList.tsx`.
- Add multi-user — change `ALLOWED_EMAIL` to a comma-separated list.
- See [README.md](./README.md) for architecture and customisation pointers.
- See [SECURITY.md](./SECURITY.md) for the security model.
