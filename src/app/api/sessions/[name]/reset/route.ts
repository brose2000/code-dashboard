import { currentUser } from "@/lib/current-user";
import { checkSameOrigin } from "@/lib/csrf";
import { resetSession, validateName, type ResetMode } from "@/lib/tmux";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request, ctx: { params: Promise<{ name: string }> }) {
  const csrfBlock = checkSameOrigin(req);
  if (csrfBlock) return csrfBlock;

  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { name } = await ctx.params;
  const nameErr = validateName(name);
  if (nameErr) return NextResponse.json({ error: nameErr }, { status: 400 });

  // Parse optional body — default mode = resume (preserves thread).
  let mode: ResetMode = "resume";
  try {
    const body = await req.json();
    if (body && body.mode === "fresh") mode = "fresh";
  } catch {
    // empty body → keep default
  }

  try {
    await resetSession(name, mode);
    console.log(`[audit] ${user.email} ${mode === "fresh" ? "fresh-reset" : "resumed"} session=${name}`);
    return NextResponse.json({ ok: true, mode });
  } catch (e: any) {
    console.error(`[audit] ${user.email} reset-failed name=${name}: ${e.message}`);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
