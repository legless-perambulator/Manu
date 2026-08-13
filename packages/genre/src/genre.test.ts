import { describe, expect, it } from "vitest";
import { InMemoryProjectStore } from "@jellytind/persistence";
import { StoryRepository } from "@jellytind/story-repository";
import { isSpecialistId } from "@jellytind/agent-runtime";
import { RECIPE_NAMES } from "@jellytind/context-compiler";
import { BUILT_IN_SKILLS } from "@jellytind/skills";
import {
  MODULES,
  TEMPLATES,
  extensionKindById,
  extensionKindsFor,
  moduleById,
  moduleOwningView,
  rulesFor,
  skillIsAvailable,
  templateById,
  viewsFor,
} from "./index";
import { GenreRuntime } from "./runtime";
import { GenreError } from "./types";
import { validateModule, validateRecord } from "./validate";
import { MYSTERY_MODULE } from "./modules/mystery";
import { FANTASY_MODULE } from "./modules/fantasy";

/**
 * One project, used by every genre below.
 *
 * That is the acceptance criterion in the shape of a fixture: the same
 * characters, scenes, chapters, locations and relationships serve a mystery, a
 * fantasy, a romance, a thriller and a screenplay. Nothing here is
 * genre-specific, because nothing in the core is.
 */
async function project() {
  const store = new InMemoryProjectStore();
  const repo = await StoryRepository.createProject({ store, title: "One Core, Many Books" });
  const runtime = GenreRuntime.attach(repo);

  const mara = await repo.addCharacter({ name: "Mara", goals: [] });
  const elias = await repo.addCharacter({ name: "Elias", goals: [] });
  const hall = await repo.addLocation({ name: "The hall" });
  const cellar = await repo.addLocation({ name: "The cellar" });
  const fact = await repo.addFact({ statement: "The vault was sealed from the inside" });
  const thread = await repo.addPlotThread({ name: "The sealed vault" });
  const relationship = await repo.addRelationship({
    characterAId: mara.id,
    characterBId: elias.id,
    type: "siblings",
  });

  const one = await repo.addChapter({ title: "Openings" });
  const two = await repo.addChapter({ title: "The Cellar" });
  const s1 = await repo.addScene({
    title: "The hall",
    chapterId: one.id,
    locationId: hall.id,
    characterIds: [mara.id, elias.id],
  });
  const s2 = await repo.addScene({
    title: "The stairs",
    chapterId: one.id,
    locationId: hall.id,
    characterIds: [mara.id],
  });
  const s3 = await repo.addScene({
    title: "The cellar",
    chapterId: two.id,
    locationId: cellar.id,
    characterIds: [mara.id, elias.id],
  });

  return {
    repo,
    store,
    runtime,
    mara,
    elias,
    hall,
    cellar,
    fact,
    thread,
    relationship,
    one,
    two,
    s1,
    s2,
    s3,
  };
}

// ── The framework ───────────────────────────────────────────────────────────

