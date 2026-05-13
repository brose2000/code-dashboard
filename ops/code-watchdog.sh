#!/bin/bash
# code-watchdog — check every tmux session for a live `claude` process and
# auto-resume (--continue) if dropped to shell. Runs from a systemd timer.
#
# Skips sessions in the SKIP_LIST (utility sessions where no claude is expected).

set -uo pipefail

# Sessions to NOT auto-resume even if they have no claude (utility/scratch sessions)
SKIP_LIST=("main" "tmuxy")

# Names we recognise as a healthy state
HEALTHY_CMDS="claude node"

log() { printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$*"; }

is_skipped() {
  local s="$1"
  for x in "${SKIP_LIST[@]}"; do [[ "$x" == "$s" ]] && return 0; done
  return 1
}

# Validate session name follows the dashboard pattern: lowercase, hyphens, ≤31
valid_name() {
  [[ "$1" =~ ^[a-z0-9][a-z0-9-]{0,30}$ ]]
}

revived=0
checked=0
for s in $(tmux list-sessions -F '#{session_name}' 2>/dev/null); do
  if is_skipped "$s"; then continue; fi
  if ! valid_name "$s"; then
    log "skip $s (name doesn't match dashboard pattern)"
    continue
  fi
  checked=$((checked+1))
  cmd=$(tmux list-panes -t "=$s" -F '#{pane_current_command}' 2>/dev/null | head -1)
  healthy=0
  for h in $HEALTHY_CMDS; do [[ "$cmd" == "$h" ]] && healthy=1; done
  if [ "$healthy" = "0" ]; then
    log "reviving $s (current cmd: $cmd) → claude --continue"
    tmux respawn-pane -k -t "${s}:" 2>/dev/null
    sleep 0.4
    tmux send-keys -t "${s}:" "claude --remote-control --name '[${s}]' --continue" Enter
    revived=$((revived+1))
  fi
done

log "checked $checked sessions, revived $revived"
exit 0
