import { describe, expect, it } from "vitest";
import { GigaChatNetworkError, toNetworkError } from "./errors.js";

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
