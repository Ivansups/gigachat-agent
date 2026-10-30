import { spawn as nodeSpawn } from "node:child_process";
import type { EventEmitter } from "node:events";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { parseOpencodeEvents } from "../../../packages/mcp/src/events.js";

interface Rule {
  action: string;
  resource: string;
  effect: "allow" | "deny" | "ask";
}

const FIX_PLUGIN_DIR = fileURLToPath(new URL("../", import.meta.url));

/** OpenCode 2 uses ordered permissions and the shell action (formerly bash). */
export const READ_ONLY_CONFIG = {
  plugins: [FIX_PLUGIN_DIR],
  permissions: ["edit", "write", "shell", "bash", "execute"].map((action): Rule => ({ action, resource: "*", effect: "deny" })),
  policies: ["edit", "write", "shell", "bash", "execute"].map((action) => ({ action: "tool.use", resource: `${action}:*`, effect: "deny" })),
};

const KILL_GRACE_MS = 2000;
const DEFAULT_MAX_OUTPUT_CHARS = 20_000;
const MAX_CAPTURE_CHARS = 5_000_000;
const STDERR_TAIL_CHARS = 2000;

export interface OpencodeRunOptions {
  prompt: string;
  /** `provider/model`, e.g. `GigaChat (Sberbank)/GigaChat`. */
  model: string;
  cwd: string;
  timeoutMs: number;
  sessionId?: string;
  agent?: string;
  allowWrite?: boolean;
  signal?: AbortSignal;
  maxOutputChars?: number;
}

export interface OpencodeRunResult {
  text: string;
  sessionId?: string | undefined;
  exitCode: number | null;
  timedOut?: boolean;
  error?: string;
  truncated?: boolean;
}

export interface ChildLike extends EventEmitter {
  stdout: Readable | null;
  stderr: Readable | null;
  kill(signal?: NodeJS.Signals): boolean;
}

export type SpawnLike = (
  command: string,
  args: string[],
  options: { cwd: string; env: Record<string, string | undefined>; stdio: ["ignore", "pipe", "pipe"] },
) => ChildLike;

interface RunDeps {
  spawn?: SpawnLike;
  env?: Record<string, string | undefined>;
}

/** Preserve operator configuration while appending mandatory restrictions. Policies
 * also enforce denies after agent-specific permissions, which may override globals.
 */
export function buildRunEnv(base: Record<string, string | undefined>, allowWrite: boolean, cwd: string): Record<string, string | undefined> {
  let existing: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(base["OPENCODE_CONFIG_CONTENT"] ?? "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) existing = parsed as Record<string, unknown>;
  } catch {
    // Malformed inline configuration cannot bypass the restrictions below.
  }
  const permissions: Rule[] = allowWrite
    ? ["edit", "write"].map((action) => ({ action, resource: "*", effect: "allow" }))
    : [...READ_ONLY_CONFIG.permissions];
  if (allowWrite) permissions.push({ action: "execute", resource: "*", effect: "deny" });
  const denied = allowWrite ? ["execute"] : ["edit", "write"];
  if (allowWrite && base["GIGACHAT_ALLOW_BASH"] !== "1") {
    permissions.push(...["shell", "bash"].map((action): Rule => ({ action, resource: "*", effect: "deny" })));
  }
  if (!allowWrite || base["GIGACHAT_ALLOW_BASH"] !== "1") denied.push("shell", "bash");
  if (!allowWrite) denied.push("execute");
  const policies = denied.map((action) => ({ action: "tool.use", resource: `${action}:*`, effect: "deny" }));
  // The legacy permission map must not be migrated after our native rules.
  delete existing["permission"];
  return {
    ...base,
    // v2 reads PWD before process.cwd(); a spawn cwd alone is insufficient.
    PWD: cwd,
    // The v2 adapter also enforces these in its permission hook, independently
    // of operator/agent configuration precedence.
    GIGACHAT_OPENCODE_NATIVE_TOOLS: "1",
    GIGACHAT_OPENCODE_READ_ONLY: allowWrite ? "0" : "1",
    GIGACHAT_OPENCODE_DENY_SHELL: !allowWrite || base["GIGACHAT_ALLOW_BASH"] !== "1" ? "1" : "0",
    OPENCODE_CONFIG_CONTENT: JSON.stringify({
      ...existing,
      // Always load the guard, including when the caller selects another provider.
      plugins: [...(Array.isArray(existing["plugins"]) ? existing["plugins"] : []), FIX_PLUGIN_DIR],
      permissions: [...(Array.isArray(existing["permissions"]) ? existing["permissions"] : []), ...permissions],
      policies: [...(Array.isArray(existing["policies"]) ? existing["policies"] : []), ...policies],
    }),
  };
}

