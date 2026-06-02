# Security Policy

## Reporting a vulnerability

Please report security issues privately. Do **not** open a public issue for a
vulnerability.

- Preferred: open a private advisory via GitHub's **Security > Report a
  vulnerability** ("Security Advisories") on this repository.
- Alternatively, email the maintainer at
  `seth@monokoda.com`.

Please include enough detail to reproduce (affected endpoint or tool, steps,
expected vs. actual behavior). We will acknowledge the report and work with you
on a fix and disclosure timeline.

## Supported versions

Flow State follows semantic versioning. Security fixes target the latest
released `1.x` line.

| Version | Supported |
| ------- | --------- |
| 1.x     | Yes       |
| < 1.0   | No        |

## Threat model

Flow State is **local-first** and ships in **open mode** by default, intended
for a trusted localhost or trusted-LAN, single-user setup:

- No API key is required. Mutations are allowed without authentication.
- **GET endpoints are unauthenticated** in open mode.
- The `dev` and `start` servers bind all interfaces (`0.0.0.0`), so the
  dashboard is reachable from other devices on your network. This is
  intentional so you can open it from your phone.

Because open mode authenticates nothing, **do not expose an open-mode server to
untrusted networks.** It is not designed to be a public, internet-facing
service.

For shared, multi-user, or public hosting, lock it down:

- Set `FS_API_KEY` (the root/admin bootstrap key). When set, mutations require
  an `x-api-key` header.
- And/or set `FS_AUTH=strict` to require a key for all mutations.

Authentication is resolved per request (see `resolveContext` in
`src/lib/http.ts`). Per-agent keys have the format `fsk_<prefix>.<secret>`; the
secret is shown only once at creation. Mint them with the `fs_mint_agent_key`
MCP tool or `POST /api/keys`, and manage them in the `/users` UI.

Even with an admin key set, GET endpoints may remain unauthenticated depending
on configuration; treat the network boundary as part of your threat model and
run behind a trusted network, reverse proxy, or VPN when in doubt.
