import { describe, expect, it } from "vitest";
import { computeLineDiff, diffStat } from "./diff";

describe("computeLineDiff", () => {
  it("marks unchanged lines as context", () => {
    const d = computeLineDiff("a\nb\nc", "a\nb\nc");
    expect(d.every((l) => l.op === "context")).toBe(true);
  });

  it("detects additions", () => {
    const d = computeLineDiff("a\nc", "a\nb\nc");
    expect(d).toEqual([
      { op: "context", text: "a" },
      { op: "add", text: "b" },
      { op: "context", text: "c" },
    ]);
  });

  it("detects deletions", () => {
    const d = computeLineDiff("a\nb\nc", "a\nc");
    expect(diffStat(d)).toEqual({ added: 0, removed: 1 });
    expect(d.find((l) => l.op === "remove")?.text).toBe("b");
  });

  it("renders a modification as a remove + add", () => {
    const d = computeLineDiff("hello world", "hello there");
    expect(diffStat(d)).toEqual({ added: 1, removed: 1 });
  });

  it("handles creation and deletion of whole files", () => {
    expect(diffStat(computeLineDiff("", "a\nb"))).toEqual({ added: 2, removed: 0 });
    expect(diffStat(computeLineDiff("a\nb", ""))).toEqual({ added: 0, removed: 2 });
  });
});
