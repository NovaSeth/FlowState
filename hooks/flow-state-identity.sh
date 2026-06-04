#!/usr/bin/env bash
#
# Flow State identity banner - Claude Code SessionStart hook.
#
# Resolves which Flow State actor THIS project directory authenticates as and
# injects it into the session, so a session running under an inherited or wrong
# key is caught immediately instead of silently acting as someone else.
#
# The footgun this guards: a directory with no per-project mcpServers.flow-state
# entry in ~/.claude.json silently inherits the top-level key, so the session
# becomes whatever actor that key belongs to - with no warning. This hook makes
# that visible and flags the inherited case.
#
# Stays silent (exit 0, no output) when the directory has no Flow State MCP
# config or the server is unreachable - it never blocks or errors a session.
#
# Wire it in settings.json under hooks.SessionStart (alongside any existing
# hooks); see hooks/README.md.

config="$HOME/.claude.json"
[ -f "$config" ] || exit 0
command -v jq >/dev/null 2>&1 || exit 0
command -v curl >/dev/null 2>&1 || exit 0

# The hook receives a JSON event on stdin; cwd tells us which project we are in.
input=$(cat 2>/dev/null || true)
cwd=$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null || true)
[ -n "$cwd" ] || cwd="${CLAUDE_PROJECT_DIR:-$PWD}"

# Per-project key wins; fall back to the top-level key (the silent inheritance).
key=$(jq -r --arg d "$cwd" '.projects[$d].mcpServers["flow-state"].env.FS_API_KEY // empty' "$config" 2>/dev/null || true)
inherited=""
if [ -z "$key" ]; then
  key=$(jq -r '.mcpServers["flow-state"].env.FS_API_KEY // empty' "$config" 2>/dev/null || true)
  [ -n "$key" ] && inherited=1
fi
[ -n "$key" ] || exit 0

base=$(jq -r --arg d "$cwd" '
  .projects[$d].mcpServers["flow-state"].env.FS_BASE_URL
  // .mcpServers["flow-state"].env.FS_BASE_URL
  // "http://localhost:3000"' "$config" 2>/dev/null || true)
[ -n "$base" ] || base="http://localhost:3000"

me=$(curl -s --max-time 1 -H "x-api-key: $key" "$base/api/me" 2>/dev/null || true)
name=$(printf '%s' "$me" | jq -r '.actor.name // empty' 2>/dev/null || true)
[ -n "$name" ] || exit 0

prefix="${key%%.*}"
msg="Flow State identity: this session authenticates as \"$name\" ($prefix)."
if [ -n "$inherited" ]; then
  msg="$msg WARNING: this is the INHERITED top-level key - this directory has no per-project mcpServers.flow-state entry in ~/.claude.json, so the session may be acting as the wrong actor. If \"$name\" is not who this project should be, mint a key for the right actor, add a per-project mcpServers.flow-state entry, and restart the session (a live session never picks up a key changed after it started)."
fi

jq -n --arg m "$msg" \
  '{hookSpecificOutput: {hookEventName: "SessionStart", additionalContext: $m}}'
exit 0
