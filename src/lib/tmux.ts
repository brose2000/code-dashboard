import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const exec = promisify(execFile);
const TMUX_TIMEOUT_MS = 5000;

export type Session = {
  name: string;
  created: number;
  activity: number;
  attached: boolean;
  windows: number;
  claudeRunning: boolean;
  cwd: string | null;
  subroot: "personal" | "runspace" | null;
};

export type Subroot = "personal" | "runspace";

const SUBROOTS: Subroot[] = ["personal", "runspace"];

function detectSubroot(cwd: string | null): Subroot | null {
  if (!cwd) return null;
  for (const r of SUBROOTS) {
    if (cwd.includes(`/claude-code/${r}/`)) return r;
  }
  return null;
}

// Persisted "first-seen" timestamp per session name. Survives reboots/watchdog
// recreates, so sort order reflects the user's original creation order — not
// the moment the watchdog respawned the session after a host restart.
const BIRTHS_DIR = join(homedir(), ".local", "state", "code-dashboard");
const BIRTHS_FILE = join(BIRTHS_DIR, "session-births.json");

function loadBirths(): Record<string, number> {
  try {
    return JSON.parse(readFileSync(BIRTHS_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveBirths(map: Record<string, number>): void {
  try {
    if (!existsSync(BIRTHS_DIR)) mkdirSync(BIRTHS_DIR, { recursive: true, mode: 0o755 });
    const tmp = BIRTHS_FILE + ".tmp";
    writeFileSync(tmp, JSON.stringify(map));
    renameSync(tmp, BIRTHS_FILE);
  } catch {
    // non-fatal: sort just falls back to tmux session_created next call
  }
}

async function tmux(args: string[]): Promise<string> {
  try {
    const { stdout } = await exec("tmux", args, {
      maxBuffer: 4 * 1024 * 1024,
      timeout: TMUX_TIMEOUT_MS,
    });
    return stdout;
  } catch (e: any) {
    throw new Error(`tmux ${args.join(" ")} failed: ${e.stderr?.trim() || e.message}`);
  }
}

/** Build the claude-launch command. Single-quoted to neutralise any shell expansion
 * inside the pane. Names are validated upstream so contain no quotes. */
function claudeLaunchCommand(name: string): string {
  // session names match /^[a-z0-9-]+$/ so single quotes are safe
  return `claude --remote-control --name '[${name}]'`;
}

/** Like claudeLaunchCommand but continues the most recent conversation in the cwd
 *  (used by resetSession to preserve thread history across kills/restarts). */
function claudeResumeCommand(name: string): string {
  return `claude --remote-control --name '[${name}]' --continue`;
}


/** Pre-accept the Claude Code trust dialog for a directory by writing to ~/.claude.json.
 *  Safe: reads, mutates, writes-via-tmp-rename. Creates a fresh project entry if absent. */
function trustDirectory(absPath: string): void {
  const cfgPath = join(homedir(), ".claude.json");
  if (!existsSync(cfgPath)) {
    // First-time install of claude — write a minimal config with the project trusted.
    const fresh = { projects: { [absPath]: minimalProjectEntry() } };
    atomicWriteJson(cfgPath, fresh);
    return;
  }
  let cfg: any;
  try {
    cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
  } catch (e: any) {
    throw new Error(`failed to parse ~/.claude.json: ${e.message}`);
  }
  cfg.projects ??= {};
  cfg.projects[absPath] ??= minimalProjectEntry();
  cfg.projects[absPath].hasTrustDialogAccepted = true;
  atomicWriteJson(cfgPath, cfg);
}

function minimalProjectEntry() {
  return {
    allowedTools: [],
    mcpContextUris: [],
    mcpServers: {},
    enabledMcpjsonServers: [],
    disabledMcpjsonServers: [],
    hasTrustDialogAccepted: true,
    projectOnboardingSeenCount: 0,
    hasClaudeMdExternalIncludesApproved: false,
    hasClaudeMdExternalIncludesWarningShown: false,
    exampleFiles: [],
  };
}

function atomicWriteJson(path: string, data: unknown): void {
  const tmp = `${path}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  renameSync(tmp, path);
}

export async function listSessions(): Promise<Session[]> {
  let out: string;
  try {
    out = await tmux([
      "list-sessions",
      "-F",
      "#{session_name}\t#{session_created}\t#{session_attached}\t#{session_windows}\t#{session_activity}",
    ]);
  } catch (e: any) {
    // tmux server not running → treat as no sessions
    if (/no server running|failed to connect/i.test(e.message)) return [];
    throw e;
  }
  const sessions: Session[] = [];
  for (const line of out.trim().split("\n").filter(Boolean)) {
    const [name, created, attached, windows, activity] = line.split("\t");
    if (!name) continue;
    if (name.startsWith("__")) continue;
    if (name.startsWith("tmuxy_")) continue;
    let cwd: string | null = null;
    let claudeRunning = false;
    try {
      const panesOut = await tmux([
        "list-panes",
        "-t",
        `=${name}`,
        "-F",
        "#{pane_current_path}\t#{pane_current_command}",
      ]);
      const lines = panesOut.trim().split("\n").filter(Boolean);
      if (lines.length > 0) {
        cwd = lines[0].split("\t")[0] || null;
        claudeRunning = lines.some((l) => {
          const cmd = l.split("\t")[1] || "";
          return cmd === "claude" || cmd === "node";
        });
      }
    } catch {
      // session may have vanished between list-sessions and list-panes
    }
    sessions.push({
      name,
      created: parseInt(created, 10) || 0,
      activity: parseInt(activity, 10) || 0,
      attached: attached === "1",
      windows: parseInt(windows, 10) || 0,
      claudeRunning,
      cwd,
      subroot: detectSubroot(cwd),
    });
  }
  // Override `created` with the first time we saw each session name. New names
  // get persisted on the spot; recreated names keep their original birth date.
  const births = loadBirths();
  let dirty = false;
  for (const s of sessions) {
    if (births[s.name]) {
      s.created = births[s.name];
    } else {
      births[s.name] = s.created;
      dirty = true;
    }
  }
  if (dirty) saveBirths(births);
  // Newest-first by original creation time.
  sessions.sort((a, b) => b.created - a.created);
  return sessions;
}

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,30}$/;

export function validateName(name: string): string | null {
  if (typeof name !== "string" || !name) return "name required";
  if (!NAME_RE.test(name)) {
    return "name must be lowercase letters, digits, hyphens (max 31 chars), starting with letter or digit";
  }
  return null;
}

export function folderForSession(name: string, subroot: Subroot): string {
  if (validateName(name)) throw new Error("invalid name");
  if (subroot !== "personal" && subroot !== "runspace") throw new Error("invalid subroot");
  return join(homedir(), "claude-code", subroot, name);
}

export function folderExists(name: string, subroot: Subroot): boolean {
  return existsSync(folderForSession(name, subroot));
}

export async function sessionExists(name: string): Promise<boolean> {
  if (validateName(name)) return false;
  try {
    await tmux(["has-session", "-t", `=${name}`]);
    return true;
  } catch {
    return false;
  }
}

export type CreateSessionOpts =
  | { name: string; mode: "new"; subroot: Subroot; createFolder: boolean; trustDirectory?: boolean; launchClaude?: boolean }
  | { name: string; mode: "existing"; path: string; trustDirectory?: boolean; launchClaude?: boolean };

/** Validate an absolute path is safe to use: must be absolute, must exist as dir,
 *  and must be inside the user's home (no /etc, /var, etc). */
export function validateExistingPath(path: string): { ok: true; resolved: string } | { ok: false; error: string } {
  if (typeof path !== "string" || !path) return { ok: false, error: "path required" };
  // Expand leading ~
  let p = path;
  if (p.startsWith("~/")) p = join(homedir(), p.slice(2));
  if (p === "~") p = homedir();
  // Must be absolute now
  if (!p.startsWith("/")) return { ok: false, error: "path must be absolute or start with ~/" };
  // No traversal nonsense
  if (p.includes("/../") || p.endsWith("/..")) return { ok: false, error: "path contains '..'" };
  // Must be inside home dir
  const home = homedir();
  if (p !== home && !p.startsWith(home + "/")) return { ok: false, error: `path must be inside ${home}` };
  // Must exist as a directory
  if (!existsSync(p)) return { ok: false, error: `path does not exist: ${p}` };
  // Lightweight check: directory? (existsSync doesn't tell us; we can rely on tmux to fail anyway)
  return { ok: true, resolved: p };
}

export async function createSession(opts: CreateSessionOpts): Promise<void> {
  const { name } = opts;
  if (validateName(name)) throw new Error("invalid name");

  let folder: string;
  if (opts.mode === "existing") {
    const v = validateExistingPath(opts.path);
    if (!v.ok) throw new Error(v.error);
    folder = v.resolved;
  } else {
    folder = folderForSession(name, opts.subroot);
    if (!existsSync(folder)) {
      if (!opts.createFolder) throw new Error(`folder ${folder} does not exist and createFolder=false`);
      mkdirSync(folder, { recursive: true, mode: 0o755 });
    }
  }

  if (await sessionExists(name)) {
    throw new Error(`session ${name} already exists`);
  }
  if (opts.trustDirectory) {
    try {
      trustDirectory(folder);
    } catch (e: any) {
      // non-fatal: log and continue; user will just see the trust prompt
      console.warn(`[trust] failed to pre-trust ${folder}: ${e.message}`);
    }
  }
  await tmux(["new-session", "-d", "-s", name, "-c", folder]);
  if (opts.launchClaude === false) {
    // Mark the session so code-watchdog won't auto-revive a Claude process in it.
    await tmux(["set-environment", "-t", name, "NO_AUTO_CLAUDE", "1"]);
  } else {
    await tmux(["send-keys", "-t", `${name}:`, claudeLaunchCommand(name), "Enter"]);
  }
}

export type ResetMode = "resume" | "fresh";

export async function resetSession(name: string, mode: ResetMode = "resume"): Promise<void> {
  if (validateName(name)) throw new Error("invalid name");
  if (!(await sessionExists(name))) {
    throw new Error(`session ${name} does not exist`);
  }
  const launch = mode === "resume" ? claudeResumeCommand(name) : claudeLaunchCommand(name);
  // Cleanest reset: respawn the pane with default shell ($SHELL), killing whatever was there.
  // Then send-keys to launch claude. Fallback to send-keys-only if respawn-pane fails.
  try {
    await tmux(["respawn-pane", "-k", "-t", `${name}:`]);
    // Wait briefly for the shell prompt to render before typing.
    await new Promise((r) => setTimeout(r, 300));
    await tmux(["send-keys", "-t", `${name}:`, launch, "Enter"]);
  } catch {
    // Fallback: send-keys. Two C-c interrupts, C-u clears input, then run.
    await tmux(["send-keys", "-t", `${name}:`, "C-c"]);
    await new Promise((r) => setTimeout(r, 200));
    await tmux(["send-keys", "-t", `${name}:`, "C-c"]);
    await new Promise((r) => setTimeout(r, 200));
    await tmux(["send-keys", "-t", `${name}:`, "C-u"]);
    await new Promise((r) => setTimeout(r, 100));
    await tmux(["send-keys", "-t", `${name}:`, launch, "Enter"]);
  }
}

export async function deleteSession(name: string, deleteFolder = false): Promise<void> {
  if (validateName(name)) throw new Error("invalid name");

  let cwd: string | null = null;
  if (deleteFolder && (await sessionExists(name))) {
    try {
      const out = await tmux([
        "list-panes",
        "-t",
        `=${name}`,
        "-F",
        "#{pane_current_path}",
      ]);
      cwd = out.trim().split("\n")[0] || null;
    } catch {
      // ignore — we'll just skip folder removal if we can't resolve cwd
    }
  }

  if (await sessionExists(name)) {
    await tmux(["kill-session", "-t", `=${name}`]);
  }

  // Forget this session's birth time so a future session with the same name
  // gets a fresh timestamp instead of inheriting the deleted one's slot.
  const births = loadBirths();
  if (births[name]) {
    delete births[name];
    saveBirths(births);
  }

  if (deleteFolder && cwd) {
    removeSessionFolder(cwd);
  }
}

/** Safely remove a session's working directory.
 * Only deletes if the path resolves inside ~/claude-code/{personal,runspace}/<name>/,
 * exactly one level below a known subroot — never the subroot itself, never outside. */
function removeSessionFolder(cwd: string): void {
  const home = homedir();
  const allowedRoots = SUBROOTS.map((r) => resolve(join(home, "claude-code", r)));

  let target: string;
  try {
    target = realpathSync(cwd);
  } catch {
    return; // cwd vanished — nothing to do
  }

  const matchingRoot = allowedRoots.find((root) => {
    if (!target.startsWith(root + "/")) return false;
    const rel = target.slice(root.length + 1);
    return rel.length > 0 && !rel.includes("/");
  });

  if (!matchingRoot) {
    throw new Error(`refusing to delete folder outside known subroots: ${target}`);
  }

  rmSync(target, { recursive: true, force: true });
}

export async function detachSession(name: string): Promise<void> {
  if (validateName(name)) throw new Error("invalid name");
  if (!(await sessionExists(name))) {
    throw new Error(`session ${name} does not exist`);
  }
  // -s <name> detaches every client attached to that session.
  // Idempotent: if no clients are attached, tmux exits 0 silently.
  await tmux(["detach-client", "-s", name]);
}
