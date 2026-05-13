import crypto from "node:crypto";

const SECRET = process.env.AUTH_SECRET;
if (!SECRET) throw new Error("AUTH_SECRET env var must be set");

const ALLOWED_EMAIL = (process.env.ALLOWED_EMAIL || "you@example.com").toLowerCase();

export const SESSION_COOKIE = "__Secure-code-session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

type Payload = { email: string; iat: number; exp: number };

const b64url = (s: string) => Buffer.from(s).toString("base64url");
const b64urlJson = (obj: unknown) => b64url(JSON.stringify(obj));

const hmac = (data: string) =>
  crypto.createHmac("sha256", SECRET!).update(data).digest("base64url");

export function createSessionToken(email: string): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: Payload = { email, iat: now, exp: now + SESSION_MAX_AGE_SECONDS };
  const body = b64urlJson(payload);
  return `${body}.${hmac(body)}`;
}

export function verifySessionToken(token: string): Payload | null {
  if (typeof token !== "string" || token.length > 4096) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = hmac(body);
  // length pre-check + timing-safe compare
  if (sig.length !== expected.length) return null;
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch {
    return null;
  }
  let payload: Payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString()) as Payload;
  } catch {
    return null;
  }
  if (typeof payload?.email !== "string") return null;
  if (typeof payload?.exp !== "number") return null;
  if (payload.exp < Math.floor(Date.now() / 1000)) return null;
  // Defense in depth: even with valid signature, only the allowlisted email is accepted.
  // Protects against post-hoc allowlist changes and limits blast radius if SECRET leaks.
  if (payload.email.toLowerCase() !== ALLOWED_EMAIL) return null;
  return payload;
}
