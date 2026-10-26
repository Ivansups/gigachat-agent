import { describe, expect, it } from "vitest";
import { GigaChatApiError, GigaChatNetworkError, InsufficientTokensError, AllModelsExhaustedError, toNetworkError } from "./errors.js";

const failure = (code: string): TypeError => new TypeError("fetch failed", { cause: { code } });

describe("toNetworkError", () => {
  it("tells how to fix an untrusted certificate instead of a bare 'fetch failed'", () => {
    const error = toNetworkError(failure("SELF_SIGNED_CERT_IN_CHAIN"), "https://ngw.devices.sberbank.ru:9443/api/v2/oauth");

    expect(error).toBeInstanceOf(GigaChatNetworkError);
    expect(error.message).toContain("SELF_SIGNED_CERT_IN_CHAIN");
    expect(error.message).toContain("GIGACHAT_CA_BUNDLE_FILE");
    expect(error.message).toContain("Russian Trusted Root CA");
  });

  it("recognises every certificate trust failure code", () => {
    for (const code of ["DEPTH_ZERO_SELF_SIGNED_CERT", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "UNABLE_TO_VERIFY_LEAF_SIGNATURE"]) {
      expect(toNetworkError(failure(code), "https://x.test/").message).toContain("GIGACHAT_CA_BUNDLE_FILE");
    }
  });

  it("points at the network or VPN for other failures and names the host", () => {
    const error = toNetworkError(failure("UND_ERR_CONNECT_TIMEOUT"), "https://api.giga.chat/v1/chat/completions");

    expect(error.message).toContain("https://api.giga.chat");
    expect(error.message).toContain("UND_ERR_CONNECT_TIMEOUT");
    expect(error.message).toMatch(/VPN/);
    expect(error.message).not.toContain("GIGACHAT_CA_BUNDLE_FILE");
  });

  it("falls back to the error message when there is no cause code", () => {
    expect(toNetworkError(new Error("boom"), "https://x.test/").message).toContain("boom");
  });
});

describe("GigaChatApiError", () => {
  it("status field equals constructor arg", () => {
    const error = new GigaChatApiError(500);
    expect(error.status).toBe(500);
  });

  it("message is 'GigaChat API error: HTTP 500'", () => {
    const error = new GigaChatApiError(500);
    expect(error.message).toBe("GigaChat API error: HTTP 500");
  });

  it("name is 'GigaChatApiError'", () => {
    const error = new GigaChatApiError(500);
    expect(error.name).toBe("GigaChatApiError");
  });
});

describe("InsufficientTokensError", () => {
  it("model field set", () => {
    const error = new InsufficientTokensError("giga-1");
    expect(error.model).toBe("giga-1");
  });

  it("message contains the model name and 'HTTP 402'", () => {
    const error = new InsufficientTokensError("giga-1");
    expect(error.message).toContain("giga-1");
    expect(error.message).toContain("HTTP 402");
  });

  it("name is 'InsufficientTokensError'", () => {
    const error = new InsufficientTokensError("giga-1");
    expect(error.name).toBe("InsufficientTokensError");
  });
});

describe("AllModelsExhaustedError", () => {
  it("models and unavailable fields set", () => {
    const error = new AllModelsExhaustedError(["giga-1", "giga-2"], ["giga-3"]);
    expect(error.models).toEqual(["giga-1", "giga-2"]);
    expect(error.unavailable).toEqual(["giga-3"]);
  });

  it("message lists exhausted models", () => {
    const error = new AllModelsExhaustedError(["giga-1", "giga-2"]);
    expect(error.message).toContain("giga-1");
    expect(error.message).toContain("giga-2");
  });

  it("message contains 'HTTP 404' and the unavailable names only when unavailable is non-empty", () => {
    const error = new AllModelsExhaustedError(["giga-1"], ["giga-3"]);
    expect(error.message).toContain("HTTP 404");
    expect(error.message).toContain("giga-3");

    const error2 = new AllModelsExhaustedError(["giga-1"]);
    expect(error2.message).not.toContain("HTTP 404");
    expect(error2.message).not.toContain("giga-3");
  });

  it("name is 'AllModelsExhaustedError'", () => {
    const error = new AllModelsExhaustedError(["giga-1"]);
    expect(error.name).toBe("AllModelsExhaustedError");
  });
});
