import { describe, expect, it } from "vitest";
import { Autopilot } from "./engine";
import type {
  AnalysisKind,
  AnalystRequest,
  AutopilotPorts,
  FileStorePort,
  IntelAnalyst,
  IntelFinding,
  IntelProposal,
  KnownEntity,
  ProseUnit,
} from "./types";

/** Phase 44: the writer writes the story; Manu maintains the map. */

function memoryFiles(): FileStorePort & { readonly map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    readProjectFile: (path) => Promise.resolve(map.get(path) ?? null),
    writeProjectFile: (path, contents) => {
      map.set(path, contents);
      return Promise.resolve();
    },
    listProjectFiles: (prefix) =>
      Promise.resolve(
        [...map.keys()].filter((path) => prefix === undefined || path.startsWith(prefix)),
      ),
  };
}

const ENTITIES: KnownEntity[] = [
  { id: "CHAR_0001", kind: "character", name: "Mara Ellison", aliases: ["Mara"] },
  { id: "CHAR_0002", kind: "character", name: "Elias Thorn", aliases: ["Elias"] },
  { id: "OBJ_0001", kind: "object", name: "Brass Key", aliases: [] },
];

const SCENE_42_BEFORE =
  "Mara waited in the hall. Elias said nothing. The photograph was still missing.";

const SCENE_42_AFTER = [
  "Mara stepped into the library and closed the door behind her. Dr. Halden was",
  "waiting by the cold hearth. Dr. Halden held out the brass key, and Mara took it.",
  "“The vault is under the west wing,” said Dr. Halden quietly. Detective Ellison",
  "turned the key over in her hand. Dr. Halden watched her pocket it.",
  "When Elias learned she had gone to Halden behind his back, something closed in",
  "his face. The missing photograph, Mara realised, had been taken by someone",
  "who knew about the vault.",
].join(" ");

/**
 * The analyst the tests fake: per-kind findings for the §32 scene edit, and
 * a call counter that proves scope (§33). Never called for unchanged scenes.
 */
function fakeAnalyst(): IntelAnalyst & {
  calls: Array<{ kind: AnalysisKind; sceneId: string }>;
} {
  const analyst = {
    calls: [] as Array<{ kind: AnalysisKind; sceneId: string }>,
    costPerCallUsd: 0.01,
    read(kind: AnalysisKind, request: AnalystRequest): Promise<readonly IntelFinding[]> {
      analyst.calls.push({ kind, sceneId: request.sceneId });
      if (!request.text.includes("library")) return Promise.resolve([]);
      const by: Partial<Record<AnalysisKind, IntelFinding[]>> = {
        state: [
          {
            summary: "Mara: location → Library",
            confidence: "high",
            quote: "Mara stepped into the library and closed the door behind her.",
            payload: { character: "Mara Ellison", field: "location", value: "Library" },
          },
        ],
        objects: [
          {
            summary: "Brass Key → Mara",
            confidence: "high",
            quote: "Dr. Halden held out the brass key, and Mara took it.",
            payload: { object: "Brass Key", holder: "Mara Ellison" },
          },
        ],
        knowledge: [
          {
            summary: "Mara learns the vault exists.",
            confidence: "medium",
            quote: "“The vault is under the west wing,” said Dr. Halden quietly.",
            payload: { character: "Mara Ellison", fact: "A vault exists under the west wing." },
          },
        ],
        relationships: [
          {
            summary: "Mara–Elias trust decreases substantially.",
            confidence: "medium",
            quote: "something closed in his face",
            payload: { a: "Mara Ellison", b: "Elias Thorn", change: "trust_down" },
          },
        ],
        threads: [
          {
            summary: "Missing Photograph thread advances.",
            confidence: "medium",
            quote: "The missing photograph … had been taken by someone who knew about the vault.",
            payload: { thread: "Missing Photograph", movement: "advanced" },
          },
        ],
      };
      return Promise.resolve(by[kind] ?? []);
    },
  };
  return analyst;
}

interface Applied {
  proposals: IntelProposal[];
  reverted: string[][];
}

