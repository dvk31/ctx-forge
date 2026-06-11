<div align="center"><pre>
   ██████╗████████╗██╗  ██╗      ███████╗ ██████╗ ██████╗  ██████╗ ███████╗
  ██╔════╝╚══██╔══╝╚██╗██╔╝      ██╔════╝██╔═══██╗██╔══██╗██╔════╝ ██╔════╝
  ██║        ██║    ╚███╔╝ █████╗█████╗  ██║   ██║██████╔╝██║  ███╗█████╗
  ██║        ██║    ██╔██╗ ╚════╝██╔══╝  ██║   ██║██╔══██╗██║   ██║██╔══╝
  ╚██████╗   ██║   ██╔╝ ██╗      ██║     ╚██████╔╝██║  ██║╚██████╔╝███████╗
   ╚═════╝   ╚═╝   ╚═╝  ╚═╝      ╚═╝      ╚═════╝ ╚═╝  ╚═╝ ╚═════╝ ╚══════╝
            Your agent builds its own context tools. Once. Verified.
</pre></div>

<p align="center"><strong>skill, not a binary · project-native tools · self-verified · CLI + MCP · pairs with Headroom</strong></p>

---

ctx-forge is a meta-tool: an agent skill that teaches your coding agent (Cursor, Claude Code, Codex, ...) to **generate a context toolset specific to your project** — then prove it works before installing it.

Instead of your agent re-exploring the codebase every session (grep, read, grep, read, 30k tokens later...), it gets purpose-built commands like:

```bash
ctx flow "notification sending"     # trigger -> signal -> service -> provider, with file:line
ctx schema --find invoice           # models, fields, relationships
ctx impact src/billing/service.py   # blast radius before editing
ctx api --find webhook --edit-hints # endpoints + exactly where to make changes
```

One tool call. Dense, `file:line`-anchored output. Relationships already resolved.

## The idea in 30 seconds

Domain-aware context tools are the highest-leverage thing you can give a coding agent — but they cannot be shipped generically, because the domain knowledge *is* the tool. A `show_urn_flow` command only exists because something understood URNs.

ctx-forge resolves that tension: **don't ship the tools, ship the skill that builds them.**

```
 You: "use the ctx-forge skill"
        │
        ▼
 ┌─────────────────────────────────────────────────────┐
 │ 1. AUDIT    detect stack, find introspection seams  │
 │ 2. GENERATE ctx CLI implementing the tool contract  │
 │ 3. VERIFY   golden questions: tool answers must     │
 │             match ground-truth raw exploration      │
 │ 4. INSTALL  ctx CLI + MCP server + AGENTS.md entry  │
 └─────────────────────────────────────────────────────┘
        │
        ▼
 Every future session: navigation is one tool call, not thirty.
```

The generation cost is paid once. The savings compound on every session after.

## Works on any stack

The skill follows a three-tier methodology that does not depend on any framework:

| Tier | What | Requires |
|------|------|----------|
| **0 — Static** | file/module map, dependency graph, symbol index, route/entry-point detection | nothing — any repo |
| **1 — Runtime introspection** | tools that boot the framework's own reflection: Django app registry & ORM meta, Rails reflection, Next.js route tree, FastAPI app inspection | a detected framework |
| **2 — Ask layer** | `ctx ask "how does X work?"` — LLM-backed answers over the generated guides and indexes | an API key (optional) |

`recipes/` contains distilled playbooks for specific frameworks (Django first) that make Tier 1 generation faster and better — but they are accelerators, not requirements. No recipe? The agent derives the seams from the methodology.

## The tool contract

Every generated toolset exposes the same surface, so agents (and anything downstream) can rely on it across projects:

| Command | Purpose |
|---------|---------|
| `ctx map` | repo/module overview |
| `ctx find <pattern> --locate` | semantic find with `file:line` output |
| `ctx flow <topic>` | execution trace across layers |
| `ctx schema` | data models, fields, relationships |
| `ctx api` | endpoints, routes, permissions |
| `ctx impact <target>` | blast-radius analysis before editing |
| `ctx ask <question>` | LLM-backed Q&A over generated guides |
| `ctx regen` | staleness-aware regeneration |
| `ctx selftest` | re-run golden questions |

