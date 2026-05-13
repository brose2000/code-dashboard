import { NextRequest, NextResponse } from "next/server";
import { createSessionToken, SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from "@/lib/session";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const BASE_URL = process.env.AUTH_URL || "https://code.example.com";
const REDIRECT_URI = `${BASE_URL}/api/auth/callback/google`;
const ALLOWED_EMAIL = (process.env.ALLOWED_EMAIL || "you@example.com").toLowerCase();

export const dynamic = "force-dynamic";

function back(error: string) {
  return NextResponse.redirect(`${BASE_URL}/login?error=${encodeURIComponent(error)}`);
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const googleError = req.nextUrl.searchParams.get("error");

  const expectedState = req.cookies.get("oauth-state")?.value;
  const verifier = req.cookies.get("oauth-verifier")?.value;

  const wipe = (res: NextResponse) => {
    res.cookies.delete("oauth-state");
    res.cookies.delete("oauth-verifier");
    return res;
  };

  if (googleError) {
    console.warn(`[auth] callback: google returned error=${googleError}`);
    return wipe(back(googleError));
  }
  if (!code || !state || !expectedState || state !== expectedState || !verifier) {
    console.warn(
      `[auth] callback: invalid state code=${!!code} state=${!!state} expected=${!!expectedState} match=${state === expectedState} verifier=${!!verifier}`,
    );
    return wipe(back("invalid_state"));
  }

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code",
      code_verifier: verifier,
    }),
  });

  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    console.error(`[auth] token exchange failed: ${tokenRes.status} ${body}`);
    return wipe(back("token_exchange"));
  }
  const tokenJson = (await tokenRes.json()) as { access_token?: string };
  if (!tokenJson.access_token) {
    console.error("[auth] token response missing access_token", tokenJson);
    return wipe(back("token_exchange"));
  }

  const uiRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${tokenJson.access_token}` },
  });
  if (!uiRes.ok) {
    console.error(`[auth] userinfo failed: ${uiRes.status}`);
    return wipe(back("userinfo"));
  }
  const ui = (await uiRes.json()) as { email?: string };
  const email = (ui.email || "").toLowerCase();

  if (email !== ALLOWED_EMAIL) {
    console.warn(`[auth] denied login for ${email || "<no email>"}`);
    return wipe(back("forbidden"));
  }

  const token = createSessionToken(email);
  const res = NextResponse.redirect(`${BASE_URL}/`);
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  console.log(`[auth] signed in ${email}`);
  return wipe(res);
}