function ports(options: {
  files?: FileStorePort;
  units: () => ProseUnit[];
  analyst?: IntelAnalyst | null;
  applied?: Applied;
  conflictCheck?: (proposal: IntelProposal) => string | null;
}): AutopilotPorts {
  const applied = options.applied ?? { proposals: [], reverted: [] };
  let recordSeq = 0;
  return {
    files: options.files ?? memoryFiles(),
    units: () => Promise.resolve(options.units()),
    entities: () => Promise.resolve(ENTITIES),
    analyst: options.analyst === undefined ? null : options.analyst,
    ...(options.conflictCheck !== undefined
      ? { conflictCheck: (p: IntelProposal) => Promise.resolve(options.conflictCheck?.(p) ?? null) }
      : {}),
    applier: {
      apply: (proposal) => {
        applied.proposals.push(proposal);
        return Promise.resolve([`REC_${String((recordSeq += 1))}`]);
      },
      revert: (recordIds) => {
        applied.reverted.push([...recordIds]);
        return Promise.resolve();
      },
    },
    now: () => "2026-08-16T12:00:00.000Z",
  };
}

function project(scene42Text: string): ProseUnit[] {
  return [
    { sceneId: "SCENE_0041", chapterId: "CH_04", title: "Scene 41", text: "Elias read alone." },
    { sceneId: "SCENE_0042", chapterId: "CH_04", title: "Scene 42", text: scene42Text },
    {
      sceneId: "SCENE_0043",
      chapterId: "CH_04",
      title: "Scene 43",
      text: "Rain fell on the drive.",
    },
  ];
}

describe("change detection and scope (§2, §4)", () => {
  it("enqueues work only for the scenes whose prose changed", async () => {
    const files = memoryFiles();
    let text = SCENE_42_BEFORE;
    const pilot = await Autopilot.open(ports({ files, units: () => project(text) }));
    await pilot.markSynced();
    expect(await pilot.noteChange()).toEqual([]);

    text = SCENE_42_AFTER;
    const changed = await pilot.noteChange();
    expect(changed).toEqual(["SCENE_0042"]);
    expect(pilot.status().pendingJobs).toBe(2); // one deterministic, one semantic
  });
});

describe("deterministic first (§5–§7)", () => {
  it("proposes Dr. Halden once, resolves Detective Ellison to Mara, and learns from corrections", async () => {
    const files = memoryFiles();
    const applied: Applied = { proposals: [], reverted: [] };
    const pilot = await Autopilot.open(
      ports({ files, units: () => project(SCENE_42_AFTER), applied }),
    );
    await pilot.sync({ sceneIds: ["SCENE_0042"] });
    await pilot.drain();

    const discovery = pilot
      .list("needs_review")
      .find((held) => held.kind === "new_entity" && held.summary.includes("Halden"));
    expect(discovery).toBeDefined();
    expect(discovery?.because).toContain("appears");

    // "Detective Ellison" auto-linked as a high-confidence safe alias under
    // the balanced default (§7, §17).
    const alias = pilot.list().find((held) => held.kind === "alias");
    expect(alias?.status).toBe("auto_applied");
    expect(alias?.payload["entityName"]).toBe("Mara Ellison");

    // §19: rejecting the discovery teaches the project; a re-scan stays quiet.
    if (discovery === undefined) throw new Error("no discovery");
    await pilot.reject(discovery.id);
    expect(pilot.learned().notEntities).toContain("Dr. Halden");
    await pilot.sync({ sceneIds: ["SCENE_0042"] });
    await pilot.drain();
    const again = pilot
      .list("needs_review")
      .filter((held) => held.kind === "new_entity" && held.summary.includes("Halden"));
    expect(again).toHaveLength(0);
  });
});