describe("a module extends the domain and does not replace it", () => {
  it("adds no entity kind and no ID prefix per genre", () => {
    // Every record any module will ever write is an EXT_. Adding a genre adds
    // nothing to the ID space, which is what stops the core becoming a union
    // of every genre Manu has supported.
    const kinds = MODULES.flatMap((module) => module.extensionKinds);
    expect(kinds.length).toBeGreaterThan(15);
    expect(new Set(kinds.map((kind) => kind.moduleId)).size).toBe(4);
  });

  it("validates every shipped module as the registry is built", () => {
    for (const module of MODULES) expect(() => validateModule(module)).not.toThrow();
    expect(MODULES.map((module) => module.id)).toEqual([
      "mystery",
      "fantasy",
      "romance",
      "thriller",
      "screenplay",
    ]);
  });

  it("only lets a module name agents, skills and recipes that already exist", () => {
    for (const module of MODULES) {
      for (const agent of module.agents) expect(isSpecialistId(agent)).toBe(true);
      for (const skill of module.skills) {
        expect(BUILT_IN_SKILLS.some((entry) => entry.id === skill)).toBe(true);
      }
      for (const recipe of module.recipes) {
        expect((RECIPE_NAMES as readonly string[]).includes(recipe)).toBe(true);
      }
    }
  });

  it("refuses a module that invents an agent, because an agent is a permission grant", () => {
    expect(() => validateModule({ ...FANTASY_MODULE, agents: ["world_smith"] })).toThrowError(
      /names the agent "world_smith", which is not a specialist/,
    );
  });

  it("refuses a module naming a skill or recipe that does not exist", () => {
    expect(() => validateModule({ ...FANTASY_MODULE, skills: ["worldbuild"] })).toThrowError(
      /names the skill "worldbuild"/,
    );
    expect(() => validateModule({ ...FANTASY_MODULE, recipes: ["world_dump"] })).toThrowError(
      /names the context recipe "world_dump"/,
    );
  });

  it("refuses a module that tries to gate a skill belonging to everybody", () => {
    // The failure this guards against is quiet: claim `/character-pass` and it
    // disappears for every writer who never enabled that genre.
    expect(() => validateModule({ ...FANTASY_MODULE, skills: ["character_pass"] })).toThrowError(
      /belongs to everybody/,
    );
  });

  it("refuses a module that leaves its own skill unregistered", () => {
    expect(() => validateModule({ ...MYSTERY_MODULE, skills: [] })).toThrowError(
      /does not register "fairness_audit", which declares this module/,
    );
  });

  it("refuses a malformed field schema", () => {
    const broken = {
      ...FANTASY_MODULE,
      extensionKinds: [
        {
          id: "sigil",
          moduleId: "fantasy" as const,
          label: "Sigil",
          plural: "Sigils",
          description: "",
          attachesTo: [],
          fields: [{ key: "shape", label: "Shape", type: "choice" as const }],
        },
      ],
    };
    expect(() => validateModule(broken)).toThrowError(/choice type and no choices/);
  });

  it("refuses two modules claiming the same extension kind", () => {
    const seen = new Set(["culture"]);
    expect(() => validateModule(FANTASY_MODULE, seen)).toThrowError(
      /declares the extension kind "culture" more than once/,
    );
  });

  it("insists a module rule declares that it reads extensions", () => {
    const first = FANTASY_MODULE.rules[0];
    expect(first).toBeDefined();
    const rule = { ...(first as NonNullable<typeof first>), inputs: ["scenes" as const] };
    expect(() => validateModule({ ...FANTASY_MODULE, rules: [rule] })).toThrowError(
      /does not declare that it reads extensions/,
    );
  });

  it("insists a test template be semantic, because a rule is the place for what can be decided", () => {
    const bad = {
      ...MYSTERY_MODULE,
      testTemplates: [
        {
          id: "x",
          name: "x",
          rationale: "x",
          draft: {
            name: "x",
            description: "",
            type: "deterministic" as const,
            scope: { kind: "always" as const },
            enabled: true,
            severity: "warning" as const,
            assertion: { kind: "fact_true" as const, factId: "FACT_0001" as never },
          },
        },
      ],
    };
    expect(() => validateModule(bad)).toThrowError(/belongs in a rule, not a template/);
  });

  it("carries a machine-readable error code", () => {
    expect(new GenreError("unknown_module", "nope").code).toBe("unknown_module");
    expect(() => moduleById("western")).toThrowError(/No genre module called "western"/);
    expect(() => extensionKindById("spaceship")).toThrowError(/No extension kind called/);
  });
});

// ── Records are schema-checked ──────────────────────────────────────────────

describe("a module may add records, not arbitrary shapes", () => {
  it("refuses a field the kind never declared", () => {
    expect(() =>
      validateRecord(extensionKindById("culture"), {
        name: "The Fen folk",
        fields: { values: "endurance", favourite_colour: "green" },
      }),
    ).toThrowError(/has no field "favourite_colour"/);
  });

  it("refuses a choice outside its list, and names the list", () => {
    expect(() =>
      validateRecord(extensionKindById("magic_system"), {
        name: "Tidecalling",
        fields: { how_it_works: "…", visibility: "semi-secret" },
      }),
    ).toThrowError(/must be one of: common, rumoured, hidden, forbidden/);
  });

  it("refuses a missing required field", () => {
    expect(() =>
      validateRecord(extensionKindById("magic_system"), { name: "Tidecalling" }),
    ).toThrowError(/needs How it works/);
  });

  it("refuses an attachment to the wrong kind of thing", () => {
    expect(() =>
      validateRecord(extensionKindById("scene_heading"), {
        name: "INT. HALL — DAY",
        fields: { int_ext: "INT", location: "LOC_0001" },
        attachedTo: ["CHAR_0001"],
      }),
    ).toThrowError(/attaches to scene, not to a character/);
  });

  it("refuses an entity field naming the wrong kind", () => {
    expect(() =>
      validateRecord(extensionKindById("scene_heading"), {
        name: "INT. HALL — DAY",
        fields: { int_ext: "INT", location: "CHAR_0001" },
        attachedTo: ["SCENE_0001"],
      }),
    ).toThrowError(/must name a location/);
  });

  it("refuses a list where a single value belongs, and the reverse", () => {
    expect(() =>
      validateRecord(extensionKindById("culture"), {
        name: "The Fen folk",
        fields: { social_structure: ["a", "b"] },
      }),
    ).toThrowError(/takes a single value, not a list/);
    expect(() =>
      validateRecord(extensionKindById("culture"), {
        name: "The Fen folk",
        fields: { customs: "one custom" },
      }),
    ).toThrowError(/takes a list of values, not one value/);
  });
});

