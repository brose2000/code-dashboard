# code-dashboard

> A small web UI to manage your Claude Code (`claude --remote-control`) sessions running inside tmux. Each session shows up in Claude Desktop's "Recents" with a `[<name>]` prefix, so you can jump in from any device.

![dashboard](docs/screenshot.png)

## Why

If you use Claude Code with `--remote-control`, the natural workflow is:

1. SSH into a server
2. `tmux new -s my-project`
3. `cd /some/path && claude --remote-control --name "[my-project]"`
4. Disconnect; pick it up from Claude Desktop on your phone/laptop later

This dashboard automates that. Open it in a browser, click **+ New session**, get a tmux session with `claude --remote-control` already running and the session prefixed `[name]` ready for Claude Desktop.

## Features

| Button | What it does |
|---|---|
| **+ New session** | Spawn a tmux session running `claude --remote-control --name '[<n>]'`. Two modes: new project in `~/claude-code/<subroot>/<name>` (auto-creates folder) or attach to an existing path. |
| **open** | Opens the session in [tmuxy](https://github.com/flplima/tmuxy) for an in-browser terminal. |
| **resume** | Kills the current claude process and restarts with `--continue` — preserves the conversation thread. Use this when Claude Desktop says "Disconnected from remote session". |
| **reset** | Same as resume but **without** `--continue`. Wipes the thread for a fresh start. |
| **detach** | Force-detach all clients (useful when stuck "attached" badge persists from a closed browser tab). |
| **×** | Kill the tmux session entirely (the working folder is preserved). |

Auto-refresh every 10s, re-fetch on window focus. Optional watchdog (sample systemd timer in `ops/`) revives sessions whose `claude` process died.

## Architecture

```
                        ┌──────────────────┐
   you (browser) ─TLS─► │  reverse proxy   │ ─► Next.js standalone (this app)
                        │  (Caddy/nginx/   │            │
                        │   CF tunnel)     │            ▼
                        └──────────────────┘     tmux (local socket)
                                                       │
                                                ┌──────┴──────┐
                                                │             │
                                                ▼             ▼
                                          claude --rc    claude --rc
                                          [project-a]    [project-b]
```

- **Next.js 16** standalone build, ~200 LOC of dashboard code.
- **Auth**: small custom Google OAuth flow (HMAC-signed session cookie, no NextAuth dependency).
- **State**: nothing persisted — the truth lives in `tmux list-sessions`.
- **tmux ops**: server-side `execFile("tmux", ...)`, no shell interpolation.

## Requirements

- **Node.js 22+**
- **tmux 3.x**
- **`claude` CLI** ([install](https://docs.anthropic.com/claude/code)) — logged in with `claude login` under the user the service runs as
- **[tmuxy](https://github.com/flplima/tmuxy)** running on a reachable URL (used for the "open" button)
- **Google OAuth 2.0 Web Client** (free, 5 min in [Google Cloud Console](https://console.cloud.google.com/apis/credentials))
- A way to **terminate TLS** in front of the app (Caddy, nginx, Cloudflare Tunnel, Tailscale Serve — your pick)

## Quick start

```bash
# 1. Clone + install
git clone https://github.com/brose2000/code-dashboard.git
cd code-dashboard
npm install

# 2. Configure
cp .env.production.example .env.production
$EDITOR .env.production
# Fill in:
#   AUTH_URL=https://code.example.com           ← your public URL
#   AUTH_SECRET=$(openssl rand -base64 32)      ← any random 32 bytes
#   GOOGLE_CLIENT_ID=...                        ← from Google Cloud
#   GOOGLE_CLIENT_SECRET=...                    ← from Google Cloud
#   ALLOWED_EMAIL=you@example.com               ← your Google email
#   NEXT_PUBLIC_TMUXY_ORIGIN=http://localhost:9000  ← your tmuxy URL

# 3. Register the OAuth redirect URI in Google Cloud Console:
#    https://code.example.com/api/auth/callback/google

# 4. Build + run
set -a; source .env.production; set +a
npm run build
node .next/standalone/server.js   # listens on $PORT (default 3000)
```

Put a reverse proxy in front that does TLS and forwards to the Node process. Done.

## Production install (systemd + Caddy)

`ops/` contains samples that work out of the box on Linux:

```bash
# 1. Place sample files
cp ops/code-dashboard.service ~/.config/systemd/user/
cp ops/deploy.sh ./deploy.sh && chmod +x deploy.sh

# 2. Allow user services to run without an active login session
sudo loginctl enable-linger $USER

# 3. Deploy (build + rsync to ~/code-dashboard-deploy + start service)
./deploy.sh

# 4. Add a Caddy block (or similar)
#    See ops/Caddyfile.snippet
```

Then point DNS at your server and you're live.

## Security model

Read [SECURITY.md](./SECURITY.md) for the full audit history. Highlights:

- **Cookie**: HMAC-SHA256-signed, `__Secure-` prefixed, `HttpOnly` + `Secure` + `SameSite=Lax`.
- **Email allowlist**: re-checked on every request, not only at signin (defense in depth if `AUTH_SECRET` ever leaks).
- **CSRF**: Origin/Referer check on all mutating endpoints, on top of SameSite=Lax.
- **8 security headers** (HSTS preload, CSP `frame-ancestors 'none'`, X-Frame-Options DENY, …).
- **Input validation**: session names regex'd `^[a-z0-9][a-z0-9-]{0,30}$`; existing-path mode validated to be inside `$HOME` (no `/etc`, no `..`).
- **No shell interpolation**: all tmux ops use `execFile` with array args.
- **Audit log**: every mutation logged to journalctl as `[audit] <email> <action> session=<name>`.

## Customising

- **Multi-user**: change `ALLOWED_EMAIL` to comma-separated emails (e.g. `you@example.com,colleague@example.com`).
- **Different subroots**: edit the `SUBROOTS` array in `src/lib/tmux.ts`.
- **Custom claude command**: edit `claudeLaunchCommand()` and `claudeResumeCommand()` in `src/lib/tmux.ts`.
- **Add buttons**: each session is a row in `SessionList.tsx`. Mirror the existing `detach` / `reset` / `delete` pattern.

## Operational

```bash
# logs
journalctl --user -u code-dashboard -f

# audit
journalctl --user -u code-dashboard | grep '\[audit\]'

# convention checker (runs as first step of deploy.sh)
./ops/check-conventions.sh   # if you copied it from infra-docs/
```

## Common issues

| Symptom | Likely cause | Fix |
|---|---|---|
| `invalid_client` on login | OAuth redirect URI not registered with the exact public URL | Add `https://<your-host>/api/auth/callback/google` in Google Cloud Console |
| Login loops back to `/login` | `AUTH_URL` doesn't match the host the browser hits | Make `AUTH_URL` exactly the public URL (no trailing slash, scheme included) |
| `Disconnected from remote session` in Claude Desktop | Anthropic's websocket dropped (idle, network blip) | Click **resume** in this dashboard |
| Session shows "attached" forever | Closed browser tab left a zombie client | Click **detach** |
| Service won't start: `EADDRINUSE` | Port already taken | Change `PORT` in `.env.production` or kill the other process |

## Trust dialog

The "Trust directory" checkbox in the New Session modal pre-accepts Claude Code's first-time trust prompt for the working directory, so you don't get interrupted on the first message.

How it works:

- `claude` runs **on the dashboard host** (the server, not your laptop).
- It reads `~/.claude.json` on that host to decide whether the directory is "trusted".
- The checkbox writes `projects[<abs-path>].hasTrustDialogAccepted = true` to that JSON, atomically (`*.tmp` + rename), preserving all other entries.

Your **local** machine's Claude Desktop / `~/.claude.json` is **not** touched. Trust lives where `claude` actually runs.

It only suppresses the initial "is this safe?" prompt. It does NOT auto-approve tools, shell commands, or any other permission gate.

If you want to reset trust for a directory, edit `~/.claude.json` on the host:

```bash
python3 -c "
import json
p = '/home/USER/.claude.json'
d = json.load(open(p))
d['projects']['/path/to/your/project']['hasTrustDialogAccepted'] = False
json.dump(d, open(p, 'w'), indent=2)
"
```

## License

MIT — see [`LICENSE`](./LICENSE).

## Author

Built by [Robbert Dijkstra](https://github.com/brose2000) for his own home setup. Shared in case it's useful — issues and PRs welcome, but this is a small personal tool, expect a chill maintenance pace.
