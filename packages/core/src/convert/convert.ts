import { randomUUID } from "node:crypto";
import type {
  ChatChunk,
  ChatRequest,
  ChatResponse,
  GigaChoice,
  GigaMessage,
  GigaRequest,
  GigaResponse,
  ToolCall,
} from "../types.js";
import { simplifySchema } from "./schema.js";

function parseArguments(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Converts an OpenAI-style chat request to the GigaChat API format. */
export function toGigaChatRequest(request: ChatRequest): GigaRequest {
  const callNames = new Map<string, string>();
  const messages: GigaMessage[] = request.messages.map((message) => {
    if (message.role === "assistant" && message.tool_calls?.length) {
      for (const call of message.tool_calls) callNames.set(call.id, call.function.name);
      const first = message.tool_calls[0] as ToolCall;
      return {
        role: "assistant",
        content: message.content ?? "",
        function_call: { name: first.function.name, arguments: parseArguments(first.function.arguments) },
      };
    }
    if (message.role === "tool") {
      return {
        role: "function",
        name: callNames.get(message.tool_call_id ?? "") ?? "tool",
        content: JSON.stringify({ result: message.content ?? "" }),
      };
    }
    return { role: message.role, content: message.content ?? "" };
  });

  const result: GigaRequest = { model: request.model, messages };
  if (request.tools?.length) {
    result.functions = request.tools.map(({ function: fn }) => ({
      name: fn.name,
      ...(fn.description ? { description: fn.description } : {}),
      parameters: simplifySchema(fn.parameters ?? { type: "object", properties: {} }),
    }));
  }
  if (request.temperature !== undefined) result.temperature = request.temperature;
  if (request.max_tokens !== undefined) result.max_tokens = request.max_tokens;
  if (request.stream !== undefined) result.stream = request.stream;
  return result;
}

function toToolCall(call: { name: string; arguments: unknown }): ToolCall {
  const args = typeof call.arguments === "string" ? call.arguments : JSON.stringify(call.arguments ?? {});
  return {
    id: `call_${randomUUID().slice(0, 8)}`,
    type: "function",
    function: { name: call.name, arguments: args },
  };
}

function finishReason(reason: string | null | undefined): string | null {
  return reason === "function_call" ? "tool_calls" : (reason ?? null);
}

/** Converts a GigaChat completion to the OpenAI response shape. */
export function fromGigaChatResponse(raw: GigaResponse, model: string): ChatResponse {
  return {
    id: raw.id ?? `chatcmpl-${randomUUID().slice(0, 8)}`,
    model: raw.model ?? model,
    choices: raw.choices.map((choice: GigaChoice) => {
      const call = choice.message?.function_call;
      return {
        index: choice.index,
        finish_reason: finishReason(choice.finish_reason),
        message: {
          role: "assistant" as const,
          content: choice.message?.content || (call ? null : ""),
          ...(call ? { tool_calls: [toToolCall(call)] } : {}),
        },
      };
    }),
    ...(raw.usage ? { usage: raw.usage } : {}),
  };
}

/** Converts one GigaChat streaming event to an OpenAI chunk. */
export function fromGigaChatChunk(raw: GigaResponse): ChatChunk {
  return {
    choices: raw.choices.map((choice) => {
      const call = choice.delta?.function_call;
      return {
        index: choice.index,
        delta: {
          ...(choice.delta?.role === "assistant" ? { role: "assistant" as const } : {}),
          ...(choice.delta?.content ? { content: choice.delta.content } : {}),
          ...(call ? { tool_calls: [toToolCall(call)] } : {}),
        },
        finish_reason: finishReason(choice.finish_reason),
      };
    }),
  };
}
