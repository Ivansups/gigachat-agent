import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "node:util";

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

/** Copies variables from the candidate env files into `env`; already-set variables win and missing files are skipped. */
export function loadEnvFiles(env: Record<string, string | undefined>, home: string = homedir()): void {
  for (const file of envFileCandidates(env, home)) {
    let parsed: Record<string, string | undefined>;
    try {
      parsed = parseEnv(readFileSync(file, "utf8"));
    } catch {
      continue;
    }
    for (const [key, value] of Object.entries(parsed)) {
      env[key] ??= value;
    }
  }
}
