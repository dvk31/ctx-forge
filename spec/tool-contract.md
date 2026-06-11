# ctx-forge Tool Contract

Version: `0.1` (pre-release; breaking changes allowed until `1.0`)

This document defines the surface every ctx-forge-generated toolset MUST expose. The contract exists so that agents, MCP wrappers, verification harnesses, and downstream tools (e.g. Headroom) can rely on identical behavior across wildly different projects.

The words MUST, SHOULD, and MAY are used in the RFC 2119 sense.

## 1. Installation layout

A generated toolset lives entirely inside the target repository:

```
<repo>/
└── .ctx/
    ├── ctx                # executable entrypoint (or ctx.cmd on Windows)
    ├── ctx.toml           # manifest (see spec/ctx-toml.md)
    ├── tools/             # generated command implementations
    ├── guides/            # generated reference guides (markdown, regenerable)
    ├── golden.yaml        # golden questions + ground-truth answers
    └── cache/             # derived indexes (gitignored)
```

Rules:

- The toolset MUST be self-contained under `.ctx/`. The only file written outside `.ctx/` is the agent-guidance section in `AGENTS.md` / `CLAUDE.md` (clearly fenced with `<!-- ctx-forge:begin -->` / `<!-- ctx-forge:end -->` markers).
- `.ctx/cache/` MUST be gitignored (the generator adds the entry). Everything else under `.ctx/` SHOULD be committed — the tools are reviewable source, not build artifacts.
- The entrypoint MUST be runnable as `./.ctx/ctx <command>` with no environment setup beyond what the project itself already requires.
- Implementation language MUST match the project's primary toolchain (Python project -> Python script, Node project -> Node script, etc.). A toolset MUST NOT introduce new runtime dependencies beyond the project's existing lockfiles, except stdlib.

## 2. Command surface

### 2.1 Required (every toolset, any stack — Tier 0)

| Command | Purpose |
|---------|---------|
| `ctx map [path]` | Repo or subtree overview: modules, responsibilities, key entry points. |
| `ctx find <pattern>` | Semantic find over the generated index: symbols, routes, models, config keys — not raw text grep. |
| `ctx regen [--check]` | Regenerate indexes and guides. `--check` only reports staleness (exit code 2 if stale) without regenerating. |
| `ctx selftest` | Re-run all golden questions; exit code 3 on any failure. |
| `ctx help [command]` | Self-documentation. `ctx help` MUST list every installed command with a one-line description. |

### 2.2 Recommended (generate when the stack supports them — Tier 1)

| Command | Purpose |
|---------|---------|
| `ctx flow <topic>` | Execution trace across layers (e.g. request -> route -> handler -> service -> events), with `file:line` for every hop. |
| `ctx schema [--find <pattern>]` | Data models: fields, types, relationships, indexes. |
| `ctx api [--find <pattern>]` | Endpoints/routes: method, path, handler location, auth/permissions where derivable. |
| `ctx impact <file[::symbol]>` | Blast radius: who imports/calls/depends on the target; affected tests. |

A toolset SHOULD implement these via the framework's own reflection when a framework is present (boot the app registry, walk the real route table) rather than re-parsing source statically, because runtime truth beats parse-time guesses.

### 2.3 Optional

| Command | Purpose |
|---------|---------|
| `ctx ask <question>` | LLM-backed Q&A over `guides/` + indexes. MUST degrade gracefully (clear error, exit 1) when no API key is configured. |
| Stack-specific commands | e.g. `ctx signals`, `ctx tasks`, `ctx middleware` for a Django project. Free-form, but MUST follow the output rules below and MUST be listed in `ctx help` and `ctx.toml`. |

### 2.4 Naming

Stack-specific commands MUST be nouns describing the surface they expose (`ctx signals`), not verbs describing implementation (`ctx parse-signals`). Two toolsets for similar stacks SHOULD converge on the same names; recipes define the canonical names per framework.

## 3. Output rules

These rules are what make generated tools agent-efficient. They apply to every command.

1. **Anchored.** Every code fact MUST carry a `path:line` anchor (`src/billing/service.py:142`). Anchors MUST point at the current working tree, not cached line numbers — commands MUST re-resolve anchors if their index is older than the file's mtime, or declare staleness (see §5).
2. **Dense by default.** Default output MUST fit a small budget: at most ~150 lines or ~6 KB, whichever is hit first. When results are truncated, the command MUST say so explicitly and show the flag that expands them (`--full`, `--limit N`).
3. **Structured flags.** Every command MUST support:
   - `--json` — machine-readable output, stable schema, no truncation;
   - `--locate` — terse `path:line:name` lines only (grep-friendly);
   - `--help`.
4. **Edit-oriented flag.** Commands in §2.2 SHOULD support `--edit-hints`: append the concrete files/lines a change would touch and the project-specific pattern to follow (e.g. "new endpoint: add handler in X, register route in Y, add test in Z").
5. **Deterministic.** Same tree state -> byte-identical output (no timestamps, no random ordering). Required for verification.
6. **Plain.** No ANSI color or spinners when stdout is not a TTY. Never write to stdout except the answer; diagnostics go to stderr.
7. **Fast.** Tier 0 commands SHOULD answer in under 2 seconds from a warm cache. Commands that need to boot a framework SHOULD cache aggressively and note cold-start cost in `ctx help`.

## 4. Exit codes

| Code | Meaning |
|------|---------|
| 0 | Success. |
| 1 | Error (bad arguments, missing dependency, internal failure). |
| 2 | Stale: the introspected surface changed since last `ctx regen` (see §5). The answer MAY still be printed, prefixed with a staleness warning on stderr. |
| 3 | Selftest failure (only from `ctx selftest`). |

## 5. Staleness

`ctx.toml` records a content hash over the **introspected surface** — the set of files/globs each generator declares as its inputs (e.g. `**/models.py`, `**/urls.py` for a Django schema/api generator). On every invocation, commands MUST cheaply compare the current surface hash against the recorded one:

- Match -> answer normally.
- Mismatch -> answer if possible, warn on stderr, exit 2. Agents treat exit 2 as "run `ctx regen`".

`ctx regen` MUST update the hash, rebuild indexes and guides, and then run `ctx selftest` automatically. A regen whose selftest fails MUST restore the previous state (or clearly mark the toolset broken in `ctx.toml`) — never leave silently-wrong tools installed.

## 6. Verification

Every toolset ships `golden.yaml`: a set of questions with ground-truth answers established during generation by raw exploration (see `verify/PROTOCOL.md`). Requirements:

- Minimum 3 golden questions per installed command from §2.1/§2.2; at least one per stack-specific command.
- `ctx selftest` MUST run all of them and report pass/fail per question with a diff on failure.
- A command that cannot pass its golden questions MUST NOT be installed. The generator either fixes it or drops it (recording the drop in `ctx.toml`).

## 7. MCP exposure

When the MCP server (from `mcp-template/`) is installed, it MUST expose each installed command as an MCP tool named `ctx_<command>` (e.g. `ctx_flow`), passing flags through verbatim and returning the command's stdout. The MCP layer is a thin shell — it MUST NOT add behavior beyond transport.

## 8. Conformance levels

| Level | Requirements |
|-------|--------------|
| **core** | §2.1 commands + output rules + exit codes + staleness + verification. |
| **standard** | core + all §2.2 commands applicable to the stack. |
| **full** | standard + `ctx ask` + MCP exposure. |

`ctx.toml` declares the level; `ctx selftest` MUST fail if the declared level's requirements are not met.
