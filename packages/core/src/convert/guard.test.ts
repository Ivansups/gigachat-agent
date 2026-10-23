import { describe, expect, it } from "vitest";
import { applyInputBudget } from "./guard.js";

const msg = (role: "system" | "user" | "assistant", content: string): { role: typeof role; content: string } => ({
  role,
  content,
});

describe("applyInputBudget", () => {
  it("leaves requests within budget untouched", () => {
    const messages = [msg("system", "s"), msg("user", "hello")];

    const result = applyInputBudget(messages, 100);

    expect(result.truncated).toBe(false);
    expect(result.messages).toEqual(messages);
  });

  it("drops the oldest non-system messages first", () => {
    const messages = [msg("system", "sys"), msg("user", "a".repeat(50)), msg("assistant", "b".repeat(50)), msg("user", "latest")];

    const result = applyInputBudget(messages, 70);

    expect(result.truncated).toBe(true);
    expect(result.messages[0]).toEqual(msg("system", "sys"));
    expect(result.messages.at(-1)).toEqual(msg("user", "latest"));
    expect(result.messages.length).toBeLessThan(messages.length);
  });

  it("truncates the last message when it alone exceeds the budget", () => {
    const result = applyInputBudget([msg("user", "x".repeat(500))], 100);

    expect(result.truncated).toBe(true);
    const total = result.messages.reduce((sum, m) => sum + (m.content?.length ?? 0), 0);
    expect(total).toBeLessThanOrEqual(100);
  });
});
