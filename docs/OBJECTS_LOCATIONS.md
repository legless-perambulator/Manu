# OBJECTS_LOCATIONS

Object continuity and location tracking: making physical things traceable
through story time, so contradictions are found by arithmetic rather than by
re-reading.

- **Packages:** `@jellytind/domain` (statuses, the location tree),
  `@jellytind/story-state` (object state, continuity checks), persisted by
  `@jellytind/story-repository`
- **Status (Phase 14):** implemented and tested. Time-aware object state,
  transfers, nested locations, strengthened character location, six
  deterministic continuity checks, object context, and the Objects panel.

## The premise

A revolver is left in a flat in chapter 19 and fired at the manor in chapter 22.
The two mentions are sixty thousand words apart, so no amount of careful reading
reliably catches it — and asking a model to re-read the manuscript is both
expensive and unreliable. Recorded as state, the same problem is two values and
a comparison.

**The acceptance test for this subsystem is that basic physical continuity
problems are found without a model.**

## Object state

Objects are tracked through the same scene-anchored transitions as everything
else ([STORY_STATE.md](STORY_STATE.md)), across six dimensions:

| Dimension  | Transition kind     | Meaning                                        |
| ---------- | ------------------- | ---------------------------------------------- |
| owner      | `object_owner`      | whose it is — survives theft and lending       |
| holder     | `object_holder`     | who physically has it right now                |
| location   | `object_location`   | where it was last put down                     |
| condition  | `object_condition`  | free text: "cracked", "bloodstained"           |
| status     | `object_status`     | `exists` `lost` `destroyed` `hidden` `unknown` |
| visibility | `object_visibility` | `visible` `concealed` `disguised` `unknown`    |

### Owner is not holder

A stolen revolver still belongs to its owner. Collapsing the two would make
theft, lending and hiding unrepresentable, and would turn every hand-off into a
false ownership conflict. So both are recorded, and a character's **inventory**
is what they _hold_ — what they own but have not got on them is property.

A project that never uses `object_holder` is unaffected: with no holder
recorded, the owner is taken to be carrying it, which is exactly how the system
behaved before.

### Placement decides where a thing actually is

```
placement: "held"     → wherever the holder is
placement: "placed"   → wherever it was put down
placement: "unplaced" → nowhere recorded
```

Whichever of holder and location was set most recently wins. Putting something
down ends anyone's hold on it; picking it up takes it away from where it lay.
`objectLocationAt()` follows the chain, so "Elias carries the revolver to the
manor" needs no second transition restating the obvious — and, crucially,
"the revolver is in the flat" stops being true the moment someone pockets it.

### Status and condition are different questions

`destroyed` means the story world no longer has the thing. `lost` and `hidden`
mean it is findable again — `hidden` is somebody's doing, `lost` is nobody's
knowledge. `unknown` means the project has not recorded an answer, which is not
the same as the story giving one.

**Legacy statuses are interpreted on read.** `intact` becomes `exists`, and
`transformed` becomes `exists` too: a melted candlestick has not left the story,
it has changed _condition_, and there is now a field that says so. No project is
rewritten.

## Transfers

```ts
repo.recordObjectTransfer({
  objectId: OBJECT_KEY,
  sceneId: SCENE_0017,
  fromCharacterId: CHAR_MARA, // optional
  toCharacterId: CHAR_ELIAS,
  reason: "handed over at the door",
});
```

A transfer is a **convenience over the transitions it writes, not a second
store**. Transfers are _derived_ from state (`objectTransfers()`), so there is
only ever one version of where a thing is and the two can never drift apart.

Supplying a `from` is optional. When given it is checked against the state
entering the scene: a caller asserting the key came from Mara when the timeline
says it was in a drawer is stating something the project contradicts, and is
told so rather than having it silently recorded.

## Nested locations

```
Blackthorn Manor
  └── West Wing
       └── Library
            └── Hidden Vault
```

Someone in the Hidden Vault **is** at Blackthorn Manor. Every containment
question is answered in one place (`@jellytind/domain/location-tree`), so checks,
context and the UI agree:

```ts
isWithin(locations, VAULT, MANOR); // true
isWithin(locations, MANOR, VAULT); // false — direction matters
locationsCompatible(locations, VAULT, MANOR); // true — neither contradicts the other
describeLocationPath(locations, VAULT); // "Blackthorn Manor › West Wing › Library › Hidden Vault"
repo.getScenesWithinLocation(MANOR); // finds the scene set in the vault
```

`locationsCompatible` is the test a continuity check should use: it flags only
positions that genuinely cannot both hold, never a coarser description of the
same place. Getting this wrong would report a contradiction between two true
statements, which is worse than having no check at all.

Every function tolerates a broken tree — a missing parent, a loop a writer
created mid-edit. That is a finding for `checkContinuity`, not a crash.

