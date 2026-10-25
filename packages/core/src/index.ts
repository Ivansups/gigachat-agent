export const PACKAGE_NAME = "@gigachat-agent/core";

export {
  AUTO_MODEL,
  DEFAULT_MODEL_PRIORITY,
  GigaChatClient,
  type GigaChatClientOptions,
  type TokenSource,
} from "./client.js";
export { AllModelsExhaustedError, GigaChatApiError, GigaChatNetworkError, InsufficientTokensError } from "./errors.js";
export { envFileCandidates, loadEnvFiles } from "./env-files.js";
export { defaultCacheDir, loadConfig, parseModelPriority, type GigaChatConfig } from "./config.js";
export { TokenProvider, type TokenProviderOptions } from "./auth/token.js";
export { buildTlsOptions, createGigaChatFetch, type TlsSettings } from "./auth/tls.js";
export { fromGigaChatChunk, fromGigaChatResponse, toGigaChatRequest } from "./convert/convert.js";
export { simplifySchema } from "./convert/schema.js";
export { applyInputBudget } from "./convert/guard.js";
export type * from "./types.js";
