import { describe, expect, it } from "vitest";
import {
  emptyStatusCounts,
  progressFromCounts,
  statusCountsFromRows,
} from "./progress";

describe("progressFromCounts", () => {
  it("returns 0% when there are no tasks", () => {
    expect(progressFromCounts(emptyStatusCounts())).toEqual({
      total: 0,
      done: 0,
      percent: 0,
    });
  });

  it("computes percent as done/total rounded", () => {
    const counts = { todo: 1, in_progress: 1, blocked: 0, done: 1, closed: 0 };
    expect(progressFromCounts(counts)).toEqual({
      total: 3,
      done: 1,
      percent: 33,
    });
  });

  it("100% when everything is done", () => {
    const counts = { todo: 0, in_progress: 0, blocked: 0, done: 4, closed: 0 };
    expect(progressFromCounts(counts)).toEqual({
      total: 4,
      done: 4,
      percent: 100,
    });
  });

  it("'closed' drops out of the denominator (does not count toward total)", () => {
    const counts = { todo: 1, in_progress: 0, blocked: 0, done: 1, closed: 8 };
    expect(progressFromCounts(counts)).toEqual({
      total: 2,
      done: 1,
      percent: 50,
    });
  });
});

describe("statusCountsFromRows", () => {
  it("fills missing statuses with zeros and ignores unknown ones", () => {
    const counts = statusCountsFromRows([
      { status: "done", n: 2 },
      { status: "blocked", n: 1 },
      { status: "garbage", n: 99 },
    ]);
    expect(counts).toEqual({
      todo: 0,
      in_progress: 0,
      blocked: 1,
      done: 2,
      closed: 0,
    });
  });
});
