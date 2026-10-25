import { describe, expect, it, vi } from "vitest";
import { GigaChatClient } from "./client.js";
import { AllModelsExhaustedError, GigaChatNetworkError, InsufficientTokensError } from "./errors.js";

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const completion = (content: string): unknown => ({
  model: "GigaChat",
  choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
});

function setup(
  fetchImpl: typeof fetch,
  extra: { maxInputChars?: number; modelPriority?: string[]; now?: () => number } = {},
): {
  client: GigaChatClient;
  tokens: { getToken: ReturnType<typeof vi.fn>; invalidate: ReturnType<typeof vi.fn> };
  sleep: ReturnType<typeof vi.fn>;
} {
  let n = 0;
  const tokens = {
    getToken: vi.fn(async () => `tok-${++n}`),
    invalidate: vi.fn(async () => undefined),
  };
  const sleep = vi.fn(async () => undefined);
  const client = new GigaChatClient({
    tokens,
    fetch: fetchImpl,
    sleep,
    baseUrl: "https://api.test/v1",
    ...extra,
  });
  return { client, tokens, sleep };
}

describe("GigaChatClient.chat", () => {
  it("posts to /chat/completions with a bearer token and returns OpenAI shape", async () => {
    const fetchMock = vi.fn(async () => json(completion("hi")));
    const { client } = setup(fetchMock as unknown as typeof fetch);

    const response = await client.chat({ model: "GigaChat", messages: [{ role: "user", content: "yo" }] });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.test/v1/chat/completions");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer tok-1");
    expect(response.choices[0]?.message.content).toBe("hi");
  });

  it("refreshes the token and retries once on 401", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("expired", { status: 401 }))
      .mockResolvedValueOnce(json(completion("ok")));
    const { client, tokens } = setup(fetchMock as unknown as typeof fetch);

    const response = await client.chat({ model: "GigaChat", messages: [{ role: "user", content: "yo" }] });

    expect(response.choices[0]?.message.content).toBe("ok");
    expect(tokens.invalidate).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("backs off and retries on 429", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("slow down", { status: 429 }))
      .mockResolvedValueOnce(new Response("slow down", { status: 429 }))
      .mockResolvedValueOnce(json(completion("ok")));
    const { client, sleep } = setup(fetchMock as unknown as typeof fetch);

    const response = await client.chat({ model: "GigaChat", messages: [{ role: "user", content: "yo" }] });

    expect(response.choices[0]?.message.content).toBe("ok");
    expect(sleep).toHaveBeenCalledTimes(2);
    const [first, second] = sleep.mock.calls.map((c) => c[0] as number);
    expect(second).toBeGreaterThan(first as number);
  });

  it("gives up after the retry limit on 429", async () => {
    const fetchMock = vi.fn(async () => new Response("slow down", { status: 429 }));
    const { client } = setup(fetchMock as unknown as typeof fetch);

    await expect(
      client.chat({ model: "GigaChat", messages: [{ role: "user", content: "yo" }] }),
    ).rejects.toThrow(/429/);
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(4);
  });

  it("retries once with an error hint when the function call is invalid", async () => {
    const bad = {
      choices: [
        {
          index: 0,
          finish_reason: "function_call",
          message: { role: "assistant", content: "", function_call: { name: "unknown_tool", arguments: {} } },
        },
      ],
    };
    const good = {
      choices: [
        {
          index: 0,
          finish_reason: "function_call",
          message: { role: "assistant", content: "", function_call: { name: "read", arguments: { path: "a" } } },
        },
      ],
    };
    const fetchMock = vi.fn().mockResolvedValueOnce(json(bad)).mockResolvedValueOnce(json(good));
    const { client } = setup(fetchMock as unknown as typeof fetch);

    const response = await client.chat({
      model: "GigaChat",
      messages: [{ role: "user", content: "read a" }],
      tools: [{ type: "function", function: { name: "read", parameters: { type: "object", properties: {} } } }],
    });

    expect(response.choices[0]?.message.tool_calls?.[0]?.function.name).toBe("read");
    const secondBody = JSON.parse(String((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].body)) as {
      messages: { content: string }[];
    };
    expect(secondBody.messages.at(-1)?.content).toMatch(/unknown_tool/);
  });

  it("truncates oversized input and reports it", async () => {
    const fetchMock = vi.fn(async () => json(completion("ok")));
    const { client } = setup(fetchMock as unknown as typeof fetch, { maxInputChars: 50 });

    const response = await client.chat({
      model: "GigaChat",
      messages: [{ role: "user", content: "x".repeat(500) }],
    });

    expect(response.truncated).toBe(true);
    const sent = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body)) as {
      messages: { content: string }[];
    };
    expect(sent.messages[0]?.content.length).toBeLessThanOrEqual(50);
  });

  it("never leaks the bearer token in errors", async () => {
    const fetchMock = vi.fn(async () => new Response("boom", { status: 500 }));
    const { client } = setup(fetchMock as unknown as typeof fetch);

    const error = await client
      .chat({ model: "GigaChat", messages: [{ role: "user", content: "yo" }] })
      .catch((e: unknown) => e as Error);

    expect((error as Error).message).toContain("500");
    expect((error as Error).message).not.toContain("tok-1");
  });
});