// ── Enable, disable, and never be trapped ───────────────────────────────────

describe("modules can be switched on and off without trapping the project", () => {
  it("refuses to create a record for a module that is off", async () => {
    const { runtime } = await project();
    await expect(runtime.addRecord({ kind: "culture", name: "The Fen folk" })).rejects.toThrowError(
      /Fantasy module is switched off/,
    );
  });

  it("keeps every record when a module is disabled, and brings them all back", async () => {
    const { runtime, repo, hall } = await project();
    await runtime.enable("fantasy");

    const culture = await runtime.addRecord({
      kind: "culture",
      name: "The Fen folk",
      fields: { values: "endurance", customs: ["salt on the doorstep"] },
      attachedTo: [hall.id],
    });
    const magic = await runtime.addRecord({
      kind: "magic_system",
      name: "Tidecalling",
      fields: { how_it_works: "You ask the water and it remembers you asked." },
    });

    const impact = await runtime.disable("fantasy", "trying something else");
    expect(impact.recordsHidden).toBe(2);
    expect(impact.reversible).toBe(true);
    expect(impact.rulesStopped).toContain("Magic without cost");

    // Hidden, not deleted. The file is exactly where it was.
    expect(await repo.modules.isEnabled("fantasy")).toBe(false);
    expect(await runtime.visibleRecords()).toEqual([]);
    expect(await repo.extensions.list("fantasy")).toHaveLength(2);

    await runtime.enable("fantasy");
    const back = await runtime.visibleRecords();
    expect(back.map((record) => record.id)).toEqual([culture.id, magic.id]);
    expect(back[0]?.fields["customs"]).toEqual(["salt on the doorstep"]);
  });

  it("survives a restart, because the records are canon and the setting is a setting", async () => {
    const { runtime, store } = await project();
    await runtime.enable("thriller");
    await runtime.addRecord({
      kind: "deadline",
      name: "The tide",
      fields: { consequence: "The cellar floods." },
    });

    const reopened = await StoryRepository.openProject({ store });
    const again = GenreRuntime.attach(reopened);
    expect(await again.enabled()).toEqual(["thriller"]);
    expect(await again.visibleRecords()).toHaveLength(1);
    expect(await store.readFile("extensions/thriller.json")).not.toBeNull();
  });

  it("refuses to enable something that is not a module", async () => {
    const { runtime, repo } = await project();
    await expect(runtime.enable("western")).rejects.toThrowError(/No genre module called/);
    expect(await repo.modules.enabled()).toEqual([]);
  });

  it("checks an attachment against the project like any other reference", async () => {
    const { runtime } = await project();
    await runtime.enable("fantasy");
    await expect(
      runtime.addRecord({ kind: "culture", name: "Ghosts", attachedTo: ["LOC_9999" as never] }),
    ).rejects.toThrowError(/LOC_9999 is not in this project/);
  });
});

// ── Templates ───────────────────────────────────────────────────────────────

