"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";

type Session = {
  name: string;
  created: number;
  attached: boolean;
  windows: number;
  claudeRunning: boolean;
  cwd: string | null;
  subroot: "personal" | "runspace" | null;
};

export default function SessionList({
  initialSessions,
  tmuxyOrigin,
}: {
  initialSessions: Session[];
  tmuxyOrigin: string;
}) {
  const router = useRouter();
  const [sessions, setSessions] = useState(initialSessions);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showNewModal, setShowNewModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ name: string; cwd: string | null; subroot: "personal" | "runspace" | null } | null>(null);

  useEffect(() => {
    const id = setInterval(() => { refresh(); }, 10_000);
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => { clearInterval(id); window.removeEventListener("focus", onFocus); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refresh() {
    try {
      const r = await fetch("/api/sessions", { cache: "no-store" });
      if (r.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        setError(data.error || `refresh failed: HTTP ${r.status}`);
        return;
      }
      const data = await r.json();
      setSessions(data.sessions);
    } catch (e: any) {
      setError(`refresh failed: ${e.message}`);
    }
  }

  async function action(url: string, body?: any) {
    setError(null);
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    if (r.status === 401) {
      window.location.href = "/login";
      throw new Error("unauthorized");
    }
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      throw new Error(data.error || `HTTP ${r.status}`);
    }
    return r.json();
  }

  function resume(name: string) {
    if (busy) return;
    setBusy(name);
    action(`/api/sessions/${encodeURIComponent(name)}/reset`, { mode: "resume" })
      .then(() => refresh())
      .catch((e) => setError(e.message))
      .finally(() => setBusy(null));
  }

  function reset(name: string) {
    if (busy) return;
    if (!confirm(`Reset session "${name}" with a FRESH thread? The current conversation will be lost (use Resume to keep it).`)) return;
    setBusy(name);
    action(`/api/sessions/${encodeURIComponent(name)}/reset`, { mode: "fresh" })
      .then(() => refresh())
      .catch((e) => setError(e.message))
      .finally(() => setBusy(null));
  }

  function del(name: string, cwd: string | null, subroot: "personal" | "runspace" | null) {
    if (busy) return;
    setDeleteTarget({ name, cwd, subroot });
  }

  function confirmDelete(deleteFolder: boolean) {
    if (!deleteTarget) return;
    const { name } = deleteTarget;
    setDeleteTarget(null);
    setBusy(name);
    action(`/api/sessions/${encodeURIComponent(name)}/delete`, { deleteFolder })
      .then(() => refresh())
      .catch((e) => setError(e.message))
      .finally(() => setBusy(null));
  }

  function detach(name: string) {
    if (busy) return;
    setBusy(name);
    action(`/api/sessions/${encodeURIComponent(name)}/detach`)
      .then(() => refresh())
      .catch((e) => setError(e.message))
      .finally(() => setBusy(null));
  }

  function open(name: string) {
    window.open(`${tmuxyOrigin}/?session=${encodeURIComponent(name)}`, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded border border-red-900 bg-red-950/40 px-3 py-2 text-sm text-red-200 flex items-center justify-between gap-3">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-300 hover:text-red-100">×</button>
        </div>
      )}
      <div className="flex justify-end">
        <button
          onClick={() => setShowNewModal(true)}
          disabled={!!busy}
          className="rounded bg-white text-neutral-900 px-4 py-2 text-sm font-medium hover:bg-neutral-200 disabled:opacity-50"
        >
          + New session
        </button>
      </div>

      <Card className="divide-y divide-border overflow-hidden p-0">
        {sessions.length === 0 && (
          <div className="p-8 text-center text-neutral-500">No sessions.</div>
        )}
        {sessions.map((s) => (
          <div key={s.name} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-sm break-all">[{s.name}]</span>
                {s.attached && (
                  <span className="text-xs rounded bg-green-900/40 text-green-300 px-1.5 py-0.5">
                    attached
                  </span>
                )}
                {s.claudeRunning ? (
                  <span className="text-xs rounded bg-blue-900/40 text-blue-300 px-1.5 py-0.5">
                    claude
                  </span>
                ) : (
                  <span className="text-xs rounded bg-neutral-800 text-neutral-400 px-1.5 py-0.5">
                    idle
                  </span>
                )}
                {s.subroot && (
                  <span className="text-xs text-neutral-500">{s.subroot}</span>
                )}
              </div>
              {s.cwd && (
                <div className="text-xs text-neutral-500 font-mono truncate mt-0.5">
                  {s.cwd}
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2 text-sm sm:flex-nowrap sm:justify-end">
              <button
                onClick={() => open(s.name)}
                className="rounded border border-neutral-700 px-3 py-1 hover:bg-neutral-800"
              >
                open
              </button>
              {s.attached && (
                <button
                  onClick={() => detach(s.name)}
                  disabled={!!busy}
                  className="rounded border border-neutral-700 px-3 py-1 hover:bg-neutral-800 disabled:opacity-50"
                  title="Force-detach all clients from this session"
                >
                  {busy === s.name ? "…" : "detach"}
                </button>
              )}
              <button
                onClick={() => resume(s.name)}
                disabled={!!busy}
                className="rounded border border-neutral-700 px-3 py-1 hover:bg-neutral-800 disabled:opacity-50"
                title="Restart claude but keep conversation history (--continue)"
              >
                {busy === s.name ? "…" : "resume"}
              </button>
              <button
                onClick={() => reset(s.name)}
                disabled={!!busy}
                className="rounded border border-amber-900/60 text-amber-300 px-3 py-1 hover:bg-amber-950/40 disabled:opacity-50"
                title="Restart claude with a fresh thread (discards conversation)"
              >
                {busy === s.name ? "…" : "reset"}
              </button>
              <button
                onClick={() => del(s.name, s.cwd, s.subroot)}
                disabled={!!busy}
                className="rounded border border-red-900/60 text-red-300 px-3 py-1 hover:bg-red-950/40 disabled:opacity-50 ml-auto sm:ml-0"
                aria-label="Delete session"
              >
                ×
              </button>
            </div>
          </div>
        ))}
      </Card>

      {showNewModal && (
        <NewSessionModal
          onClose={() => setShowNewModal(false)}
          onCreated={(name) => {
            setShowNewModal(false);
            // Open the new session's tmuxy view, then refresh the list.
            window.open(`${tmuxyOrigin}/?session=${encodeURIComponent(name)}`, "_blank", "noopener,noreferrer");
            refresh();
            router.refresh();
          }}
          onError={setError}
        />
      )}

      {deleteTarget && (
        <DeleteSessionModal
          target={deleteTarget}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={confirmDelete}
        />
      )}
    </div>
  );
}

function DeleteSessionModal({
  target,
  onCancel,
  onConfirm,
}: {
  target: { name: string; cwd: string | null; subroot: "personal" | "runspace" | null };
  onCancel: () => void;
  onConfirm: (deleteFolder: boolean) => void;
}) {
  const [deleteFolder, setDeleteFolder] = useState(false);
  const canDeleteFolder = !!(target.subroot && target.cwd);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      else if (e.key === "Enter") onConfirm(deleteFolder);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [deleteFolder, onCancel, onConfirm]);

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50"
      onClick={onCancel}
    >
      <Card
        className="w-full max-w-md p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold">Delete session</h2>

        <div className="space-y-3 text-sm">
          <p>
            Kill the tmux session{" "}
            <code className="font-mono bg-neutral-900 rounded px-1.5 py-0.5">
              [{target.name}]
            </code>
            ?
          </p>

          {canDeleteFolder ? (
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={deleteFolder}
                onChange={(e) => setDeleteFolder(e.target.checked)}
                className="mt-1"
              />
              <span>
                Also delete the project folder
                <span className="block text-xs text-neutral-500 font-mono mt-0.5 break-all">
                  {target.cwd}
                </span>
                <span className="block text-xs text-red-400 mt-1">
                  Permanent — cannot be undone.
                </span>
              </span>
            </label>
          ) : (
            <p className="text-xs text-neutral-500">
              Folder will be kept (no subroot detected).
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onCancel}
            className="rounded border border-neutral-700 px-3 py-1.5 text-sm hover:bg-neutral-800"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(deleteFolder)}
            className="rounded border border-red-900/60 bg-red-950/40 text-red-300 px-3 py-1.5 text-sm hover:bg-red-950/70"
          >
            {deleteFolder ? "Delete session + folder" : "Delete session"}
          </button>
        </div>
      </Card>
    </div>
  );
}

