import { describe, expect, it, vi } from "vitest";
import type { ChatChunk, ChatRequest, ChatResponse } from "@gigachat-agent/core";
import { createOpenAIFetch, type OpenAIBackend } from "./openai-fetch.js";

const response: ChatResponse = {
  id: "r1",
  model: "GigaChat",
  choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "hello" } }],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
};

function backend(overrides: Partial<OpenAIBackend> = {}): OpenAIBackend {
  return {
    chat: vi.fn(async () => response),
    stream: vi.fn(async function* (): AsyncGenerator<ChatChunk> {
      yield { choices: [{ index: 0, delta: { role: "assistant", content: "Hel" } }] };
      yield {
        choices: [
          {
            index: 0,
            delta: { tool_calls: [{ id: "c1", type: "function", function: { name: "read", arguments: "{}" } }] },
            finish_reason: "tool_calls",
          },
        ],
      };
    }),
    listModels: vi.fn(async () => ["GigaChat", "GigaChat-Pro"]),
    ...overrides,
  };
}

const post = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });
const request: ChatRequest = { model: "GigaChat", messages: [{ role: "user", content: "hi" }] };

describe("createOpenAIFetch", () => {
  it("answers /chat/completions in OpenAI completion shape", async () => {
    const b = backend();
    const fetchImpl = createOpenAIFetch(b);

    const res = await fetchImpl("https://api.gigachat.local/v1/chat/completions", post(request));
    const json = (await res.json()) as { object: string; choices: { message: { content: string } }[]; created: number };

    expect(res.status).toBe(200);
    expect(json.object).toBe("chat.completion");
    expect(json.choices[0]?.message.content).toBe("hello");
    expect(typeof json.created).toBe("number");
    expect(b.chat).toHaveBeenCalledWith(expect.objectContaining({ model: "GigaChat" }));
  });

  it("streams SSE chunks with indexed tool calls and a [DONE] terminator", async () => {
    const fetchImpl = createOpenAIFetch(backend());

    const res = await fetchImpl("https://api.gigachat.local/v1/chat/completions", post({ ...request, stream: true }));
    const text = await res.text();

    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const events = text.split("\n\n").filter(Boolean);
    expect(events.at(-1)).toBe("data: [DONE]");
    const first = JSON.parse(events[0]?.slice(6) ?? "{}") as { object: string; choices: { delta: { content: string } }[] };
    expect(first.object).toBe("chat.completion.chunk");
    expect(first.choices[0]?.delta.content).toBe("Hel");
    const second = JSON.parse(events[1]?.slice(6) ?? "{}") as {
      choices: { delta: { tool_calls: { index: number }[] } }[];
    };
    expect(second.choices[0]?.delta.tool_calls[0]?.index).toBe(0);
  });

  it("lists models in OpenAI shape", async () => {
    const fetchImpl = createOpenAIFetch(backend());

    const res = await fetchImpl("https://api.gigachat.local/v1/models");
    const json = (await res.json()) as { object: string; data: { id: string }[] };

    expect(json.object).toBe("list");
    expect(json.data.map((m) => m.id)).toEqual(["GigaChat", "GigaChat-Pro"]);
  });

  it("returns 404 for unknown paths", async () => {
    const res = await createOpenAIFetch(backend())("https://api.gigachat.local/v1/embeddings", post({}));

    expect(res.status).toBe(404);
  });

  it("returns an OpenAI-style error body when the backend fails", async () => {
    const b = backend({
      chat: vi.fn(async () => {
        throw new Error("GigaChat API error: HTTP 500");
      }),
    });

    const res = await createOpenAIFetch(b)("https://api.gigachat.local/v1/chat/completions", post(request));
    const json = (await res.json()) as { error: { message: string } };

    expect(res.status).toBe(502);
    expect(json.error.message).toContain("500");
  });
});
