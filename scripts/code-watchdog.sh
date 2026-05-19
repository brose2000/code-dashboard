#!/bin/bash
# code-watchdog — auto-heal Claude Code sessions managed by code-dashboard.
#
# Two failure modes handled:
#   A. Session exists in tmux but `claude` process has died (dropped to shell)
#      → respawn-pane + claude --continue
#   B. Session is COMPLETELY gone from tmux (OOM killer, crash, etc.)
#      → recreate tmux session + claude --continue, IF the project dir still
#        exists AND the session was not intentionally deleted via the dashboard
#        within the last 30 minutes.
#
# State: ~/.local/state/code-watchdog/last-healthy.txt
# Format: <session_name>\t<cwd> per line
set -uo pipefail

SKIP_LIST=("main" "tmuxy")
MAX_RECREATE_PER_RUN=3
HEALTHY_CMDS="claude node"
STATE_DIR="$HOME/.local/state/code-watchdog"
STATE_FILE="$STATE_DIR/last-healthy.txt"
mkdir -p "$STATE_DIR"

log() { printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$*"; }

is_skipped() {
  local s="$1"
  for x in "${SKIP_LIST[@]}"; do [[ "$x" == "$s" ]] && return 0; done
  return 1
}

valid_name() {
  [[ "$1" =~ ^[a-z0-9][a-z0-9-]{0,30}$ ]]
}

# Was this session intentionally deleted via the dashboard in the last 30 min?
# Looks for "[audit] <email> deleted session=<name>" entries.
was_recently_deleted() {
  local name="$1"
  journalctl --user -u code-dashboard --since "30 minutes ago" --no-pager 2>/dev/null \
    | grep -qE "\[audit\].*deleted session=$name(\s|$)"
}

# Did the user create this session with launchClaude=false? Marked via tmux env var.
has_no_auto_claude() {
  local name="$1"
  tmux show-environment -t "=$name" NO_AUTO_CLAUDE 2>/dev/null | grep -q '^NO_AUTO_CLAUDE=1$'
}

# === read current state ===
declare -A CURRENT_CWD
declare -A CURRENT_CMD
for s in $(tmux list-sessions -F '#{session_name}' 2>/dev/null); do
  cwd=$(tmux list-panes -t "=$s" -F '#{pane_current_path}' 2>/dev/null | head -1)
  cmd=$(tmux list-panes -t "=$s" -F '#{pane_current_command}' 2>/dev/null | head -1)
  CURRENT_CWD[$s]="$cwd"
  CURRENT_CMD[$s]="$cmd"
done


# After launching claude in a pane, wait for boot then verify remote-control came up.
# If we see "Remote Control failed" in the pane buffer, send /remote-control as a retry.
# Idempotent: only sends the slash command when failure is detected.
verify_remote_control() {
  local target="$1"
  sleep 12
  # Check only the currently-visible footer for the positive signal.
  # The scrollback may contain stale "Remote Control failed" messages.
  local buf
  buf=$(tmux capture-pane -t "$target" -p 2>/dev/null | tail -10)
  if printf '%s' "$buf" | grep -q "Remote Control active"; then
    return 0
  fi
  log "RC: bringing remote-control up on $target via slash command"
  tmux send-keys -t "$target" "/remote-control" Enter
  sleep 1
  tmux send-keys -t "$target" Enter
}

# === heal A: dropped-to-shell within existing session ===
revived_inplace=0
for s in "${!CURRENT_CMD[@]}"; do
  if is_skipped "$s"; then continue; fi
  if ! valid_name "$s"; then continue; fi
  if has_no_auto_claude "$s"; then continue; fi
  cmd="${CURRENT_CMD[$s]}"
  healthy=0
  for h in $HEALTHY_CMDS; do [[ "$cmd" == "$h" ]] && healthy=1; done
  if [ "$healthy" = "0" ]; then
    log "A: reviving $s in-place (current cmd: $cmd)"
    tmux respawn-pane -k -t "${s}:" 2>/dev/null
    sleep 0.4
    tmux send-keys -t "${s}:" "claude --remote-control --name '[${s}]' --continue" Enter
    ( verify_remote_control "${s}:" & ) >/dev/null 2>&1
    revived_inplace=$((revived_inplace+1))
  fi
done

# === heal B: sessions that vanished entirely ===
revived_recreated=0
if [ -f "$STATE_FILE" ]; then
  while IFS=$'\t' read -r name cwd; do
    [ -z "$name" ] && continue
    if is_skipped "$name"; then continue; fi
    if ! valid_name "$name"; then continue; fi
    # Skip if it's still around (in either healthy or dropped state)
    if [ -n "${CURRENT_CWD[$name]+x}" ]; then continue; fi
    # Skip if intentionally deleted via dashboard recently
    if was_recently_deleted "$name"; then
      log "B: skip $name (recently deleted via dashboard)"
      continue
    fi
    # Skip if the project dir is gone
    if [ ! -d "$cwd" ]; then
      log "B: skip $name (dir $cwd no longer exists)"
      continue
    fi
    if [ "$revived_recreated" -ge "$MAX_RECREATE_PER_RUN" ]; then
      log "B: hit MAX_RECREATE_PER_RUN=$MAX_RECREATE_PER_RUN, deferring $name to next tick"
      continue
    fi
    log "B: recreating $name in $cwd"
    tmux new-session -d -s "$name" -c "$cwd"
    sleep 0.4
    tmux send-keys -t "${name}:" "claude --remote-control --name '[${name}]' --continue" Enter
    ( verify_remote_control "${name}:" & ) >/dev/null 2>&1
    revived_recreated=$((revived_recreated+1))
  done < "$STATE_FILE"
fi

# === heal C: remote-control died but claude is still running ===
# For each session where claude is alive, check the current view for the positive
# "Remote Control active" signal. If missing, send /remote-control + Enter to
# bring it back via the slash command. Catches the post-bulk-recreate race AND
# any later RC drop (network blip, etc.) without disturbing healthy sessions.
revived_rc=0
for s in "${!CURRENT_CMD[@]}"; do
  if is_skipped "$s"; then continue; fi
  if ! valid_name "$s"; then continue; fi
  if has_no_auto_claude "$s"; then continue; fi
  cmd="${CURRENT_CMD[$s]}"
  # Only heal if claude is actually running (not a shell-dropped pane, those are
  # handled by heal A above which will re-launch claude with --remote-control).
  claude_running=0
  for h in $HEALTHY_CMDS; do [[ "$cmd" == "$h" ]] && claude_running=1; done
  [ "$claude_running" = "1" ] || continue
  # Capture wider window (terminal width varies in tmux capture-pane default)
  buf=$(tmux capture-pane -t "${s}:" -p 2>/dev/null | tail -10)
  if printf '%s' "$buf" | grep -q "Remote Control active"; then
    continue
  fi
  log "C: re-activating remote-control on $s via slash command"
  tmux send-keys -t "${s}:" "/remote-control" Enter
  sleep 1
  tmux send-keys -t "${s}:" Enter
  revived_rc=$((revived_rc+1))
done

# === write new state snapshot ===
# Includes:
#   1. All current tmux sessions (healthy + dropped — they exist now).
#   2. Previously-tracked sessions that are STILL MISSING but whose dir exists
#      AND were not intentionally deleted. These were deferred this run and need
#      to be retried on the next tick — must survive the state write.
{
  # 1. current sessions
  declare -A WROTE
  for s in "${!CURRENT_CMD[@]}"; do
    if is_skipped "$s"; then continue; fi
    if ! valid_name "$s"; then continue; fi
    if has_no_auto_claude "$s"; then continue; fi
    cwd="${CURRENT_CWD[$s]}"
    [ -n "$cwd" ] || continue
    printf '%s\t%s\n' "$s" "$cwd"
    WROTE[$s]=1
  done
  # 2. preserve deferred-from-previous-state entries (dir still exists, not deleted)
  if [ -f "$STATE_FILE" ]; then
    while IFS=$'\t' read -r prev_name prev_cwd; do
      [ -z "$prev_name" ] && continue
      [ -n "${WROTE[$prev_name]+x}" ] && continue        # already wrote
      is_skipped "$prev_name" && continue
      valid_name "$prev_name" || continue
      [ -d "$prev_cwd" ] || continue                       # dir gone
      was_recently_deleted "$prev_name" && continue        # user deleted
      printf '%s\t%s\n' "$prev_name" "$prev_cwd"
    done < "$STATE_FILE"
  fi
} > "$STATE_FILE.tmp"
mv "$STATE_FILE.tmp" "$STATE_FILE"

total_now=${#CURRENT_CWD[@]}
total_state=$(wc -l < "$STATE_FILE" 2>/dev/null || echo 0)
log "checked $total_now sessions, revived $revived_inplace in-place, recreated $revived_recreated, rc-healed $revived_rc. state=$total_state"
exit 0
