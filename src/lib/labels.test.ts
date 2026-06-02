import { describe, it, expect } from "vitest";
import {
  STATUS_META,
  STATUS_ORDER,
  PRIORITY_META,
  PROJECT_STATUS_META,
  MILESTONE_STATUS_META,
  SOLUTION_STATUS_META,
  MILESTONE_OUTCOME_META,
  BLOCKER_TYPE_LABEL,
} from "./labels";
import { t } from "@/i18n";

describe("labels", () => {
  it("has the full set of task statuses with label keys and classes", () => {
    for (const s of STATUS_ORDER) {
      expect(STATUS_META[s].labelKey).toBeTruthy();
      // the key must resolve to a non-empty label in en (source of truth)
      expect(t("en", STATUS_META[s].labelKey)).toBeTruthy();
      expect(STATUS_META[s].pill).toContain("bg-");
    }
  });

  it("priorities have keys that resolve to labels", () => {
    expect(t("pl", PRIORITY_META.urgent.labelKey)).toBe("Pilny");
    expect(t("pl", PRIORITY_META.none.labelKey)).toBe("Brak");
    expect(t("en", PRIORITY_META.urgent.labelKey)).toBe("Urgent");
  });

  it("project statuses match the milestone ones", () => {
    expect(MILESTONE_STATUS_META).toBe(PROJECT_STATUS_META);
    expect(t("en", SOLUTION_STATUS_META.active.labelKey)).toBeTruthy();
    expect(t("pl", MILESTONE_OUTCOME_META.shipped.labelKey)).toBe("Dostarczone");
    expect(t("pl", BLOCKER_TYPE_LABEL.dependency)).toBe("zaleznosc");
  });
});
