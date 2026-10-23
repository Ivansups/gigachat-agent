import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

const DEFAULT_AUTH_URL = "https://ngw.devices.sberbank.ru:9443/api/v2/oauth";
const REFRESH_MARGIN_MS = 5 * 60_000;
const LOCK_STALE_MS = 15_000;
const LOCK_WAIT_MS = 30_000;
const LOCK_POLL_MS = 25;
/** Values below this are unix seconds, above are milliseconds. */
const SECONDS_THRESHOLD = 1e12;

export interface TokenProviderOptions {
  /** Base64(Client_ID:Client_Secret) authorization key. */
  credentials: string;
  scope: string;
  /** Directory for the shared token cache (token.json and its lock). */
  cacheDir: string;
  authUrl?: string;
  fetch?: typeof fetch;
  now?: () => number;
}

interface CachedToken {
  fingerprint: string;
  accessToken: string;
  expiresAt: number;
}

/** Returns a valid GigaChat access token, sharing it across processes via a file cache. */
export class TokenProvider {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly authUrl: string;
  private readonly fingerprint: string;
  private readonly cachePath: string;
  private readonly lockPath: string;
  private inflight: Promise<string> | undefined;

  constructor(private readonly options: TokenProviderOptions) {
    this.fetchImpl = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
    this.authUrl = options.authUrl ?? DEFAULT_AUTH_URL;
    this.fingerprint = createHash("sha256")
      .update(`${options.scope}:${options.credentials}`)
      .digest("hex")
      .slice(0, 16);
    this.cachePath = join(options.cacheDir, "token.json");
    this.lockPath = join(options.cacheDir, "token.lock");
  }

  /** Returns a token that stays valid for at least five more minutes. */
  getToken(): Promise<string> {
    this.inflight ??= this.resolve().finally(() => {
      this.inflight = undefined;
    });
    return this.inflight;
  }

  /** Drops the cached token so the next call requests a new one. */
  async invalidate(): Promise<void> {
    await rm(this.cachePath, { force: true });
  }

  private async resolve(): Promise<string> {
    const cached = await this.readValid();
    if (cached) return cached;

    await mkdir(this.options.cacheDir, { recursive: true });
    const deadline = Date.now() + LOCK_WAIT_MS;
    for (;;) {
      if (await this.tryLock()) {
        try {
          return (await this.readValid()) ?? (await this.refresh());
        } finally {
          await rm(this.lockPath, { force: true });
        }
      }
      await this.dropStaleLock();
      const shared = await this.readValid();
      if (shared) return shared;
      if (Date.now() > deadline) throw new Error("GigaChat token lock timeout");
      await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_MS));
    }
  }

  private async tryLock(): Promise<boolean> {
    try {
      const handle = await open(this.lockPath, "wx", 0o600);
      await handle.close();
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw error;
    }
  }

  private async dropStaleLock(): Promise<void> {
    try {
      const { mtimeMs } = await stat(this.lockPath);
      if (Date.now() - mtimeMs > LOCK_STALE_MS) await rm(this.lockPath, { force: true });
    } catch {
      // lock vanished between checks
    }
  }

  private async readValid(): Promise<string | undefined> {
    try {
      const cached = JSON.parse(await readFile(this.cachePath, "utf8")) as CachedToken;
      const fresh = cached.expiresAt - this.now() > REFRESH_MARGIN_MS;
      return cached.fingerprint === this.fingerprint && fresh ? cached.accessToken : undefined;
    } catch {
      return undefined;
    }
  }

  private async refresh(): Promise<string> {
    const response = await this.fetchImpl(this.authUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${this.options.credentials}`,
        RqUID: randomUUID(),
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({ scope: this.options.scope }).toString(),
    });
    if (!response.ok) {
      throw new Error(`GigaChat OAuth failed: HTTP ${response.status}`);
    }
    const body = (await response.json()) as { access_token: string; expires_at: number };
    const expiresAt =
      body.expires_at < SECONDS_THRESHOLD ? body.expires_at * 1000 : body.expires_at;
    const entry: CachedToken = {
      fingerprint: this.fingerprint,
      accessToken: body.access_token,
      expiresAt,
    };
    const tmp = `${this.cachePath}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(entry), { mode: 0o600 });
    await rename(tmp, this.cachePath);
    return entry.accessToken;
  }
}
