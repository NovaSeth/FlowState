import { describe, it, expect } from "vitest";
import { timeAgo, timeAgoText } from "./format";
import { t } from "@/i18n";

// timeAgo is locale-agnostic: it returns a { key, vars } structure that callers
// render through their translate fn. These tests pin the contract (the buckets and
// the interpolation vars) and confirm both shipped locales render real text.

describe("timeAgo - structured, locale-agnostic relative time", () => {
  const now = Date.now();
  const ago = (ms: number) => new Date(now - ms).toISOString();

  it("buckets the elapsed time into i18n keys with {n} vars", () => {
    expect(timeAgo(ago(5_000))).toEqual({ key: "time.justNow" });
    expect(timeAgo(ago(5 * 60_000))).toEqual({
      key: "time.minsAgo",
      vars: { n: 5 },
    });
    expect(timeAgo(ago(3 * 3_600_000))).toEqual({
      key: "time.hoursAgo",
      vars: { n: 3 },
    });
    expect(timeAgo(ago(4 * 86_400_000))).toEqual({
      key: "time.daysAgo",
      vars: { n: 4 },
    });
    expect(timeAgo(ago(90 * 86_400_000))).toEqual({
      key: "time.monthsAgo",
      vars: { n: 3 },
    });
  });

  it("returns an empty key for an invalid date (no value rendered)", () => {
    expect(timeAgo("not-a-date")).toEqual({ key: "" });
  });
});

describe("timeAgoText - rendered via a translate fn", () => {
  const now = Date.now();
  const ago = (ms: number) => new Date(now - ms).toISOString();
  const en = (iso: string) => timeAgoText(iso, (k, v) => t("en", k, v));
  const pl = (iso: string) => timeAgoText(iso, (k, v) => t("pl", k, v));

  it("renders English", () => {
    expect(en(ago(5_000))).toBe("just now");
    expect(en(ago(5 * 60_000))).toBe("5 min ago");
    expect(en(ago(3 * 3_600_000))).toBe("3 h ago");
    expect(en(ago(4 * 86_400_000))).toBe("4 days ago");
    expect(en(ago(90 * 86_400_000))).toBe("3 mo ago");
  });

  it("renders Polish", () => {
    expect(pl(ago(5 * 60_000))).toBe("5 min temu");
    expect(pl(ago(3 * 3_600_000))).toBe("3 h temu");
    expect(pl(ago(4 * 86_400_000))).toBe("4 dni temu");
    expect(pl(ago(90 * 86_400_000))).toBe("3 mies. temu");
  });

  it("renders nothing for an invalid date", () => {
    expect(en("not-a-date")).toBe("");
    expect(pl("not-a-date")).toBe("");
  });
});
