import { homedir } from "node:os";
import { join } from "node:path";

/** Where the shared token cache lives: explicit override, then XDG cache, then ~/.cache. */
export function defaultCacheDir(
  env: Record<string, string | undefined>,
  home: string = homedir(),
): string {
  return (
    env["GIGACHAT_CACHE_DIR"] || join(env["XDG_CACHE_HOME"] || join(home, ".cache"), "gigachat")
  );
}

export interface GigaChatConfig {
  credentials: string;
  scope: string;
  caBundleFile: string | undefined;
  verifySsl: boolean;
  /** API base URL including the version prefix, e.g. https://api.giga.chat/v1. */
  baseUrl: string | undefined;
  /** OAuth token endpoint; defaults to the ngw.devices.sberbank.ru host. */
  authUrl: string | undefined;
}

const DEFAULT_SCOPE = "GIGACHAT_API_PERS";

/** Reads GigaChat settings from environment variables; empty values count as unset. */
export function loadConfig(env: Record<string, string | undefined>): GigaChatConfig {
  const credentials = env["GIGACHAT_CREDENTIALS"];
  if (!credentials) {
    throw new Error("GIGACHAT_CREDENTIALS is not set");
  }
  return {
    credentials,
    scope: env["GIGACHAT_SCOPE"] || DEFAULT_SCOPE,
    caBundleFile: env["GIGACHAT_CA_BUNDLE_FILE"] || undefined,
    verifySsl: (env["GIGACHAT_VERIFY_SSL"] || "true").toLowerCase() !== "false",
    baseUrl: env["GIGACHAT_BASE_URL"] || undefined,
    authUrl: env["GIGACHAT_AUTH_URL"] || undefined,
  };
}
