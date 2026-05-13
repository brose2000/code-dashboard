import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const SESSION_COOKIE = "__Secure-code-session";
const BASE_URL = process.env.AUTH_URL || "https://code.example.com";
const SECRET = process.env.AUTH_SECRET || "";
const ALLOWED_EMAIL = (process.env.ALLOWED_EMAIL || "you@example.com").toLowerCase();

function b64urlToBytes(s: string): ArrayBuffer {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const buf = new ArrayBuffer(bin.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i);
  return buf;
}

async function verifyToken(token: string): Promise<boolean> {
  if (!SECRET) return false;
  if (typeof token !== "string" || token.length > 4096) return false;
  const [body, sig] = token.split(".");
  if (!body || !sig) return false;
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const ok = await crypto.subtle.verify(
      { name: "HMAC" },
      key,
      b64urlToBytes(sig),
      new TextEncoder().encode(body),
    );
    if (!ok) return false;
    const decoded = new TextDecoder().decode(new Uint8Array(b64urlToBytes(body)));
    const payload = JSON.parse(decoded) as { email?: string; exp?: number };
    if (typeof payload?.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) return false;
    // Defense in depth: enforce allowlist on every request (not only at signin).
    if (typeof payload?.email !== "string" || payload.email.toLowerCase() !== ALLOWED_EMAIL) return false;
    return true;
  } catch {
    return false;
  }
}

export async function middleware(request: NextRequest) {
  if (process.env.NODE_ENV === "development") return NextResponse.next();

  // 1. Force HTTPS — but ONLY for the configured public hostname.
  // Tailnet hosts (private hostnames) reach the service over WireGuard so
  // plain HTTP is acceptable; redirecting them to https would break access.
  const proto = request.headers.get("x-forwarded-proto");
  const host = (request.headers.get("x-forwarded-host") || request.headers.get("host") || "").split(":")[0].toLowerCase();
  const publicHost = new URL(BASE_URL).host.split(":")[0].toLowerCase();
  if (proto && proto.split(",")[0].trim() !== "https" && host === publicHost) {
    const target = new URL("https://" + host);
    target.pathname = request.nextUrl.pathname;
    target.search = request.nextUrl.search;
    return NextResponse.redirect(target.toString(), 308);
  }

  // 2. Skip auth for public paths and OAuth flow.
  const path = request.nextUrl.pathname;
  if (
    path.startsWith("/api/auth/") ||
    path.startsWith("/_next/") ||
    path === "/favicon.ico" ||
    path === "/robots.txt" ||
    path === "/login" ||
    path === "/icon.svg"
  ) {
    return NextResponse.next();
  }

  // 3. API routes do their own auth checks. Page routes are gated here.
  if (!path.startsWith("/api/")) {
    const sessionCookie = request.cookies.get(SESSION_COOKIE);
    if (!sessionCookie || !(await verifyToken(sessionCookie.value))) {
      return NextResponse.redirect(new URL("/login", request.url));
    }
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
