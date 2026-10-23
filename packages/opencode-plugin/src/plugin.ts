import type { Hooks, Plugin } from "@opencode-ai/plugin";
import {
  GigaChatClient,
  TokenProvider,
  createGigaChatFetch,
  defaultCacheDir,
} from "@gigachat-agent/core";
import { formatStoredKey, resolveCredentials } from "./credentials.js";
import { createOpenAIFetch } from "./openai-fetch.js";

export const PROVIDER_ID = "GigaChat (Sberbank)";
/** Virtual host: the custom fetch answers every request, nothing is sent to it. */
const VIRTUAL_BASE_URL = "https://api.gigachat.local/v1";
/** Context is 128 000 tokens for GigaChat 2 / 2 Pro / 2 Max per the official model pages; the output limit is not published there, so it stays conservative. */
const MODEL_LIMITS = { context: 128000, output: 4096 };
const MODELS = ["GigaChat", "GigaChat-2", "GigaChat-2-Pro", "GigaChat-2-Max", "GigaChat-Pro", "GigaChat-Max"];

const SCOPES = [
  { label: "Personal (GIGACHAT_API_PERS)", value: "GIGACHAT_API_PERS" },
  { label: "Business, pay-as-you-go (GIGACHAT_API_CORP)", value: "GIGACHAT_API_CORP" },
  { label: "Business, prepaid packages (GIGACHAT_API_B2B)", value: "GIGACHAT_API_B2B" },
];

interface PluginDeps {
  env?: Record<string, string | undefined>;
}

function providerConfig(): Record<string, unknown> {
  return {
    npm: "@ai-sdk/openai-compatible",
    name: PROVIDER_ID,
    options: { baseURL: VIRTUAL_BASE_URL },
    models: Object.fromEntries(
      MODELS.map((id) => [
        id,
        { name: id, limit: MODEL_LIMITS, modalities: { input: ["text"], output: ["text"] } },
      ]),
    ),
  };
}

/** Builds the opencode plugin that exposes GigaChat as a provider on top of the shared core library. */
export function createGigaChatPlugin(deps: PluginDeps = {}): Plugin {
  const env = deps.env ?? process.env;

  return async (): Promise<Hooks> => ({
    config: async (config) => {
      const target = config as { provider?: Record<string, unknown> };
      target.provider ??= {};
      target.provider[PROVIDER_ID] ??= providerConfig();
    },

    auth: {
      provider: PROVIDER_ID,
      methods: [
        {
          type: "api",
          label: "GigaChat authorization key",
          prompts: [
            { type: "select", key: "scope", message: "Scope of your key", options: SCOPES },
            {
              type: "text",
              key: "key",
              message: "Authorization key (Base64 of Client_ID:Client_Secret)",
            },
          ],
          authorize: async (inputs = {}) => {
            const key = (inputs["key"] ?? "").trim();
            if (!key) return { type: "failed" };
            return {
              type: "success",
              key: formatStoredKey(inputs["scope"] || "GIGACHAT_API_PERS", key),
            };
          },
        },
      ],
      loader: async (getAuth) => {
        const stored = await getAuth().catch(() => undefined);
        const { credentials, scope } = resolveCredentials(
          stored as { type?: string; key?: string } | undefined,
          env,
        );
        const fetchImpl = await createGigaChatFetch({
          caBundleFile: env["GIGACHAT_CA_BUNDLE_FILE"] || undefined,
          verifySsl: (env["GIGACHAT_VERIFY_SSL"] || "true").toLowerCase() !== "false",
        });
        const tokens = new TokenProvider({
          credentials,
          scope,
          cacheDir: defaultCacheDir(env),
          fetch: fetchImpl,
          ...(env["GIGACHAT_AUTH_URL"] ? { authUrl: env["GIGACHAT_AUTH_URL"] } : {}),
        });
        const client = new GigaChatClient({
          tokens,
          fetch: fetchImpl,
          ...(env["GIGACHAT_BASE_URL"] ? { baseUrl: env["GIGACHAT_BASE_URL"] } : {}),
        });
        return { apiKey: "gigachat", fetch: createOpenAIFetch(client) };
      },
    },
  });
}
