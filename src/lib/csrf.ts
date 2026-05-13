import { NextResponse } from "next/server";

const ALLOWED_ORIGINS = (process.env.AUTH_URL || "https://code.example.com")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/**
 * Same-origin enforcement for state-changing requests. Returns null if OK.
 * Strategy:
 *   - If Origin header is present, it MUST match an allowed origin.
 *   - Otherwise, fall back to Referer (older browsers / non-CORS POST may omit Origin).
 *   - If both are missing → reject (no way to verify same-origin).
 */
export function checkSameOrigin(req: Request): NextResponse | null {
  const origin = req.headers.get("origin");
  if (origin) {
    if (!ALLOWED_ORIGINS.includes(origin)) {
      return NextResponse.json({ error: "forbidden origin" }, { status: 403 });
    }
    return null;
  }
  const referer = req.headers.get("referer");
  if (referer) {
    if (!ALLOWED_ORIGINS.some((o) => referer.startsWith(o + "/") || referer === o)) {
      return NextResponse.json({ error: "forbidden referer" }, { status: 403 });
    }
    return null;
  }
  return NextResponse.json({ error: "missing origin/referer" }, { status: 403 });
}

/** Lenient variant: same-origin if signal present, but accept missing both
 * (covers address-bar entry / direct nav). Still rejects FOREIGN origins. */
export function checkSameOriginLenient(req: Request): NextResponse | null {
  const origin = req.headers.get("origin");
  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    return NextResponse.json({ error: "forbidden origin" }, { status: 403 });
  }
  const referer = req.headers.get("referer");
  if (referer && !ALLOWED_ORIGINS.some((o) => referer.startsWith(o + "/") || referer === o)) {
    return NextResponse.json({ error: "forbidden referer" }, { status: 403 });
  }
  return null;
}