describe("§32 — the acceptance scenario", () => {
  it("runs the scene-42 edit end to end without a single blocking step", async () => {
    const files = memoryFiles();
    const applied: Applied = { proposals: [], reverted: [] };
    const analyst = fakeAnalyst();
    let text = SCENE_42_BEFORE;
    const make = () => ports({ files, units: () => project(text), analyst, applied });

    // 1–2: a mapped project; writing happens; autosave fires noteChange.
    const pilot = await Autopilot.open(make());
    await pilot.markSynced();
    text = SCENE_42_AFTER;
    await pilot.noteChange();

    // 3: background analysis runs — nothing here ever blocked the editor;
    // drain is bounded and asynchronous by construction (§1).
    await pilot.drain(20);

    // 4–5: Mara resolved (alias auto-linked); Dr. Halden proposed.
    expect(pilot.list().some((p) => p.kind === "alias" && p.status === "auto_applied")).toBe(true);
    expect(pilot.list("needs_review").some((p) => p.kind === "new_entity")).toBe(true);

    // 6: the location transition auto-applied under the balanced policy —
    // objective, high-confidence, low-risk (§9, §17).
    const location = pilot.list().find((p) => p.kind === "state_transition");
    expect(location?.status).toBe("auto_applied");
    expect(applied.proposals.some((p) => p.kind === "state_transition")).toBe(true);

    // 7–10: key transfer detected; knowledge, relationship and thread
    // proposals wait for review (medium confidence or medium risk).
    expect(pilot.list().find((p) => p.kind === "object_transfer")?.status).toBe("auto_applied");
    expect(pilot.list("needs_review").some((p) => p.kind === "knowledge")).toBe(true);
    expect(pilot.list("needs_review").some((p) => p.kind === "relationship")).toBe(true);
    expect(pilot.list("needs_review").some((p) => p.kind === "thread")).toBe(true);

    // 11: every proposal explains itself — what, why, where (§18).
    for (const proposal of pilot.list()) {
      expect(proposal.summary).not.toBe("");
      expect(proposal.because).not.toBe("");
      expect(proposal.evidence[0]?.sceneId).toBe("SCENE_0042");
    }
    const knowledge = pilot.list("needs_review").find((p) => p.kind === "knowledge");
    expect(knowledge?.evidence[0]?.quote).toContain("vault");

    // 12: the writer rejects one inference; 13: everything else stands.
    const relationship = pilot.list("needs_review").find((p) => p.kind === "relationship");
    if (relationship === undefined) throw new Error("no relationship proposal");
    await pilot.reject(relationship.id);
    expect(pilot.list().find((p) => p.id === relationship.id)?.status).toBe("rejected");
    expect(applied.proposals.some((p) => p.kind === "relationship")).toBe(false);

    // 14: the Context Compiler reads accepted state only (§25).
    if (knowledge === undefined) throw new Error("no knowledge proposal");
    await pilot.accept(knowledge.id);
    const confirmed = pilot.confirmed();
    expect(confirmed.some((p) => p.kind === "knowledge")).toBe(true);
    expect(confirmed.some((p) => p.kind === "thread")).toBe(false); // still under review
    expect(pilot.uncertain().some((p) => p.kind === "thread")).toBe(true);

    // §26: the applied intelligence names its scenes for incremental checks.
    const affected = pilot.takeAffectedScenes();
    expect(affected).toEqual(["SCENE_0042"]);

    // 15: restart — a fresh engine over the same files keeps everything.
    const reopened = await Autopilot.open(make());
    expect(reopened.list("needs_review").some((p) => p.kind === "thread")).toBe(true);
    expect(reopened.list().find((p) => p.id === relationship.id)?.status).toBe("rejected");
    expect(reopened.confirmed().some((p) => p.kind === "knowledge")).toBe(true);
    expect(reopened.status().label).toContain("need review");
  });
});