## Character location

`character_location` now carries a **movement**:

| Movement    | Meaning                                           | Presence     |
| ----------- | ------------------------------------------------- | ------------ |
| `arrival`   | now at `value` (the default, and the old meaning) | `present`    |
| `departure` | has left `value`, not placed anywhere yet         | `departed`   |
| `travel`    | between places; `value` is the destination        | `travelling` |
| `unknown`   | whereabouts deliberately unrecorded               | `unknown`    |

`CharacterState` gains `presence`, `travellingTo` and `lastKnownLocationId`. A
character who has departed is not "at" their last location any more, and saying
so is the difference between a usable check and a noisy one — a scene set
somewhere they are travelling to is not a contradiction.

Transitions written before this phase carry no movement and read as arrivals,
which is exactly what they always meant.

## Continuity checks

`checkContinuity({ timeline, scenes, locations, view })` — deterministic, no
model, reusable by the Story Compiler, the repository and the UI alike:

| Kind                             | Severity | What it means                                           |
| -------------------------------- | -------- | ------------------------------------------------------- |
| `impossible_object_appearance`   | error\*  | a scene uses an object the state puts somewhere else    |
| `destroyed_object_reused`        | error    | an object is used or moved after it was destroyed       |
| `conflicting_object_ownership`   | error    | one scene records two owners, or two holders            |
| `unexplained_object_relocation`  | warning  | an object moved with nobody carrying it                 |
| `conflicting_character_location` | error†   | a character is put in two places that cannot both hold  |
| `invalid_nested_location`        | error    | a cycle, a self-parent, or a parent that does not exist |

\* a warning when the object is being carried by someone simply absent from the
scene — that is a question about a _character's_ whereabouts, not the object's.
† a warning when it is the scene's own setting that disagrees with where the
character was last recorded, since that is usually an unrecorded walk.

### Two disciplines keep it from crying wolf

- **Containment is honoured.** A scene in the vault may use an object recorded
  "at the manor". Only positions where neither contains the other are flagged.
- **Silence is not a claim.** An object with no recorded location asserts
  nothing to contradict. A character whose position was never recorded is not
  reported for turning up somewhere. Nothing here infers state that was never
  entered.

A scene that explicitly restates an object's status is the writer handling the
case — resurrection, reconstruction, a second copy — and is not a finding.

## Object state in compiled context

When a scene references tracked objects, their state travels with it, rendered
so a model cannot use it wrongly:

```
STATE OF OBJECT_0001 immediately before SCENE_0002
owner: CHAR_0001
where: LOC_0003 (Blackthorn Manor › West Wing)
status: exists
condition: bent
```

A held object reads as `carried by CHAR_0002` rather than naming a place it left
chapters ago, and a destroyed one carries an explicit "do not use it". Character
locations are spelled out with their containment path, because `LOC_0003` tells
a model nothing while the trail tells it the character is at the manor — which
is the fact a scene set "at the manor" turns on. See
[CONTEXT_COMPILER.md](CONTEXT_COMPILER.md).

## The Objects panel

The desktop app's **Objects** tab shows, for any tracked object:

- where it stands now — holder or place, owner, status, condition, visibility
- its **history as a trail through the chapters**, each step with what it
  changed from and the author's reason
- a form to record the next transfer, condition, status or visibility change
- the continuity findings that name it, and the project's full list

```
BRASS KEY

Openings
  location    → Library        SCENE_0004   in the drawer
  holder      → CHAR_0002      SCENE_0012   Mara takes the key
The Rift
  holder  CHAR_0002 → CHAR_0001  SCENE_0017  given to Elias
  condition   → bent            SCENE_0027   forced in the cellar door
```

## Relationship to other subsystems

- [STORY_STATE.md](STORY_STATE.md) — objects and locations are the same
  scene-anchored transitions as knowledge and relationships, replayed the same
  way. Nothing here is a cached snapshot.
- [TIMELINE.md](TIMELINE.md) — the chronology supplies an alternative scene
  order, so continuity can be checked in story order as well as manuscript
  order.
- [STORY_COMPILER.md](STORY_COMPILER.md) — `checkContinuity` is the reusable
  foundation for the "Character locations valid" and "object/inventory
  continuity" lines of a story build.
- [DOMAIN_MODEL.md](DOMAIN_MODEL.md) — statuses, visibility and the location
  tree are domain vocabulary, shared by every consumer.

## Invariants

- Owner and holder are separate; neither is inferred from the other.
- A held object is wherever its holder is; a placed one stays put.
- Containment is honoured everywhere: in the vault is at the manor.
- Silence is never a claim — unrecorded state contradicts nothing.
- Transfers are derived from transitions, never stored beside them.
- Legacy statuses are interpreted on read; no project is rewritten.
- Every check is decidable from recorded data alone. No model, ever.
