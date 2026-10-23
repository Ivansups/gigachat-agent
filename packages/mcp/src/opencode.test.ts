import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { READ_ONLY_CONFIG, killActiveRuns, runOpencode, type SpawnLike } from "./opencode.js";

class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  killed = false;
  kill = vi.fn((_signal?: string) => {
    this.killed = true;
    queueMicrotask(() => this.emit("close", null, "SIGTERM"));
    return true;
  });
  finish(code = 0): void {
    this.stdout.end();
    this.stderr.end();
    setImmediate(() => this.emit("close", code, null));
  }
}

function setup(): { child: FakeChild; spawn: ReturnType<typeof vi.fn> } {
  const child = new FakeChild();
  return { child, spawn: vi.fn(() => child) };
}

const event = (value: unknown): string => `${JSON.stringify(value)}\n`;

describe("runOpencode", () => {
  it("runs `opencode run --format json` with model, dir and prompt", async () => {
    const { child, spawn } = setup();
    const promise = runOpencode(
      { prompt: "review", model: "GigaChat (Sberbank)/GigaChat", cwd: "/work", timeoutMs: 5000 },
      { spawn: spawn as unknown as SpawnLike, env: {} },
    );
    child.stdout.write(event({ type: "text", sessionID: "ses_9", part: { text: "done" } }));
    child.finish(0);

    const result = await promise;

    const [command, args] = spawn.mock.calls[0] as unknown as [string, string[]];
    expect(command).toBe("opencode");
    expect(args).toEqual(
      expect.arrayContaining(["run", "--format", "json", "--model", "GigaChat (Sberbank)/GigaChat", "--dir", "/work"]),
    );
    expect(args.at(-1)).toBe("review");
    expect(result).toMatchObject({ text: "done", sessionId: "ses_9" });
  });

  it("denies edit, write and bash by default and never uses --auto", async () => {
    const { child, spawn } = setup();
    const promise = runOpencode(
      { prompt: "p", model: "m/x", cwd: "/w", timeoutMs: 5000 },
      { spawn: spawn as unknown as SpawnLike, env: {} },
    );
    child.finish(0);
    await promise;

    const [, args, options] = spawn.mock.calls[0] as unknown as [string, string[], { env: Record<string, string> }];
    expect(args).not.toContain("--auto");
    expect(JSON.parse(options.env["OPENCODE_CONFIG_CONTENT"] ?? "{}")).toEqual(READ_ONLY_CONFIG);
    expect(READ_ONLY_CONFIG.permission).toMatchObject({ edit: "deny", write: "deny", bash: "deny" });
  });

  it("allows edits but still denies bash when writing is requested", async () => {
    const { child, spawn } = setup();
    const promise = runOpencode(
      { prompt: "p", model: "m/x", cwd: "/w", timeoutMs: 5000, allowWrite: true },
      { spawn: spawn as unknown as SpawnLike, env: {} },
    );
    child.finish(0);
    await promise;

    const [, args, options] = spawn.mock.calls[0] as unknown as [string, string[], { env: Record<string, string> }];
    const config = JSON.parse(options.env["OPENCODE_CONFIG_CONTENT"] ?? "{}") as { permission: Record<string, string> };
    expect(args).not.toContain("--auto");
    expect(config.permission).toMatchObject({ edit: "allow", write: "allow", bash: "deny" });
  });

  it("grants bash only with an operator opt-in from the environment", async () => {
    const { child, spawn } = setup();
    const promise = runOpencode(
      { prompt: "p", model: "m/x", cwd: "/w", timeoutMs: 5000, allowWrite: true },
      { spawn: spawn as unknown as SpawnLike, env: { GIGACHAT_ALLOW_BASH: "1" } },
    );
    child.finish(0);
    await promise;

    const [, , options] = spawn.mock.calls[0] as unknown as [string, string[], { env: Record<string, string> }];
    const config = JSON.parse(options.env["OPENCODE_CONFIG_CONTENT"] ?? "{}") as { permission: Record<string, string> };
    expect(config.permission["bash"]).toBeUndefined();
  });

  it("ignores the bash opt-in for read-only runs", async () => {
    const { child, spawn } = setup();
    const promise = runOpencode(
      { prompt: "p", model: "m/x", cwd: "/w", timeoutMs: 5000 },
      { spawn: spawn as unknown as SpawnLike, env: { GIGACHAT_ALLOW_BASH: "1" } },
    );
    child.finish(0);
    await promise;

    const [, , options] = spawn.mock.calls[0] as unknown as [string, string[], { env: Record<string, string> }];
    const config = JSON.parse(options.env["OPENCODE_CONFIG_CONTENT"] ?? "{}") as { permission: Record<string, string> };
    expect(config.permission).toMatchObject({ edit: "deny", write: "deny", bash: "deny" });
  });

  it("continues an existing session", async () => {
    const { child, spawn } = setup();
    const promise = runOpencode(
      { prompt: "more", model: "m/x", cwd: "/w", timeoutMs: 5000, sessionId: "ses_5" },
      { spawn: spawn as unknown as SpawnLike, env: {} },
    );
    child.finish(0);
    await promise;

    const [, args] = spawn.mock.calls[0] as unknown as [string, string[]];
    expect(args).toEqual(expect.arrayContaining(["--session", "ses_5"]));
  });

  it("kills the process and reports a timeout with partial output", async () => {
    vi.useFakeTimers();
    try {
      const { child, spawn } = setup();
      const promise = runOpencode(
        { prompt: "slow", model: "m/x", cwd: "/w", timeoutMs: 1000 },
        { spawn: spawn as unknown as SpawnLike, env: {} },
      );
      child.stdout.write(event({ type: "text", sessionID: "ses_1", part: { text: "partial" } }));

      await vi.advanceTimersByTimeAsync(1500);
      const result = await promise;

      expect(child.kill).toHaveBeenCalled();
      expect(result.timedOut).toBe(true);
      expect(result.text).toBe("partial");
    } finally {
      vi.useRealTimers();
    }
  });

  it("kills the process when the caller aborts", async () => {
    const { child, spawn } = setup();
    const controller = new AbortController();
    const promise = runOpencode(
      { prompt: "p", model: "m/x", cwd: "/w", timeoutMs: 60_000, signal: controller.signal },
      { spawn: spawn as unknown as SpawnLike, env: {} },
    );

    controller.abort();
    await promise;

    expect(child.kill).toHaveBeenCalled();
  });

  it("terminates every running child when the server shuts down", async () => {
    const first = setup();
    const second = setup();
    const a = runOpencode(
      { prompt: "a", model: "m/x", cwd: "/w", timeoutMs: 60_000 },
      { spawn: first.spawn as unknown as SpawnLike, env: {} },
    );
    const b = runOpencode(
      { prompt: "b", model: "m/x", cwd: "/w", timeoutMs: 60_000 },
      { spawn: second.spawn as unknown as SpawnLike, env: {} },
    );

    killActiveRuns();
    await Promise.all([a, b]);

    expect(first.child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(second.child.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("does not kill children that already finished", async () => {
    const { child, spawn } = setup();
    const promise = runOpencode(
      { prompt: "p", model: "m/x", cwd: "/w", timeoutMs: 5000 },
      { spawn: spawn as unknown as SpawnLike, env: {} },
    );
    child.finish(0);
    await promise;

    killActiveRuns();

    expect(child.kill).not.toHaveBeenCalled();
  });

  it("reports a failed run with the stderr tail", async () => {
    const { child, spawn } = setup();
    const promise = runOpencode(
      { prompt: "p", model: "m/x", cwd: "/w", timeoutMs: 5000 },
      { spawn: spawn as unknown as SpawnLike, env: {} },
    );
    child.stderr.write("provider exploded");
    child.finish(1);

    const result = await promise;

    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("provider exploded");
  });

  it("truncates very long output", async () => {
    const { child, spawn } = setup();
    const promise = runOpencode(
      { prompt: "p", model: "m/x", cwd: "/w", timeoutMs: 5000, maxOutputChars: 20 },
      { spawn: spawn as unknown as SpawnLike, env: {} },
    );
    child.stdout.write(event({ type: "text", sessionID: "s", part: { text: "x".repeat(200) } }));
    child.finish(0);

    const result = await promise;

    expect(result.truncated).toBe(true);
    expect(result.text.length).toBeLessThanOrEqual(20);
  });
});
