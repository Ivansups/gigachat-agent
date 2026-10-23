export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolDefinition {
  type: "function";
  function: { name: string; description?: string; parameters?: Record<string, unknown> };
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
}

export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface ChatResponse {
  id: string;
  model: string;
  choices: {
    index: number;
    finish_reason: string | null;
    message: { role: "assistant"; content: string | null; tool_calls?: ToolCall[] };
  }[];
  usage?: Usage;
  /** True when the input was shortened to fit the context budget. */
  truncated?: boolean;
}

export interface ChatChunk {
  choices: {
    index: number;
    delta: { role?: "assistant"; content?: string; tool_calls?: ToolCall[] };
    finish_reason?: string | null;
  }[];
}

/** GigaChat wire format (subset used by the converter). */
export interface GigaMessage {
  role: "system" | "user" | "assistant" | "function";
  content: string;
  name?: string;
  function_call?: { name: string; arguments: Record<string, unknown> };
}

export interface GigaFunction {
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
}

export interface GigaRequest {
  model: string;
  messages: GigaMessage[];
  functions?: GigaFunction[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
}

export interface GigaChoice {
  index: number;
  finish_reason?: string | null;
  message?: {
    role: string;
    content?: string | null;
    function_call?: { name: string; arguments: unknown };
  };
  delta?: {
    role?: string;
    content?: string | null;
    function_call?: { name: string; arguments: unknown };
  };
}

export interface GigaResponse {
  id?: string;
  model?: string;
  choices: GigaChoice[];
  usage?: Usage;
}
