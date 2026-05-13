import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySessionToken } from "./session";

export async function currentUser(): Promise<{ email: string } | null> {
  const c = await cookies();
  const tok = c.get(SESSION_COOKIE)?.value;
  if (!tok) return null;
  const payload = verifySessionToken(tok);
  if (!payload) return null;
  return { email: payload.email };
}
