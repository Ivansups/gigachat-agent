import { describe, expect, it, vi } from "vitest";
import { buildTlsOptions, createGigaChatFetch } from "./tls.js";

describe("createGigaChatFetch under Bun", () => {
  it("passes TLS options through Bun's `tls` fetch option instead of an undici dispatcher", async () => {
    const baseFetch = vi.fn(async () => new Response("ok"));
    const fetchImpl = await createGigaChatFetch(
      { caBundleFile: "/certs/ca.pem", verifySsl: true },
      { isBun: true, baseFetch: baseFetch as unknown as typeof fetch, readFile: async () => "PEM" },
    );

    await fetchImpl("https://example.test/x", { method: "POST" });

    const init = (baseFetch.mock.calls[0] as unknown as [string, { tls: unknown; method: string }])[1];
    expect(init.method).toBe("POST");
    expect(init.tls).toEqual({ ca: "PEM", rejectUnauthorized: true });
  });
});

describe("buildTlsOptions", () => {
  it("loads the CA bundle from the configured path and verifies TLS", async () => {
    const readFile = vi.fn(async () => "PEM-DATA");

    const options = await buildTlsOptions({ caBundleFile: "/certs/ca.pem", verifySsl: true }, { readFile });

    expect(readFile).toHaveBeenCalledWith("/certs/ca.pem", "utf8");
    expect(options).toEqual({ ca: "PEM-DATA", rejectUnauthorized: true });
  });

  it("uses the system trust store when no bundle is configured", async () => {
    const options = await buildTlsOptions({ verifySsl: true });

    expect(options).toEqual({ rejectUnauthorized: true });
  });

  it("skips verification only when explicitly disabled and warns", async () => {
    const warn = vi.fn();

    const options = await buildTlsOptions({ verifySsl: false }, { warn });

    expect(options.rejectUnauthorized).toBe(false);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("fails with a clear message when the bundle cannot be read", async () => {
    const readFile = vi.fn(async () => {
      throw new Error("ENOENT");
    });

    await expect(
      buildTlsOptions({ caBundleFile: "/missing.pem", verifySsl: true }, { readFile }),
    ).rejects.toThrow(/\/missing\.pem/);
  });
});
