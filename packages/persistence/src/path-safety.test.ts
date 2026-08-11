import { describe, expect, it } from "vitest";
import { normalizeProjectPath, isSafeProjectPath, PathEscapeError } from "./path-safety";

describe("normalizeProjectPath", () => {
  it("normalises valid project-relative paths", () => {
    expect(normalizeProjectPath("manuscript/chapter_001.md")).toBe("manuscript/chapter_001.md");
    expect(normalizeProjectPath("./scenes/./SCENE_0001.yaml")).toBe("scenes/SCENE_0001.yaml");
    expect(normalizeProjectPath("world\\locations\\LOC_0001.md")).toBe(
      "world/locations/LOC_0001.md",
    );
    expect(normalizeProjectPath("a/b/../c")).toBe("a/c");
    expect(normalizeProjectPath("")).toBe("");
    expect(normalizeProjectPath(".")).toBe("");
  });

  it("rejects traversal above the root", () => {
    expect(() => normalizeProjectPath("../secret")).toThrow(PathEscapeError);
    expect(() => normalizeProjectPath("a/../../b")).toThrow(PathEscapeError);
    expect(() => normalizeProjectPath("manuscript/../../etc/passwd")).toThrow(PathEscapeError);
  });

  it("rejects absolute and drive-qualified paths", () => {
    expect(() => normalizeProjectPath("/etc/passwd")).toThrow(PathEscapeError);
    expect(() => normalizeProjectPath("C:\\Windows")).toThrow(PathEscapeError);
    expect(() => normalizeProjectPath("\\\\server\\share")).toThrow(PathEscapeError);
  });

  it("rejects NUL bytes", () => {
    expect(() => normalizeProjectPath("a\0b")).toThrow(PathEscapeError);
  });

  it("isSafeProjectPath mirrors the throwing behaviour", () => {
    expect(isSafeProjectPath("a/b.md")).toBe(true);
    expect(isSafeProjectPath("../a")).toBe(false);
  });
});
