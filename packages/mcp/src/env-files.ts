import { join } from "node:path";

/**
 * Env files the server may load. The project's own `.env` is deliberately excluded: the
 * server runs inside repositories it does not control, and such a file could switch off
 * TLS verification or enable the bash opt-in.
 */
export function envFileCandidates(env: Record<string, string | undefined>, home: string): string[] {
  return [env["GIGACHAT_ENV_FILE"], join(home, ".config", "gigachat", ".env")].filter(
    (file): file is string => Boolean(file),
  );
}
