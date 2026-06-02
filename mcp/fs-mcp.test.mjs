import { afterEach, describe, expect, it, vi } from "vitest";
import { getToolRun, interpretResponse } from "./fs-mcp.mjs";

describe("fs-mcp interpretResponse - error contract (never HTML into context)", () => {
  it("returns parsed JSON for 2xx", () => {
    const out = interpretResponse({
      ok: true,
      status: 200,
      text: '{"id":"ta_1","title":"X"}',
      contentType: "application/json",
    });
    expect(out).toEqual({ id: "ta_1", title: "X" });
  });

  it("JSON error with an error field -> clean, short message", () => {
    expect(() =>
      interpretResponse({
        ok: false,
        status: 422,
        text: '{"error":"Status \\"blocked\\" requires a reason"}',
        contentType: "application/json",
      }),
    ).toThrowError(/FS 422: Status "blocked" requires a reason/);
  });

  it("500 with HTML (next dev overlay) -> concise message, WITHOUT pouring in HTML/stacktrace", () => {
    const html =
      "<!DOCTYPE html><html><head></head><body>Module not found: Can't resolve '@/lib/use-is-narrow' in Explorer.tsx" +
      "\n".repeat(50) +
      "x".repeat(8000) +
      "</body></html>";
    let err;
    try {
      interpretResponse({
        ok: false,
        status: 500,
        text: html,
        contentType: "text/html",
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    expect(err.message).toContain("FS 500");
    expect(err.message).not.toContain("<html>");
    expect(err.message).not.toContain("Explorer.tsx");
    expect(err.message.length).toBeLessThan(200); // no KB of junk
    expect(err.fsStatus).toBe(500);
  });

  it("2xx but non-JSON (HTML) -> error, does not return HTML as data", () => {
    expect(() =>
      interpretResponse({
        ok: true,
        status: 200,
        text: "<html><body>nope</body></html>",
        contentType: "text/html",
      }),
    ).toThrowError(/expected JSON/);
  });

  it("204 (empty body) -> null", () => {
    expect(
      interpretResponse({ ok: true, status: 204, text: "", contentType: "" }),
    ).toBeNull();
  });
});

describe("fs-mcp tool input guards (no PATCH /api/.../undefined)", () => {
  it("fs_update_task without taskId (single) throws, instead of hitting /api/tasks/undefined", () => {
    const run = getToolRun("fs_update_task");
    expect(() => run({ status: "done" })).toThrowError(
      /taskId is required when not using bulk updates/,
    );
  });

  it("fs_update_task bulk item without an id throws (and rejects a non-string id)", () => {
    const run = getToolRun("fs_update_task");
    expect(() => run({ updates: [{ status: "done" }] })).toThrowError(
      /must have a string taskId/,
    );
    expect(() => run({ updates: [{ taskId: 123, status: "done" }] })).toThrowError(
      /must have a string taskId/,
    );
  });

  it("fs_get_task without taskId throws", () => {
    expect(() => getToolRun("fs_get_task")({})).toThrowError(/taskId is required/);
  });

  it("fs_add_comment / fs_list_comments without taskId throw", () => {
    expect(() => getToolRun("fs_add_comment")({ body: "x" })).toThrowError(
      /taskId is required/,
    );
    expect(() => getToolRun("fs_list_comments")({})).toThrowError(/taskId is required/);
  });

  it("fs_revoke_key without keyId throws", () => {
    expect(() => getToolRun("fs_revoke_key")({})).toThrowError(/keyId is required/);
  });

  it("fs_update_solution/project/milestone without an id throw", () => {
    expect(() => getToolRun("fs_update_solution")({ name: "x" })).toThrowError(
      /solutionId is required/,
    );
    expect(() => getToolRun("fs_update_project")({ name: "x" })).toThrowError(
      /projectId is required/,
    );
    expect(() => getToolRun("fs_update_milestone")({ title: "x" })).toThrowError(
      /milestoneId is required when not using bulk updates/,
    );
  });

  it("fs_update_milestone bulk item without an id throws (and rejects a non-string id)", () => {
    const run = getToolRun("fs_update_milestone");
    expect(() => run({ updates: [{ title: "x" }] })).toThrowError(
      /must have a string milestoneId/,
    );
    expect(() => run({ updates: [{ milestoneId: 1, title: "x" }] })).toThrowError(
      /must have a string milestoneId/,
    );
  });
});

describe("fs-mcp fs_create_task allowlist (no mass assignment)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Stub fetch and capture the POST body that fs_create_task sends.
  function captureCreateBody() {
    const captured = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
        captured.body = JSON.parse(init.body);
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () => "{}",
          headers: { get: () => "application/json" },
        };
      }),
    );
    return captured;
  }

  it("bulk: strips unknown / server-trusted fields from each task element", async () => {
    const captured = captureCreateBody();
    await getToolRun("fs_create_task")({
      tasks: [
        {
          milestoneId: "mi_1",
          title: "Legit",
          // illegitimate / server-trusted fields that must NOT pass through:
          id: "ta_forged",
          ownerActorId: "actor_admin",
          createdAt: "1999-01-01",
          authorKeyId: "key_admin",
          bogus: true,
        },
      ],
    });
    expect(Array.isArray(captured.body)).toBe(true);
    expect(captured.body[0]).toEqual({ milestoneId: "mi_1", title: "Legit" });
  });

  it("single: shapes the same allowlisted body and drops unknown fields", async () => {
    const captured = captureCreateBody();
    await getToolRun("fs_create_task")({
      milestoneId: "mi_1",
      title: "Solo",
      priority: "high",
      // unknown field at the top level is ignored anyway, but assert the shape:
      ownerActorId: "actor_admin",
    });
    expect(captured.body).toEqual({
      milestoneId: "mi_1",
      title: "Solo",
      priority: "high",
    });
  });
});
