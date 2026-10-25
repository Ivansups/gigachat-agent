export interface ParsedEvents {
  text: string;
  sessionId: string | undefined;
  error?: string;
}

interface RawEvent {
  type?: string;
  sessionID?: string;
  part?: { text?: string };
  text?: string;
  error?: unknown;
}

function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null) {
    const record = error as { message?: unknown; data?: { message?: unknown } };
    if (typeof record.message === "string") return record.message;
    if (typeof record.data?.message === "string") return record.data.message;
  }
  return "opencode reported an error";
}

/**
 * Extracts assistant text, session id and errors from `opencode run --format json` output.
 * Shape verified against opencode 1.18.29 (see __fixtures__); unknown lines are ignored.
 */
export function parseOpencodeEvents(stdout: string): ParsedEvents {
  let text = "";
  let sessionId: string | undefined;
  let error: string | undefined;
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    let event: RawEvent;
    try {
      event = JSON.parse(trimmed) as RawEvent;
    } catch {
      continue;
    }
    sessionId ??= event.sessionID;
    if (event.type === "text") text += event.part?.text ?? event.text ?? "";
    if (event.type === "error") error = errorMessage(event.error);
  }
  return { text, sessionId, ...(error ? { error } : {}) };
}
