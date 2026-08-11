import { describe, expect, it } from "vitest";
import { ToolRegistry, ToolError, type Tool } from "./tool";

const readScene: Tool<{ id: string }, { text: string }> = {
  name: "get_scene",
  description: "Read a scene by ID.",
  readOnly: true,
  execute: ({ id }) => Promise.resolve({ text: `scene ${id}` }),
};

describe("ToolRegistry", () => {
  it("registers, finds and lists tools", async () => {
    const registry = new ToolRegistry().register(readScene);
    expect(registry.has("get_scene")).toBe(true);
    expect(registry.list()).toHaveLength(1);
    const tool = registry.get("get_scene");
    await expect(tool.execute({ id: "SCENE_0001" })).resolves.toEqual({ text: "scene SCENE_0001" });
  });

  it("rejects duplicate tool names", () => {
    const registry = new ToolRegistry().register(readScene);
    expect(() => registry.register(readScene)).toThrow(ToolError);
  });

  it("throws a typed error for unknown tools", () => {
    const registry = new ToolRegistry();
    expect(() => registry.get("nope")).toThrow(ToolError);
    expect(registry.has("nope")).toBe(false);
  });
});
