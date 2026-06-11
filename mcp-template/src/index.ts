#!/usr/bin/env node
/**
 * ctx-forge MCP server.
 *
 * Thin by contract (tool-contract.md §7): reads .ctx/ctx.toml, registers one
 * MCP tool per installed command as `ctx_<name>`, and shells out to the
 * generated `ctx` entrypoint. No behavior beyond transport.
 */

import { execFile } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse as parseToml } from "smol-toml";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const EXEC_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

interface CommandEntry {
  description?: string;
  tier?: number;
  boots_framework?: boolean;
}

interface CtxManifest {
  ctx?: { contract_version?: string };
  commands?: Record<string, CommandEntry>;
  verify?: { last_selftest_result?: string };
}

function findRepoRoot(): string {
  const explicit = process.env.CTX_REPO_ROOT;
  if (explicit) {
    const root = resolve(explicit);
    if (!existsSync(join(root, ".ctx", "ctx.toml"))) {
      fail(`CTX_REPO_ROOT=${root} has no .ctx/ctx.toml`);
    }
    return root;
  }
  // Walk up from cwd to the nearest directory containing .ctx/ctx.toml.
  let dir = process.cwd();
  for (;;) {
    if (existsSync(join(dir, ".ctx", "ctx.toml"))) return dir;
    const parent = resolve(dir, "..");
    if (parent === dir) {
      fail(
        "No .ctx/ctx.toml found from cwd upward. Run inside a repo with a " +
          "ctx-forge toolset, or set CTX_REPO_ROOT."
      );
    }
    dir = parent;
  }
}

function fail(message: string): never {
  console.error(`ctx-forge-mcp: ${message}`);
  process.exit(1);
}

function loadManifest(repoRoot: string): CtxManifest {
  const raw = readFileSync(join(repoRoot, ".ctx", "ctx.toml"), "utf8");
  return parseToml(raw) as CtxManifest;
}

function runCtx(
  repoRoot: string,
  command: string,
  args: string[]
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolvePromise) => {
    const entrypoint = join(repoRoot, ".ctx", "ctx");
    execFile(
      entrypoint,
      [command, ...args],
      {
        cwd: repoRoot,
        timeout: EXEC_TIMEOUT_MS,
        maxBuffer: MAX_OUTPUT_BYTES,
        env: process.env,
      },
      (error, stdout, stderr) => {
        const code =
          error && typeof (error as NodeJS.ErrnoException & { code?: unknown }).code === "number"
            ? ((error as unknown as { code: number }).code as number)
            : error
              ? 1
              : 0;
        resolvePromise({ stdout: stdout ?? "", stderr: stderr ?? "", code });
      }
    );
  });
}

async function main(): Promise<void> {
  const repoRoot = findRepoRoot();
  const manifest = loadManifest(repoRoot);
  const commands = manifest.commands ?? {};

  if (Object.keys(commands).length === 0) {
    fail("ctx.toml has no [commands] entries; nothing to expose.");
  }

  const server = new McpServer({ name: "ctx-forge", version: "0.1.0" });

  for (const [name, entry] of Object.entries(commands)) {
    const description = [
      entry.description ?? `ctx ${name}`,
      "Output is file:line anchored.",
      entry.boots_framework ? "Cold start may be slow (boots the framework)." : "",
      "Pass extra CLI flags via `args` (e.g. [\"--json\"], [\"--locate\"], [\"--full\"]).",
    ]
      .filter(Boolean)
      .join(" ");

    server.registerTool(
      `ctx_${name}`,
      {
        description,
        inputSchema: {
          args: z
            .array(z.string())
            .optional()
            .describe("Arguments and flags passed verbatim to the ctx command"),
        },
      },
      async ({ args }) => {
        const { stdout, stderr, code } = await runCtx(repoRoot, name, args ?? []);

        if (code === 2) {
          // Contract §4: stale toolset. Surface the answer plus the fix.
          return {
            content: [
              {
                type: "text" as const,
                text:
                  `[STALE: toolset index is out of date — run \`ctx regen\`]\n\n` +
                  stdout,
              },
            ],
          };
        }
        if (code !== 0) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: `ctx ${name} exited ${code}\n${stderr || stdout}`,
              },
            ],
          };
        }
        return { content: [{ type: "text" as const, text: stdout }] };
      }
    );
  }

  // Selftest health is worth a warning at startup, not a hard failure:
  // agents should know the toolset is currently untrusted.
  if (manifest.verify?.last_selftest_result === "fail") {
    console.error(
      "ctx-forge-mcp: WARNING — last selftest FAILED; toolset is untrusted. " +
        "Prefer raw exploration and run `ctx regen`."
    );
  }

  await server.connect(new StdioServerTransport());
}

main().catch((error) => fail(String(error)));
