# Plugin Protocol

> Phase 42. The versioned, permissioned extension protocol: what a plugin is,
> what it may touch, and how Manu keeps a broken or hostile one from mattering.
> The developer-facing guide with a working example is
> [PLUGIN_DEVELOPMENT.md](PLUGIN_DEVELOPMENT.md).

## What a plugin is

A Manu plugin is a **declarative capability bundle**, not a program. The
manifest is a single JSON document that _describes_ contributions — tools,
commands, skills, compiler rules, context providers, importers, exporters,
panels, settings — and every contribution is expressed in a closed vocabulary
the host already knows how to execute. There is no plugin code to run, which
is the sandbox: a plugin cannot open a shell, read the filesystem, call an
undeclared host or touch another plugin's secrets, because none of those
operations exist in the vocabulary.

Implementation lives in `packages/plugin-protocol`:

| Module         | Responsibility                                                        |
| -------------- | --------------------------------------------------------------------- |
| `types.ts`     | The manifest schema, permission vocabulary and protocol version.      |
| `validate.ts`  | `validateManifest`: structural, versioning and security validation.   |
| `host.ts`      | `PluginHost`: install/enable/disable/remove, the gated tool executor. |
| `contrib.ts`   | Adapters that express contributions in Manu's existing contracts.     |
| `reference.ts` | The Writing Statistics reference plugin.                              |

The desktop runtime (`apps/desktop/src/lib/plugins.ts`) persists manifests in
`.writer/plugins/` — plugins are project files, so a project carries its
dependencies with it — and the Plugins panel (Advanced group, `/plugins`)
is where the writer installs, reviews, enables, disables and removes them.

## Versioning

`PROTOCOL_VERSION` is currently `1.0`. A manifest declares the
`protocolVersion` it was written against; `protocolCompatible` accepts a
manifest whose **major** version matches and refuses anything else loudly at
validation ("written for a different major version"), never silently. Minor
mismatches within a major are accepted: additions to the vocabulary are
backwards compatible, breaking changes bump the major.

## Permissions — least privilege, enforced twice

A manifest requests permissions from a closed set (`PLUGIN_PERMISSIONS`):
`read_manuscript`, `read_entities`, `write_research`, `create_entities`,
`modify_manuscript`, `register_commands`, `register_skills`,
`register_compiler_rules`, `register_agent_tools`, `register_context`,
`register_importers`, `register_exporters`, `register_panels`,
`plugin_settings`, `plugin_secrets` — plus `network:<host>` per individual
host (bare hostname only; paths, schemes and `..` are rejected).

Enforcement happens at two independent layers:

1. **Validation couples contributions to permissions.** A manifest that
   contributes commands without requesting `register_commands` (and likewise
   for every contribution kind) is rejected before it is ever installed.
2. **The runtime clamps and gates.** At enable time, grants are clamped to
   what the manifest requested — a grant the manifest never asked for is
   clipped, so over-granting is impossible. At call time, each implementation
   checks its own permission again (`read_manuscript` for manuscript
   statistics, `network:<host>` before any fetch, `plugin_secrets` before any
   secret header resolves).

## Network access

Network is per-host, three checks deep:

1. **Validation**: every `http_get_json` tool's URL host must appear in the
   manifest's declared `network:<host>` permissions, and the URL must be
   `https`. An undeclared host fails validation by name.
2. **Enable**: the writer sees "This plugin requests access to: `<hosts>`"
   before enabling, and the grant is recorded.
3. **Call**: the hostname of the resolved URL is checked against the
   _granted_ permissions before the fetcher is invoked — declared but not
   granted performs zero network calls (asserted in the §25 tests).

## Tools

A plugin tool declares a name, description, an **input schema** and an
**output schema** (`ObjectSchema`: typed fields, optionally typed rows), and
one of two implementations:

- `computed` — one of the host's built-in read-only computations
  (`manuscript_statistics`, `entity_counts`), gated on `read_manuscript` /
  `read_entities` respectively.
- `http_get_json` — a GET against a declared https host, with
  `{input.field}` placeholders (URL-encoded), a `pick` map from output field
  to a dot-path in the response JSON, and optional headers whose values may
  be `secret:NAME` references.

Every call runs the full gate chain: installed → enabled → tool exists →
input validates → execute (isolated) → **output validates**. A tool whose
result does not match its own output schema returns a typed error — malformed
output is a contained plugin failure, never data handed onward.

## Error isolation

`PluginHost.callTool` never throws for a plugin failure. Failures become a
typed `{ok: false, error}` outcome, are recorded on the plugin
(`InstalledPlugin.error`) and appended to a bounded activity log. The Plugins
panel shows the failure with **View error** and **Disable** — a broken plugin
degrades to a visible error and everything else keeps working (§19).

## Contributions reuse Manu's contracts

Plugins never get parallel systems:

- **Commands** register into the same `CommandRegistry` the terminal and
  palette share (group "Plugins"; names that clash with built-ins are skipped,
  never shadowing them).
- **Skills** use the existing custom-skill format and loader.
- **Compiler rules** must declare themselves `deterministic` or `semantic`.
  Deterministic rules are restricted to a closed template set
  (`scene_word_limit`, `entity_field_required`) that compiles to real
  `StoryCompilerRule`s; anything subjective is rejected at validation with an
  instruction to declare it semantic, where it becomes a briefing for the
  semantic layer — subjective judgements never masquerade as build errors (§9).
- **Context providers** carry provenance like every other context source.
- **Importers/exporters** are declarative dialects and templates over the
  existing manuscript-io pipeline.
- **Panels** are limited `tool_report` renderings styled with Manu's tokens —
  no arbitrary UI.

## Secrets

Plugin secrets live in Manu's secure credential storage under
`plugin:<pluginId>:<name>` keys. A plugin can only ever resolve its own
namespace, and only with the `plugin_secrets` grant. Provider API keys are a
different namespace entirely and are never reachable from a plugin (§15).

## Lifecycle and data preservation

Install (from a file, validated or refused with reasons) → review permissions
→ enable (grants recorded in `.writer/plugins/state.json`) → disable (all
capability disappears immediately) → remove. Removal renames the manifest
out of the way rather than destroying it, and unknown contribution kinds in
a manifest are **preserved with a warning**, never silently dropped — a
project touched by a newer Manu or an unknown plugin loses nothing (§20, §21).

## Developer Mode

A checkbox in the Plugins panel, away from the writing surfaces: reload
plugins from disk, inspect a plugin's contributions, re-validate a manifest,
and read the host's bounded activity log.

## Security tests

`packages/plugin-protocol/src/plugin-protocol.test.ts` holds the §25 suite:
invalid manifests rejected, incompatible protocol refused loudly, missing
permissions rejected per contribution, excessive grants clamped, failing
plugins isolated without a crash, malformed tool output rejected against the
tool's own schema, undeclared network blocked at validation _and_ at call
time (with the fetch counter proving zero calls), path-shaped ids and hosts
rejected, plain-http rejected, and unknown contributions preserved.
