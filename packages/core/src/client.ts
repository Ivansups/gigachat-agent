import { applyInputBudget } from "./convert/guard.js";
import { fromGigaChatChunk, fromGigaChatResponse, toGigaChatRequest } from "./convert/convert.js";
import type { ChatChunk, ChatRequest, ChatResponse, GigaMessage, GigaResponse } from "./types.js";

const DEFAULT_BASE_URL = "https://gigachat.devices.sberbank.ru/api/v1";
/** Roughly 80k tokens of Cyrillic text, leaving headroom under the documented 128k-token window. */
const DEFAULT_MAX_INPUT_CHARS = 200_000;
const MAX_RATE_LIMIT_RETRIES = 3;
const BACKOFF_BASE_MS = 500;

export interface TokenSource {
  getToken(): Promise<string>;
  invalidate(): Promise<void>;
}

export interface GigaChatClientOptions {
  tokens: TokenSource;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  baseUrl?: string;
  maxInputChars?: number;
}

/** Talks to the GigaChat API using the OpenAI chat shape on the outside. */
export class GigaChatClient {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly baseUrl: string;
  private readonly maxInputChars: number;

  constructor(private readonly options: GigaChatClientOptions) {
    this.fetchImpl = options.fetch ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.maxInputChars = options.maxInputChars ?? DEFAULT_MAX_INPUT_CHARS;
  }

  /** Runs a non-streaming chat completion. */
  async chat(request: ChatRequest): Promise<ChatResponse> {
    const { messages, truncated } = applyInputBudget(request.messages, this.maxInputChars);
    const body = toGigaChatRequest({ ...request, messages, stream: false });
    let raw = await this.completion(body);
    const invalid = this.invalidCall(raw, request);
    if (invalid) {
      const hint: GigaMessage = { role: "user", content: invalid };
      raw = await this.completion({ ...body, messages: [...body.messages, hint] });
    }
    const response = fromGigaChatResponse(raw, request.model);
    return truncated ? { ...response, truncated } : response;
  }

  /** Streams a chat completion as OpenAI-style chunks. */
  async *stream(request: ChatRequest): AsyncGenerator<ChatChunk> {
    const { messages } = applyInputBudget(request.messages, this.maxInputChars);
    const body = toGigaChatRequest({ ...request, messages, stream: true });
    const response = await this.send("/chat/completions", { method: "POST", body: JSON.stringify(body) });
    if (!response.body) return;

    const decoder = new TextDecoder();
    let buffer = "";
    for await (const part of response.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(part, { stream: true });
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const event = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = event
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .join("");
        if (data === "[DONE]") return;
        if (data) yield fromGigaChatChunk(JSON.parse(data) as GigaResponse);
        boundary = buffer.indexOf("\n\n");
      }
    }
  }

  /** Lists model ids available to the account. */
  async listModels(): Promise<string[]> {
    const response = await this.send("/models", { method: "GET" });
    const body = (await response.json()) as { data: { id: string }[] };
    return body.data.map((model) => model.id);
  }

  private async completion(body: unknown): Promise<GigaResponse> {
    const response = await this.send("/chat/completions", { method: "POST", body: JSON.stringify(body) });
    return (await response.json()) as GigaResponse;
  }

  private invalidCall(raw: GigaResponse, request: ChatRequest): string | undefined {
    const call = raw.choices[0]?.message?.function_call;
    if (!call || !request.tools?.length) return undefined;
    const names = request.tools.map((tool) => tool.function.name);
    if (names.includes(call.name)) return undefined;
    return `Function "${call.name}" does not exist. Available functions: ${names.join(", ")}. Call one of them or answer in plain text.`;
  }

  private async send(path: string, init: RequestInit): Promise<Response> {
    let refreshed = false;
    for (let attempt = 0; ; attempt++) {
      const token = await this.options.tokens.getToken();
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      });
      if (response.status === 401 && !refreshed) {
        refreshed = true;
        await this.options.tokens.invalidate();
        continue;
      }
      if (response.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
        await this.sleep(BACKOFF_BASE_MS * 2 ** attempt);
        continue;
      }
      if (!response.ok) {
        throw new Error(`GigaChat API error: HTTP ${response.status}`);
      }
      return response;
    }
  }
}
