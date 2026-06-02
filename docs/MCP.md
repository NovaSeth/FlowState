# Flow State MCP server

The MCP server lets any Claude Code instance read and write Flow State project
state over the REST API instead of keeping it in markdown files. The server
code lives **in this repo** at `mcp/fs-mcp.mjs` (stdio, zero dependencies).

## Registration

Register it with your Claude Code client. Use an **absolute path** to
`mcp/fs-mcp.mjs` (the registration itself lives in your client config, e.g.
`~/.claude.json`, not in this repo):

```bash
claude mcp add flow-state -s user \
  -e FS_BASE_URL=http://localhost:3000 \
  -- node /ABSOLUTE/PATH/mcp/fs-mcp.mjs
```

This writes the equivalent entry to your client config:

```json
{
  "mcpServers": {
    "flow-state": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/mcp/fs-mcp.mjs"],
      "env": { "FS_BASE_URL": "http://localhost:3000", "FS_API_KEY": "<your-key>" }
    }
  }
}
```

`FS_API_KEY` is only needed when the app requires auth (see Environment below).

## Tools

All tools use the `fs_` prefix, for example:

- `fs_dashboard` - full overview (solutions, progress, blocked/urgent, recent)
- `fs_changes_since` - delta since a timestamp (start-of-turn sync)
- `fs_list_solutions` / `fs_list_projects` / `fs_list_milestones` / `fs_list_tasks`
- `fs_search_tasks` - global full-text search
- `fs_get_task` - one task with deps/subtasks (optionally comments)
- `fs_create_solution` / `fs_create_project` / `fs_create_milestone` / `fs_create_task`
- `fs_update_task` / `fs_update_solution` / `fs_update_project` / `fs_update_milestone`
- `fs_add_comment` / `fs_list_comments`
- `fs_whoami` / `fs_list_actors` / `fs_mint_agent_key` / `fs_list_keys` / `fs_revoke_key`
- `fs_list_activity` - audit log

## Environment

- `FS_BASE_URL` - app base URL (default `http://localhost:3000`).
- `FS_API_KEY` - sent as the `x-api-key` header when the app requires auth.

The app itself reads `FS_DB_PATH` (default `data/fs.db`) for the SQLite database.
