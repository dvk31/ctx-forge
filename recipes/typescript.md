# Recipe: TypeScript / Node

Status: v0.1 draft · Applies to TS 4.x–5.x, Node 18+ · Written from the contract plus an audit of three production TS packages (a CLI, a zod-based schema compiler, an MCP server) in a pnpm monorepo. **Validation pending**: unlike the Django recipe, this one has not yet survived a full generate-and-verify run — expect revision after the first dogfooded toolset, and trust the protocol over this document wherever they disagree.

A recipe accelerates Phase 1–3 of the skill: known-good introspection seams, canonical command names, implementation techniques, pitfalls. It does not override the contract or the protocol.

## 1. Boot strategy (read this first)

TypeScript's analog of Django's live registry is the **compiler API**. `typescript` is in virtually every TS project's lockfile (always as a devDependency — that satisfies the no-new-deps rule, since generated tools are dev tooling), and a `ts.Program` + type checker resolves what regex never will: re-exports, path aliases, declaration merging, workspace imports.

```js
// .ctx/tools/_lib.mjs — tools are plain Node ESM, no transpile step
import ts from "typescript"; // the project's own copy

const configPath = ts.findConfigFile(ROOT, ts.sys.fileExists, "tsconfig.json");
const config = ts.parseJsonConfigFileContent(
  ts.readConfigFile(configPath, ts.sys.readFile).config, ts.sys, ROOT);
const program = ts.createProgram(config.fileNames, config.options);
const checker = program.getTypeChecker();
```

Rules:

