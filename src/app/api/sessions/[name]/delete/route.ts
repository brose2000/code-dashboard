import { currentUser } from "@/lib/current-user";
import { checkSameOrigin } from "@/lib/csrf";
import { deleteSession, validateName } from "@/lib/tmux";
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

  let deleteFolder = false;
  try {
    const body = await req.json();
    deleteFolder = !!body?.deleteFolder;
  } catch {
    // no body or invalid JSON — default deleteFolder=false
  }

  try {
    await deleteSession(name, deleteFolder);
    console.log(`[audit] ${user.email} deleted session=${name} deleteFolder=${deleteFolder}`);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error(`[audit] ${user.email} delete-failed name=${name}: ${e.message}`);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
