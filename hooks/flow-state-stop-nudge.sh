#!/usr/bin/env bash
#
# Flow State stop nudge - Claude Code Stop hook.
#
# When the agent finishes a turn, check whether it left any of its OWN tasks
# stuck in_progress without a recent update. If so, nudge it once to close the
# status (Flow State is the source of truth for progress, not stale in_progress
# rows). This is the "report progress on the fly" discipline, enforced instead
# of merely asked for.
#
# Scope: only tasks owned by the actor this directory authenticates as, and only
# those not touched within FS_STALE_MINUTES (default 30) - so freshly started
# work is not nagged.
#
# Loop-safe: when the agent is already continuing because of this hook
# (stop_hook_active), it stays silent so it nudges at most once per settle.
# Silent when there is no Flow State config, the server is down, or nothing is
# stale - it never blocks for nothing.
#
# Wire it in settings.json under hooks.Stop (alongside any existing hooks);
# see hooks/README.md.

config="$HOME/.claude.json"
[ -f "$config" ] || exit 0
command -v jq >/dev/null 2>&1 || exit 0
command -v curl >/dev/null 2>&1 || exit 0

input=$(cat 2>/dev/null || true)

# Never re-trigger while the agent is already continuing from this same hook.
active=$(printf '%s' "$input" | jq -r '.stop_hook_active // false' 2>/dev/null || echo false)
[ "$active" = "true" ] && exit 0

cwd=$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null || true)
[ -n "$cwd" ] || cwd="${CLAUDE_PROJECT_DIR:-$PWD}"

key=$(jq -r --arg d "$cwd" '.projects[$d].mcpServers["flow-state"].env.FS_API_KEY // empty' "$config" 2>/dev/null || true)
[ -n "$key" ] || key=$(jq -r '.mcpServers["flow-state"].env.FS_API_KEY // empty' "$config" 2>/dev/null || true)
[ -n "$key" ] || exit 0

base=$(jq -r --arg d "$cwd" '
  .projects[$d].mcpServers["flow-state"].env.FS_BASE_URL
  // .mcpServers["flow-state"].env.FS_BASE_URL
  // "http://localhost:3000"' "$config" 2>/dev/null || true)
[ -n "$base" ] || base="http://localhost:3000"

me=$(curl -s --max-time 1 -H "x-api-key: $key" "$base/api/me" 2>/dev/null || true)
actor_id=$(printf '%s' "$me" | jq -r '.actor.id // empty' 2>/dev/null || true)
actor_name=$(printf '%s' "$me" | jq -r '.actor.name // empty' 2>/dev/null || true)
[ -n "$actor_id" ] || exit 0

tasks=$(curl -s --max-time 1 -H "x-api-key: $key" \
  "$base/api/tasks?status=in_progress&ownerActorId=$actor_id&limit=200" 2>/dev/null || true)
printf '%s' "$tasks" | jq -e 'type == "array"' >/dev/null 2>&1 || exit 0

stale_minutes="${FS_STALE_MINUTES:-30}"
cutoff_ms=$(( ($(date +%s) - stale_minutes * 60) * 1000 ))

# Titles of in_progress tasks whose updatedAt is older than the cutoff.
# jq's fromdateiso8601 rejects fractional seconds, so truncate ".SSSZ" -> "Z"
# (take the first 19 chars "YYYY-MM-DDTHH:MM:SS" and re-append "Z") before parsing.
stale=$(printf '%s' "$tasks" | jq -r --argjson cut "$cutoff_ms" '
  [ .[] | select(((.updatedAt[0:19] + "Z") | fromdateiso8601? // 0) * 1000 < $cut) | .title ]
  | .[:5] | map("  - " + .) | join("\n")' 2>/dev/null || true)
[ -n "$stale" ] || exit 0

count=$(printf '%s' "$tasks" | jq -r --argjson cut "$cutoff_ms" '
  [ .[] | select(((.updatedAt[0:19] + "Z") | fromdateiso8601? // 0) * 1000 < $cut) ] | length' 2>/dev/null || echo 0)
[ "$count" -gt 0 ] 2>/dev/null || exit 0

reason="Flow State: $actor_name still has $count task(s) marked in_progress, untouched for over ${stale_minutes}m:
$stale
Before finishing, update their status in Flow State (fs_update_task: done / blocked with a reason / back to todo). Flow State is the source of truth for progress - do not leave stale in_progress rows. If they are genuinely still in progress, say so briefly and stop."

jq -n --arg r "$reason" '{decision: "block", reason: $r}'
exit 0
