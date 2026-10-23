import { execFile } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { relative, isAbsolute } from "node:path";
import { promisify } from "node:util";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  GigaChatClient,
  TokenProvider,
  createGigaChatFetch,
  defaultCacheDir,
  loadConfig,
} from "@gigachat-agent/core";
import { envFileCandidates } from "./env-files.js";
import { createHandlers } from "./handlers.js";
import { killActiveRuns, runOpencode } from "./opencode.js";
import { createServer } from "./server.js";

const run = promisify(execFile);

function loadEnvFiles(): void {
  for (const file of envFileCandidates(process.env, homedir())) {
    try {
      process.loadEnvFile(file);
    } catch {
      // file is optional
    }
  }
}

async function readInsideRoot(root: string, path: string): Promise<string> {
  const [realRoot, realFile] = await Promise.all([realpath(root), realpath(path)]);
  const rel = relative(realRoot, realFile);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`Path resolves outside the allowed root: ${path}`);
  }
  return readFile(realFile, "utf8");
}

async function main(): Promise<void> {
  loadEnvFiles();
  const root = process.cwd();
  const cacheDir = defaultCacheDir(process.env);

  // Built lazily so tools that do not need GigaChat work without credentials.
  let client: GigaChatClient | undefined;
  const getClient = async (): Promise<GigaChatClient> => {
    if (client) return client;
    const config = loadConfig(process.env);
    const fetchImpl = await createGigaChatFetch(config);
    const tokens = new TokenProvider({
      credentials: config.credentials,
      scope: config.scope,
      cacheDir,
      fetch: fetchImpl,
      ...(config.authUrl ? { authUrl: config.authUrl } : {}),
    });
    client = new GigaChatClient({
      tokens,
      fetch: fetchImpl,
      ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
    });
    return client;
  };

  const handlers = createHandlers({
    client: {
      chat: async (request) => (await getClient()).chat(request),
      listModels: async () => (await getClient()).listModels(),
    },
    runOpencode,
    listOpencodeModels: async () => {
      const { stdout } = await run("opencode", ["models"], { timeout: 20_000 });
      return stdout.split("\n").filter(Boolean);
    },
    readFile: (path) => readInsideRoot(root, path),
    root,
    agentModel: process.env["GIGACHAT_AGENT_MODEL"] ?? "GigaChat (Sberbank)/GigaChat",
  });

  const server = createServer(handlers);
  await server.connect(new StdioServerTransport());
  const shutdown = (): never => {
    killActiveRuns();
    process.exit(0);
  };
  process.stdin.on("close", shutdown);
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
