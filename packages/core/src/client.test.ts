import { describe, expect, it, vi } from "vitest";
import { GigaChatClient } from "./client.js";

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const completion = (content: string): unknown => ({
  model: "GigaChat",
  choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
});

function setup(fetchImpl: typeof fetch, extra: { maxInputChars?: number } = {}): {
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
