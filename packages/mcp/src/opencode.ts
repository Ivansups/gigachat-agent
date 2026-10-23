import { spawn as nodeSpawn } from "node:child_process";
import type { EventEmitter } from "node:events";
import type { Readable } from "node:stream";
import { parseOpencodeEvents } from "./events.js";

/** Denies file edits and shell access for a run; opencode reads this from OPENCODE_CONFIG_CONTENT. */
export const READ_ONLY_CONFIG = {
  permission: { edit: "deny", write: "deny", bash: "deny" },
} as const;

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
  options: { env: Record<string, string | undefined>; stdio: ["ignore", "pipe", "pipe"] },
) => ChildLike;

interface RunDeps {
  spawn?: SpawnLike;
  env?: Record<string, string | undefined>;
}

/**
 * Read-only denies edit, write and bash. Write mode allows edits but keeps bash denied
 * unless the operator opts in with GIGACHAT_ALLOW_BASH=1; the model-controlled flag alone
 * never grants a shell.
 */
function permissionsFor(base: Record<string, string | undefined>, allowWrite: boolean): Record<string, string> {
  if (!allowWrite) return { ...READ_ONLY_CONFIG.permission };
  return {
    edit: "allow",
    write: "allow",
    ...(base["GIGACHAT_ALLOW_BASH"] === "1" ? {} : { bash: "deny" }),
  };
}

function buildEnv(base: Record<string, string | undefined>, allowWrite: boolean): Record<string, string | undefined> {
  let existing: Record<string, unknown> = {};
  try {
    existing = JSON.parse(base["OPENCODE_CONFIG_CONTENT"] ?? "{}") as Record<string, unknown>;
  } catch {
    // ignore malformed user config; the permission rules below still apply
  }
  const permission = { ...((existing["permission"] as object | undefined) ?? {}), ...permissionsFor(base, allowWrite) };
  return { ...base, OPENCODE_CONFIG_CONTENT: JSON.stringify({ ...existing, permission }) };
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
    "--format",
    "json",
    "--model",
    options.model,
    "--dir",
    options.cwd,
    ...(options.agent ? ["--agent", options.agent] : []),
    ...(options.sessionId ? ["--session", options.sessionId] : []),
    "--",
    options.prompt,
  ];
  const env = buildEnv(deps.env ?? process.env, options.allowWrite === true);
  const maxOutput = options.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS;

  return new Promise((resolve) => {
    const child = spawn("opencode", args, { env, stdio: ["ignore", "pipe", "pipe"] });
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
      finish(result);
    });
  });
}
