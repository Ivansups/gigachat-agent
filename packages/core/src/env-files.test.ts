import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { envFileCandidates, loadEnvFiles } from "./env-files.js";

describe("envFileCandidates", () => {
  it("loads only the explicit file and the user config file, never the project .env", () => {
    const files = envFileCandidates({ GIGACHAT_ENV_FILE: "/secure/giga.env" }, "/home/u");

    expect(files).toEqual(["/secure/giga.env", "/home/u/.config/gigachat/.env"]);
    expect(files).not.toContain(".env");
  });

  it("skips the explicit file when it is not set", () => {
    expect(envFileCandidates({}, "/home/u")).toEqual(["/home/u/.config/gigachat/.env"]);
  });
});

describe("loadEnvFiles", () => {
  const writeEnv = (content: string): string => {
    const file = join(mkdtempSync(join(tmpdir(), "giga-env-")), ".env");
    writeFileSync(file, content);
    return file;
  };

  it("fills unset variables from the explicit file and never overrides existing ones", () => {
    const file = writeEnv("GIGACHAT_SCOPE=GIGACHAT_API_CORP\nGIGACHAT_VERIFY_SSL=false\n");
    const env: Record<string, string | undefined> = { GIGACHAT_ENV_FILE: file, GIGACHAT_VERIFY_SSL: "true" };

    loadEnvFiles(env, "/nonexistent-home");

    expect(env["GIGACHAT_SCOPE"]).toBe("GIGACHAT_API_CORP");
    expect(env["GIGACHAT_VERIFY_SSL"]).toBe("true");
  });

  it("ignores missing files", () => {
    const env: Record<string, string | undefined> = { GIGACHAT_ENV_FILE: "/no/such/file" };

    expect(() => loadEnvFiles(env, "/nonexistent-home")).not.toThrow();
  });
});