describe("GigaChatClient.stream", () => {
  it("yields OpenAI-style chunks from SSE and stops at [DONE]", async () => {
    const sse = [
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: "assistant", content: "Hel" } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "lo" }, finish_reason: "stop" }] })}\n\n`,
      "data: [DONE]\n\n",
    ].join("");
    const fetchMock = vi.fn(async () => new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } }));
    const { client } = setup(fetchMock as unknown as typeof fetch);

    const parts: string[] = [];
    for await (const chunk of client.stream({ model: "GigaChat", messages: [{ role: "user", content: "yo" }] })) {
      parts.push(chunk.choices[0]?.delta.content ?? "");
    }

    expect(parts.join("")).toBe("Hello");
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body)) as { stream: boolean };
    expect(body.stream).toBe(true);
  });
});

describe("GigaChatClient.listModels", () => {
  it("returns model ids", async () => {
    const fetchMock = vi.fn(async () => json({ data: [{ id: "GigaChat" }, { id: "GigaChat-Pro" }] }));
    const { client } = setup(fetchMock as unknown as typeof fetch);

    expect(await client.listModels()).toEqual(["GigaChat", "GigaChat-Pro"]);
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe("https://api.test/v1/models");
  });
});

const payment = (): Response => json({ status: 402, message: "Payment Required" }, 402);
const user = [{ role: "user" as const, content: "yo" }];
const sentModels = (fetchMock: ReturnType<typeof vi.fn>): string[] =>
  fetchMock.mock.calls.map(
    (call) => (JSON.parse(String((call as unknown as [string, RequestInit])[1].body)) as { model: string }).model,
  );

describe("GigaChatClient automatic model choice", () => {
  const priority = ["GigaChat-2-Max", "GigaChat-2-Pro", "GigaChat-2"];

  it("reports an exhausted explicit model unambiguously and does not switch models", async () => {
    const fetchMock = vi.fn(async () => payment());
    const { client } = setup(fetchMock as unknown as typeof fetch, { modelPriority: priority });

    const error = await client.chat({ model: "GigaChat-2-Max", messages: user }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(InsufficientTokensError);
    expect((error as InsufficientTokensError).model).toBe("GigaChat-2-Max");
    expect((error as Error).message).toMatch(/GigaChat-2-Max.*402|402.*GigaChat-2-Max/);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("falls through from the best model to the next one on 402", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(payment()).mockResolvedValueOnce(json(completion("ok")));
    const { client } = setup(fetchMock as unknown as typeof fetch, { modelPriority: priority });

    const response = await client.chat({ model: "auto", messages: user });

    expect(sentModels(fetchMock)).toEqual(["GigaChat-2-Max", "GigaChat-2-Pro"]);
    expect(response.choices[0]?.message.content).toBe("ok");
  });

  it("remembers an exhausted model for a while instead of probing it on every call", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(payment())
      .mockImplementation(async () => json(completion("ok")));
    const { client } = setup(fetchMock as unknown as typeof fetch, { modelPriority: priority });

    await client.chat({ model: "auto", messages: user });
    await client.chat({ model: "auto", messages: user });

    expect(sentModels(fetchMock)).toEqual(["GigaChat-2-Max", "GigaChat-2-Pro", "GigaChat-2-Pro"]);
  });

  it("tries the best model again once the memory expires", async () => {
    let now = 0;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(payment())
      .mockImplementation(async () => json(completion("ok")));
    const { client } = setup(fetchMock as unknown as typeof fetch, { modelPriority: priority, now: () => now });

    await client.chat({ model: "auto", messages: user });
    now = 60 * 60 * 1000;
    await client.chat({ model: "auto", messages: user });

    expect(sentModels(fetchMock)).toEqual(["GigaChat-2-Max", "GigaChat-2-Pro", "GigaChat-2-Max"]);
  });

  it("names every model when all of them are out of tokens", async () => {
    const fetchMock = vi.fn(async () => payment());
    const { client } = setup(fetchMock as unknown as typeof fetch, { modelPriority: priority });

    const error = await client.chat({ model: "auto", messages: user }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AllModelsExhaustedError);
    expect((error as AllModelsExhaustedError).models).toEqual(priority);
    for (const model of priority) expect((error as Error).message).toContain(model);
  });

  it("probes remembered models again when every candidate is marked exhausted", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(payment())
      .mockResolvedValueOnce(payment())
      .mockResolvedValueOnce(payment())
      .mockResolvedValueOnce(json(completion("topped up")));
    const { client } = setup(fetchMock as unknown as typeof fetch, { modelPriority: priority });

    await client.chat({ model: "auto", messages: user }).catch(() => undefined);
    const response = await client.chat({ model: "auto", messages: user });

    expect(response.choices[0]?.message.content).toBe("topped up");
    expect(sentModels(fetchMock)[3]).toBe("GigaChat-2-Max");
  });

  it("does not treat other failures as a reason to switch models", async () => {
    const fetchMock = vi.fn(async () => new Response("boom", { status: 500 }));
    const { client } = setup(fetchMock as unknown as typeof fetch, { modelPriority: priority });

    const error = await client.chat({ model: "auto", messages: user }).catch((e: unknown) => e as Error);

    expect(error).not.toBeInstanceOf(InsufficientTokensError);
    expect((error as Error).message).toContain("500");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("starts the default order with the best tier, Ultra", async () => {
    const fetchMock = vi.fn(async () => json(completion("ok")));
    const { client } = setup(fetchMock as unknown as typeof fetch);

    await client.chat({ model: "auto", messages: user });

    expect(sentModels(fetchMock)).toEqual(["GigaChat-3-Ultra"]);
  });

  it("skips a model the account or host does not serve (404) and goes on, down Ultra, Max, Pro, Lite", async () => {
    const missing = (): Response => json({ status: 404, message: "No such model" }, 404);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(missing())
      .mockResolvedValueOnce(payment())
      .mockResolvedValueOnce(payment())
      .mockResolvedValueOnce(json(completion("lite answered")));
    const { client } = setup(fetchMock as unknown as typeof fetch);

    const response = await client.chat({ model: "auto", messages: user });

    expect(sentModels(fetchMock)).toEqual(["GigaChat-3-Ultra", "GigaChat-2-Max", "GigaChat-2-Pro", "GigaChat-2"]);
    expect(response.choices[0]?.message.content).toBe("lite answered");
  });

  it("does not skip a missing model when it was asked for explicitly", async () => {
    const fetchMock = vi.fn(async () => json({ status: 404, message: "No such model" }, 404));
    const { client } = setup(fetchMock as unknown as typeof fetch, { modelPriority: priority });

    const error = (await client
      .chat({ model: "GigaChat-3-Ultra", messages: user })
      .catch((e: unknown) => e)) as Error;

    expect(error.message).toContain("404");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("separates exhausted models from unavailable ones in the final error", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ status: 404, message: "No such model" }, 404))
      .mockResolvedValue(payment());
    const { client } = setup(fetchMock as unknown as typeof fetch, { modelPriority: ["Ultra", "Max", "Pro"] });

    const error = await client.chat({ model: "auto", messages: user }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AllModelsExhaustedError);
    expect((error as AllModelsExhaustedError).models).toEqual(["Max", "Pro"]);
    expect((error as AllModelsExhaustedError).unavailable).toEqual(["Ultra"]);
    expect((error as Error).message).toMatch(/exhausted.*Max, Pro/);
    expect((error as Error).message).toMatch(/Not available.*Ultra/);
  });

  it("says plainly that no listed model is available when all of them answer 404", async () => {
    const fetchMock = vi.fn(async () => json({ status: 404, message: "No such model" }, 404));
    const { client } = setup(fetchMock as unknown as typeof fetch, { modelPriority: ["A", "B"] });

    const error = (await client.chat({ model: "auto", messages: user }).catch((e: unknown) => e)) as Error;

    expect(error).not.toBeInstanceOf(AllModelsExhaustedError);
    expect(error.message).toMatch(/None of the models.*A, B/);
  });

  it("falls through when streaming too", async () => {
    const sse = `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "hi" }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(payment())
      .mockResolvedValueOnce(new Response(sse, { status: 200 }));
    const { client } = setup(fetchMock as unknown as typeof fetch, { modelPriority: priority });

    const parts: string[] = [];
    for await (const chunk of client.stream({ model: "auto", messages: user })) {
      parts.push(chunk.choices[0]?.delta.content ?? "");
    }

    expect(parts.join("")).toBe("hi");
    expect(sentModels(fetchMock)).toEqual(["GigaChat-2-Max", "GigaChat-2-Pro"]);
  });
});

describe("GigaChatClient network failures", () => {
  const unreachable = (): Promise<Response> =>
    Promise.reject(new TypeError("fetch failed", { cause: { code: "UND_ERR_CONNECT_TIMEOUT" } }));

  it("names the host and the cause instead of a bare 'fetch failed'", async () => {
    const { client } = setup(vi.fn(unreachable) as unknown as typeof fetch);

    const error = (await client.chat({ model: "GigaChat", messages: user }).catch((e: unknown) => e)) as Error;

    expect(error).toBeInstanceOf(GigaChatNetworkError);
    expect(error.message).toContain("https://api.test");
    expect(error.message).toContain("UND_ERR_CONNECT_TIMEOUT");
    expect(error.message).toMatch(/VPN/);
    expect(error.message).not.toContain("tok-1");
  });

  it("does not try the next model when the host is unreachable", async () => {
    const fetchMock = vi.fn(unreachable);
    const { client } = setup(fetchMock as unknown as typeof fetch);

    await client.chat({ model: "auto", messages: user }).catch(() => undefined);

    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
