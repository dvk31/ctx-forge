# Headroom Integration

Goal: `HEADROOM_CONTEXT_TOOL=ctx-forge` — make ctx-forge a first-class selectable context tool in [Headroom](https://github.com/chopratejas/headroom), alongside `rtk` and `lean-ctx`, so `headroom wrap <agent>` injects ctx guidance instead of rtk guidance when a repo has a generated toolset.

Until the upstream PR lands, the combo works today with zero integration: the ctx-forge skill already writes the fenced guidance section into `AGENTS.md`/`CLAUDE.md` at install (skill Phase 5), and Headroom compresses everything downstream regardless of which tool produced it. The PR's value is wrap-time awareness: correct guidance injection for marker-file agents (`.clinerules`, `.goosehints`), no duplicate rtk guidance, and a status line.

## The upstream seam

Headroom already routes context-tool selection through one fork (paths as of the snapshot reviewed, 2026-06):

| Location | What it does |
|---|---|
| `headroom/cli/wrap.py` — `_CONTEXT_TOOL_ENV`, `_VALID_CONTEXT_TOOLS` (~line 94) | Env var + allowed values (`{"rtk", "lean-ctx"}`). |
| `headroom/cli/wrap.py` — `_selected_context_tool()` (~line 166) | Parses/validates `HEADROOM_CONTEXT_TOOL`; rtk is the default. |
| `headroom/cli/wrap.py` — `_setup_context_tool_for_agent()` (~line 1148) | The single rtk-vs-lean-ctx fork every wrap subcommand calls. |
| `headroom/lean_ctx/installer.py` | Reference for a non-rtk tool module (download + `init --agent <agent>`). |

## Proposed diff (sketch)

1. New module `headroom/ctx_forge/__init__.py` — the contents of `ctx_forge_setup.py` in this folder (stdlib-only: detection via `.ctx/ctx.toml` walk-up, trust check from `[verify]`, guidance text, status line).

2. `headroom/cli/wrap.py`:

```python
_CONTEXT_TOOL_CTX_FORGE = "ctx-forge"
_VALID_CONTEXT_TOOLS = {_CONTEXT_TOOL_RTK, _CONTEXT_TOOL_LEAN_CTX, _CONTEXT_TOOL_CTX_FORGE}
```

`_selected_context_tool()`: accept `ctxforge` / `ctx_forge` normalizations the same way `leanctx` is accepted.

`_setup_context_tool_for_agent()`: add the third branch before the rtk default:

```python
if _selected_context_tool() == _CONTEXT_TOOL_CTX_FORGE:
    from headroom import ctx_forge
    toolset = ctx_forge.find_toolset()
    click.echo(f"  {ctx_forge.setup_summary(toolset)}")
    if toolset is not None and on_rtk_ready is not None:
        # Marker-file agents get ctx guidance instead of rtk guidance.
        _inject_ctx_forge_guidance(ctx_forge.guidance_text(toolset), marker_path)
    return None
```

Key behavioral differences from lean-ctx, to call out in the PR:

- **No download.** ctx-forge toolsets are generated into the repo by an agent skill; absence is reported with a pointer, never auto-installed (generation requires an agent, not a curl).
- **Per-repo, not per-user.** lean-ctx `init` writes home-scoped agent config; ctx-forge detection is repo-scoped (`.ctx/` walk-up from cwd). Wrapping in a repo without a toolset degrades gracefully to plain proxy compression.
- **Trust surface.** The recorded selftest verdict gates the guidance tone: an untrusted toolset still surfaces, but with an explicit warning telling the agent to prefer raw exploration. The verdict lives in the gitignored `.ctx/cache/state.json` (so a fresh checkout reads as `never`/untrusted until one `ctx regen`); the manifest's `[verify].last_selftest_result` is honored as a legacy fallback for pre-state-file toolsets.

3. Tests: mirror `tests/test_lean_ctx_installer.py` shape — fixture repo with a minimal `ctx.toml`, assert detection, trust gating, guidance content, and `_selected_context_tool()` acceptance of the three spellings.

## Layering (why both, one paragraph for the PR description)

ctx-forge reduces the *need* for context (project-specific, verified navigation tools — the agent fetches the right 2 KB instead of the raw 30 KB); Headroom reduces the *cost* of whatever is fetched anyway (routing, compression, cache alignment, history compaction). Headroom already ships RTK for exactly this upstream role and supports `lean-ctx` as an alternative; ctx-forge is a third option that is repo-aware rather than generic. Everything downstream of a ctx call — and every session's long tail of raw tool output — remains Headroom's job.

## Status

- [x] Detection/guidance module (`ctx_forge_setup.py`, tested standalone)
- [x] Fork + PR against `chopratejas/headroom` with the wrap.py diff and tests — [chopratejas/headroom#939](https://github.com/chopratejas/headroom/pull/939) (branch `feat/ctx-forge-context-tool` on the `dvk31/headroom` fork; 20 new tests mirroring the lean-ctx suite, ruff clean, README + configuration docs updated)
- [ ] Upstream review