- **Write tools as `.mjs`** (plain JavaScript, ESM). They run under the project's Node with zero setup — no tsx/ts-node dependency, works in both `"type": "module"` and CJS packages. Do not write the tools themselves in TypeScript unless the lockfile already carries a zero-config runner.
- Program creation is the cold path (1–5 s on a mid-sized package). Boot once per regen, serialize to `.ctx/cache/*.json` keyed by the surface hash; warm reads must be instant (contract §3.7). Mark these commands `boots_framework = true`.
- Anchors come from declarations: `symbol.getDeclarations()[0]` -> `getSourceFile()` + `getLineAndCharacterOfPosition()` (+1 for 1-based lines). For aliased/re-exported symbols, `checker.getAliasedSymbol(sym)` jumps to the original — this one call is the whole barrel-file problem solved.
- No execution of project code is needed for any of this — the compiler API is import-only and side-effect-free, so there is nothing to ask the user about booting (Phase 2's boot-approval rule mostly does not apply to TS).

## 2. Seams -> commands

| Contract command | Seam | Technique |
|---|---|---|
| `ctx map` | `package.json` + workspace manifest + tsconfig | Per package: name, entry points (`main`/`exports`/`bin`), source root, exported-symbol count, one-line responsibility (package.json `description`). Monorepo: read `pnpm-workspace.yaml` / `workspaces` globs for the package list. |
| `ctx find` | checker symbol index | One index over every **exported** symbol: kind (function/class/interface/type/const/enum), name, anchor. Include CLI subcommands, MCP tool names, route paths as their own kinds (see `api`). Resolve aliases so the anchor is the defining file, never a barrel. |
| `ctx schema` | exported types + runtime validators | TS data shapes live in two layers: type-space (interfaces/type aliases) and runtime validators (zod/valibot/io-ts `z.object({...})` consts — walk exported consts whose initializer is a `z.*` call chain). Surface both, mark which is runtime-validated; anchor each field to its property line. The validator layer is the one agents actually need — it carries `.refine`/`.transform`/`.strict` behavior invisible in the inferred type. |
| `ctx api` | whatever the package exposes externally | Framework-dependent, derived in the audit: Express/Fastify `app.<method>(path, handler)` call sites; Next.js file-convention routes (the filesystem IS the route table); MCP servers: `registerTool`/`server.tool` call sites (name arg + handler anchor); CLI packages: the subcommand surface (see pitfall 6). |
| `ctx flow` | entry -> handler -> calls, via AST | From an entry (CLI command, route, tool registration) scope to the handler body and list called project functions with anchors. Same module-scope discipline as the Django recipe: attribute calls to the handler node, never the whole file. |
| `ctx impact` | module graph via the compiler's own resolution | Build edges with `ts.resolveModuleName` (honors tsconfig `paths`, `package.json` `exports` maps, workspace symlinks) — never join path strings yourself. Edge forms: static `import`, `export ... from` re-exports, dynamic `import()`, `require()` in `.cts`. Tag `import type` edges as type-only and include them (a type change has a type-radius). Affected tests = importers matching the project's test glob. |

### Stack-specific commands (generate when present)

| Command | Seam | Notes |
|---|---|---|
| `ctx exports` | checker `getExportsOfModule` on each package entry | The package's public API as a flat, diffable list. The first thing an agent needs before changing a shared package. |
| `ctx deps` | workspace import graph | Package-level edges (`@scope/a` -> `@scope/b`) with the importing files. Answers "what breaks downstream" one level above `impact`. |
| `ctx tools` | MCP `registerTool` call sites | For MCP-server packages: tool name, input schema (zod), handler anchor. |
| `ctx routes` | file conventions | For Next.js/Remix-style apps: resolved route table from the filesystem conventions, with page/layout/handler anchors. |

## 3. Surface globs (starting point)

```toml
[surface]
globs = [
  "src/**/*.ts", "src/**/*.tsx", "src/**/*.mts", "src/**/*.cts",
  "package.json", "tsconfig*.json",
]
exclude = [
  "**/dist/**", "**/build/**", "**/node_modules/**", "**/*.d.ts",
  "**/coverage/**", "**/.next/**", "**/.turbo/**", "**/__tests__/**",
  "**/*.test.ts", "**/*.spec.ts", ".ctx/**",
]
```

`*.d.ts` exclusion is load-bearing: emitted declarations duplicate every symbol with a second, wrong anchor (pitfall 3). Hand-written ambient declarations (`src/**/*.d.ts` committed as source) can be re-included explicitly if the audit finds them.

## 4. Output patterns

Same conventions that earned their keep in the Django suite: `--find` on every listing command with the match list as default output; `--locate` -> `path:line:name`; guides regenerated wholesale from `--json`; a short decision matrix at the top of each guide. See the contract §3 for the budget and determinism rules.

## 5. Pitfalls (write the goldens before the tools)

1. **Barrel files lie to grep.** `export * from "./client"` makes every symbol "appear" in `index.ts`. Anchors MUST point at the defining file: resolve through `getAliasedSymbol`. Golden-question this with a symbol that is only reachable through a barrel, plus a `not_contains` on the barrel path.
2. **Path aliases and workspace names defeat naive resolution.** `@scope/pkg` and tsconfig `paths` entries do not exist on disk where a string-join puts them. Use `ts.resolveModuleName` with the package's own parsed config — `impact` is a confident liar without it (the Django recipe's pitfall 12 has the same shape: the import forms you forgot to resolve report 0 importers).
3. **Emitted output shadows source.** `dist/` and `*.d.ts` carry every exported symbol at the wrong anchor. Exclude them from the surface; golden a `not_contains` for a `dist/` path.
4. **Default exports have no stable name.** `import Whatever from "./x"` — the local name is arbitrary. Index as `<module>.default`, and have `impact` report importer-side local names rather than pretending they match.
5. **Dynamic `import()` and plugin loops register things invisibly.** List dynamically imported modules as "possible" edges, honest about limits — same posture as Django's `getattr`/signals honesty rule.
6. **CLI command surfaces are often hand-rolled.** No commander/yargs registry to read — real CLIs dispatch via `if (command === "init")` chains on an argv variable. Derive the command table from string-literal comparisons (and `case` clauses) against the dispatch variable in the entry module's AST. Observed in a production CLI: 15+ subcommands, zero framework, the literal chain was the only truth.
7. **Type-only edges are real edges.** `import type` importers break on type changes and survive runtime changes. Tag, don't drop.
8. **ESM/CJS duality.** `"type": "module"` changes what `require` means and which extensions resolve. Detect it per package; write tools as `.mjs` so they are immune.
9. **Zod (or sibling) schemas are the de-facto data model.** A modern TS service's truth is `z.object(...)`, not the interface next to it. `schema` must surface validator consts as first-class models — the inferred-type-only view misses runtime refinements (and is exactly the hand-wavy answer the protocol exists to catch).
10. **Monorepos multiply everything.** One `.ctx/` per package vs one umbrella at the workspace root with `--pkg` scoping is a Phase 0 user question. Umbrella wins when packages are small and cross-import heavily (the audit's `deps` graph tells you); per-package wins when teams own packages separately.
11. **The project's linter will lint `.ctx/` — and hooks may skip what CI checks.** eslint/biome configs usually scope `**/*` and CI runs whole-tree; a staged-paths pre-commit hook can pass while CI fails. Lint `.ctx/` with the project's own config after every tool edit (generalized from the Django recipe's pitfall 9, observed twice).
12. **The compiler version belongs to the project.** Import `typescript` from the project's `node_modules`, never a global. A version-mismatched compiler parses new syntax wrong silently — record the version in `ctx.toml` `[project]` and re-check at regen.

## 6. Golden questions to include (adversarial set)

- A symbol re-exported through one or more barrels — `find` anchors to the defining file (`not_contains` the barrel).
- An MCP tool / route / CLI subcommand that exists only as a call site or string literal — `api`/`tools` must list it; it appears in no registry.
- `impact` through a tsconfig path alias or workspace package import — the importer uses the alias form, the answer anchors the real file.
- An `import type`-only consumer — present in `impact` output, marked type-only.
- A zod schema with a `.refine`/`.transform` — `schema` shows the validator, not just the inferred type.
- `not_contains`: any symbol anchored into `dist/` or a `.d.ts`.

## 7. What not to build (v1)

Bundle-size analysis, circular-dependency audits, dead-code detection, lint-rule duplicates, coverage maps. Real, but they are *audits*, not navigation — different cadence, different consumer. `[dropped]` and later regens exist precisely so the toolset can grow with demand.
