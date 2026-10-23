import type { ChatMessage } from "../types.js";

export interface BudgetResult {
  messages: ChatMessage[];
  truncated: boolean;
}

const size = (message: ChatMessage): number => message.content?.length ?? 0;

/** Fits messages into a character budget: drops the oldest non-system turns, then cuts the last one. */
export function applyInputBudget(messages: ChatMessage[], maxChars: number): BudgetResult {
  let kept = [...messages];
  const total = (): number => kept.reduce((sum, m) => sum + size(m), 0);
  if (total() <= maxChars) return { messages: kept, truncated: false };

  while (total() > maxChars) {
    const index = kept.findIndex((m, i) => m.role !== "system" && i < kept.length - 1);
    if (index === -1) break;
    kept = kept.filter((_, i) => i !== index);
  }
  if (total() > maxChars) {
    const last = kept.length - 1;
    const target = kept[last];
    if (target) {
      const allowed = Math.max(0, maxChars - (total() - size(target)));
      kept[last] = { ...target, content: (target.content ?? "").slice(0, allowed) };
    }
  }
  return { messages: kept, truncated: true };
}
