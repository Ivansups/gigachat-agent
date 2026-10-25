import { mkdtemp, readFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GigaChatNetworkError } from "../errors.js";
import { TokenProvider, type TokenProviderOptions } from "./token.js";

const KEY = "c2VjcmV0LWtleQ==";
const NOW = 1_700_000_000_000;

function oauthResponse(token: string, expiresAt: number): Response {
  return new Response(JSON.stringify({ access_token: token, expires_at: expiresAt }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("TokenProvider", () => {
  let dir: string;
  let now: number;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "gigachat-token-"));
    now = NOW;
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function make(
    fetchImpl: typeof fetch,
    overrides: Partial<TokenProviderOptions> = {},
  ): TokenProvider {
    return new TokenProvider({
      credentials: KEY,
      scope: "GIGACHAT_API_PERS",
      cacheDir: dir,
      fetch: fetchImpl,
      now: () => now,
      ...overrides,
    });
  }

  it("requests a token with Basic key, uuid RqUID and scope", async () => {
    const fetchMock = vi.fn(async () => oauthResponse("tok-1", now + 1_800_000));
    const token = await make(fetchMock as unknown as typeof fetch).getToken();

    expect(token).toBe("tok-1");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/api/v2/oauth");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe(`Basic ${KEY}`);
    expect(headers["RqUID"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(String(init.body)).toBe("scope=GIGACHAT_API_PERS");
  });

  it("reuses the cached token across provider instances", async () => {
    const fetchMock = vi.fn(async () => oauthResponse("tok-1", now + 1_800_000));
    await make(fetchMock as unknown as typeof fetch).getToken();
    const second = vi.fn(async () => oauthResponse("tok-2", now + 1_800_000));

    const token = await make(second as unknown as typeof fetch).getToken();

    expect(token).toBe("tok-1");
    expect(second).not.toHaveBeenCalled();
  });

  it("stores the cache file readable only by the owner", async () => {
    const fetchMock = vi.fn(async () => oauthResponse("tok-1", now + 1_800_000));
    await make(fetchMock as unknown as typeof fetch).getToken();

    const path = join(dir, "token.json");
    const mode = (await stat(path)).mode & 0o777;
    expect(mode).toBe(0o600);
    expect(await readFile(path, "utf8")).not.toContain(KEY);
  });

  it("refreshes when fewer than 5 minutes remain", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(oauthResponse("tok-1", now + 1_800_000))
      .mockResolvedValueOnce(oauthResponse("tok-2", now + 3_600_000));
    const provider = make(fetchMock as unknown as typeof fetch);
    await provider.getToken();

    now += 1_800_000 - 4 * 60_000;
    const token = await provider.getToken();

    expect(token).toBe("tok-2");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps a token that still has more than 5 minutes left", async () => {
    const fetchMock = vi.fn(async () => oauthResponse("tok-1", now + 1_800_000));
    const provider = make(fetchMock as unknown as typeof fetch);
    await provider.getToken();

    now += 10 * 60_000;
    await provider.getToken();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("accepts expires_at given in seconds", async () => {
    const fetchMock = vi.fn(async () => oauthResponse("tok-1", Math.floor((now + 1_800_000) / 1000)));
    const provider = make(fetchMock as unknown as typeof fetch);
    await provider.getToken();
    await provider.getToken();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends a single OAuth request for concurrent callers", async () => {
    const fetchMock = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 20));
      return oauthResponse("tok-1", now + 1_800_000);
    });
    const provider = make(fetchMock as unknown as typeof fetch);

    const tokens = await Promise.all([provider.getToken(), provider.getToken(), provider.getToken()]);

    expect(tokens).toEqual(["tok-1", "tok-1", "tok-1"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends a single OAuth request across provider instances sharing a cache dir", async () => {
    const fetchMock = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 40));
      return oauthResponse("tok-1", now + 1_800_000);
    });
    const a = make(fetchMock as unknown as typeof fetch);
    const b = make(fetchMock as unknown as typeof fetch);

    const tokens = await Promise.all([a.getToken(), b.getToken()]);

    expect(tokens).toEqual(["tok-1", "tok-1"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails with an error that does not leak the key", async () => {
    const fetchMock = vi.fn(async () => new Response("denied", { status: 401 }));

    const error = await make(fetchMock as unknown as typeof fetch)
      .getToken()
      .catch((e: unknown) => e as Error);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("401");
    expect((error as Error).message).not.toContain(KEY);
  });

  it("can drop the cached token to force a new one", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(oauthResponse("tok-1", now + 1_800_000))
      .mockResolvedValueOnce(oauthResponse("tok-2", now + 1_800_000));
    const provider = make(fetchMock as unknown as typeof fetch);
    await provider.getToken();

    await provider.invalidate();

    expect(await provider.getToken()).toBe("tok-2");
  });
  it("names the auth host and the cause when the token request cannot connect", async () => {
    const fetchMock = vi.fn(() => Promise.reject(new TypeError("fetch failed", { cause: { code: "SELF_SIGNED_CERT_IN_CHAIN" } })));
    const provider = make(fetchMock as unknown as typeof fetch);

    const error = (await provider.getToken().catch((e: unknown) => e)) as Error;

    expect(error).toBeInstanceOf(GigaChatNetworkError);
    expect(error.message).toContain("https://ngw.devices.sberbank.ru:9443");
    expect(error.message).toContain("GIGACHAT_CA_BUNDLE_FILE");
  });
});
