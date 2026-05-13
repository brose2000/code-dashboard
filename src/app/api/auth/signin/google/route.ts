import { NextResponse } from "next/server";
import crypto from "node:crypto";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const BASE_URL = process.env.AUTH_URL || "https://code.example.com";
const REDIRECT_URI = `${BASE_URL}/api/auth/callback/google`;

const COOKIE_OPTS = {
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: 600,
};

export const dynamic = "force-dynamic";

export async function GET() {
  if (!CLIENT_ID) {
    return NextResponse.redirect(`${BASE_URL}/login?error=missing_client_id`);
  }

  const state = crypto.randomBytes(16).toString("base64url");
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: "openid email",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    access_type: "online",
    prompt: "select_account",
  });

  const res = NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  res.cookies.set("oauth-state", state, COOKIE_OPTS);
  res.cookies.set("oauth-verifier", verifier, COOKIE_OPTS);
  console.log(`[auth] signin: redirecting to Google (state=${state.slice(0, 8)}…)`);
  return res;
}
