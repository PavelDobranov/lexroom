import { describe, expect, it } from "vitest";

import type { WorkspaceSnapshot } from "../shared/api";
import { resolveSelectedLawyerId } from "./selected-lawyer";

type Lawyer = WorkspaceSnapshot["lawyers"][number];

const lawyers: Lawyer[] = [
  { id: "first", name: "Ada", title: "Partner" },
  { id: "second", name: "Zoe", title: "Associate" },
];

describe("lawyer selection", () => {
  it("keeps a valid stored selection", () => {
    expect(resolveSelectedLawyerId(lawyers, "second")).toBe("second");
  });

  it("falls back to the first server-ordered lawyer for missing or invalid selections", () => {
    expect(resolveSelectedLawyerId(lawyers, null)).toBe("first");
    expect(resolveSelectedLawyerId(lawyers, "removed")).toBe("first");
  });

  it("keeps the repaired fallback when a removed lawyer later reappears", () => {
    const withoutSecond = lawyers.filter(({ id }) => id !== "second");
    const repairedId = resolveSelectedLawyerId(withoutSecond, "second");

    expect(repairedId).toBe("first");
    expect(resolveSelectedLawyerId(lawyers, repairedId)).toBe("first");
  });

  it("has no selection when no lawyers are available", () => {
    expect(resolveSelectedLawyerId([], "removed")).toBeNull();
  });
});