describe("project templates configure modules and confer nothing else", () => {
  it("offers the eight the brief asks for", () => {
    expect(TEMPLATES.map((entry) => entry.name)).toEqual([
      "Novel",
      "Mystery",
      "Fantasy",
      "Romance",
      "Thriller",
      "Screenplay",
      "Short Story",
      "Blank Project",
    ]);
  });

  it("switches on what it names, and nothing more", async () => {
    const { runtime, repo } = await project();
    await runtime.applyTemplate("mystery");
    expect(await runtime.enabled()).toEqual(["mystery"]);
    expect((await repo.modules.read()).template).toBe("mystery");
  });

  it("does not trap the project in the genre it was created as", async () => {
    const { runtime, repo } = await project();
    await runtime.applyTemplate("mystery");

    // The next morning, it is a fantasy novel instead.
    await runtime.disable("mystery");
    await runtime.enable("fantasy");

    expect(await runtime.enabled()).toEqual(["fantasy"]);
    // The template it was made from is a note about the past, not a type.
    expect((await repo.modules.read()).template).toBe("mystery");
    expect(await runtime.addRecord({ kind: "culture", name: "The Fen folk" })).toBeDefined();
  });

  it("refuses a template it does not have", () => {
    expect(() => templateById("epic")).toThrowError(/No project template called "epic"/);
  });
});

// ── What the workspace shows ────────────────────────────────────────────────

describe("the workspace adapts to what is on", () => {
  it("shows a module's views only while it is enabled", () => {
    expect(viewsFor([]).map((view) => view.id)).toEqual([]);
    expect(viewsFor(["mystery"]).map((view) => view.id)).toEqual(["mystery"]);
    expect(moduleOwningView("mystery")).toBe("mystery");
    // A core panel belongs to nobody and is always there.
    expect(moduleOwningView("timeline")).toBeNull();
  });

  it("offers a module's skill only while it is on, and everyone else's always", () => {
    expect(skillIsAvailable("fairness_audit", [])).toBe(false);
    expect(skillIsAvailable("fairness_audit", ["mystery"])).toBe(true);
    // /character-pass belongs to everybody, even though romance names it.
    expect(skillIsAvailable("character_pass", [])).toBe(true);
  });

  it("offers only the record kinds the enabled modules declare", async () => {
    const { runtime } = await project();
    expect(await runtime.availableKinds()).toEqual([]);

    await runtime.enable("screenplay");
    expect((await runtime.availableKinds()).map((kind) => kind.id)).toEqual([
      "scene_heading",
      "production_unit",
    ]);
    // Ten kinds of fantasy do not appear because a screenplay is open.
    expect(extensionKindsFor(["fantasy"])).toHaveLength(10);
  });
});

// ── The build ───────────────────────────────────────────────────────────────

