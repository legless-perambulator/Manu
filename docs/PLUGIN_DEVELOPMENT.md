# Plugin Development

> How to build a Manu plugin. The protocol's rules and security model are in
> [PLUGIN_PROTOCOL.md](PLUGIN_PROTOCOL.md); this is the practical side.

## The shape of a plugin

A plugin is one JSON file: a manifest. You do not ship code — you declare
contributions in a vocabulary Manu executes for you. If the vocabulary cannot
express what you want, the protocol does not support it yet; there is no
escape hatch, by design.

Required fields:

| Field             | Rule                                                   |
| ----------------- | ------------------------------------------------------ |
| `id`              | Reverse-DNS style, lowercase: `com.example.my-plugin`. |
| `name`            | Human-readable name.                                   |
| `version`         | Your plugin's own semver (`1.2.0`).                    |
| `protocolVersion` | The protocol you wrote against — currently `"1.0"`.    |
| `permissions`     | Everything you need, and nothing more.                 |
| `contributes`     | The contributions themselves.                          |

## A complete working example

This is the reference **Writing Statistics** plugin that ships with Manu
(`WRITING_STATISTICS_PLUGIN` in `packages/plugin-protocol/src/reference.ts`),
trimmed to its essentials. Save it as a `.json` file and install it through
the Plugins panel:

```json
{
  "id": "com.example.writing-statistics",
  "name": "Writing Statistics",
  "version": "1.0.0",
  "protocolVersion": "1.0",
  "description": "Word counts, chapter averages and dialogue share.",
  "permissions": [
    "read_manuscript",
    "register_agent_tools",
    "register_commands",
    "register_panels"
  ],
  "contributes": {
    "tools": [
      {
        "name": "writing_statistics",
        "description": "Compute manuscript statistics.",
        "input": { "fields": {} },
        "output": {
          "fields": {
            "chapters": { "kind": "number", "required": true },
            "totalWords": { "kind": "number", "required": true },
            "averageChapterWords": { "kind": "number", "required": true },
            "dialoguePercent": { "kind": "number", "required": true }
          },
          "rows": {
            "name": "perChapter",
            "fields": {
              "title": { "kind": "string", "required": true },
              "words": { "kind": "number", "required": true }
            }
          }
        },
        "implementation": { "kind": "computed", "operation": "manuscript_statistics" }
      }
    ],
    "commands": [
      {
        "name": "writing-stats",
        "summary": "Show manuscript statistics",
        "action": { "kind": "run_tool", "tool": "writing_statistics" }
      }
    ],
    "panels": [
      {
        "id": "writing-statistics",
        "title": "Writing statistics",
        "rendering": { "kind": "tool_report", "tool": "writing_statistics" }
      }
    ]
  }
}
```

Once installed and enabled, `/writing-stats` exists in the terminal and the
palette, and the panel renders the tool's report inside the Plugins view.

## Tools

Two implementation kinds:

**`computed`** — a built-in read-only computation. `manuscript_statistics`
needs `read_manuscript`; `entity_counts` needs `read_entities`. The host
computes over chapter _bodies_ (front matter and markers are never exposed).

**`http_get_json`** — a GET against a host you declared:

```json
{
  "name": "weather",
  "description": "Current temperature for a city.",
  "input": { "fields": { "city": { "kind": "string", "required": true } } },
  "output": { "fields": { "temperature": { "kind": "number", "required": true } } },
  "implementation": {
    "kind": "http_get_json",
    "url": "https://api.example.com/weather?q={input.city}",
    "pick": { "temperature": "current.temp_c" },
    "headers": { "Authorization": "secret:API_KEY" }
  }
}
```

Rules: `https` only; the URL's host must appear in your `permissions` as
`"network:api.example.com"`; `{input.field}` placeholders are URL-encoded from
validated input; `pick` maps each output field to a dot-path in the response;
`secret:NAME` headers resolve from Manu's secure storage under _your_ plugin's
namespace and require the `plugin_secrets` permission. If the response does
not satisfy your output schema, the call fails — declare what you actually
return.

## Compiler rules

Declare honestly. A **deterministic** rule must use a closed template:

```json
{
  "type": "deterministic",
  "id": "short-scenes",
  "name": "Scenes stay under 4000 words",
  "description": "Flag scenes longer than the limit.",
  "severity": "warning",
  "template": { "kind": "scene_word_limit", "maxWords": 4000 }
}
```

Templates: `scene_word_limit` (`maxWords`) and `entity_field_required`
(`entity`: `character` | `location`, `field`). Anything subjective — pacing,
tension, "does this feel right" — must be `"type": "semantic"` with a
`briefing`, and surfaces through the semantic layer as a soft finding, never
a build error. A "deterministic" rule with an unknown template is rejected.

## Importers, exporters, skills, context, settings

- **Importer**: `{ "id", "name", "extensions": ["fountain"], "dialect": {
"chapterHeading": "^#\\s+(.+)$", "sceneBreak": "^===+$" } }` — regexes over
  lines; the heading's first capture group is the chapter title. Requires
  `register_importers`.
- **Exporter**: `{ "id", "name", "extension": "txt", "template": {
"header": "== {title} ==", "chapterHeading": "[{number}] {title}",
"sceneBreak": "---" } }`. Requires `register_exporters`.
- **Skills** use Manu's custom-skill format (see
  [WRITING_SKILLS.md](WRITING_SKILLS.md)) and appear as `/commands` like any
  other skill. Requires `register_skills`.
- **Context providers** contribute a titled, provenance-tagged note to
  context compilation. Requires `register_context`.
- **Settings** are schema-driven: `{ "key", "label", "kind":
"string" | "number" | "boolean" | "choice", "choices"?, "defaultValue"? }`.
  Manu renders the editor; values persist per project. Requires
  `plugin_settings`.

## Developing and debugging

Turn on **Developer Mode** in the Plugins panel: reload manifests from
`.writer/plugins/` after editing on disk, inspect what a plugin contributes,
re-validate a manifest, and read the host's activity log (every call, block
and failure). Validation errors name the field and the rule that rejected it.

## What you cannot do

No arbitrary code, no shell, no filesystem, no undeclared hosts, no plain
http, no other plugin's (or Manu's provider) secrets, no silent failures and
no subjective "errors". If your plugin breaks, it breaks alone: the writer
sees the error on your plugin's card, and the rest of Manu does not notice.
