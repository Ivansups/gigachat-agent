import { describe, expect, it } from "vitest";
import type { Hooks } from "@opencode-ai/plugin";
import { PROVIDER_ID, createGigaChatPlugin } from "./plugin.js";
import { formatStoredKey } from "./credentials.js";

const input = {} as Parameters<ReturnType<typeof createGigaChatPlugin>>[0];

async function hooks(env: Record<string, string | undefined> = {}): Promise<Hooks> {
  return createGigaChatPlugin({ env })(input);
}

describe("GigaChat opencode plugin", () => {
  it("registers the provider through the config hook without overwriting user settings", async () => {
    const h = await hooks();
    const config: Record<string, unknown> = {};

    await h.config?.(config as never);

    const provider = (config["provider"] as Record<string, { npm: string; options: { baseURL: string }; models: object }>)[
      PROVIDER_ID
    ];
    expect(provider?.npm).toBe("@ai-sdk/openai-compatible");
    expect(provider?.options.baseURL).toContain("/v1");
    expect(Object.keys(provider?.models ?? {})).toContain("GigaChat");

    const custom = { provider: { [PROVIDER_ID]: { models: { Mine: {} } } } };
    await h.config?.(custom as never);
    expect(Object.keys((custom.provider[PROVIDER_ID] as { models: object }).models)).toEqual(["Mine"]);
  });

  it("offers an API-key login with scope and authorization key prompts", async () => {
    const h = await hooks();

    expect(h.auth?.provider).toBe(PROVIDER_ID);
    const method = h.auth?.methods[0];
    expect(method?.type).toBe("api");
    const keys = (method?.prompts ?? []).map((p) => p.key);
    expect(keys).toEqual(expect.arrayContaining(["scope", "key"]));
  });

  it("stores scope together with the key on login", async () => {
    const h = await hooks();
    const method = h.auth?.methods[0];
    if (method?.type !== "api" || !method.authorize) throw new Error("api method expected");

    const result = await method.authorize({ scope: "GIGACHAT_API_CORP", key: "a2V5" });

    expect(result).toEqual({ type: "success", key: formatStoredKey("GIGACHAT_API_CORP", "a2V5") });
  });

  it("rejects an empty key on login", async () => {
    const h = await hooks();
    const method = h.auth?.methods[0];
    if (method?.type !== "api" || !method.authorize) throw new Error("api method expected");

    expect(await method.authorize({ scope: "GIGACHAT_API_PERS", key: "  " })).toEqual({ type: "failed" });
  });

  it("loader returns a custom fetch built from the stored key", async () => {
    const h = await hooks();
    const stored = { type: "api", key: formatStoredKey("GIGACHAT_API_PERS", "a2V5") };

    const options = await h.auth?.loader?.(async () => stored as never, {} as never);

    expect(typeof options?.["fetch"]).toBe("function");
    expect(options?.["apiKey"]).toBeTruthy();
  });

  it("loader works from environment variables when nothing is stored", async () => {
    const h = await hooks({ GIGACHAT_CREDENTIALS: "ZW52" });

    const options = await h.auth?.loader?.(async () => undefined as never, {} as never);

    expect(typeof options?.["fetch"]).toBe("function");
  });

  it("loader explains how to log in when there are no credentials", async () => {
    const h = await hooks();

    await expect(h.auth?.loader?.(async () => undefined as never, {} as never)).rejects.toThrow(/providers login/);
  });
});
