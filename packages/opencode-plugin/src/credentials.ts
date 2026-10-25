import { loadConfig } from "@gigachat-agent/core";

const DEFAULT_SCOPE = "GIGACHAT_API_PERS";
const STORED_KEY = /^(GIGACHAT_[A-Z0-9_]+):(.+)$/;

export interface ResolvedCredentials {
  scope: string;
  credentials: string;
}

/** opencode stores one string per provider, so scope and key are joined with a colon (Base64 has none). */
export function formatStoredKey(scope: string, key: string): string {
  return `${scope}:${key}`;
}

/** Picks credentials from opencode's auth store first, then from the environment. */
export function resolveCredentials(
  stored: { type?: string; key?: string } | undefined,
  env: Record<string, string | undefined>,
): ResolvedCredentials {
  if (stored?.type === "api" && stored.key) {
    const match = STORED_KEY.exec(stored.key);
    return match
      ? { scope: match[1] as string, credentials: match[2] as string }
      : { scope: DEFAULT_SCOPE, credentials: stored.key };
  }
  if (env["GIGACHAT_CLIENT_ID"] || env["GIGACHAT_CREDENTIALS"]) {
    const { scope, credentials } = loadConfig(env);
    return { scope, credentials };
  }
  throw new Error(
    'No GigaChat credentials. Run `opencode providers login --provider "GigaChat (Sberbank)"` or set GIGACHAT_CLIENT_ID and GIGACHAT_CLIENT_SECRET.',
  );
}
