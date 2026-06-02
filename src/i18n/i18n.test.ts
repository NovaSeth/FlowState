import { describe, it, expect } from "vitest";
import en from "./en.json";
import pl from "./pl.json";

// Flattens a nested dictionary into a set of paths like "a.b.c", to compare the
// KEYS themselves (not the values) across locales. Enforces parity: when someone
// adds a key to en.json, the test detects the missing translation in pl.json (and vice versa).
function flatten(obj: unknown, prefix = ""): string[] {
  if (obj === null || typeof obj !== "object") return [prefix];
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    out.push(...flatten(v, path));
  }
  return out;
}

describe("i18n key parity", () => {
  const enKeys = new Set(flatten(en));
  const plKeys = new Set(flatten(pl));

  it("pl.json has every key present in en.json", () => {
    const missing = [...enKeys].filter((k) => !plKeys.has(k)).sort();
    expect(missing, `keys missing in pl.json: ${missing.join(", ")}`).toEqual(
      [],
    );
  });

  it("en.json has every key present in pl.json", () => {
    const extra = [...plKeys].filter((k) => !enKeys.has(k)).sort();
    expect(extra, `keys missing in en.json: ${extra.join(", ")}`).toEqual([]);
  });
});