A `ctx.toml` manifest records the detected stack, generated commands, and a content hash of the introspected surface — so staleness is detected mechanically, not by vibes.

## Verified, not vibes

Agent-generated tooling has an obvious credibility problem: what if the generated `ctx impact` is just wrong?

That is why verification is built into the skill, not optional:

1. During generation, the agent writes golden questions and obtains ground-truth answers by raw exploration.
2. Each generated tool must answer those questions correctly **before** it installs.
3. `ctx selftest` re-runs the suite after every `ctx regen`.
4. Failing tools are regenerated or dropped — never silently installed.

## Why not just use Headroom?

Use both — they sit at different layers and compose.

[Headroom](https://github.com/chopratejas/headroom) compresses context **after** your agent decides to fetch it. It cannot fix a bad retrieval decision; it can only shrink the payload of one. ctx-forge changes what gets fetched in the first place.

```
ctx-forge   reduces the NEED for context   (source layer, proactive)
Headroom    reduces the COST of context    (transport layer, reactive)
```

| | ctx-forge | Headroom |
|---|---|---|
| Layer | what the agent fetches | what gets sent to the LLM |
| Knowledge | your project's actual semantics | generic content-type heuristics |
| Setup | one-time generation + verification | turnkey |
| Conversation history | not touched | compacted |
| Bad navigation (30 greps) | prevented | compressed |

Headroom itself endorses this layering — it bundles RTK and supports pluggable upstream context tools via `HEADROOM_CONTEXT_TOOL`. ctx-forge aims to be the smartest thing you can put in that slot: a project-aware upstream whose output barely needs compressing, while Headroom handles everything else downstream.

```bash
# the full stack
"use the ctx-forge skill"        # once per project
headroom wrap claude             # every session
```

## Proven on a real codebase

The skill was run end-to-end on a production Django 6 control-plane app (20 apps, **140 models**, a 4,000-line gateway view module, DRF + Inertia):

- Generated a 7-command toolset (`map`, `find`, `schema`, `api`, `flow`, `impact`, plus a project-specific `services` command that surfaces every `@service_contract`'s billing/risk/effects metadata) — ~1,100 lines of stdlib-only Python, full rebuild + selftest in ~3s.
- **19/19 golden questions passed**, ground truth derived independently of the tools per [`verify/PROTOCOL.md`](verify/PROTOCOL.md), including adversarial cases: inherited fields anchored to their abstract base, abstract models correctly absent, DRF router routes that appear in no source file.
- **The verification gate caught a real "confident liar."** The first `flow` implementation scanned the whole view *module* and confidently attributed every service call in a 4k-line file to one route — six plausible, wrong hops. The golden question failed, the bug was fixed (AST scoped to the view node), and a `not_contains` matcher now pins it forever. This is the entire point of the verify phase: a tool that lies convincingly is worse than no tool.

The same run surfaced three lessons now codified in the skill and Django recipe: generated tools must pass the host repo's own linter (16 ruff violations blocked a commit), `import django` is not proof you're in the project venv, and `golden.yaml` should use JSON syntax when PyYAML isn't in the lockfile.

## Benchmarks

Same five navigation questions, same codebase (the Django 6 platform above), measured: ctx answer size vs. the bytes raw exploration pulls into an agent's context. Tokens approximated at 4 bytes/token.

| Question | ctx | raw exploration | reduction |
|---|--:|--:|--:|
| Where does wallet logic live? | 44 tok | 3.5k tok (grep fan-out: 175 hits) | 98.8% |
| Full model shape + relations | 150 tok | 4.3k tok (model file + base-class file) | 96.5% |
| Which services are metered/high-risk? | 41 tok | 9.7k tok (whole services.py) | 99.6% |
| Blast radius of editing services.py | 108 tok | 3.2k tok (import grep, unfiltered) | 96.6% |
| Trace route -> view -> service -> contract | 106 tok | 158k tok (urls + 4k-line views + services) | 99.9% |

Every ctx answer: **1 tool call, ~50 ms warm, every fact `file:line`-anchored.** Raw exploration for the same answers is typically 4-8 tool calls each, plus the round-trip latency and the manual cross-file correlation the trace question requires.

Methodology notes, honestly stated: the "raw" baselines assume whole-file reads, which is common naive agent behavior; a careful agent using ranged reads lands somewhere in between — but it still has to *find* the ranges, which is itself a grep + read cycle. The trace row's 158k assumes reading all three files; no ranged read can answer it without first locating the route, the view class, and the service definition. These are navigation-question benchmarks on one real repo, not end-to-end task benchmarks. Reproduce: any generated toolset, `wc -c` on both paths.

And the part a generic compressor cannot replicate at any ratio: the metered/high-risk answer (`risk=high billing=metered requires=idempotency_checked effects=receipt_emitted`) is **project governance metadata** surfaced from the `@service_contract` convention — information an agent reading raw code wouldn't know to look for.

## Compared to

| | Scope | Project-aware | Verified | Stack |
|---|---|:-:|:-:|---|
| **ctx-forge** | generated navigation tools: schema, routes, flows, impact, project conventions | yes — generated per repo, incl. runtime introspection | yes — golden questions, selftest, staleness hash | any (recipes accelerate) |
| [tokenmax-mcp](https://github.com/justinjamesmathew/tokenmax-mcp) | static symbol-level codemap | partial — symbols, not conventions | no | TS/JS only |
| Aider repo-map / IDE semantic search | static ranking of relevant files/symbols | partial | no | any |
| [RTK](https://github.com/rtk-ai/rtk) / [lean-ctx](https://github.com/yvgude/lean-ctx) | rewrite/teach efficient CLI usage | no — generic | no | any |
| [Headroom](https://github.com/chopratejas/headroom) | compress everything in transit; reversible | no — content-type heuristics | n/a | any |

ctx-forge is the only one in this list that (a) knows your project's *conventions* (service contracts, base classes, registries) because it introspects the running framework, and (b) refuses to install a tool it cannot prove correct. It is also the only one that requires a generation step — that is the trade.

## Quickstart

> Status: early. The spec and skill are being built in the open; interfaces below are the target surface.

1. Add the skill to your agent (e.g. clone this repo and point your agent at `SKILL.md`, or drop it into your skills directory).
2. Tell your agent: **"Use the ctx-forge skill to generate context tools for this project."**
3. The agent audits, generates, verifies, and installs. Review the diff — the toolset lives in your repo, readable and yours.
4. Future sessions pick up the tools automatically via MCP and `AGENTS.md`.

## Repo layout

```
ctx-forge/
├── SKILL.md            # the meta-skill: audit -> generate -> verify -> install
├── spec/
│   ├── tool-contract.md  # the standard surface every generated toolset must expose
│   └── ctx-toml.md       # manifest format: stack, generators, staleness hash
├── recipes/
│   └── django.md         # framework playbooks (accelerators, not requirements)
├── mcp-template/         # thin MCP server wrapping the generated ctx CLI
├── verify/               # golden-question protocol + selftest harness
├── headroom/             # HEADROOM_CONTEXT_TOOL integration
└── examples/             # sample project + its generated toolset
```

## Lineage

ctx-forge distills a production-proven internal suite: 30+ `show_*_flow` / `ask_context` Django management commands that replaced exploratory grep with one-call, `file:line`-anchored answers for AI agents working in a large multi-tenant codebase. The Django recipe is that suite, generalized.

## Status & roadmap

- [x] Tool contract spec
- [x] Core skill (generic 3-tier methodology)
- [x] Verification harness (golden-question protocol)
- [x] MCP server template (built + smoke-tested)
- [x] Django recipe
- [x] Headroom integration module (`HEADROOM_CONTEXT_TOOL=ctx-forge`)
- [x] Proven end-to-end on a real Django 6 app (19/19 golden questions)
- [ ] Upstream the Headroom PR
- [ ] Ship a committed `examples/` generated toolset
- [ ] More recipes: Next.js, Rails, FastAPI, Go

## License

Apache 2.0
