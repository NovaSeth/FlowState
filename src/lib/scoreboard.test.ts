import { describe, expect, it } from "vitest";
import { newIds } from "./scoreboard";

describe("scoreboard - id-set diff", () => {
  it("newIds returns only the new ids", () => {
    expect(newIds(new Set(["a", "b"]), ["a", "b", "c", "d"])).toEqual(["c", "d"]);
    expect(newIds(new Set(["a"]), ["a"])).toEqual([]);
  });

  it("newIds returns all when prev is empty", () => {
    expect(newIds(new Set(), ["a", "b"])).toEqual(["a", "b"]);
  });
});
