# Examples

Copy-paste-ready scripts showing how an external Claude Code agent drives the
Flow State REST API.

## agent-solution.ts

A full agent flow over the global `fetch`: creating a solution and project,
creating a Backlog milestone, bulk-creating tasks with idempotency
(`clientRequestId`), changing status with a single PATCH, adding a comment, and
reading `/api/dashboard` with a one-line progress summary.

### Running

1. In one terminal, start the app:

   ```bash
   npm run dev
   ```

2. In a second terminal, run the example:

   ```bash
   npx tsx examples/agent-solution.ts
   ```

### Environment variables

- `FS_BASE_URL` - the base API URL (defaults to `http://localhost:3000`).
- `FS_API_KEY` - an optional API key. When the server started with `FS_API_KEY`
  set, mutations require the `x-api-key` header. The script adds this header
  automatically if the variable is set in its environment:

  ```bash
  FS_API_KEY=your-secret-key npx tsx examples/agent-solution.ts
  ```