describe("policy (§17)", () => {
  it("conservative confirms everything; automatic widens only low-risk reach", async () => {
    const analyst = fakeAnalyst();
    const conservative = await Autopilot.open(
      ports({ units: () => project(SCENE_42_AFTER), analyst }),
    );
    await conservative.configure({ policy: "conservative" });
    await conservative.sync({ sceneIds: ["SCENE_0042"] });
    await conservative.drain(20);
    expect(conservative.list("auto_applied")).toHaveLength(0);

    const automatic = await Autopilot.open(
      ports({ units: () => project(SCENE_42_AFTER), analyst: fakeAnalyst() }),
    );
    await automatic.configure({ policy: "automatic" });
    await automatic.sync({ sceneIds: ["SCENE_0042"] });
    await automatic.drain(20);
    // Low-risk kinds auto-apply down to medium confidence — but knowledge,
    // relationships and threads carry interpretation and still wait.
    expect(automatic.list("auto_applied").every((p) => p.risk === "low")).toBe(true);
    expect(automatic.list("needs_review").some((p) => p.kind === "relationship")).toBe(true);
  });

  it("auto-applied intelligence stays reversible", async () => {
    const applied: Applied = { proposals: [], reverted: [] };
    const pilot = await Autopilot.open(
      ports({ units: () => project(SCENE_42_AFTER), analyst: fakeAnalyst(), applied }),
    );
    await pilot.sync({ sceneIds: ["SCENE_0042"] });
    await pilot.drain(20);
    const auto = pilot.list("auto_applied")[0];
    if (auto === undefined) throw new Error("nothing auto-applied");
    const reverted = await pilot.revert(auto.id);
    expect(reverted.status).toBe("rejected");
    expect(applied.reverted).toHaveLength(1);
  });
});

describe("authority and conflicts (§20, §21)", () => {
  it("never proposes over an authoritative field", async () => {
    const units = (): ProseUnit[] => [
      {
        sceneId: "SCENE_0042",
        chapterId: "CH_04",
        title: "Scene 42",
        text: SCENE_42_AFTER,
        authoritative: ["pov"],
      },
    ];
    const analyst: IntelAnalyst = {
      read: (kind) =>
        Promise.resolve(
          kind === "scene"
            ? [
                {
                  summary: "POV → Mara",
                  confidence: "high" as const,
                  payload: { field: "pov", value: "Mara Ellison" },
                },
              ]
            : [],
        ),
    };
    const pilot = await Autopilot.open(ports({ units, analyst }));
    await pilot.sync({ all: true });
    await pilot.drain(20);
    expect(pilot.list().filter((p) => p.kind === "scene_metadata")).toHaveLength(0);
  });

  it("a canon contradiction becomes a conflict with four ways out, none automatic", async () => {
    const applied: Applied = { proposals: [], reverted: [] };
    const pilot = await Autopilot.open(
      ports({
        units: () => project(SCENE_42_AFTER),
        analyst: fakeAnalyst(),
        applied,
        conflictCheck: (proposal) =>
          proposal.kind === "fact" || proposal.kind === "state_transition"
            ? null
            : proposal.kind === "knowledge"
              ? "Canon holds that Mara already knew about the vault (FACT_0007)."
              : null,
      }),
    );
    await pilot.sync({ sceneIds: ["SCENE_0042"] });
    await pilot.drain(20);
    const conflict = pilot.list("conflict")[0];
    expect(conflict?.conflictsWith).toContain("FACT_0007");
    expect(applied.proposals.some((p) => p.kind === "knowledge")).toBe(false);

    if (conflict === undefined) throw new Error("no conflict");
    const resolved = await pilot.resolveConflict(conflict.id, "explain_exception", "She forgot.");
    expect(resolved.status).toBe("accepted");
    expect(resolved.exception).toBe("She forgot.");
    expect(applied.proposals.some((p) => p.kind === "knowledge")).toBe(false); // exception applies nothing
  });
});

