# Flow State hooks for Claude Code

Two optional [Claude Code hooks](https://docs.claude.com/en/docs/claude-code/hooks)
that make Flow State's identity and progress discipline deterministic instead of
relying on the agent to remember it.

Both are self-contained POSIX shell scripts (need only `jq` and `curl`), read
the Flow State key for the current project directory straight from
`~/.claude.json`, and stay silent when there is no Flow State config or the
server is down. They never error a session.

## `flow-state-identity.sh` - SessionStart

Injects "this session authenticates as `<actor>`" at session start, resolved by
calling `GET /api/me` with the key configured for the current directory. If the
directory has no per-project `mcpServers.flow-state` entry and falls back to the
top-level key, it adds a WARNING - this is the silent footgun where a session
acts as the wrong actor without any sign.

## `flow-state-stop-nudge.sh` - Stop

When the agent finishes a turn, checks whether it left any of its own tasks
stuck `in_progress` and untouched for over `FS_STALE_MINUTES` (default `30`). If
so it nudges once (loop-safe via `stop_hook_active`) to close the status in Flow
State. Scoped to the actor the current directory authenticates as.

## Wiring

Make them executable and reference them from `~/.claude/settings.json`, appended
to any hooks you already run (the arrays hold multiple entries):

```jsonc
{
  "hooks": {
    "SessionStart": [
      { "hooks": [
        { "type": "command",
          "command": "/ABSOLUTE/PATH/TO/FlowState/hooks/flow-state-identity.sh",
          "timeout": 5 }
      ] }
    ],
    "Stop": [
      { "hooks": [
        { "type": "command",
          "command": "/ABSOLUTE/PATH/TO/FlowState/hooks/flow-state-stop-nudge.sh",
          "timeout": 5 }
      ] }
    ]
  }
}
```
