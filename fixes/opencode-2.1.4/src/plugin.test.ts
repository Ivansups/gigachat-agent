import { describe, expect, it, vi } from "vitest";
import { createPlugin, type Context } from "./plugin.js";

function fixture(credential?: { type: string; key?: string; metadata?: Record<string, unknown> }): {
  context: Context;
  add: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  dispose: () => Promise<void>;
  runSDK: () => Promise<Record<string, unknown>>;
} {
  const add = vi.fn();
  const update = vi.fn();
  const dispose = vi.fn(async () => {});
  let sdk: (input: { options: Record<string, unknown> }) => Promise<void> = async () => {};
  const context: Context = {
    provider: { transform: async (callback) => {
      callback({ get: () => undefined, add }); return { dispose };
    } },
    integration: {
      transform: async (callback) => { callback({ method: { update } }); return { dispose }; },
      connection: { active: async () => credential ? {} : undefined, resolve: async () => credential },
    },
    permission: { hook: async () => ({ dispose }) },
    aisdk: { hook: async (name, callback, options) => {
      expect(name).toBe("sdk");
      expect(options).toEqual({ providerID: "GigaChat (Sberbank)" });
      sdk = callback; return { dispose };
    } },
  };
  return { context, add, update, dispose, runSDK: async () => {
    const options: Record<string, unknown> = {};
    await sdk({ options }); return options;
  } };
}

describe("OpenCode 2.1.4 adapter", () => {
  it("registers complete v2 provider models and key scope form, and cleans up", async () => {
    const f = fixture();
    const cleanup = await createPlugin({}).setup(f.context);
    const registration = f.add.mock.calls[0]?.[0];
    expect(registration.info).toMatchObject({ package: "aisdk:@ai-sdk/openai-compatible", activation: "enabled" });
    expect(registration.models.map((model: { id: string }) => model.id)).toContain("auto");
    expect(registration.models.every((model: { capabilities: { tools: boolean } }) => model.capabilities.tools)).toBe(true);
    expect(f.update.mock.calls[0]?.[0].method).toMatchObject({ type: "key", form: [{ key: "scope" }] });
    await cleanup();
    expect(f.dispose).toHaveBeenCalledTimes(3);
  });

  it.each([
    { type: "key", key: "a2V5", metadata: { scope: "GIGACHAT_API_CORP" } },
    { type: "key", key: "GIGACHAT_API_B2B:a2V5" },
  ])("uses v2 saved keys through the original transport", async (credential) => {
    const f = fixture(credential);
    await createPlugin({}).setup(f.context);
    const options = await f.runSDK();
    expect(typeof options["fetch"]).toBe("function");
    expect(options["baseURL"]).toBe("https://api.gigachat.local/v1");
  });

  it("falls back to the original environment credential loading", async () => {
    const f = fixture();
    await createPlugin({ GIGACHAT_CREDENTIALS: "ZW52" }).setup(f.context);
    expect(typeof (await f.runSDK())["fetch"]).toBe("function");
  });

  it("enforces MCP guards after permissive agent rules", async () => {
    const f = fixture();
    let evaluate: (event: { action: string; effect: string; message?: string }) => Promise<void> = async () => {};
    f.context.permission.hook = async (name, callback) => {
      expect(name).toBe("evaluate"); evaluate = callback; return { dispose: f.dispose };
    };
    await createPlugin({ GIGACHAT_OPENCODE_READ_ONLY: "1" }).setup(f.context);
    for (const action of ["edit", "write", "shell", "bash"]) {
      const event = { action, effect: "allow" };
      await evaluate(event);
      expect(event.effect).toBe("deny");
    }
    const read = { action: "read", effect: "allow" };
    await evaluate(read);
    expect(read.effect).toBe("allow");
  });

  it("denies shell while permitting requested writes", async () => {
    const f = fixture();
    let evaluate: (event: { action: string; effect: string }) => Promise<void> = async () => {};
    f.context.permission.hook = async (_name, callback) => { evaluate = callback; return { dispose: f.dispose }; };
    await createPlugin({ GIGACHAT_OPENCODE_READ_ONLY: "0", GIGACHAT_OPENCODE_DENY_SHELL: "1" }).setup(f.context);
    const write = { action: "edit", effect: "allow" };
    const shell = { action: "shell", effect: "allow" };
    await evaluate(write); await evaluate(shell);
    expect(write.effect).toBe("allow");
    expect(shell.effect).toBe("deny");
  });

  it("keeps Code Mode disabled even with write and shell permissions", async () => {
    const f = fixture();
    let evaluate: (event: { action: string; effect: string }) => Promise<void> = async () => {};
    f.context.permission.hook = async (_name, callback) => { evaluate = callback; return { dispose: f.dispose }; };
    await createPlugin({ GIGACHAT_OPENCODE_NATIVE_TOOLS: "1" }).setup(f.context);
    const execute = { action: "execute", effect: "allow" };
    const edit = { action: "edit", effect: "allow" };
    await evaluate(execute); await evaluate(edit);
    expect(execute.effect).toBe("deny"); expect(edit.effect).toBe("allow");
  });

  it("rejects unknown saved scopes", async () => {
    const f = fixture({ type: "key", key: "a2V5", metadata: { scope: "bad" } });
    await createPlugin({}).setup(f.context);
    await expect(f.runSDK()).rejects.toThrow("Invalid GigaChat scope");
  });

  it("rejects non-key accounts rather than silently using environment secrets", async () => {
    const f = fixture({ type: "oauth" });
    await createPlugin({ GIGACHAT_CREDENTIALS: "ZW52" }).setup(f.context);
    await expect(f.runSDK()).rejects.toThrow("requires a key account");
  });
});
