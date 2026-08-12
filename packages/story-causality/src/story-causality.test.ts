import { describe, expect, it } from "vitest";
import type { Dependency, DependencyKind, DependencyStatus } from "@jellytind/domain";
import { CausalityGraph, describePath } from "./graph";
import { checkDependencies } from "./checks";

/**
 * The graph, on its own, with no project.
 *
 * The chain under test is the one from the spec:
 *
 * ```
 * Elias discovers letter → enables → Elias confronts father
 *   → causes → Father lies → motivates → Elias contacts Mara
 * ```
 */
let seq = 0;
function dep(
  fromId: string,
  kind: DependencyKind,
  toId: string,
  status: DependencyStatus = "confirmed",
): Dependency {
  seq += 1;
  return {
    id: `DEP_${String(seq).padStart(4, "0")}`,
    kind,
    fromId,
    toId,
    status,
    source: "human",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

const CHAIN = (): Dependency[] => {
  seq = 0;
  return [
    dep("SCENE_0001", "enables", "SCENE_0002"),
    dep("SCENE_0002", "causes", "SCENE_0003"),
    dep("SCENE_0003", "motivates", "SCENE_0004"),
  ];
};

describe("direction", () => {
  /** The writer's sentence is kept; the arrow is normalised. */
  it("reads a backward relation the same way as its forward twin", () => {
    const forward = new CausalityGraph([dep("SCENE_0001", "enables", "SCENE_0002")]);
    const backward = new CausalityGraph([dep("SCENE_0002", "requires", "SCENE_0001")]);

    for (const graph of [forward, backward]) {
      expect(graph.getDependents("SCENE_0001").map((s) => s.effectId)).toEqual(["SCENE_0002"]);
      expect(graph.getDependencies("SCENE_0002").map((s) => s.causeId)).toEqual(["SCENE_0001"]);
      expect(graph.getTransitiveDependents("SCENE_0001")).toEqual(["SCENE_0002"]);
    }
  });

  it("keeps the sentence the writer wrote alongside the arrow", () => {
    const graph = new CausalityGraph([dep("SCENE_0002", "requires", "SCENE_0001")]);
    const step = graph.getDependents("SCENE_0001")[0];

    expect(step?.statedFromId).toBe("SCENE_0002");
    expect(step?.statedToId).toBe("SCENE_0001");
    expect(step?.causeId).toBe("SCENE_0001");
  });

  /** A traced chain reads forwards even where a link was written backwards. */
  it("renders a path along the influence arrow", () => {
    const graph = new CausalityGraph([
      dep("SCENE_0001", "enables", "SCENE_0002"),
      dep("SCENE_0003", "requires", "SCENE_0002"),
    ]);
    const path = graph.getDependencyPath("SCENE_0001", "SCENE_0003");

    expect(describePath(path as never)).toBe(
      "SCENE_0001 → enables → SCENE_0002 → is required by → SCENE_0003",
    );
  });
});

describe("direct and transitive dependencies", () => {
  it("separates what rests on a node from what it rests on", () => {
    const graph = new CausalityGraph(CHAIN());

    expect(graph.getDependents("SCENE_0002").map((s) => s.effectId)).toEqual(["SCENE_0003"]);
    expect(graph.getDependencies("SCENE_0002").map((s) => s.causeId)).toEqual(["SCENE_0001"]);
    expect(graph.getDependents("SCENE_0004")).toEqual([]);
  });

  it("walks the whole chain in both directions", () => {
    const graph = new CausalityGraph(CHAIN());

    expect(graph.getTransitiveDependents("SCENE_0001")).toEqual([
      "SCENE_0002",
      "SCENE_0003",
      "SCENE_0004",
    ]);
    expect(graph.getTransitiveDependencies("SCENE_0004")).toEqual([
      "SCENE_0003",
      "SCENE_0002",
      "SCENE_0001",
    ]);
  });

  it("stops where it is told to", () => {
    const graph = new CausalityGraph(CHAIN());
    expect(graph.getTransitiveDependents("SCENE_0001", { maxDepth: 2 })).toEqual([
      "SCENE_0002",
      "SCENE_0003",
    ]);
  });

  it("follows only the relation kinds asked for", () => {
    const graph = new CausalityGraph(CHAIN());
    expect(graph.getTransitiveDependents("SCENE_0001", { kinds: ["enables", "causes"] })).toEqual([
      "SCENE_0002",
      "SCENE_0003",
    ]);
    expect(graph.getTransitiveDependents("SCENE_0001", { kinds: ["prevents"] })).toEqual([]);
  });

  /** A model's guess is not story architecture until a human accepts it. */
  it("leaves proposed and rejected edges out of the graph", () => {
    const dependencies = [
      dep("SCENE_0001", "enables", "SCENE_0002"),
      dep("SCENE_0002", "causes", "SCENE_0003", "proposed"),
      dep("SCENE_0003", "causes", "SCENE_0004", "rejected"),
    ];

    expect(new CausalityGraph(dependencies).getTransitiveDependents("SCENE_0001")).toEqual([
      "SCENE_0002",
    ]);
    // Reviewing them is a different view of the same data.
    expect(
      new CausalityGraph(dependencies, { includeProposed: true }).getTransitiveDependents(
        "SCENE_0001",
      ),
    ).toEqual(["SCENE_0002", "SCENE_0003"]);
  });
});

describe("dependency paths", () => {
  it("finds the shortest chain between two nodes", () => {
    const path = new CausalityGraph(CHAIN()).getDependencyPath("SCENE_0001", "SCENE_0004");

    expect(path?.steps.map((s) => s.effectId)).toEqual(["SCENE_0002", "SCENE_0003", "SCENE_0004"]);
  });

  it("prefers the direct route when there are two", () => {
    const graph = new CausalityGraph([
      ...CHAIN(),
      dep("SCENE_0001", "causes", "SCENE_0004"), // a shortcut
    ]);
    const path = graph.getDependencyPath("SCENE_0001", "SCENE_0004");
    expect(path?.steps).toHaveLength(1);
  });

  it("returns nothing when the two are not connected that way round", () => {
    const graph = new CausalityGraph(CHAIN());
    expect(graph.getDependencyPath("SCENE_0004", "SCENE_0001")).toBeNull();
    expect(graph.getDependencyPath("SCENE_0001", "SCENE_9999")).toBeNull();
  });

  it("treats a node as reaching itself in no steps", () => {
    const path = new CausalityGraph(CHAIN()).getDependencyPath("SCENE_0001", "SCENE_0001");
    expect(path?.steps).toEqual([]);
  });
});

describe("blast radius", () => {
  /** The question the graph exists to answer. */
  it("names everything downstream and how each is reached", () => {
    const graph = new CausalityGraph([
      ...CHAIN(),
      dep("SCENE_0002", "reveals", "FACT_0012"),
      dep("SCENE_0004", "resolves", "THREAD_0008"),
    ]);

    const radius = graph.calculateBlastRadius("SCENE_0001");

    expect(radius.total).toBe(5);
    expect(radius.affected.map((a) => a.id)).toEqual([
      "SCENE_0002",
      "FACT_0012",
      "SCENE_0003",
      "SCENE_0004",
      "THREAD_0008",
    ]);

    const direct = radius.affected.find((a) => a.id === "SCENE_0002");
    expect(direct?.direct).toBe(true);
    expect(direct?.distance).toBe(1);

    const far = radius.affected.find((a) => a.id === "THREAD_0008");
    expect(far?.direct).toBe(false);
    expect(far?.distance).toBe(4);
    expect(describePath(far?.paths[0] as never)).toBe(
      "SCENE_0001 → enables → SCENE_0002 → causes → SCENE_0003 → motivates → SCENE_0004 → resolves → THREAD_0008",
    );
  });

  it("is empty for something nothing rests on", () => {
    const radius = new CausalityGraph(CHAIN()).calculateBlastRadius("SCENE_0004");
    expect(radius.affected).toEqual([]);
    expect(radius.cyclic).toBe(false);
  });

  it("keeps more than one route to the same place", () => {
    const graph = new CausalityGraph([
      dep("SCENE_0001", "enables", "SCENE_0002"),
      dep("SCENE_0001", "motivates", "SCENE_0003"),
      dep("SCENE_0002", "causes", "SCENE_0004"),
      dep("SCENE_0003", "causes", "SCENE_0004"),
    ]);

    const affected = graph.calculateBlastRadius("SCENE_0001").affected;
    expect(affected.find((a) => a.id === "SCENE_0004")?.paths).toHaveLength(2);
  });
});

describe("cycles", () => {
  const LOOP = (): Dependency[] => {
    seq = 0;
    return [
      dep("SCENE_0001", "causes", "SCENE_0002"),
      dep("SCENE_0002", "causes", "SCENE_0003"),
      dep("SCENE_0003", "causes", "SCENE_0001"),
    ];
  };

  /** The one thing traversal must never do is hang or throw. */
  it("does not crash traversal", () => {
    const graph = new CausalityGraph(LOOP());

    expect(graph.getTransitiveDependents("SCENE_0001")).toEqual(["SCENE_0002", "SCENE_0003"]);
    expect(graph.getTransitiveDependencies("SCENE_0001")).toEqual(["SCENE_0003", "SCENE_0002"]);
    expect(graph.getDependencyPath("SCENE_0001", "SCENE_0003")?.steps).toHaveLength(2);
  });

  it("says the radius met a loop rather than hiding it", () => {
    const radius = new CausalityGraph(LOOP()).calculateBlastRadius("SCENE_0001");
    expect(radius.cyclic).toBe(true);
    expect(radius.affected.map((a) => a.id)).toEqual(["SCENE_0002", "SCENE_0003"]);
  });

  it("reports each loop once, however it is entered", () => {
    const cycles = new CausalityGraph(LOOP()).findCycles();
    expect(cycles).toHaveLength(1);
    expect([...(cycles[0] as string[])].sort()).toEqual(["SCENE_0001", "SCENE_0002", "SCENE_0003"]);
  });

  it("survives a two-node loop and a self-loop", () => {
    const graph = new CausalityGraph([
      dep("SCENE_0001", "causes", "SCENE_0002"),
      dep("SCENE_0002", "causes", "SCENE_0001"),
      dep("SCENE_0003", "causes", "SCENE_0003"),
    ]);

    expect(graph.getTransitiveDependents("SCENE_0001")).toEqual(["SCENE_0002"]);
    expect(graph.getTransitiveDependents("SCENE_0003")).toEqual([]);
    expect(graph.findCycles().length).toBeGreaterThan(0);
  });
});

describe("checking the registered graph", () => {
  const existing = new Set(["SCENE_0001", "SCENE_0002", "SCENE_0003", "FACT_0012"]);

  it("reports an endpoint that no longer exists", () => {
    const findings = checkDependencies({
      dependencies: [dep("SCENE_0001", "causes", "SCENE_9999")],
      existingIds: existing,
    });

    expect(findings[0]?.kind).toBe("dangling_endpoint");
    expect(findings[0]?.severity).toBe("error");
    expect(findings[0]?.message).toContain("SCENE_9999");
    expect(findings[0]?.suggestedAction).not.toBe("");
  });

  /** An unreviewed proposal is not a broken dependency. */
  it("checks only what the writer has confirmed", () => {
    const findings = checkDependencies({
      dependencies: [dep("SCENE_0001", "causes", "SCENE_9999", "proposed")],
      existingIds: existing,
    });
    expect(findings).toEqual([]);
  });

  it("reports a self-dependency and a duplicate", () => {
    const findings = checkDependencies({
      dependencies: [
        dep("SCENE_0001", "causes", "SCENE_0001"),
        dep("SCENE_0001", "causes", "SCENE_0002"),
        dep("SCENE_0001", "causes", "SCENE_0002"),
      ],
      existingIds: existing,
    });

    expect(findings.map((f) => f.kind)).toEqual(["self_dependency", "duplicate"]);
    expect(findings[1]?.severity).toBe("info");
  });

  it("reports a loop as a warning, not an error", () => {
    const findings = checkDependencies({
      dependencies: [
        dep("SCENE_0001", "causes", "SCENE_0002"),
        dep("SCENE_0002", "causes", "SCENE_0001"),
      ],
      existingIds: existing,
    });

    const cycle = findings.find((f) => f.kind === "cycle");
    expect(cycle?.severity).toBe("warning");
    expect(cycle?.message).toContain("→");
  });

  /** A flashback can legitimately look like this, so it is never an error. */
  it("reports an effect that comes before its cause", () => {
    const findings = checkDependencies({
      dependencies: [dep("SCENE_0003", "causes", "SCENE_0001")],
      existingIds: existing,
      sceneOrder: ["SCENE_0001", "SCENE_0002", "SCENE_0003"],
    });

    const ordering = findings.find((f) => f.kind === "effect_precedes_cause");
    expect(ordering?.severity).toBe("warning");
    expect(ordering?.evidence).toContain("position 3");
    expect(ordering?.suggestedAction).toContain("flashback");
  });

  it("skips the ordering check when there is no order to compare against", () => {
    const findings = checkDependencies({
      dependencies: [dep("SCENE_0003", "causes", "SCENE_0001")],
      existingIds: existing,
    });
    expect(findings.some((f) => f.kind === "effect_precedes_cause")).toBe(false);
  });

  it("places a non-scene node by the scene it happens in", () => {
    const findings = checkDependencies({
      dependencies: [dep("SCENE_0003", "reveals", "FACT_0012")],
      existingIds: existing,
      sceneOrder: ["SCENE_0001", "SCENE_0002", "SCENE_0003"],
      sceneOf: new Map([["FACT_0012", "SCENE_0001"]]),
    });

    expect(findings.find((f) => f.kind === "effect_precedes_cause")?.entities).toContain(
      "FACT_0012",
    );
  });
});
