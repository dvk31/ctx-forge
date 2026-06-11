---
name: ctx-forge
description: Generate, verify, and install a project-specific context toolset (ctx CLI + MCP) so agents navigate this codebase in one tool call instead of thirty. Use when asked to "forge context tools", "set up ctx", "generate context tools for this project", or when ctx selftest/regen reports a broken or stale toolset.
---

# ctx-forge: Forge Context Tools for This Project

You are about to build a `ctx` toolset: a small set of fast, deterministic, `file:line`-anchored commands that answer the questions agents otherwise burn dozens of tool calls exploring. You will generate the tools, **prove they tell the truth**, and only then install them.

Read `spec/tool-contract.md` and `spec/ctx-toml.md` from the ctx-forge repo before starting. They are the law; this file is the method.

## Non-negotiables

1. **Never install an unverified tool.** Every command passes its golden questions (see `verify/PROTOCOL.md`) or it gets dropped — recorded in `[dropped]` in `ctx.toml` with the reason.
2. **No new runtime dependencies.** Tools are written in the project's own primary language using stdlib plus what the project's lockfile already provides.
3. **Everything lives under `.ctx/`** except one fenced section in `AGENTS.md`/`CLAUDE.md`. You never modify project source.
4. **Deterministic output.** Same tree -> byte-identical answers. No timestamps, no random ordering.
5. **Runtime truth over parse-time guesses.** If the framework can be booted cheaply and safely (read-only, no side effects, no network, no migrations), introspect the live registry instead of regexing source. If booting is unsafe or slow, fall back to static analysis and say so in the command's description.
6. **Ask before booting anything** that could touch a real database or external service. Prefer the framework's offline/inspection modes.

## Phase 0 — Preflight

1. If `.ctx/` already exists: read `ctx.toml`. If `contract_version` is current and `last_selftest_result = "pass"`, run `./.ctx/ctx regen --check`. Only regenerate what is stale. Do not rebuild a healthy toolset from scratch.
2. Confirm with the user if the project is unusual: monorepo with multiple apps (one toolset per app or one umbrella?), generated code, vendored trees.

## Phase 1 — Audit

Goal: a written inventory (keep it in your head or a scratch note, not committed) of:

1. **Stack**: primary language, frameworks + versions (read lockfiles/manifests: `pyproject.toml`, `package.json`, `go.mod`, `Gemfile`, `Cargo.toml`...), entry points, how the app boots.
2. **Introspection seams** — for each, note how you would query it and what command it powers:
   - module/file layout -> `ctx map`
   - symbol definitions (classes, functions, exports) -> `ctx find`
   - data models (ORM registry, schema files, migrations) -> `ctx schema`
   - routes/endpoints (URL conf, route tables, decorators, file-based routing) -> `ctx api`
   - cross-layer wiring (signals/events, DI containers, queues, middleware) -> `ctx flow` and stack-specific commands
   - import/call graph -> `ctx impact`
3. **Recipe check**: look in the ctx-forge repo's `recipes/` for this stack. A recipe lists the known-good seams, canonical command names, and pitfalls. Recipes accelerate; absence of one never blocks — derive the seams from the methodology above.
4. **Surface globs**: the exact file globs each planned generator will read. These become `[surface]` in `ctx.toml`. If a generator reads it, it is in the surface.

Tier rules:
- **Tier 0** (always buildable): map, find, regen, selftest, help — from static analysis of the tree.
- **Tier 1** (framework detected): schema, api, flow, impact, stack-specific commands — prefer booting the framework's own reflection.
- **Tier 2** (optional): ask — only if the user wants it and an API key env var is available.

## Phase 2 — Plan the toolset

Produce a short plan and show it to the user before generating:

- Commands to build, each with: tier, seam it reads, surface globs, expected cold/warm latency.
- Conformance target (`core` / `standard` / `full` per the contract).
- Anything you will NOT build and why (be honest; `[dropped]` exists for a reason).
- Where golden-question ground truth will come from (which raw explorations you will perform).

