# Security model

This document describes the security design of code-dashboard — what threats it aims to prevent and how. It's intentionally generic; your own deployment will have additional concerns (host hardening, network topology, etc.).

## Threat model

- **Audience**: small private tool, typically self-hosted. Single user or small allowlist of Google accounts.
- **Public surface**: only what your reverse proxy exposes. The Node process itself is bound to localhost (or whatever you choose).
- **Adversary**: any unauthenticated visitor on the internet (if you publish the URL), plus authenticated users trying to escalate or escape.
- **Out of scope**: physical access to the host, compromise of the operator's Google account or laptop, compromise of the OAuth client secret out-of-band.

## Mitigations

### Authentication

- **Cookie-based session**, HMAC-SHA256 signed with a 32-byte secret (`AUTH_SECRET`). No external session store.
- Cookie attributes: `__Secure-` prefix (browser-enforces HTTPS), `HttpOnly`, `Secure`, `SameSite=Lax`.
- **Email allowlist re-checked on every request**, not only at sign-in — protects against post-leak forgery: even if `AUTH_SECRET` is exposed, attackers cannot mint a cookie for an email not on the allowlist.
- Token validation uses `crypto.timingSafeEqual` (no timing leak).
- 30-day session expiry baked into the cookie payload.

### Authorization

- Every API endpoint calls `currentUser()` and returns 401 if no valid session.
- The middleware also gates page routes (not API routes — those self-gate to keep redirect logic simple).

### CSRF

- `SameSite=Lax` on the session cookie blocks cross-site `POST` requests carrying credentials.
- Defence in depth: every mutating endpoint also checks the `Origin` (or `Referer` fallback) header against the configured `AUTH_URL`. Foreign origins get 403.

### Transport

- App emits HSTS preload header (`Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`).
- Middleware redirects HTTP → HTTPS for the configured public host, based on `x-forwarded-proto` set by the reverse proxy.
- All cookies have `Secure` + `__Secure-` prefix, so they're never sent over plain HTTP.

### Headers

Eight security headers are set on every response (via `next.config.ts`):

| Header | Value |
|---|---|
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` |
| `X-Frame-Options` | `DENY` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | camera/microphone/geolocation/interest-cohort all denied |
| `Content-Security-Policy` | `default-src 'self'; frame-ancestors 'none'; form-action 'self' https://accounts.google.com; …` |
| `X-DNS-Prefetch-Control` | `off` |
| `X-Robots-Tag` | `noindex, nofollow` |

`x-powered-by` is suppressed (no server-stack leak).

### Input validation

- **Session names** match `^[a-z0-9][a-z0-9-]{0,30}$`. Anything else returns 400.
- **Subroot** (`personal`/`work`) is enum-checked; anything else returns 400.
- **Existing-path mode** (new-session): path must be absolute (or start with `~/`), must not contain `..`, must resolve to a directory inside the user's home directory. Otherwise 400.
- **JSON bodies** parsed with try/catch — malformed JSON returns 400.

### Command-injection avoidance

All `tmux` operations use `execFile("tmux", [...args])` — array form, never a shell string. The session name is regex-validated, and the launch command is built with single-quoted brackets so even if validation were bypassed there's no shell-expansion vector.

### File-system safety

- `~/.claude.json` modifications (for the trust dialog) use `writeFileSync` to a `*.tmp` file followed by atomic `renameSync` — crash-mid-write leaves the original intact.
- Folder creation uses `mkdirSync({ recursive: true, mode: 0o755 })`.
- No file writes outside `~/claude-code/<subroot>/<name>` (or, in existing-path mode, the validated path).

### Audit logging

All mutating actions log to stdout/journalctl with `[audit] <email> <action> session=<name>` so you have a per-user trail. Auth events log to `[auth]`.

### Operational

- The service runs as an **unprivileged user** under systemd, not root.
- The sample systemd unit sets multiple hardening flags: `NoNewPrivileges`, `ProtectKernel*`, `ProtectControlGroups`, `RestrictRealtime`, `RestrictNamespaces`, `LockPersonality`, `RestrictSUIDSGID`, `SystemCallArchitectures=native`, `ProtectHostname`, `ProtectClock`.
- `PrivateTmp` is intentionally NOT set — the app needs to reach the tmux socket in `/tmp/tmux-<uid>/`.

## Known residual risks

1. **postcss < 8.4.32** is a transitive build-time dependency of Next.js. Has an XSS-via-`</style>` advisory. Not exploitable at runtime in this app (no untrusted CSS processing). Will resolve on a future Next.js patch.
2. **No server-side session revocation.** Cookie deletion on signout clears the client cookie, but a leaked cookie remains valid until its expiry. Rotate `AUTH_SECRET` to invalidate all sessions immediately.
3. **No rate-limiting** on the OAuth sign-in path. Brute-forcing is impractical because the allowlist gates account selection and Google rate-limits its own auth surface.
4. **`AUTH_SECRET` loss** invalidates all sessions (forcing re-login) but doesn't otherwise compromise the system.
5. **Operator-controlled values are not separately validated** — if you misconfigure your reverse proxy (e.g. forward wrong `X-Forwarded-Host`) you can break the auth flow. This is a deployment concern, not an app vulnerability.

## How to verify

Run the conventions linter (sample in `ops/check-conventions.sh`):

```bash
./ops/check-conventions.sh
```

This catches the common drift: missing shadcn init, raw Tailwind cards, NextAuth dependency, missing security headers, `.env*` not gitignored, etc. It's wired into `deploy.sh` as the first step.

## Reporting issues

Found a security bug? Open a private issue on the GitHub repo or email the maintainer (see `README.md`).
