import { describe, expect, it } from "vitest";
import { toGigaChatRequest, fromGigaChatResponse } from "./convert.js";

describe("toGigaChatRequest", () => {
  it("converts tools to functions", () => {
    const request = toGigaChatRequest({
      model: "GigaChat",
      messages: [{ role: "user", content: "hi" }],
      tools: [
        {
          type: "function",
          function: { name: "read", description: "Read a file", parameters: { type: "object", properties: {} } },
        },
      ],
    });

    expect(request.functions).toEqual([
      { name: "read", description: "Read a file", parameters: { type: "object", properties: {} } },
    ]);
    expect("tools" in request).toBe(false);
  });

  it("passes only the first tool call of an assistant message as function_call", () => {
    const request = toGigaChatRequest({
      model: "GigaChat",
      messages: [
        {
          role: "assistant",
          content: null,
          tool_calls: [
            { id: "c1", type: "function", function: { name: "read", arguments: '{"path":"a"}' } },
            { id: "c2", type: "function", function: { name: "read", arguments: '{"path":"b"}' } },
          ],
        },
      ],
    });

    expect(request.messages[0]).toEqual({
      role: "assistant",
      content: "",
      function_call: { name: "read", arguments: { path: "a" } },
    });
  });

  it("maps tool results to function messages using the call name", () => {
    const request = toGigaChatRequest({
      model: "GigaChat",
      messages: [
        {
          role: "assistant",
          content: null,
          tool_calls: [{ id: "c1", type: "function", function: { name: "read", arguments: "{}" } }],
        },
        { role: "tool", tool_call_id: "c1", content: "file body" },
      ],
    });

    expect(request.messages[1]).toEqual({
      role: "function",
      name: "read",
      content: JSON.stringify({ result: "file body" }),
    });
  });

  it("keeps plain text messages and sampling options", () => {
    const request = toGigaChatRequest({
      model: "GigaChat",
      messages: [
        { role: "system", content: "be brief" },
        { role: "user", content: "hi" },
      ],
      temperature: 0.2,
      max_tokens: 100,
      stream: true,
    });

    expect(request).toMatchObject({
      model: "GigaChat",
      temperature: 0.2,
      max_tokens: 100,
      stream: true,
      messages: [
        { role: "system", content: "be brief" },
        { role: "user", content: "hi" },
      ],
    });
  });
});

describe("fromGigaChatResponse", () => {
  it("returns plain assistant text in OpenAI shape", () => {
    const response = fromGigaChatResponse(
      {
        model: "GigaChat",
        choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "hello" } }],
        usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
      },
      "GigaChat",
    );

    expect(response.choices[0]).toMatchObject({
      finish_reason: "stop",
      message: { role: "assistant", content: "hello" },
    });
    expect(response.usage).toEqual({ prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 });
  });

  it("converts a function_call into an OpenAI tool call", () => {
    const response = fromGigaChatResponse(
      {
        choices: [
          {
            index: 0,
            finish_reason: "function_call",
            message: { role: "assistant", content: "", function_call: { name: "read", arguments: { path: "a" } } },
          },
        ],
      },
      "GigaChat",
    );

    const choice = response.choices[0];
    expect(choice?.finish_reason).toBe("tool_calls");
    expect(choice?.message.tool_calls).toEqual([
      { id: expect.any(String), type: "function", function: { name: "read", arguments: '{"path":"a"}' } },
    ]);
  });
});