function NewSessionModal({
  onClose,
  onCreated,
  onError,
}: {
  onClose: () => void;
  onCreated: (name: string) => void;
  onError: (msg: string) => void;
}) {
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [subroot, setSubroot] = useState<"personal" | "runspace">("personal");
  const [createFolder, setCreateFolder] = useState(true);
  const [existingPath, setExistingPath] = useState("");
  const [trustDirectory, setTrustDirectory] = useState(true);
  const [launchClaude, setLaunchClaude] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const trimmed = name.trim();
  const trimmedPath = existingPath.trim();
  const nameValid = /^[a-z0-9][a-z0-9-]{0,30}$/.test(trimmed);
  const showNameWarning = trimmed.length > 0 && !nameValid;
  const pathValid = mode === "existing" ? trimmedPath.length > 0 && (trimmedPath.startsWith("/") || trimmedPath.startsWith("~/") || trimmedPath === "~") : true;
  const canSubmit = nameValid && pathValid && !submitting;

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const body =
        mode === "existing"
          ? { name: trimmed, mode: "existing", path: trimmedPath, trustDirectory, launchClaude }
          : { name: trimmed, mode: "new", subroot, createFolder, trustDirectory, launchClaude };
      const r = await fetch("/api/sessions/new", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (r.status === 401) {
        window.location.href = "/login";
        return;
      }
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      onCreated(data.name);
    } catch (e: any) {
      onError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <Card
        className="w-full max-w-md p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold">New session</h2>

        {/* mode tabs */}
        <div className="grid grid-cols-2 gap-2 p-1 bg-neutral-950 rounded border border-neutral-800">
          {(["new", "existing"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
                mode === m
                  ? "bg-neutral-800 text-neutral-100"
                  : "text-neutral-400 hover:text-neutral-200"
              }`}
            >
              {m === "new" ? "New project" : "Existing path"}
            </button>
          ))}
        </div>

        <div className="space-y-3">
          <label className="block">
            <span className="text-sm text-neutral-400">Session name</span>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && canSubmit) submit(); }}
              placeholder="my-project"
              maxLength={31}
              className="mt-1 w-full rounded border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm font-mono focus:outline-none focus:border-neutral-500"
            />
            {showNameWarning && (
              <span className="text-xs text-red-400 mt-1 block">
                Must start with letter/digit, only lowercase a-z 0-9 and hyphen, ≤ 31 chars
              </span>
            )}
          </label>

          {mode === "new" ? (
            <>
              <div>
                <span className="text-sm text-neutral-400 block mb-1">Subroot</span>
                <div className="flex gap-2">
                  {(["personal", "runspace"] as const).map((r) => (
                    <label
                      key={r}
                      className={`flex-1 rounded border px-3 py-2 text-sm cursor-pointer text-center ${
                        subroot === r
                          ? "border-white bg-neutral-800"
                          : "border-neutral-700 hover:bg-neutral-800/50"
                      }`}
                    >
                      <input
                        type="radio"
                        className="sr-only"
                        name="subroot"
                        checked={subroot === r}
                        onChange={() => setSubroot(r)}
                      />
                      ~/claude-code/{r}/
                    </label>
                  ))}
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={createFolder}
                  onChange={(e) => setCreateFolder(e.target.checked)}
                />
                Create folder if it doesn&apos;t exist
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={launchClaude}
                  onChange={(e) => setLaunchClaude(e.target.checked)}
                />
                Start Claude automatically
              </label>
              <label className={`flex items-center gap-2 text-sm ${!launchClaude ? "opacity-50" : ""}`}>
                <input
                  type="checkbox"
                  checked={trustDirectory}
                  onChange={(e) => setTrustDirectory(e.target.checked)}
                  disabled={!launchClaude}
                />
                Trust directory (skip Claude&apos;s trust dialog)
              </label>
              {nameValid && (
                <div className="text-xs text-neutral-500 font-mono">
                  ~/claude-code/{subroot}/{trimmed}
                </div>
              )}
            </>
          ) : (
            <>
              <label className="block">
                <span className="text-sm text-neutral-400">Existing path</span>
                <input
                  value={existingPath}
                  onChange={(e) => setExistingPath(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && canSubmit) submit(); }}
                  placeholder="~/claude-code/personal/some-existing-project"
                  className="mt-1 w-full rounded border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm font-mono focus:outline-none focus:border-neutral-500"
                />
                <span className="text-xs text-neutral-500 mt-1 block">
                  Absolute path or starting with <code className="font-mono">~/</code>. Must be inside your home directory and exist.
                </span>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={launchClaude}
                  onChange={(e) => setLaunchClaude(e.target.checked)}
                />
                Start Claude automatically
              </label>
              <label className={`flex items-center gap-2 text-sm ${!launchClaude ? "opacity-50" : ""}`}>
                <input
                  type="checkbox"
                  checked={trustDirectory}
                  onChange={(e) => setTrustDirectory(e.target.checked)}
                  disabled={!launchClaude}
                />
                Trust directory (skip Claude&apos;s trust dialog)
              </label>
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            className="rounded border border-neutral-700 px-3 py-1.5 text-sm hover:bg-neutral-800"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!canSubmit}
            className="rounded bg-white text-neutral-900 px-3 py-1.5 text-sm font-medium hover:bg-neutral-200 disabled:opacity-50"
          >
            {submitting ? "Creating…" : "Create"}
          </button>
        </div>
      </Card>
    </div>
  );
}
