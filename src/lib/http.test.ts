import { afterEach, describe, expect, it } from "vitest";
import { route, json, requireManagementAuthority, authorizeEventStream } from "./http";
import { AppError } from "./errors";

// A trivial read handler wrapped exactly like the real API routes.
const read = route(async () => json({ ok: true }));
const ctx = { params: Promise.resolve<Record<string, string>>({}) };

function get(headers: Record<string, string>): Request {
  return new Request("http://localhost:3000/api/solutions", { headers });
}

describe("keyless API access (no x-api-key)", () => {
  it("allows a same-origin browser read (the local dashboard)", async () => {
    const res = await read(get({ "sec-fetch-site": "same-origin" }), ctx);
    expect(res.status).toBe(200);
  });

  it("allows the menu-bar app's read (x-fs-monitor)", async () => {
    const res = await read(get({ "x-fs-monitor": "1" }), ctx);
    expect(res.status).toBe(200);
  });

  it("allows the dashboard's tagged read (x-fs-dashboard) regardless of network", async () => {
    const res = await read(get({ "x-fs-dashboard": "1" }), ctx);
    expect(res.status).toBe(200);
  });

  it("denies a non-browser client without a key (MCP / CLI / node)", async () => {
    const res = await read(get({}), ctx);
    expect(res.status).toBe(401);
  });

  it("denies a cross-site browser request without a key", async () => {
    const res = await read(get({ "sec-fetch-site": "cross-site" }), ctx);
    expect(res.status).toBe(401);
  });

  // Plain HTTP over a LAN IP (e.g. the dashboard on a phone) gets no Sec-Fetch-*
  // headers, so we fall back to a same-origin Origin/Referer check.
  it("allows a keyless read when Sec-Fetch is absent but the Referer is same-origin", async () => {
    const res = await read(get({ referer: "http://localhost:3000/explore" }), ctx);
    expect(res.status).toBe(200);
  });

  it("allows a keyless read with a same-origin Origin header", async () => {
    const res = await read(get({ origin: "http://localhost:3000" }), ctx);
    expect(res.status).toBe(200);
  });

  it("denies a keyless read whose Referer is a different origin", async () => {
    const res = await read(get({ referer: "http://evil.example/" }), ctx);
    expect(res.status).toBe(401);
  });
});

describe("management authority (connections/settings data-plane control)", () => {
  const authStatus = (ctx: Parameters<typeof requireManagementAuthority>[0]) => {
    try {
      requireManagementAuthority(ctx);
      return 0;
    } catch (e) {
      return e instanceof AppError ? e.status : -1;
    }
  };

  it("allows the admin key", () => {
    expect(authStatus({ admin: true })).toBe(0);
  });

  it("allows the trusted keyless local owner (empty context)", () => {
    expect(authStatus({})).toBe(0);
  });

  it("denies a resolved actor key, even with write grants (403)", () => {
    expect(
      authStatus({
        actorId: "ac_1",
        keyId: "ak_1",
        keyGrants: [{ solutionId: "so_1", scope: "write" }],
      }),
    ).toBe(403);
  });
});

describe("authorizeEventStream (SSE gate - EventSource can't send a key header)", () => {
  const evUrl = "http://localhost:3000/api/events";
  const ev = (headers: Record<string, string>) => new Request(evUrl, { headers });
  const evStatus = (headers: Record<string, string>): number => {
    try {
      authorizeEventStream(ev(headers));
      return 200;
    } catch (e) {
      return e instanceof AppError ? e.status : -1;
    }
  };

  afterEach(() => {
    delete process.env.FS_REQUIRE_KEY;
  });

  it("allows the same-origin dashboard EventSource (trusted keyless)", () => {
    expect(evStatus({ "sec-fetch-site": "same-origin" })).toBe(200);
  });

  it("allows the menu-bar app's stream (x-fs-monitor)", () => {
    expect(evStatus({ "x-fs-monitor": "1" })).toBe(200);
  });

  it("denies an anonymous non-browser client (curl, no headers)", () => {
    expect(evStatus({})).toBe(401);
  });

  it("keeps the header-less dashboard working even in require-key mode (regression)", () => {
    process.env.FS_REQUIRE_KEY = "1";
    // The whole point: a same-origin EventSource can't send x-api-key, so it must
    // still be allowed under require-key - otherwise the dashboard wedges offline.
    expect(evStatus({ "sec-fetch-site": "same-origin" })).toBe(200);
    // ...but an anonymous non-browser client is still rejected.
    expect(evStatus({})).toBe(401);
  });
});
