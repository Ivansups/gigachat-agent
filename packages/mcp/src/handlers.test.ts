import { describe, expect, it, vi } from "vitest";
import { createHandlers, type HandlerDeps } from "./handlers.js";

function deps(overrides: Partial<HandlerDeps> = {}): HandlerDeps {
  return {
    client: {
      chat: vi.fn(async () => ({
        id: "1",
        model: "GigaChat",
        choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant" as const, content: "answer" } }],
      })),
      listModels: vi.fn(async () => ["GigaChat", "GigaChat-Pro"]),
    },
    runOpencode: vi.fn(async () => ({ text: "agent says", sessionId: "ses_1", exitCode: 0 })),
    listOpencodeModels: vi.fn(async () => ["opencode/big-pickle"]),
    readFile: vi.fn(async (path: string) => `content of ${path}`),
    realpath: vi.fn(async (path: string) => path),
    root: "/repo",
    agentModel: "GigaChat (Sberbank)/GigaChat",
    ...overrides,
  };
}

describe("cwd confinement", () => {
  it("refuses a cwd that is a symlink pointing outside the root", async () => {
    const d = deps({ realpath: vi.fn(async (path: string) => (path === "/repo/link" ? "/etc" : path)) });

    await expect(createHandlers(d).runAgent({ prompt: "x", cwd: "/repo/link" })).rejects.toThrow(/outside/);
    expect(d.runOpencode).not.toHaveBeenCalled();
  });
});

describe("ask", () => {
  it("sends the prompt to GigaChat directly and returns the answer", async () => {
    const d = deps();
    const result = await createHandlers(d).ask({ prompt: "hi" });

    expect(result).toBe("answer");
    expect(d.runOpencode).not.toHaveBeenCalled();
    expect(d.client.chat).toHaveBeenCalledWith(
      expect.objectContaining({ model: "GigaChat", messages: [{ role: "user", content: "hi" }] }),
    );
  });

  it("tells which model answered when the model was chosen automatically", async () => {
    const d = deps();
    (d.client.chat as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "1",
      model: "GigaChat-2-Pro",
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "answer" } }],
    });

    const result = await createHandlers(d).ask({ prompt: "hi", model: "GigaChat (Sberbank)/auto" });

    expect(result).toBe("answer\n\n[model: GigaChat-2-Pro]");
  });

  it("adds a system prompt and file contents to the request", async () => {
    const d = deps();
    await createHandlers(d).ask({ prompt: "review", system: "be strict", files: ["/repo/a.ts"] });

    const request = (d.client.chat as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      messages: { role: string; content: string }[];
    };
    expect(request.messages[0]).toEqual({ role: "system", content: "be strict" });
    expect(request.messages[1]?.content).toContain("content of /repo/a.ts");
    expect(request.messages[1]?.content).toContain("review");
  });

  it("refuses files outside the allowed root", async () => {
    const d = deps();

    await expect(createHandlers(d).ask({ prompt: "x", files: ["/etc/passwd"] })).rejects.toThrow(/outside/);
    await expect(createHandlers(d).ask({ prompt: "x", files: ["/repo/../etc/passwd"] })).rejects.toThrow(/outside/);
    expect(d.readFile).not.toHaveBeenCalled();
  });

  it("notes when the input was truncated", async () => {
    const d = deps({
      client: {
        chat: vi.fn(async () => ({
          id: "1",
          model: "GigaChat",
          truncated: true,
          choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant" as const, content: "answer" } }],
        })),
        listModels: vi.fn(async () => []),
      },
    });

    expect(await createHandlers(d).ask({ prompt: "hi" })).toMatch(/truncated/i);
  });
});

describe("run_agent", () => {
  it("runs opencode read-only by default and returns text with the session id", async () => {
    const d = deps();
    const result = await createHandlers(d).runAgent({ prompt: "review the diff" });

    expect(d.runOpencode).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "review the diff",
        model: "GigaChat (Sberbank)/GigaChat",
        cwd: "/repo",
        allowWrite: false,
      }),
    );
    expect(result).toContain("agent says");
    expect(result).toContain("ses_1");
  });

  it("passes allow_write, model, cwd and timeout through", async () => {
    const d = deps();
    await createHandlers(d).runAgent({
      prompt: "fix",
      model: "opencode/big-pickle",
      cwd: "/repo/sub",
      allow_write: true,
      timeout_ms: 1234,
    });

    expect(d.runOpencode).toHaveBeenCalledWith(
      expect.objectContaining({ model: "opencode/big-pickle", cwd: "/repo/sub", allowWrite: true, timeoutMs: 1234 }),
    );
  });

  it("caps the timeout at the maximum", async () => {
    const d = deps();
    await createHandlers(d).runAgent({ prompt: "x", timeout_ms: 99 * 3_600_000 });

    const call = (d.runOpencode as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as { timeoutMs: number };
    expect(call.timeoutMs).toBeLessThanOrEqual(3_600_000);
  });

  it("raises an error when the run failed", async () => {
    const d = deps({
      runOpencode: vi.fn(async () => ({ text: "", exitCode: 1, error: "provider exploded" })),
    });

    await expect(createHandlers(d).runAgent({ prompt: "x" })).rejects.toThrow(/provider exploded/);
  });

  it("reports a timeout with partial output", async () => {
    const d = deps({
      runOpencode: vi.fn(async () => ({ text: "partial", exitCode: null, timedOut: true, sessionId: "ses_2" })),
    });

    await expect(createHandlers(d).runAgent({ prompt: "x" })).rejects.toThrow(/timed out.*partial/is);
  });
});

describe("continue_session", () => {
  it("continues the given session", async () => {
    const d = deps();
    const result = await createHandlers(d).continueSession({ session_id: "ses_7", prompt: "and now?" });

    expect(d.runOpencode).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "ses_7", prompt: "and now?" }));
    expect(result).toContain("agent says");
  });
});

describe("list_models", () => {
  it("lists GigaChat and opencode models in provider/model form", async () => {
    const result = await createHandlers(deps()).listModels();

    expect(result).toContain("GigaChat (Sberbank)/GigaChat");
    expect(result).toContain("GigaChat (Sberbank)/GigaChat-Pro");
    expect(result).toContain("opencode/big-pickle");
  });

  it("still lists GigaChat models when opencode is unavailable", async () => {
    const d = deps({
      listOpencodeModels: vi.fn(async () => {
        throw new Error("opencode not found");
      }),
    });

    const result = await createHandlers(d).listModels();

    expect(result).toContain("GigaChat (Sberbank)/GigaChat");
    expect(result).toMatch(/opencode.*unavailable/i);
  });
});
