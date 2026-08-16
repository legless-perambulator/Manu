# Extension Ecosystem

> Phase 45. The foundation for a curated ecosystem of installable Manu
> extensions: «discover, inspect, safely install, update and remove». No
> payments, no social platform, no remote marketplace yet — every
> abstraction shaped so those can arrive without rework.

## The Extension package (§1–§2)

One format unifies everything installable. An `ExtensionManifest` names id,
name, author, version, description, category (`agents`, `skills`,
`genre_packs`, `templates`, `tools`), compatibility (ecosystem version,
major must match), permissions (the plugin protocol's vocabulary),
dependencies and **contributions** — each an existing, already-secured
vocabulary:

| Contribution | Vocabulary                          |
| ------------ | ----------------------------------- |
| `plugin`     | A full Phase 42 plugin manifest     |
| `agents`     | Phase 43 custom agent definitions   |
| `skills`     | Phase 43 flow definitions           |
| `templates`  | Project starter descriptions        |
| `modules`    | Built-in genre module ids to enable |

The extension layer adds packaging, not power: nothing an extension
contributes can do anything its underlying vocabulary could not.
Implementation: `packages/extensions`; the desktop surface is the
**Extensions** panel (`/extensions`, Advanced group).

## Integrity and signing (§3)

The distributable unit is `{format, ecosystem, manifest, integrity}`. The
digest is SHA-256 (dependency-free implementation, tested against the
standard vectors) over the _canonicalised_ manifest — keys sorted at every
level — so formatting never breaks verification and tampering always does.
First-party packages carry an HMAC signature over the digest under a key in
the trusted registry. Verification yields exactly three honest verdicts:

- **trusted** — digest and signature verify under a trusted key;
- **unsigned** — content intact, authorship unverified (community packages
  are labelled with those words, everywhere);
- **invalid** — tampered content or a failing signature. Refused.

No stronger claim is made for unsigned packages than the mathematics
supports. Real distribution moves signing to build-infrastructure keys the
app only verifies; the port shapes already allow that swap.

## The catalogue (§4, §16)

`CataloguePort` is two calls — `list()` and `fetch(id)` — implemented today
by `staticCatalogue`: local, first-party, signed at construction. A remote
catalogue implements the same port later. Catalogue failure is tolerated
everywhere: `available()` and `updates()` return empty lists, installed
extensions keep working offline, and Manu launches regardless.

## Inspection and installation (§5–§6, §14)

`inspect(raw)` judges a package without installing anything: credential
scan (a package that looks like it carries a key is refused outright),
format and ecosystem checks, integrity verdict, and deep validation of every
contribution through its own validator — the plugin protocol's
`validateManifest`, the builder's `validateAgent`/`validateFlow`. The
result shows description, author, version, permissions, dependencies,
compatibility and a "what it adds" list. Installation refuses without
explicit approval of the stated permissions.

## Updates and rollback (§7–§8)

Updates must be strictly newer. An update that **adds** permissions is
refused until re-approved, naming exactly the additions. The replaced
version is preserved (`<id>.previous.json`) so a failed update rolls back
with one call.

## Dependencies and project needs (§9–§10)

Dependencies are one level deep by design — installable only when their
targets are already installed at a sufficient version, self-reference
refused, no chains and therefore no hidden cycles. A project may declare
required/recommended extensions (`.writer/extensions/project.json`);
opening it reports what is missing, and nothing is ever auto-installed.

## First-party packs and publishing (§12–§13)

`FIRST_PARTY_PACKS` wrap existing capabilities through the extension
mechanism without touching the built-ins: the **Noir Writing Pack** (agent +
skill + semantic compiler rule + template) and Mystery/Fantasy/Romance
genre packs that enable their modules. `publishExtension` turns Studio
definitions into a distributable community package — unsigned, labelled so,
and free of credentials by construction (the schemas have nowhere to put
one; inspection scans anyway). Ratings/review fields exist as metadata only
(§11).

## The manager surface (§15)

The Extensions panel shows Installed (with enable/disable, rollback,
remove), Updates and Available — out of the writing experience entirely.
Enabled contributions register idempotently into the live systems: plugin
manifests into the plugin host, agents and skills into the Studio's project
store, genre modules into the module framework. Removal renames the package
out of the way and deregisters contributions; every record an extension
created in the project stays.

## Acceptance (§17)

`packages/extensions/src/extensions.test.ts` runs the Noir Writing Pack end
to end: validation, permission-gated install, contributions appearing, the
skill executing through the real FlowRunner and the agent through the real
sandbox, disable removing contributions, a versioned update, a
permission-widening update refused until re-approved, rollback to the
preserved version, and an uninstall that leaves the rest of the project
byte-for-byte untouched.