/** Only native completed tool events count, never the model's prose. */
export function completedFileEdits(stdout: string): number {
  let count = 0;
  for (const line of stdout.split("\n")) {
    try {
      const event = JSON.parse(line) as { type?: string; part?: { tool?: string; state?: { status?: string } } };
      if (event.type === "tool_use" && ["edit", "write", "patch"].includes(event.part?.tool ?? "") &&
          event.part?.state?.status === "completed") count++;
    } catch { /* Ignore non-JSON CLI output. */ }
  }
  return count;
}

const activeRuns = new Set<ChildLike>();

/** Terminates every running `opencode` child; called when the MCP server shuts down. */
export function killActiveRuns(): void {
  for (const child of activeRuns) child.kill("SIGTERM");
}

/** Runs one `opencode run` subprocess to completion; nothing outlives the call. */
export function runOpencode(options: OpencodeRunOptions, deps: RunDeps = {}): Promise<OpencodeRunResult> {
  const spawn = deps.spawn ?? (nodeSpawn as unknown as SpawnLike);
  const args = [
    "run",
    "--standalone",
    "--format",
    "json",
    "--model",
    options.model,
    ...(options.agent ? ["--agent", options.agent] : []),
    ...(options.sessionId ? ["--session", options.sessionId] : []),
    "--",
    options.prompt,
  ];
  const env = buildRunEnv(deps.env ?? process.env, options.allowWrite === true, options.cwd);
  const maxOutput = options.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS;

  return new Promise((resolve) => {
    const child = spawn("opencode", args, { cwd: options.cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    activeRuns.add(child);
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let aborted = false;
    let killTimer: NodeJS.Timeout | undefined;

    child.stdout?.on("data", (chunk: Buffer | string) => {
      if (stdout.length < MAX_CAPTURE_CHARS) stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr = (stderr + chunk.toString()).slice(-STDERR_TAIL_CHARS);
    });

    const terminate = (): void => {
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS);
      killTimer.unref();
    };
    const timer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, options.timeoutMs);
    const onAbort = (): void => {
      aborted = true;
      terminate();
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });
    if (options.signal?.aborted) onAbort();

    const finish = (result: OpencodeRunResult): void => {
      activeRuns.delete(child);
      clearTimeout(timer);
      clearTimeout(killTimer);
      options.signal?.removeEventListener("abort", onAbort);
      resolve(result);
    };

    child.on("error", (error: Error) => {
      finish({ text: "", exitCode: null, error: `Failed to start opencode: ${error.message}` });
    });
    child.on("close", (code: number | null) => {
      const parsed = parseOpencodeEvents(stdout);
      const truncated = parsed.text.length > maxOutput;
      const result: OpencodeRunResult = {
        text: truncated ? parsed.text.slice(0, maxOutput) : parsed.text,
        sessionId: parsed.sessionId,
        exitCode: code,
        ...(truncated ? { truncated } : {}),
      };
      if (timedOut) result.timedOut = true;
      else if (aborted) result.error = "opencode run was cancelled";
      else if (parsed.error) result.error = parsed.error;
      else if (code !== 0) result.error = `opencode exited with code ${code}: ${stderr.trim()}`;
      if (!result.error && !timedOut && options.allowWrite === true && completedFileEdits(stdout) === 0) {
        result.error = "No file edit was confirmed: OpenCode did not complete an edit/write/patch tool call. The model's text is not proof of a file change. For a read-only task use allow_write: false.";
      }
      finish(result);
    });
  });
}
