import { readFile as readFileFs } from "node:fs/promises";

export interface TlsSettings {
  caBundleFile?: string | undefined;
  verifySsl: boolean;
}

export interface TlsOptions {
  ca?: string;
  rejectUnauthorized: boolean;
}

interface TlsDeps {
  readFile?: (path: string, encoding: "utf8") => Promise<string>;
  warn?: (message: string) => void;
}

/** Resolves TLS options: custom CA bundle if configured, verification off only on explicit opt-out. */
export async function buildTlsOptions(
  settings: TlsSettings,
  deps: TlsDeps = {},
): Promise<TlsOptions> {
  const read = deps.readFile ?? readFileFs;
  const warn = deps.warn ?? ((message: string) => console.error(message));
  if (!settings.verifySsl) {
    warn("GigaChat TLS verification is disabled; use this only for diagnostics");
    return { rejectUnauthorized: false };
  }
  if (!settings.caBundleFile) {
    return { rejectUnauthorized: true };
  }
  try {
    return { ca: await read(settings.caBundleFile, "utf8"), rejectUnauthorized: true };
  } catch (error) {
    throw new Error(
      `Cannot read CA bundle ${settings.caBundleFile}: ${(error as Error).message}`,
    );
  }
}

interface FetchDeps extends TlsDeps {
  /** Force the Bun code path (tests); detected from the runtime by default. */
  isBun?: boolean;
  baseFetch?: typeof fetch;
}

/**
 * Builds a fetch that applies the TLS options: Bun's own `tls` fetch option under Bun
 * (opencode plugins run there), an undici dispatcher under Node.
 */
export async function createGigaChatFetch(
  settings: TlsSettings,
  deps: FetchDeps = {},
): Promise<typeof fetch> {
  const tls = await buildTlsOptions(settings, deps);
  const isBun = deps.isBun ?? "Bun" in globalThis;
  if (isBun) {
    const base = deps.baseFetch ?? fetch;
    return ((input: Parameters<typeof fetch>[0], init?: RequestInit) =>
      base(input, { ...init, tls } as RequestInit)) as typeof fetch;
  }
  // Imported lazily: undici is only needed (and only safe to load) under Node.
  const { Agent, fetch: undiciFetch } = await import("undici");
  const dispatcher = new Agent({ connect: tls });
  return ((input: Parameters<typeof undiciFetch>[0], init?: Parameters<typeof undiciFetch>[1]) =>
    undiciFetch(input, { ...init, dispatcher })) as unknown as typeof fetch;
}
