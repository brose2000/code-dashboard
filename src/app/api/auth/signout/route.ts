import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/session";
import { checkSameOriginLenient } from "@/lib/csrf";

const BASE_URL = process.env.AUTH_URL || "https://code.example.com";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function handle(req: Request) {
  const block = checkSameOriginLenient(req);
  if (block) return block;
  const res = NextResponse.redirect(`${BASE_URL}/login`, 303);
  res.cookies.delete(SESSION_COOKIE);
  return res;
}

export const POST = handle;
export const GET = handle;
