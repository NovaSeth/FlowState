import { describe, expect, it } from "vitest";
import { route, json } from "./http";

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
