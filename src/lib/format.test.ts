import { describe, expect, it } from "vitest";
import { safeHref } from "./format";

describe("safeHref - XSS guard for artifacts", () => {
  it("passes http(s)://", () => {
    expect(safeHref("https://github.com/x/y/pull/1")).toBe(
      "https://github.com/x/y/pull/1",
    );
    expect(safeHref("http://localhost:3000")).toBe("http://localhost:3000");
    expect(safeHref("  https://x.dev  ")).toBe("https://x.dev");
  });

  it("rejects dangerous schemes -> null (render as text)", () => {
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("JavaScript:alert(1)")).toBeNull();
    expect(safeHref("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(safeHref("vbscript:msgbox")).toBeNull();
  });

  it("rejects non-links (commit hash, path, mailto)", () => {
    expect(safeHref("deadbeef123")).toBeNull();
    expect(safeHref("src/lib/repo.ts")).toBeNull();
    expect(safeHref("mailto:x@y.z")).toBeNull();
    expect(safeHref("")).toBeNull();
  });
});
