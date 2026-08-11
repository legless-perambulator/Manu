# SECURITY_PRIVACY

The writer's manuscript is sensitive intellectual property. Architecture must protect ownership, portability and privacy.

## Status

Documentation stage. These constraints apply from the first vertical slice; they are architectural, not features to add later.

## Local-first ownership

Where practical, design around local-first project ownership:

- local projects
- local database
- local models
- BYOK (bring-your-own-key) APIs
- cloud sync as **optional** infrastructure
- encrypted remote storage where implemented

Do **not** architect the system so that every project fundamentally requires one company's cloud. The manuscript and core story data must be usable and portable without any remote service (see [STORY_REPOSITORY.md](STORY_REPOSITORY.md)).

## Data handling

- The user's actual creative work stays in portable, human-readable files. It is never trapped in a proprietary cloud-only format.
- Internal AI metadata is kept separate from the manuscript so export can preserve the book independently of `.writer/` internals (see [VERSIONING.md](VERSIONING.md) and import/export in `MASTER_BUILD.md` §39).
- Derived data (indexes, embeddings, summaries) is regeneratable and may be deleted without losing canon.

## Model-provider privacy

- All model access goes through the [Model Router](MODEL_ROUTER.md); routing respects privacy preferences.
- Support keeping sensitive projects on local models or BYOK endpoints, so manuscript text need not be sent to a third-party hosted provider if the user forbids it.
- Track which model/provider handled each operation (provenance in the audit trail) so data flow is inspectable.

## Credential storage (implemented)

Provider API keys are credentials, not project content.

- Keys are stored by the desktop host in the operating system's credential store
  (macOS Keychain, Windows Credential Manager, Freedesktop Secret Service),
  reached through `SecretStore` so no core code depends on the mechanism.
- Where a machine offers no such service (headless Linux, containers), the host
  falls back to an owner-only (`0600`) file in the application-config directory
  and the settings UI states which backend is in use — the product does not claim
  a guarantee the platform is not providing.
- **No key is ever written into a Story Repository**: not into project files, the
  manifest, entities, the search index or revision history. A project directory
  can be copied, synced or shared without carrying credentials, which is what
  keeps portability from becoming a leak.
- The selected provider/model is a machine-local preference, stored outside the
  project, so repositories stay free of machine-specific configuration.
- Keys are read at call time and not held in application state longer than a
  request needs them.

See [MODEL_ROUTER.md](MODEL_ROUTER.md).

## Provider independence as a privacy property

Because no core data is bound to a single provider (see [ARCHITECTURE.md](ARCHITECTURE.md)), a user can move to a more private provider — or fully local models — without losing their project.

## Authorial control

AI must never make it hard to distinguish what the author wrote from what AI wrote/changed, why it changed, and how to undo it. Control and transparency are security properties for the author's trust in the system (see [VERSIONING.md](VERSIONING.md)).

## Future collaboration

Collaboration (co-authors, editors, beta readers, researchers) is designed for later with roles and permissions, but must not compromise the single-user, local-first foundation. Do not let collaboration complexity weaken the baseline privacy posture.

## Invariants

- Core manuscript and story data are usable offline and fully portable.
- No mandatory dependency on one company's cloud for core data.
- Model routing can honour "local/BYOK only" for sensitive content.
- Every operation's model/provider is recorded for inspectability.
- Provider credentials live in host secure storage, never inside a project.
