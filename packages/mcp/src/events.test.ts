import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseOpencodeEvents } from "./events.js";

const line = (value: unknown): string => JSON.stringify(value);

describe("parseOpencodeEvents", () => {
  it("parses a stream recorded from a real opencode 1.18.29 run with a read tool call", () => {
    const stdout = readFileSync(new URL("./__fixtures__/run-read-tool.jsonl", import.meta.url), "utf8");

    const parsed = parseOpencodeEvents(stdout);

    expect(parsed.text).toBe("secret_word equals banana-42.");
    expect(parsed.sessionId).toMatch(/^ses_/);
    expect(parsed.error).toBeUndefined();
  });

  it("collects assistant text and the session id", () => {
    const stdout = [
      line({ type: "step_start", sessionID: "ses_1", part: { type: "step-start" } }),
      line({ type: "text", sessionID: "ses_1", part: { type: "text", text: "Hello" } }),
      line({ type: "text", sessionID: "ses_1", part: { type: "text", text: " world" } }),
      line({ type: "step_finish", sessionID: "ses_1", part: { type: "step-finish" } }),
    ].join("\n");

    expect(parseOpencodeEvents(stdout)).toEqual({ text: "Hello world", sessionId: "ses_1" });
  });

  it("ignores lines that are not JSON", () => {
    const stdout = ["not json", line({ type: "text", sessionID: "ses_2", part: { text: "ok" } })].join("\n");

    expect(parseOpencodeEvents(stdout).text).toBe("ok");
  });

  it("surfaces an error event", () => {
    const stdout = line({ type: "error", sessionID: "ses_3", error: { message: "provider failed" } });

    expect(parseOpencodeEvents(stdout).error).toBe("provider failed");
  });

  it("returns empty text when there is no output", () => {
    expect(parseOpencodeEvents("")).toEqual({ text: "", sessionId: undefined });
  });
});
