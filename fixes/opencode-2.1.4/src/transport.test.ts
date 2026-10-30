import { describe, expect, it, vi } from "vitest";
import type { ChatResponse } from "../../../packages/core/src/index.js";
import { completeStream, withFunctionCalling } from "./transport.js";

function capture(): { fetch: typeof fetch; bodies: unknown[] } {
  const bodies: unknown[] = [];
  return { bodies, fetch: (async (_input, init) => {
    bodies.push(init?.body);
    return new Response("{}");
  }) as typeof fetch };
}

describe("GigaChat function transport", () => {
  it("explicitly enables native functions without changing their schemas", async () => {
    const c = capture();
    const functions = [{ name: "write", parameters: { type: "object", properties: { content: { type: "string" } } } }];
    await withFunctionCalling(c.fetch)("https://example.test/v1/chat/completions", {
      method: "POST", body: JSON.stringify({ model: "GigaChat", functions, messages: [] }),
    });
    expect(JSON.parse(c.bodies[0] as string)).toEqual({ model: "GigaChat", functions, messages: [], function_call: "auto" });
  });

  it("restores nested tool schemas instead of sending truncated object nodes", async () => {
    const c = capture();
    const parameters = { type: "object", properties: { questions: { type: "array", items: {
      type: "object", properties: { options: { type: "array", items: {
        type: "object", properties: { label: { type: "string" } }, required: ["label"],
      } } },
    } } } };
    const request = { model: "GigaChat", messages: [], tools: [{ type: "function" as const, function: { name: "question", parameters } }] };
    await withFunctionCalling(c.fetch, () => request)("https://example.test/chat/completions", {
      body: JSON.stringify({ functions: [{ name: "question", parameters: { type: "object" } }] }),
    });
    const body = JSON.parse(c.bodies[0] as string);
    expect(body.functions[0].parameters).toEqual(parameters);
  });

  it.each(["none", { type: "function", function: { name: "read" } }])("maps an explicit tool choice %j", async (tool_choice) => {
    const c = capture();
    const request = { model: "GigaChat", messages: [], tool_choice };
    await withFunctionCalling(c.fetch, () => request)("https://example.test/chat/completions", {
      body: JSON.stringify({ functions: [{ name: "read" }] }),
    });
    expect(JSON.parse(c.bodies[0] as string).function_call).toEqual(tool_choice === "none" ? "none" : { name: "read" });
  });

  it("does not parse or modify OAuth form bodies", async () => {
    const c = capture();
    await withFunctionCalling(c.fetch)("https://example.test/oauth", { method: "POST", body: "scope=GIGACHAT_API_PERS" });
    expect(c.bodies).toEqual(["scope=GIGACHAT_API_PERS"]);
  });

  it("leaves requests without functions unchanged", async () => {
    const c = capture(); const body = '{"messages":[],"stream":false}';
    await withFunctionCalling(c.fetch)("https://example.test/chat/completions", { body });
    expect(c.bodies).toEqual([body]);
  });

  it("emits a complete function call with one stable ID and intact arguments", async () => {
    const call = { id: "call_original", type: "function" as const, function: { name: "write", arguments: '{"path":"probe.txt","content":"AFTER"}' } };
    const response: ChatResponse = { id: "r", model: "GigaChat", choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [call] } }] };
    const chat = vi.fn(async () => response);
    const chunks = [];
    for await (const chunk of completeStream({ chat })({ model: "GigaChat", messages: [] })) chunks.push(chunk);
    expect(chat).toHaveBeenCalledTimes(1);
    expect(chunks).toEqual([{ choices: [{ index: 0, delta: { role: "assistant", tool_calls: [call] }, finish_reason: "tool_calls" }] }]);
  });

  it("preserves normal text and finish reasons", async () => {
    const chat = async (): Promise<ChatResponse> => ({ id: "r", model: "GigaChat", choices: [{ index: 0, message: { role: "assistant", content: "OK" }, finish_reason: "stop" }] });
    const chunks = [];
    for await (const chunk of completeStream({ chat })({ model: "GigaChat", messages: [] })) chunks.push(chunk);
    expect(chunks).toEqual([{ choices: [{ index: 0, delta: { role: "assistant", content: "OK" }, finish_reason: "stop" }] }]);
  });
});