Wait for approval if the plan involves booting the framework or the project is large; otherwise proceed.

## Phase 3 — Generate

1. Scaffold `.ctx/` per the contract's installation layout: entrypoint, `tools/`, `guides/`, `cache/` (gitignored), `ctx.toml`.
2. Write the entrypoint dispatcher first, with `help`, `regen --check` staleness logic, and exit codes from the contract. Every later tool plugs into it.
3. Write each command honoring the output rules (§3 of the contract): anchored, dense, `--json` / `--locate` / `--help`, deterministic, stderr for diagnostics. The contract's budget (~150 lines / ~6 KB default) is a feature, not a constraint — design the *default* view for an agent that needs orientation, and flags for depth.
4. Generate `guides/` last: dense markdown references built *by* your tools (e.g. `ctx schema --json` -> `guides/schema.md`). Guides are regenerable artifacts; never hand-author facts into them.
5. Keep each tool small and readable. The user will review this code; it is part of their repo.
6. **Pass the host project's own quality gates.** If the project has a linter/formatter config (ruff, eslint, black...), run it over `.ctx/` and fix everything before Phase 4 — generated tools are committed source and will be swept up by the project's pre-commit hooks and CI exactly like hand-written code.

## Phase 4 — Verify (the gate)

Follow `verify/PROTOCOL.md` exactly. Summary:

1. **Before** trusting any tool, establish ground truth for each golden question by raw exploration (grep, read, framework shell). Record question, expected answer, and how you derived it in `.ctx/golden.yaml`.
2. Minimums: 3 golden questions per core/standard command, 1 per stack-specific command. Mix easy and adversarial (dynamic dispatch, re-exported symbols, overridden settings — the places static tools lie).
3. Run `./.ctx/ctx selftest`. Every question must pass with an exact or semantically-equivalent match.
4. A failing command gets exactly one fix-and-retry cycle. Still failing -> drop it: remove it from `[commands]`, record the reason in `[dropped]`, and keep its golden questions in `golden.yaml` marked `dropped: true` so the next regen can retry them.
5. Update `[verify]` in `ctx.toml`. Only a passing toolset proceeds to Phase 5.

## Phase 5 — Install

1. Write the fenced `<!-- ctx-forge:begin/end -->` section into `AGENTS.md` (or `CLAUDE.md` if that's what the project uses): a compact table of installed commands, the staleness rule ("exit 2 means run `ctx regen`"), and the regen triggers from `ctx.toml`. Keep it under ~30 lines — this text is loaded into every future session.
2. If the project's agent setup supports MCP, install the MCP wrapper from `mcp-template/` and register it (`.cursor/mcp.json`, `claude mcp add`, etc.) so commands surface as native `ctx_*` tools.
3. Add `.ctx/cache/` to the project `.gitignore`.
4. Show the user: the command list, selftest results, anything dropped, and a one-line demo of the flashiest command on *their* code.

## Maintenance

- Commands self-report staleness (exit 2). On exit 2, run `./.ctx/ctx regen` — it rebuilds, re-hashes, and re-runs selftest automatically.
- When the ctx-forge skill/contract version advances, regenerate rather than patch: tools are cheap to rebuild and expensive to debug.
- If `last_selftest_result = "fail"`, the toolset is untrusted: fall back to raw exploration, then regen.

## Failure modes to avoid

- **The confident liar**: a tool that answers plausibly but wrong (stale index, missed dynamic registration). This is worse than no tool — it is why Phase 4 gates Phase 5 and why staleness checks run on every invocation.
- **The kitchen sink**: 25 commands nobody calls. Build the commands the audit showed this project actually needs; `[dropped]` and stack-specific additions can come later.
- **The framework cosplayer**: regexing `urls.py` when `manage.py` could give you the resolved URL table. Prefer the seam that cannot drift from reality.
- **The dependency smuggler**: "just one small package" — no. Stdlib or what the lockfile already has.
