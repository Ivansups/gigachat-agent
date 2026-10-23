import type { ChatChunk, ChatRequest, ChatResponse } from "@gigachat-agent/core";

export interface OpenAIBackend {
  chat(request: ChatRequest): Promise<ChatResponse>;
  stream(request: ChatRequest): AsyncIterable<ChatChunk>;
  listModels(): Promise<string[]>;
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const failure = (error: unknown, status = 502): Response =>
  json({ error: { message: (error as Error).message, type: "upstream_error" } }, status);

function requestBody(init: RequestInit | undefined): ChatRequest {
  return JSON.parse(typeof init?.body === "string" ? init.body : "{}") as ChatRequest;
}

function sseResponse(backend: OpenAIBackend, request: ChatRequest): Response {
  const id = `chatcmpl-${Date.now().toString(36)}`;
  const created = Math.floor(Date.now() / 1000);
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (data: unknown): void =>
        controller.enqueue(encoder.encode(`data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`));
      try {
        for await (const chunk of backend.stream(request)) {
          send({
            id,
            object: "chat.completion.chunk",
            created,
            model: request.model,
            choices: chunk.choices.map((choice) => ({
              ...choice,
              delta: {
                ...choice.delta,
                ...(choice.delta.tool_calls
                  ? { tool_calls: choice.delta.tool_calls.map((call, index) => ({ index, ...call })) }
                  : {}),
              },
            })),
          });
        }
      } catch (error) {
        send({ error: { message: (error as Error).message, type: "upstream_error" } });
      }
      send("[DONE]");
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

/** A fetch that speaks the OpenAI HTTP API on top of the GigaChat client, so @ai-sdk/openai-compatible can use it. */
export function createOpenAIFetch(backend: OpenAIBackend): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    if (url.pathname.endsWith("/chat/completions")) {
      const request = requestBody(init);
      if (request.stream) return sseResponse(backend, request);
      try {
        const completion = await backend.chat(request);
        return json({ ...completion, object: "chat.completion", created: Math.floor(Date.now() / 1000) });
      } catch (error) {
        return failure(error);
      }
    }
    if (url.pathname.endsWith("/models")) {
      try {
        const ids = await backend.listModels();
        return json({ object: "list", data: ids.map((id) => ({ id, object: "model", owned_by: "sber" })) });
      } catch (error) {
        return failure(error);
      }
    }
    return json({ error: { message: `Unsupported path ${url.pathname}`, type: "not_found" } }, 404);
  }) as typeof fetch;
}
