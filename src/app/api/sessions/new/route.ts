import { currentUser } from "@/lib/current-user";
import { checkSameOrigin } from "@/lib/csrf";
import {
  createSession,
  folderExists,
  sessionExists,
  validateExistingPath,
  validateName,
  type Subroot,
} from "@/lib/tmux";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const csrfBlock = checkSameOrigin(req);
  if (csrfBlock) return csrfBlock;

  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const name: string = typeof body.name === "string" ? body.name.trim() : "";
  const trustDirectory: boolean = !!body.trustDirectory;
  const launchClaude: boolean = body.launchClaude !== false; // default true
  const mode: "new" | "existing" = body.mode === "existing" ? "existing" : "new";

  const nameErr = validateName(name);
  if (nameErr) return NextResponse.json({ error: nameErr }, { status: 400 });

  if (await sessionExists(name)) {
    return NextResponse.json({ error: `session ${name} already exists` }, { status: 409 });
  }

  if (mode === "existing") {
    const path: string = typeof body.path === "string" ? body.path.trim() : "";
    const v = validateExistingPath(path);
    if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
    try {
      await createSession({ name, mode: "existing", path: v.resolved, trustDirectory, launchClaude });
      console.log(`[audit] ${user.email} created session=${name} mode=existing path=${v.resolved} launchClaude=${launchClaude}`);
      return NextResponse.json({ ok: true, name });
    } catch (e: any) {
      console.error(`[audit] ${user.email} create-failed name=${name}: ${e.message}`);
      return NextResponse.json({ error: e.message }, { status: 500 });
    }
  }

  // mode = "new"
  const subroot: Subroot = body.subroot;
  const createFolder: boolean = !!body.createFolder;
  
  if (subroot !== "personal" && subroot !== "runspace") {
    return NextResponse.json({ error: "subroot must be personal or runspace" }, { status: 400 });
  }
  if (!folderExists(name, subroot) && !createFolder) {
    return NextResponse.json(
      { error: `folder does not exist; set createFolder=true to create it` },
      { status: 400 }
    );
  }
  try {
    await createSession({ name, mode: "new", subroot, createFolder, trustDirectory, launchClaude });
    console.log(`[audit] ${user.email} created session=${name} subroot=${subroot} createFolder=${createFolder} launchClaude=${launchClaude}`);
    return NextResponse.json({ ok: true, name });
  } catch (e: any) {
    console.error(`[audit] ${user.email} create-failed name=${name}: ${e.message}`);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
