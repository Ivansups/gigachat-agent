import { describe, expect, it } from "vitest";
import { formatStoredKey, resolveCredentials } from "./credentials.js";

describe("stored key format", () => {
  it("round-trips scope and authorization key", () => {
    const stored = formatStoredKey("GIGACHAT_API_CORP", "a2V5");

    expect(resolveCredentials({ type: "api", key: stored }, {})).toEqual({
      scope: "GIGACHAT_API_CORP",
      credentials: "a2V5",
    });
  });

  it("treats a bare key as the personal scope", () => {
    expect(resolveCredentials({ type: "api", key: "a2V5" }, {})).toEqual({
      scope: "GIGACHAT_API_PERS",
      credentials: "a2V5",
    });
  });
});

describe("resolveCredentials", () => {
  it("falls back to environment variables when nothing is stored", () => {
    expect(
      resolveCredentials(undefined, { GIGACHAT_CREDENTIALS: "ZW52", GIGACHAT_SCOPE: "GIGACHAT_API_CORP" }),
    ).toEqual({ scope: "GIGACHAT_API_CORP", credentials: "ZW52" });
  });

  it("prefers the stored key over the environment", () => {
    const stored = formatStoredKey("GIGACHAT_API_PERS", "c3RvcmVk");

    expect(resolveCredentials({ type: "api", key: stored }, { GIGACHAT_CREDENTIALS: "ZW52" }).credentials).toBe(
      "c3RvcmVk",
    );
  });

  it("explains how to log in when no credentials exist", () => {
    expect(() => resolveCredentials(undefined, {})).toThrow(/providers login/);
  });
});
