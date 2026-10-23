import { describe, expect, it } from "vitest";
import { defaultCacheDir, loadConfig } from "./config.js";

describe("defaultCacheDir", () => {
  it("honours an explicit override, then XDG, then ~/.cache", () => {
    expect(defaultCacheDir({ GIGACHAT_CACHE_DIR: "/custom" }, "/home/u")).toBe("/custom");
    expect(defaultCacheDir({ XDG_CACHE_HOME: "/xdg" }, "/home/u")).toBe("/xdg/gigachat");
    expect(defaultCacheDir({}, "/home/u")).toBe("/home/u/.cache/gigachat");
  });
});

describe("loadConfig", () => {
  it("reads credentials, scope and TLS settings from the environment", () => {
    const config = loadConfig({
      GIGACHAT_CREDENTIALS: "a2V5",
      GIGACHAT_SCOPE: "GIGACHAT_API_CORP",
      GIGACHAT_CA_BUNDLE_FILE: "/tmp/ca.pem",
      GIGACHAT_VERIFY_SSL: "false",
    });

    expect(config).toEqual({
      credentials: "a2V5",
      scope: "GIGACHAT_API_CORP",
      caBundleFile: "/tmp/ca.pem",
      verifySsl: false,
    });
  });

  it("defaults to the personal scope with TLS verification on", () => {
    const config = loadConfig({ GIGACHAT_CREDENTIALS: "a2V5" });

    expect(config.scope).toBe("GIGACHAT_API_PERS");
    expect(config.verifySsl).toBe(true);
    expect(config.caBundleFile).toBeUndefined();
  });

  it("treats empty optional values as unset", () => {
    const config = loadConfig({
      GIGACHAT_CREDENTIALS: "a2V5",
      GIGACHAT_SCOPE: "",
      GIGACHAT_CA_BUNDLE_FILE: "",
      GIGACHAT_VERIFY_SSL: "",
    });

    expect(config.scope).toBe("GIGACHAT_API_PERS");
    expect(config.caBundleFile).toBeUndefined();
    expect(config.verifySsl).toBe(true);
  });

  it("reads optional API and auth endpoints so the new api.giga.chat host can be used", () => {
    const config = loadConfig({
      GIGACHAT_CREDENTIALS: "a2V5",
      GIGACHAT_BASE_URL: "https://api.giga.chat/v1",
      GIGACHAT_AUTH_URL: "https://auth.example/api/v2/oauth",
    });

    expect(config.baseUrl).toBe("https://api.giga.chat/v1");
    expect(config.authUrl).toBe("https://auth.example/api/v2/oauth");
  });

  it("leaves endpoints unset by default", () => {
    const config = loadConfig({ GIGACHAT_CREDENTIALS: "a2V5" });

    expect(config.baseUrl).toBeUndefined();
    expect(config.authUrl).toBeUndefined();
  });

  it("fails clearly when credentials are missing", () => {
    expect(() => loadConfig({})).toThrow(/GIGACHAT_CREDENTIALS/);
  });
});