describe("pause, budget and missing models (§27–§29)", () => {
  it("paused means no work at all, and the status says so", async () => {
    const analyst = fakeAnalyst();
    const pilot = await Autopilot.open(ports({ units: () => project(SCENE_42_AFTER), analyst }));
    await pilot.configure({ paused: true });
    await pilot.sync({ sceneIds: ["SCENE_0042"] });
    await pilot.drain(20);
    expect(analyst.calls).toHaveLength(0);
    expect(pilot.status().label).toBe("Paused");
  });

  it("a spent budget stops semantic work but not deterministic work", async () => {
    const analyst = fakeAnalyst();
    const pilot = await Autopilot.open(ports({ units: () => project(SCENE_42_AFTER), analyst }));
    await pilot.configure({ monthlyBudgetUsd: 0 });
    await pilot.sync({ sceneIds: ["SCENE_0042"] });
    await pilot.drain(20);
    expect(analyst.calls).toHaveLength(0);
    expect(pilot.list().some((p) => p.origin === "deterministic")).toBe(true);
    expect(pilot.status().waiting).toContain("budget");
  });

  it("a crashing analyst is contained per kind and never blocks anything (§28, Phase 46)", async () => {
    const failing: IntelAnalyst = {
      read: (kind, request) =>
        kind === "state"
          ? Promise.reject(new Error("provider exploded"))
          : fakeAnalyst().read(kind, request),
    };
    const files = memoryFiles();
    const pilot = await Autopilot.open(
      ports({ files, units: () => project(SCENE_42_AFTER), analyst: failing }),
    );
    await pilot.sync({ sceneIds: ["SCENE_0042"] });
    // drain resolves — no rejection escapes to the caller (the save path
    // never goes through the autopilot at all; this proves even the shared
    // event loop sees no unhandled failure).
    await pilot.drain(20);
    expect(pilot.status().pendingJobs).toBe(0);
    // The other kinds still produced their proposals.
    expect(pilot.list().some((p) => p.kind === "object_transfer")).toBe(true);
    expect(pilot.list().some((p) => p.kind === "state_transition")).toBe(false);
    expect(pilot.status().waiting).toContain("writing is unaffected");
    // And the project files written so far are intact JSON, not partial state.
    for (const [path, raw] of files.map) {
      expect(() => JSON.parse(raw), path).not.toThrow();
    }
  });

  it("with no analyst, semantic jobs wait visibly instead of failing", async () => {
    const pilot = await Autopilot.open(ports({ units: () => project(SCENE_42_AFTER) }));
    await pilot.sync({ sceneIds: ["SCENE_0042"] });
    await pilot.drain(20);
    expect(pilot.status().waiting).toContain("model");
    expect(pilot.status().pendingJobs).toBe(1); // the semantic job holds
  });

  it("estimates a full sync before anyone pays for it (§24)", async () => {
    const pilot = await Autopilot.open(
      ports({ units: () => project(SCENE_42_AFTER), analyst: fakeAnalyst() }),
    );
    const estimate = await pilot.estimateSync({ all: true });
    expect(estimate.scenes).toBe(3);
    expect(estimate.semanticCalls).toBe(24);
    expect(estimate.estimatedUsd).toBeCloseTo(0.24);
  });
});

describe("§33 — large manuscript performance", () => {
  it("editing one scene of 200 touches exactly that scene", async () => {
    // ~150k words across 200 scenes.
    const paragraph =
      "The corridor ran the length of the east range, and the lamps guttered as the household " +
      "moved through its evening rituals, each door closing on a smaller and smaller silence. ";
    const sceneText = paragraph.repeat(25); // ~750 words per scene
    const units: ProseUnit[] = Array.from({ length: 200 }, (_, index) => ({
      sceneId: `SCENE_${String(index + 1).padStart(4, "0")}`,
      chapterId: `CH_${String(Math.floor(index / 5) + 1)}`,
      title: `Scene ${String(index + 1)}`,
      text: sceneText,
    }));
    const words = units.reduce((sum, unit) => sum + unit.text.split(/\s+/).length, 0);
    expect(words).toBeGreaterThan(150_000);

    const files = memoryFiles();
    const analyst = fakeAnalyst();
    let current = units;
    const pilot = await Autopilot.open(ports({ files, units: () => current, analyst }));
    await pilot.markSynced();

    current = units.map((unit) =>
      unit.sceneId === "SCENE_0042"
        ? { ...unit, text: `${unit.text} Mara stepped into the library.` }
        : unit,
    );
    const started = Date.now();
    const changed = await pilot.noteChange();
    await pilot.drain(20);
    expect(changed).toEqual(["SCENE_0042"]);
    expect(new Set(analyst.calls.map((held) => held.sceneId))).toEqual(new Set(["SCENE_0042"]));
    expect(pilot.status().pendingJobs).toBe(0);
    // No full-manuscript reconstruction: the whole cycle stays fast.
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});
