/** A non-success HTTP answer from GigaChat; branch on `status`, the body text is not stable. */
export class GigaChatApiError extends Error {
  constructor(readonly status: number) {
    super(`GigaChat API error: HTTP ${status}`);
    this.name = "GigaChatApiError";
  }
}

/** HTTP 402: the tokens of one model are used up. Other limits (429 concurrency, 413 size) never map here. */
export class InsufficientTokensError extends Error {
  constructor(readonly model: string) {
    super(
      `GigaChat tokens are exhausted for model "${model}" (HTTP 402 Payment Required). Top up the balance in the Sber Developers console or choose another model.`,
    );
    this.name = "InsufficientTokensError";
  }
}

/** No model of the automatic priority list could answer: `models` returned 402, `unavailable` returned 404. */
export class AllModelsExhaustedError extends Error {
  constructor(
    readonly models: string[],
    readonly unavailable: string[] = [],
  ) {
    super(
      `GigaChat tokens are exhausted (HTTP 402 Payment Required) for: ${models.join(", ")}. Top up the balance in the Sber Developers console.` +
        (unavailable.length > 0 ? ` Not available to this account or host (HTTP 404): ${unavailable.join(", ")}.` : ""),
    );
    this.name = "AllModelsExhaustedError";
  }
}

/** TLS failures that mean "this certificate chain is not trusted", fixed by supplying the Russian Trusted Root CA. */
const CERTIFICATE_CODES = new Set([
  "SELF_SIGNED_CERT_IN_CHAIN",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
]);

/** The request never got an HTTP answer (DNS, TCP, TLS or timeout); `fetch failed` alone hides which. */
export class GigaChatNetworkError extends Error {
  constructor(
    readonly origin: string,
    readonly code: string,
  ) {
    super(
      CERTIFICATE_CODES.has(code)
        ? `The TLS certificate of ${origin} is not trusted (${code}). Save the Russian Trusted Root CA (Ministry of Digital Development) to a file and set GIGACHAT_CA_BUNDLE_FILE to its path; do not install it system-wide.`
        : `Cannot reach GigaChat at ${origin} (${code}). Check the network or VPN, and the GIGACHAT_BASE_URL setting; a host that is blocked on the current route fails this way.`,
    );
    this.name = "GigaChatNetworkError";
  }
}

/** Turns a failed `fetch` into a readable error naming the host and the cause code. */
export function toNetworkError(error: unknown, url: string): GigaChatNetworkError {
  const cause = (error as { cause?: { code?: string } }).cause;
  return new GigaChatNetworkError(new URL(url).origin, cause?.code ?? (error as Error).message);
}
