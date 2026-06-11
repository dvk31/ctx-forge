# ctx-forge MCP server

Thin MCP wrapper around a generated `ctx` toolset. Reads `.ctx/ctx.toml`, registers each `[commands]` entry as an MCP tool named `ctx_<command>`, and shells out to `./.ctx/ctx` — nothing more, by contract (`spec/tool-contract.md` §7).

Why it exists: prompt discipline ("remember to use ctx!") fails; native tool registration doesn't. With this server installed, `ctx_flow`, `ctx_schema`, etc. appear in the agent's own tool list.

## Build

```bash
npm install
npm run build
```

## Register

The server locates the toolset by walking up from cwd to the nearest `.ctx/ctx.toml`, or via `CTX_REPO_ROOT`.

Cursor (`.cursor/mcp.json` in the target repo):

```json
{
  "mcpServers": {
    "ctx": {
      "command": "node",
      "args": ["/path/to/ctx-forge-mcp/dist/index.js"],
      "env": { "CTX_REPO_ROOT": "${workspaceFolder}" }
    }
  }
}
```

Claude Code:

```bash
claude mcp add ctx -- node /path/to/ctx-forge-mcp/dist/index.js
```

## Behavior

- Each tool takes one optional `args: string[]` passed verbatim to the CLI (`["--json"]`, `["--locate"]`, `["--find", "webhook"]`).
- Exit 2 (stale) -> output is returned prefixed with a `[STALE: ... run ctx regen]` banner.
- Non-zero exit -> MCP error result carrying stderr.
- If `ctx.toml` records a failed selftest, the server warns on startup that the toolset is untrusted.

The tool list is driven entirely by the manifest: regenerating the toolset and restarting the server is all it takes to pick up new commands.
