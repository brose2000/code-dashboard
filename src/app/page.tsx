import { currentUser } from "@/lib/current-user";
import { listSessions, type Session } from "@/lib/tmux";
import { redirect } from "next/navigation";
import SessionList from "@/components/SessionList";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await currentUser();
  if (!user) redirect("/login");

  let sessions: Session[] = [];
  let listError: string | null = null;
  try {
    sessions = await listSessions();
  } catch (e: any) {
    listError = e?.message ?? "failed to list sessions";
    console.error(`[error] listSessions for ${user.email}: ${listError}`);
  }
  const tmuxyOrigin = process.env.NEXT_PUBLIC_TMUXY_ORIGIN || "http://localhost:9000";

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100">
      <div className="max-w-4xl mx-auto p-6 space-y-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">tmuxy sessions</h1>
            
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-neutral-400">{user.email}</span>
            <a
              href="/api/auth/signout"
              className="rounded border border-neutral-700 px-3 py-1 hover:bg-neutral-800"
            >
              Sign out
            </a>
          </div>
        </header>
        {listError && (
          <div className="rounded border border-red-900 bg-red-950/40 px-3 py-2 text-sm text-red-200">
            Failed to load sessions: <code className="font-mono text-xs">{listError}</code>
          </div>
        )}
        <SessionList initialSessions={sessions} tmuxyOrigin={tmuxyOrigin} />
      </div>
    </main>
  );
}