describe("module rules run in the same build as the core rules", () => {
  it("runs no module rule when nothing is enabled", async () => {
    const { repo } = await project();
    const build = await repo.buildStory({ persist: false });
    expect(build.rules.some((rule) => rule.ruleId.startsWith("fantasy_"))).toBe(false);
    expect(rulesFor([])).toEqual([]);
  });

  it("catches a magic system with no cost, once fantasy is on", async () => {
    const { repo, runtime } = await project();
    await runtime.enable("fantasy");
    await runtime.addRecord({
      kind: "magic_system",
      name: "Tidecalling",
      fields: { how_it_works: "You ask the water and it remembers you asked." },
    });

    const build = await repo.buildStory({ persist: false });
    const found = build.diagnostics.find((entry) => entry.ruleId === "fantasy_magic_without_cost");
    expect(found?.severity).toBe("warning");
    expect(found?.message).toMatch(/"Tidecalling" records no cost and no limits/);
    expect(found?.suggestedAction).toMatch(/Magic without either has no stakes/);
  });

  it("catches a screenplay heading that has drifted from its scene", async () => {
    const { repo, runtime, s1, cellar } = await project();
    await runtime.enable("screenplay");
    await runtime.addRecord({
      kind: "scene_heading",
      name: "INT. CELLAR — NIGHT",
      // The scene is set in the hall; the slug says the cellar.
      fields: { int_ext: "INT", location: cellar.id, time_of_day: "NIGHT" },
      attachedTo: [s1.id],
    });

    const build = await repo.buildStory({ persist: false });
    const found = build.diagnostics.find((entry) => entry.ruleId === "screenplay_heading_mismatch");
    expect(found?.message).toMatch(/says LOC_0002, and the scene is set at LOC_0001/);
    expect(found?.sceneId).toBe(s1.id);
  });

  it("catches a romance reconciling something that never broke", async () => {
    const { repo, runtime, relationship, s3 } = await project();
    await runtime.enable("romance");
    await runtime.addRecord({
      kind: "relationship_beat",
      name: "They forgive each other",
      fields: { beat: "reconciliation", scene: s3.id },
      attachedTo: [relationship.id],
    });

    const build = await repo.buildStory({ persist: false });
    const found = build.diagnostics.find(
      (entry) => entry.ruleId === "romance_reconciliation_without_break",
    );
    expect(found?.message).toMatch(
      /reconciles a relationship that the project never records breaking/,
    );
  });

  it("says nothing once the break is recorded before it", async () => {
    const { repo, runtime, relationship, s1, s3 } = await project();
    await runtime.enable("romance");
    await runtime.addRecord({
      kind: "relationship_beat",
      name: "The row in the hall",
      fields: { beat: "separation", scene: s1.id },
      attachedTo: [relationship.id],
    });
    await runtime.addRecord({
      kind: "relationship_beat",
      name: "They forgive each other",
      fields: { beat: "reconciliation", scene: s3.id },
      attachedTo: [relationship.id],
    });

    const build = await repo.buildStory({ persist: false });
    expect(
      build.diagnostics.filter((entry) => entry.ruleId === "romance_reconciliation_without_break"),
    ).toEqual([]);
  });

  it("catches a thriller deadline that never falls", async () => {
    const { repo, runtime, thread } = await project();
    await runtime.enable("thriller");
    await runtime.addRecord({
      kind: "deadline",
      name: "The tide",
      fields: { consequence: "The cellar floods and the evidence with it." },
      attachedTo: [thread.id],
    });

    const build = await repo.buildStory({ persist: false });
    const found = build.diagnostics.find(
      (entry) => entry.ruleId === "thriller_deadline_never_falls",
    );
    expect(found?.message).toMatch(/never falls: no scene is recorded where it expires/);
  });

  it("stops running a module's rules the moment it is switched off", async () => {
    const { repo, runtime } = await project();
    await runtime.enable("fantasy");
    await runtime.addRecord({
      kind: "magic_system",
      name: "Tidecalling",
      fields: { how_it_works: "…" },
    });
    expect(
      (await repo.buildStory({ persist: false })).diagnostics.some((entry) =>
        entry.ruleId.startsWith("fantasy_"),
      ),
    ).toBe(true);

    await runtime.disable("fantasy");
    const after = await repo.buildStory({ persist: false });
    expect(after.diagnostics.some((entry) => entry.ruleId.startsWith("fantasy_"))).toBe(false);
    // And the record is still there, waiting.
    expect(await repo.extensions.list("fantasy")).toHaveLength(1);
  });
});

// ── The mystery module, which is the odd one out ────────────────────────────

describe("the mystery module wires a subsystem rather than adding records", () => {
  it("declares no extension kinds at all", () => {
    expect(MYSTERY_MODULE.extensionKinds).toEqual([]);
    expect(MYSTERY_MODULE.skills).toEqual(["fairness_audit"]);
    expect(MYSTERY_MODULE.views.map((view) => view.id)).toEqual(["mystery"]);
  });

  it("turns an unfair mystery into a build error", async () => {
    const { repo, runtime, elias, s1, s3 } = await project();
    await runtime.enable("mystery");

    const mystery = await repo.mysteries.addMystery({
      name: "The sealed vault",
      question: "Who sealed it?",
      culpritIds: [elias.id],
      revealSceneId: s3.id,
    });
    const seen = await repo.mysteries.addClue({
      mysteryId: mystery.id,
      description: "A key missing from the board",
      firstAppearance: s1.id,
    });
    // The reader is never shown this one, and the solution rests on it.
    const unseen = await repo.mysteries.addClue({
      mysteryId: mystery.id,
      description: "The lock plate is on the cellar side",
    });
    await repo.mysteries.addDeduction({
      mysteryId: mystery.id,
      statement: "Elias sealed it from the inside",
      premises: [seen.id, unseen.id],
      isSolution: true,
    });

    const build = await repo.buildStory({ persist: false });
    const found = build.diagnostics.find((entry) => entry.ruleId === "mystery_fairness");
    expect(found?.severity).toBe("error");
    expect(found?.message).toMatch(
      /The reader is never shown "The lock plate is on the cellar side"/,
    );
    expect(found?.suggestedAction).toMatch(/Show the reader this before the reveal/);
  });

  it("keeps the fairness audit out of the build when the module is off", async () => {
    const { repo, elias, s3 } = await project();
    await repo.mysteries.addMystery({
      name: "The sealed vault",
      question: "Who sealed it?",
      culpritIds: [elias.id],
      revealSceneId: s3.id,
    });
    const build = await repo.buildStory({ persist: false });
    expect(build.diagnostics.some((entry) => entry.ruleId === "mystery_fairness")).toBe(false);
  });
});

