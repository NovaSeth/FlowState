import { describe, expect, it } from "vitest";
import { publishChange, subscribeChanges, type ChangeEvent } from "./events";

describe("events - change pub/sub (live SSE mechanism)", () => {
  it("subscribeChanges receives the published event with type and at", () => {
    const seen: ChangeEvent[] = [];
    const unsub = subscribeChanges((e) => seen.push(e));
    publishChange("POST /api/tasks");
    expect(seen).toHaveLength(1);
    expect(seen[0].type).toBe("POST /api/tasks");
    expect(typeof seen[0].at).toBe("string");
    unsub();
  });

  it("after unsubscribe receives no further events (no leak)", () => {
    const seen: ChangeEvent[] = [];
    const unsub = subscribeChanges((e) => seen.push(e));
    unsub();
    publishChange("PATCH /api/tasks/x");
    expect(seen).toHaveLength(0);
  });
});
