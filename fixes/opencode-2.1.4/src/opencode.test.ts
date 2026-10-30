import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { READ_ONLY_CONFIG, completedFileEdits, buildRunEnv, killActiveRuns, runOpencode, type SpawnLike } from "./opencode.js";

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
  it("runs standalone in the requested cwd without the removed --dir flag", async () => {
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
      expect.arrayContaining(["run", "--standalone", "--format", "json", "--model", "GigaChat (Sberbank)/GigaChat"]),
    );
    expect(args).not.toContain("--dir");
    const spawnOptions = spawn.mock.calls[0]?.[2] as unknown as { cwd: string; env: { PWD: string } };
    expect(spawnOptions.cwd).toBe("/work");
    expect(spawnOptions.env.PWD).toBe("/work");
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
    expect(READ_ONLY_CONFIG.permissions).toContainEqual({ action: "shell", resource: "*", effect: "deny" });
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
    const config = JSON.parse(options.env["OPENCODE_CONFIG_CONTENT"] ?? "{}") as { permissions: { action: string; resource: string; effect: string }[]; policies: { action: string; resource: string; effect: string }[] };
    expect(args).not.toContain("--auto");
    expect(config.permissions).toContainEqual({ action: "execute", resource: "*", effect: "deny" });
    expect(config.permissions).toContainEqual({ action: "edit", resource: "*", effect: "allow" });
    expect(config.permissions).toContainEqual({ action: "shell", resource: "*", effect: "deny" });
    expect(config.policies).toContainEqual({ action: "tool.use", resource: "shell:*", effect: "deny" });
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
    const config = JSON.parse(options.env["OPENCODE_CONFIG_CONTENT"] ?? "{}") as { permissions: { action: string; resource: string; effect: string }[]; policies: { action: string; resource: string; effect: string }[] };
    expect(config.permissions.some((rule) => rule.action === "shell")).toBe(false);
    expect(config.policies.some((rule) => rule.resource === "shell:*")).toBe(false);
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
    const config = JSON.parse(options.env["OPENCODE_CONFIG_CONTENT"] ?? "{}") as { permissions: { action: string; resource: string; effect: string }[]; policies: { action: string; resource: string; effect: string }[] };
    expect(config.permissions).toEqual(READ_ONLY_CONFIG.permissions);
    expect(config.policies).toEqual(READ_ONLY_CONFIG.policies);
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
    const result = await promise;

    expect(result.error).toBe("opencode run was cancelled");
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


describe("v2 permission configuration", () => {
  it("keeps user settings and appends denies after permissive inline rules", () => {
    const env = buildRunEnv({ OPENCODE_CONFIG_CONTENT: JSON.stringify({
      plugins: ["other-plugin"], model: "other/model", permission: { edit: "allow" },
      permissions: [{ action: "*", resource: "*", effect: "allow" }],
      policies: [{ action: "tool.use", resource: "*", effect: "allow" }],
    }), PWD: "/wrong" }, false, "/work");
    const config = JSON.parse(env["OPENCODE_CONFIG_CONTENT"] ?? "{}");
    expect(config.model).toBe("other/model");
    expect(config.plugins).toEqual(["other-plugin", ...READ_ONLY_CONFIG.plugins]);
    expect(config.permission).toBeUndefined();
    expect(config.permissions.slice(-5)).toEqual(READ_ONLY_CONFIG.permissions);
    expect(config.policies.slice(-5)).toEqual(READ_ONLY_CONFIG.policies);
    expect(env["PWD"]).toBe("/work");
    expect(env["GIGACHAT_OPENCODE_READ_ONLY"]).toBe("1");
    expect(env["GIGACHAT_OPENCODE_DENY_SHELL"]).toBe("1");
  });

  it.each(["not json", "null", "[]"])("cannot lose restrictions for invalid inline configuration %s", (content) => {
    const config = JSON.parse(buildRunEnv({ OPENCODE_CONFIG_CONTENT: content }, false, "/work")["OPENCODE_CONFIG_CONTENT"] ?? "{}");
    expect(config).toEqual(READ_ONLY_CONFIG);
  });

  it("overwrites inherited permission guards using the actual run request", () => {
    const env = buildRunEnv({ GIGACHAT_ALLOW_BASH: "1", GIGACHAT_OPENCODE_READ_ONLY: "1", GIGACHAT_OPENCODE_DENY_SHELL: "1" }, true, "/work");
    expect(env["GIGACHAT_OPENCODE_READ_ONLY"]).toBe("0");
    expect(env["GIGACHAT_OPENCODE_DENY_SHELL"]).toBe("0");
  });

  it("preserves an operator shell deny even with bash opt-in", () => {
    const deny = { action: "shell", resource: "*", effect: "deny" };
    const config = JSON.parse(buildRunEnv({ GIGACHAT_ALLOW_BASH: "1", OPENCODE_CONFIG_CONTENT: JSON.stringify({ permissions: [deny] }) }, true, "/work")["OPENCODE_CONFIG_CONTENT"] ?? "{}");
    expect(config.permissions).toContainEqual(deny);
  });
});

describe("v2 JSON event compatibility", () => {
  it("returns v2 JSON errors even when the CLI exit code is zero", async () => {
    const { child, spawn } = setup();
    const promise = runOpencode({ prompt: "p", model: "m/x", cwd: "/w", timeoutMs: 5000 }, { spawn: spawn as unknown as SpawnLike, env: {} });
    child.stdout.write(event({ type: "error", sessionID: "ses_1", error: { type: "unknown", message: "No integration connected" } }));
    child.finish(0);
    expect(await promise).toMatchObject({ sessionId: "ses_1", error: "No integration connected" });
  });

  it("reports spawn errors and removes failed children from shutdown tracking", async () => {
    const { child, spawn } = setup();
    const promise = runOpencode({ prompt: "p", model: "m/x", cwd: "/w", timeoutMs: 5000 }, { spawn: spawn as unknown as SpawnLike, env: {} });
    child.emit("error", new Error("ENOENT"));
    expect(await promise).toMatchObject({ exitCode: null, error: "Failed to start opencode: ENOENT" });
    killActiveRuns();
    expect(child.kill).not.toHaveBeenCalled();
  });
});


describe("confirmed edits", () => {
  it("does not treat prose or failed tools as an edit", () => {
    const stdout = event({ type: "text", part: { text: "File updated successfully" } }) +
      event({ type: "tool_use", part: { tool: "write", state: { status: "error" } } });
    expect(completedFileEdits(stdout)).toBe(0);
  });

  it("counts only completed native file tools", () => {
    expect(completedFileEdits(event({ type: "tool_use", part: { tool: "write", state: { status: "completed" } } }) +
      event({ type: "tool_use", part: { tool: "read", state: { status: "completed" } } }))).toBe(1);
  });

  it("rejects unverified write-mode success", async () => {
    const { child, spawn } = setup();
    const p = runOpencode({ prompt: "edit", model: "m/x", cwd: "/w", allowWrite: true, timeoutMs: 5000 }, { spawn: spawn as unknown as SpawnLike, env: {} });
    child.stdout.write(event({ type: "text", part: { text: "Done" } })); child.finish(0);
    expect((await p).error).toContain("No file edit was confirmed");
  });

  it("accepts write-mode success when OpenCode confirms a completed file edit", async () => {
    const { child, spawn } = setup();
    const p = runOpencode({ prompt: "edit", model: "m/x", cwd: "/w", allowWrite: true, timeoutMs: 5000 }, { spawn: spawn as unknown as SpawnLike, env: {} });
    child.stdout.write(event({ type: "tool_use", part: { tool: "edit", state: { status: "completed" } } })); child.finish(0);
    expect((await p).error).toBeUndefined();
  });
});
