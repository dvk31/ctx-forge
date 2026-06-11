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

- [ ] Tool contract spec
- [ ] Core skill (generic 3-tier methodology)
- [ ] Verification harness
- [ ] MCP server template
- [ ] Django recipe
- [ ] Headroom integration (`HEADROOM_CONTEXT_TOOL=ctx-forge`)
- [ ] Example: end-to-end generated toolset on a sample project
- [ ] More recipes: Next.js, Rails, FastAPI, Go

## License

Apache 2.0
