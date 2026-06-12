# ctx.toml Manifest Format

Version: `0.1` (pre-release; breaking changes allowed until `1.0`)

`.ctx/ctx.toml` is the single source of truth about a generated toolset: what was detected, what was generated, and what it reads. It is written by the generator and read by agents, the MCP server, and the verification harness.

The manifest is **deliberately static between generations**: `ctx regen` and `ctx selftest` write their volatile results (surface hash, timestamps, pass/fail) to the gitignored state file `cache/state.json`, never to the manifest. This keeps the committed tree byte-stable no matter how often the tools run — early toolsets wrote stamps into the tracked manifest, and every selftest dirtied every contributor's checkout.

## Volatile state: `cache/state.json`

Written by `ctx regen` and `ctx selftest`; absent in a fresh checkout (caches are gitignored), which all commands MUST treat as stale/untrusted until one `ctx regen` runs.

| Key | Writer | Notes |
|-----|--------|-------|
| `surface_hash` | `ctx regen` | `sha256:` over the surface (see `[surface]`); compared on every invocation. |
| `regenerated_at` | `ctx regen` | RFC 3339. |
| `last_selftest` | `ctx selftest` | RFC 3339. |
| `last_selftest_result` | `ctx selftest` | `pass` / `fail`. `fail` marks the toolset untrusted: agents SHOULD fall back to raw exploration and run `ctx regen`. |
| `questions` | `ctx selftest` | Number of non-dropped golden questions executed. |

## Full example

```toml
[ctx]
contract_version = "0.1"        # tool-contract.md version this toolset implements
conformance = "standard"        # core | standard | full
generated_at = "2026-06-11T19:04:11Z"
generated_by = "ctx-forge skill v0.1 / claude-fable-5"

[project]
name = "acme-billing"
primary_language = "python"
frameworks = ["django>=5", "celery"]
entrypoint_hint = "manage.py"   # how generators boot the framework, if they do

[surface]
# Globs that define the introspected surface. The hash below is computed over
# the sorted (path, content-hash) pairs of every file matching these globs.
globs = [
  "**/models.py",
  "**/urls.py",
  "**/views.py",
  "**/services.py",
  "**/tasks.py",
  "config/settings/**",
]
exclude = ["**/migrations/**", "**/node_modules/**", ".ctx/**"]
# The computed hash lives in cache/state.json (volatile, gitignored) — not here.

[commands.map]
tier = 0
source = "tools/map.py"
description = "Repo overview: apps, modules, responsibilities"

[commands.find]
tier = 0
source = "tools/find.py"
description = "Semantic find over symbol/route/model index"

[commands.flow]
tier = 1
source = "tools/flow.py"
description = "Trace request -> route -> view -> service -> signal"
boots_framework = true          # cold start is slower; results cached

[commands.schema]
tier = 1
source = "tools/schema.py"
description = "Models, fields, relations via Django app registry"
boots_framework = true

[commands.signals]              # stack-specific command (allowed, must be listed)
tier = 1
source = "tools/signals.py"
description = "Signal registry: senders, receivers, file:line"
boots_framework = true

[ask]
enabled = true
provider_env = "CTX_ASK_API_KEY"   # env var holding the key; never the key itself
guides = ["guides/architecture.md", "guides/schema.md", "guides/api.md"]

[verify]
golden = "golden.yaml"
# selftest results live in cache/state.json (volatile, gitignored) — not here.

[dropped]
# Commands the generator attempted but could not verify. Kept for honesty
# and so a future regen can retry them.
impact = "could not establish reliable call graph for dynamic dispatch; retry after recipe update"

[regen]
auto_check = true               # commands compare surface hash on every run
triggers = [
  "models or schema changed",
  "routes/urls changed",
  "new app/module added",
]
```

## Section reference

### `[ctx]` (required)

| Key | Type | Notes |
|-----|------|-------|
| `contract_version` | string | Must match a published `tool-contract.md` version. |
| `conformance` | string | `core`, `standard`, or `full`. `ctx selftest` enforces it. |
| `generated_at` | RFC 3339 string | Set at generation only (provenance). Regen timestamps live in `cache/state.json`. |
| `generated_by` | string | Skill version + model that generated the toolset. Provenance, not vanity: it tells a future agent how much to trust and whether a newer skill should regenerate. |

### `[project]` (required)

Detected facts about the host project. `frameworks` entries SHOULD carry a version constraint when detectable. `entrypoint_hint` is the command/file generators use to boot the framework (empty for pure Tier 0 toolsets).

### `[surface]` (required)

Defines staleness. `globs` and `exclude` MUST cover every file any generator reads; if a generator reads it, it is part of the surface. The computed hash — `sha256:` over the sorted list of `(relative_path, sha256(content))` pairs of matching files, order-independent, line-ending-normalized (`\n`) — is recorded in `cache/state.json` by `ctx regen` and compared on every invocation.

### `[commands.<name>]` (one per installed command, required)

| Key | Type | Notes |
|-----|------|-------|
| `tier` | int | 0 (static), 1 (framework introspection), 2 (LLM-backed). |
| `source` | string | Path under `.ctx/` to the implementation. Reviewable. |
| `description` | string | One line; `ctx help` reads these. |
| `boots_framework` | bool | Optional, default false. Signals cold-start cost. |

`ctx help` output, MCP tool registration, and `ctx selftest` coverage checks are all driven by this table — a command not listed here does not exist.

### `[ask]` (required iff `ctx ask` is installed)

`provider_env` names the environment variable holding the API key. The manifest MUST NOT contain secrets. `guides` lists the generated documents `ctx ask` retrieves over.

### `[verify]` (required)

Points at the golden-question file. Selftest results are volatile and live in `cache/state.json` (see above), not in the manifest.

### `[dropped]` (optional)

Commands the generator tried and could not verify, with the reason. Honesty section: dropped is fine, silently-wrong is not.

### `[regen]` (optional)

`auto_check` (default true) controls per-invocation staleness checks. `triggers` is human/agent-readable guidance copied into the `AGENTS.md` section ("regenerate after: ...").

## Invariants

1. No secrets, ever — only env var names.
2. Every file a generator reads is covered by `[surface]` globs. Generators MUST derive their file sets from `[surface]` (includes and excludes), never from independent tree walks — a walker that reads outside the surface answers from files the staleness hash ignores, so its output drifts without ever tripping exit-2.
3. Every installed command appears in `[commands]`; every `[commands]` entry has a working `source`.
4. Nothing writes the manifest after generation: `ctx regen` and `ctx selftest` write only `cache/state.json`. A toolset whose routine runs dirty the committed tree is non-conformant.
5. The manifest is committed to the host repo; agents may read it directly instead of shelling out (`ctx help` and `ctx.toml` always agree because the former is generated from the latter). Trust/staleness questions are answered by `cache/state.json`.
