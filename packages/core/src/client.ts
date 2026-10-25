import { applyInputBudget } from "./convert/guard.js";
import { AllModelsExhaustedError, GigaChatApiError, InsufficientTokensError, toNetworkError } from "./errors.js";
import { fromGigaChatChunk, fromGigaChatResponse, toGigaChatRequest } from "./convert/convert.js";
import type { ChatChunk, ChatRequest, ChatResponse, GigaMessage, GigaResponse } from "./types.js";

const DEFAULT_BASE_URL = "https://gigachat.devices.sberbank.ru/api/v1";
/** Roughly 80k tokens of Cyrillic text, leaving headroom under the documented 128k-token window. */
const DEFAULT_MAX_INPUT_CHARS = 200_000;
const MAX_RATE_LIMIT_RETRIES = 3;
const BACKOFF_BASE_MS = 500;
/** Model id that asks the client to walk the priority list instead of using one fixed model. */
export const AUTO_MODEL = "auto";
/** Best tier first: Ultra, Max, Pro, Lite (`GigaChat-2` is Lite). Models the account or host does not serve are skipped. */
export const DEFAULT_MODEL_PRIORITY = ["GigaChat-3-Ultra", "GigaChat-2-Max", "GigaChat-2-Pro", "GigaChat-2"];
/** Tokens come back only after a top-up, so a model that cannot answer is not probed again for a while. */
const EXHAUSTED_MEMORY_MS = 5 * 60 * 1000;

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
  /** Models tried in order for `model: "auto"`. */
  modelPriority?: string[];
  now?: () => number;
}

/** Talks to the GigaChat API using the OpenAI chat shape on the outside. */
export class GigaChatClient {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly baseUrl: string;
  private readonly maxInputChars: number;
  private readonly modelPriority: string[];
  private readonly now: () => number;
  private readonly exhaustedUntil = new Map<string, number>();

  constructor(private readonly options: GigaChatClientOptions) {
    this.fetchImpl = options.fetch ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.maxInputChars = options.maxInputChars ?? DEFAULT_MAX_INPUT_CHARS;
    this.modelPriority = options.modelPriority ?? DEFAULT_MODEL_PRIORITY;
    this.now = options.now ?? Date.now;
  }

  /** Runs a non-streaming chat completion. */
  async chat(request: ChatRequest): Promise<ChatResponse> {
    const { messages, truncated } = applyInputBudget(request.messages, this.maxInputChars);
    return this.withModel(request.model, async (model) => {
      const body = toGigaChatRequest({ ...request, model, messages, stream: false });
      let raw = await this.completion(body);
      const invalid = this.invalidCall(raw, request);
      if (invalid) {
        const hint: GigaMessage = { role: "user", content: invalid };
        raw = await this.completion({ ...body, messages: [...body.messages, hint] });
      }
      const response = fromGigaChatResponse(raw, model);
      return truncated ? { ...response, truncated } : response;
    });
  }

  /** Streams a chat completion as OpenAI-style chunks. */
  async *stream(request: ChatRequest): AsyncGenerator<ChatChunk> {
    const { messages } = applyInputBudget(request.messages, this.maxInputChars);
    const response = await this.withModel(request.model, (model) =>
      this.send("/chat/completions", {
        method: "POST",
        body: JSON.stringify(toGigaChatRequest({ ...request, model, messages, stream: true })),
      }),
    );
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

  /** Runs `run` with the requested model, or with each priority model in turn when it is "auto"; only 402 (tokens used up) and 404 (model not served) move on, and only in auto mode. */
  private async withModel<T>(requested: string, run: (model: string) => Promise<T>): Promise<T> {
    const auto = requested === AUTO_MODEL;
    const now = this.now();
    const fresh = this.modelPriority.filter((model) => (this.exhaustedUntil.get(model) ?? 0) <= now);
    const candidates = auto ? (fresh.length > 0 ? fresh : this.modelPriority) : [requested];
    const exhausted: string[] = [];
    const unavailable: string[] = [];
    for (const model of candidates) {
      try {
        return await run(model);
      } catch (error) {
        const status = error instanceof GigaChatApiError ? error.status : undefined;
        if (status === 402) exhausted.push(model);
        else if (status === 404 && auto) unavailable.push(model);
        else throw error;
        this.exhaustedUntil.set(model, this.now() + EXHAUSTED_MEMORY_MS);
      }
    }
    if (!auto) throw new InsufficientTokensError(requested);
    if (exhausted.length === 0) {
      throw new Error(`None of the models in the priority list is available (HTTP 404): ${unavailable.join(", ")}.`);
    }
    throw new AllModelsExhaustedError(exhausted, unavailable);
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
      }).catch((error: unknown) => {
        throw toNetworkError(error, this.baseUrl);
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
        throw new GigaChatApiError(response.status);
      }
      return response;
    }
  }
}
