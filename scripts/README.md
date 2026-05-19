# code-watchdog

Auto-heals Claude sessions managed by code-dashboard. Three failure modes:

- **A.** Tmux session exists but `claude` died (dropped to shell) → respawn pane + `claude … --continue`.
- **B.** Tmux session vanished entirely (OOM, crash) → recreate session + relaunch, if project dir still exists and the session was not deleted via the dashboard in the last 30 min.
- **C.** `claude` is alive but Remote Control footer is missing → send `/remote-control` to bring it back.

State file: `~/.local/state/code-watchdog/last-healthy.txt` (`<name>\t<cwd>` per line).

## Opt-out

If a session is created with `launchClaude=false` from the dashboard, it gets marked with a tmux environment variable:

```
tmux set-environment -t <name> NO_AUTO_CLAUDE 1
```

The watchdog checks this and skips heal A/B/C for those sessions. The env var lives with the session and disappears on delete.

## Install (linuxbox)

```
cp code-watchdog.sh ~/bin/code-watchdog.sh
chmod +x ~/bin/code-watchdog.sh
cp code-watchdog.service code-watchdog.timer ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now code-watchdog.timer
```

Runs every 5 minutes. Logs to journal: `journalctl --user -u code-watchdog`.
