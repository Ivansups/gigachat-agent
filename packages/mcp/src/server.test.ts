import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let outDir: string;
let entry: string;

beforeAll(async () => {
  // Built inside the package so externals resolve from its node_modules.
  const buildRoot = fileURLToPath(new URL("../.test-build", import.meta.url));
  await mkdir(buildRoot, { recursive: true });
  outDir = await mkdtemp(join(buildRoot, "run-"));
  entry = join(outDir, "cli.mjs");
  await build({
    entryPoints: [fileURLToPath(new URL("./cli.ts", import.meta.url))],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: entry,
    external: ["undici", "@modelcontextprotocol/sdk", "zod"],
    logLevel: "silent",
  });
});

afterAll(async () => {
  await rm(outDir, { recursive: true, force: true });
});

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("stdio MCP server", () => {
  it("exposes the four tools plus list_models and exits when the client disconnects", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "gigachat-mcp-cache-"));
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [entry],
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      env: { ...process.env, GIGACHAT_CREDENTIALS: "ZHVtbXk=", GIGACHAT_CACHE_DIR: cacheDir } as Record<string, string>,
    });
    const client = new Client({ name: "test", version: "0.0.0" });

    await client.connect(transport);
    const pid = transport.pid;
    const { tools } = await client.listTools();

    expect(tools.map((t) => t.name).sort()).toEqual(["ask", "continue_session", "list_models", "run_agent"]);
    expect(typeof pid).toBe("number");

    await client.close();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(isAlive(pid as number)).toBe(false);
    await rm(cacheDir, { recursive: true, force: true });
  });
});