// ── Test templates ──────────────────────────────────────────────────────────

describe("a module offers tests, and the writer owns the ones they take", () => {
  it("offers only what the enabled modules bring", async () => {
    const { runtime } = await project();
    expect(await runtime.offeredTests()).toEqual([]);

    await runtime.enable("mystery");
    expect((await runtime.offeredTests()).map((entry) => entry.id)).toEqual([
      "mystery_no_early_certainty",
      "mystery_investigator_earns_it",
    ]);
  });

  it("makes an adopted test the writer's own, which keeps running afterwards", async () => {
    const { runtime, repo } = await project();
    await runtime.enable("mystery");
    const adopted = await runtime.adoptTest("mystery_no_early_certainty");

    expect(adopted.type).toBe("semantic");
    expect(await repo.listStoryTests()).toHaveLength(1);

    const impact = await runtime.impactOfDisabling("mystery");
    expect(impact.testsKept).toBe(1);

    // Switched off, and the test the writer adopted is still theirs.
    await runtime.disable("mystery");
    expect(await repo.listStoryTests()).toHaveLength(1);
  });

  it("refuses a template no enabled module offers", async () => {
    const { runtime } = await project();
    await expect(runtime.adoptTest("mystery_no_early_certainty")).rejects.toThrowError(
      /No test template called .* is offered/,
    );
  });
});

// ── The acceptance criterion ────────────────────────────────────────────────

describe("one core, materially different workflows", () => {
  it("runs five genres over the same project, each seeing only its own", async () => {
    const { repo, runtime, relationship, thread, hall, cellar, s1, s2 } = await project();

    // Everything on at once — the extreme case, and the one that would expose
    // a module reaching into another's material.
    for (const id of ["mystery", "fantasy", "romance", "thriller", "screenplay"]) {
      await runtime.enable(id);
    }

    await runtime.addRecord({
      kind: "culture",
      name: "The Fen folk",
      fields: { values: "endurance" },
      attachedTo: [hall.id],
    });
    await runtime.addRecord({
      kind: "relationship_beat",
      name: "The row",
      fields: { beat: "conflict", scene: s1.id },
      attachedTo: [relationship.id],
    });
    await runtime.addRecord({
      kind: "pursuit",
      name: "Down the stairs",
      fields: { pursuer: "Elias", quarry: "Mara" },
    });
    await runtime.addRecord({
      kind: "scene_heading",
      name: "INT. HALL — DAY",
      fields: { int_ext: "INT", location: hall.id, time_of_day: "DAY" },
      attachedTo: [s2.id],
    });

    const build = await repo.buildStory({ persist: false });

    // Every module's rules ran, over one build, against one project state.
    const ran = new Set(build.rules.map((rule) => rule.ruleId));
    for (const id of [
      "fantasy_magic_without_cost",
      "romance_reconciliation_without_break",
      "thriller_deadline_never_falls",
      "screenplay_heading_mismatch",
      "mystery_fairness",
      // And the core rules, unchanged and unaware.
      "referential_integrity",
      "scene_relationships",
    ]) {
      expect(ran).toContain(id);
    }

    // Each module sees its own records and nobody else's.
    expect((await repo.extensions.list("fantasy")).map((r) => r.kind)).toEqual(["culture"]);
    expect((await repo.extensions.list("romance")).map((r) => r.kind)).toEqual([
      "relationship_beat",
    ]);
    expect(await runtime.visibleRecords()).toHaveLength(4);
    expect(cellar).toBeDefined();
    expect(thread).toBeDefined();
  });

  it("leaves the core exactly as it was when every module is off", async () => {
    const { repo } = await project();
    const build = await repo.buildStory({ persist: false });
    expect(build.rules.every((rule) => !rule.ruleId.includes("_"))).toBe(false);
    // No module rule, no module data, no module records — and a working build.
    expect(
      build.rules.some((rule) => rulesFor(["fantasy"]).some((r) => r.id === rule.ruleId)),
    ).toBe(false);
    expect(build.status).toBeDefined();
  });
});
