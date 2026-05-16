#!/bin/bash
# claude-jsonl-heal — remove empty/whitespace-only text content blocks from
# Claude Code session JSONLs. Anthropic's API rejects messages with empty text
# blocks ("API Error: 400 messages: text content blocks must be non-empty"),
# which corrupts compaction and re-attaches. This scrubs them out, atomically.
#
# Idempotent: only rewrites files that actually contain offending blocks.
# Keeps a backup .bak-jsonl-heal next to the original.

set -uo pipefail

BASE="$HOME/.claude/projects"
[ -d "$BASE" ] || { echo "no $BASE"; exit 0; }

log() { printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$*"; }

FILTER='if .message.content | type == "array"
        then .message.content |= map(select(.type != "text" or (.text // "" | test("\\S"))))
        else . end'

healed=0
scanned=0
MIN_QUIET_SECONDS=30
NOW=$(date +%s)

for jsonl in "$BASE"/*/*.jsonl; do
  [ -f "$jsonl" ] || continue
  # Skip if claude may still be writing to this file
  mtime=$(stat -c %Y "$jsonl" 2>/dev/null || echo 0)
  if [ $((NOW - mtime)) -lt "$MIN_QUIET_SECONDS" ]; then continue; fi
  scanned=$((scanned+1))
  # Skip if no empty text blocks exist (cheap pre-filter)
  if ! jq -c 'select((.message.content | type == "array") and (.message.content | map(select(.type == "text" and ((.text // "") | test("\\S") | not))) | length > 0))' "$jsonl" 2>/dev/null | head -1 | grep -q .; then
    continue
  fi
  # Has offending block(s) — fix
  tmp="${jsonl}.heal-tmp.$$"
  if jq -c "$FILTER" "$jsonl" > "$tmp" 2>/dev/null && [ -s "$tmp" ]; then
    # Validate line counts roughly match (no catastrophic loss)
    orig_lines=$(wc -l < "$jsonl")
    new_lines=$(wc -l < "$tmp")
    if [ "$new_lines" -lt "$((orig_lines - 5))" ]; then
      log "ABORT $jsonl: line drop suspicious ($orig_lines → $new_lines)"
      rm -f "$tmp"
      continue
    fi
    cp "$jsonl" "${jsonl}.bak-jsonl-heal"
    mv "$tmp" "$jsonl"
    log "healed $(basename "$(dirname "$jsonl")")/$(basename "$jsonl")"
    healed=$((healed+1))
  else
    rm -f "$tmp"
  fi
done

log "scanned $scanned jsonls, healed $healed"
exit 0
