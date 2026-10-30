import { AsyncLocalStorage } from "node:async_hooks";
import {
  GigaChatClient, TokenProvider, createGigaChatFetch, defaultCacheDir, parseModelPriority, simplifySchema,
  type ChatChunk, type ChatRequest,
} from "../../../packages/core/src/index.js";
import { resolveCredentials } from "../../../packages/opencode-plugin/src/credentials.js";
import { createOpenAIFetch } from "../../../packages/opencode-plugin/src/openai-fetch.js";

/** v1 GigaChat uses function_call, rather than the OpenAI tool_choice field. */
export function withFunctionCalling(upstream: typeof fetch, currentRequest: () => ChatRequest | undefined = () => undefined): typeof fetch {
  return (async (input, init) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    if (url.pathname.endsWith("/chat/completions") && typeof init?.body === "string") {
      const body = JSON.parse(init.body) as Record<string, unknown>;
      if (Array.isArray(body["functions"]) && body["functions"].length > 0) {
        const original = currentRequest();
        const functions = original?.tools?.map(({ function: fn }) => ({
          name: fn.name, ...(fn.description ? { description: fn.description } : {}),
          // The shared converter truncates at depth 4, invalidating nested V2 tools.
          parameters: simplifySchema(fn.parameters ?? { type: "object", properties: {} }, { maxDepth: 16 }),
        })) ?? body["functions"];
        const choice = (original as (ChatRequest & { tool_choice?: unknown }) | undefined)?.tool_choice;
        const named = typeof choice === "object" && choice !== null
          ? (choice as { function?: { name?: string } }).function?.name : undefined;
        const functionCall = choice === "none" ? "none" : named ? { name: named } : "auto";
        init = { ...init, body: JSON.stringify({ ...body, functions, function_call: functionCall }) };
      }
    }
    return upstream(input, init);
  }) as typeof fetch;
}

/** Complete function calls before emitting SSE, so IDs/arguments cannot fragment. */
export function completeStream(client: Pick<GigaChatClient, "chat">): (request: ChatRequest) => AsyncGenerator<ChatChunk> {
  return async function* (request) {
    const response = await client.chat(request);
    yield {
      choices: response.choices.map((choice) => ({
        index: choice.index,
        delta: { role: "assistant", ...(choice.message.content ? { content: choice.message.content } : {}),
          ...(choice.message.tool_calls ? { tool_calls: choice.message.tool_calls } : {}) },
        finish_reason: choice.finish_reason,
      })),
    };
  };
}

export async function createTransport(env: Record<string, string | undefined>, stored?: { type: "api"; key: string }): Promise<{
  apiKey: string; fetch: typeof fetch;
}> {
  const { credentials, scope } = resolveCredentials(stored, env);
  const secureFetch = await createGigaChatFetch({
    caBundleFile: env["GIGACHAT_CA_BUNDLE_FILE"] || undefined,
    verifySsl: (env["GIGACHAT_VERIFY_SSL"] || "true").toLowerCase() !== "false",
  });
  const requests = new AsyncLocalStorage<ChatRequest>();
  const fetchImpl = withFunctionCalling(secureFetch, () => requests.getStore());
  const tokens = new TokenProvider({ credentials, scope, cacheDir: defaultCacheDir(env), fetch: fetchImpl,
    ...(env["GIGACHAT_AUTH_URL"] ? { authUrl: env["GIGACHAT_AUTH_URL"] } : {}) });
  const modelPriority = parseModelPriority(env["GIGACHAT_MODEL_PRIORITY"]);
  const client = new GigaChatClient({ tokens, fetch: fetchImpl,
    ...(env["GIGACHAT_BASE_URL"] ? { baseUrl: env["GIGACHAT_BASE_URL"] } : {}),
    ...(modelPriority ? { modelPriority } : {}) });
  const chat = (request: ChatRequest) => requests.run(request, () => client.chat(request));
  return { apiKey: "gigachat", fetch: createOpenAIFetch({
    chat,
    stream: completeStream({ chat }),
    listModels: () => client.listModels(),
  }) };
}
