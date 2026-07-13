import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createDatabase } from "./db";
import { createConnection, remoteBase } from "./connections";
import { AppError } from "./errors";

// connections.ts talks to the global getDb() singleton (not an injected Repo),
// so we point that singleton at a fresh in-memory database per test.
const g = globalThis as unknown as { __fsDb?: DatabaseSync };

beforeEach(() => {
  g.__fsDb = createDatabase(":memory:");
});
afterEach(() => {
  g.__fsDb = undefined;
});

function status(fn: () => unknown): number {
  try {
    fn();
    return 0;
  } catch (e) {
    return e instanceof AppError ? e.status : -1;
  }
}

describe("remoteBase - scheme selection", () => {
  it("443 -> https with no port in the authority", () => {
    expect(remoteBase({ host: "fs.example.com", port: 443 })).toBe(
      "https://fs.example.com",
    );
  });
  it("8443 -> https, keeping the explicit port (no silent cleartext downgrade)", () => {
    expect(remoteBase({ host: "fs.example.com", port: 8443 })).toBe(
      "https://fs.example.com:8443",
    );
  });
  it("a plain LAN port -> http with the port", () => {
    expect(remoteBase({ host: "192.168.1.24", port: 3000 })).toBe(
      "http://192.168.1.24:3000",
    );
  });
  it("80 -> http with no port in the authority", () => {
    expect(remoteBase({ host: "box.local", port: 80 })).toBe("http://box.local");
  });
});

describe("createConnection - SSRF host validation", () => {
  it("accepts a plain LAN IP", () => {
    const c = createConnection({ host: "192.168.1.24", port: 3000 });
    expect(c.host).toBe("192.168.1.24");
  });

  it("accepts a hostname and localhost", () => {
    expect(createConnection({ host: "fs.example.com", port: 443 }).host).toBe(
      "fs.example.com",
    );
    expect(createConnection({ host: "localhost", port: 3001 }).host).toBe(
      "localhost",
    );
  });

  it("rejects a host that injects a path/fragment (the IMDS bypass)", () => {
    // "169.254.169.254/latest/meta-data/#" would turn the appended /api path
    // into a fragment and hit cloud metadata; must be a 422, not stored.
    expect(
      status(() =>
        createConnection({
          host: "169.254.169.254/latest/meta-data/iam/#",
          port: 80,
        }),
      ),
    ).toBe(422);
  });

  it("rejects hosts containing a scheme, slash, userinfo, query, or space", () => {
    for (const host of [
      "http://evil.example",
      "evil.example/api",
      "user@evil.example",
      "evil.example?x=1",
      "evil .example",
      "evil.example:8080", // embedded port belongs in the port field
    ]) {
      expect(status(() => createConnection({ host, port: 443 }))).toBe(422);
    }
  });

  it("rejects the link-local / metadata address 169.254.169.254", () => {
    expect(
      status(() => createConnection({ host: "169.254.169.254", port: 80 })),
    ).toBe(422);
  });

  it("rejects alternate encodings of 169.254.169.254 (no encoding bypass)", () => {
    for (const host of [
      "2852039166", // decimal
      "0xA9FEA9FE", // hex
      "0251.0376.0251.0376", // octal
      "[::ffff:169.254.169.254]", // IPv4-mapped IPv6
      "[::ffff:a9fe:a9fe]", // IPv4-mapped IPv6 (hex halves)
    ]) {
      expect(status(() => createConnection({ host, port: 80 }))).toBe(422);
    }
  });

  it("rejects an IPv6 link-local address (fe80::/10)", () => {
    expect(status(() => createConnection({ host: "[fe80::1]", port: 3000 }))).toBe(
      422,
    );
  });

  it("still allows a legitimate IPv6 literal and a private LAN address", () => {
    expect(createConnection({ host: "[2001:db8::1]", port: 3000 }).host).toBe(
      "[2001:db8::1]",
    );
    expect(createConnection({ host: "10.0.0.5", port: 3000 }).host).toBe("10.0.0.5");
  });

  it("allows a valid dotted IPv4-mapped IPv6 literal but still blocks a link-local one", () => {
    // RFC 4291 2.2.3 dotted form must not be wrongly rejected...
    expect(createConnection({ host: "[::ffff:192.168.1.10]", port: 3000 }).host).toBe(
      "[::ffff:192.168.1.10]",
    );
    // ...while its link-local sibling is still caught (via mappedV4Octets).
    expect(
      status(() => createConnection({ host: "[::ffff:169.254.169.254]", port: 80 })),
    ).toBe(422);
  });
});
