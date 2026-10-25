import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import manifest from "../package.json" with { type: "json" };
import type { Handlers } from "./handlers.js";

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

async function respond(run: () => Promise<string>): Promise<ToolResult> {
  try {
    return { content: [{ type: "text", text: await run() }] };
  } catch (error) {
    return { content: [{ type: "text", text: (error as Error).message }], isError: true };
  }
}

const runShape = {
  prompt: z.string().describe("Self-contained task for the agent"),
  model: z.string().optional().describe("provider/model, e.g. 'GigaChat (Sberbank)/GigaChat'"),
  cwd: z.string().optional().describe("Working directory inside the allowed root"),
  allow_write: z.boolean().optional().describe("Allow file edits and shell commands (default: read-only)"),
  timeout_ms: z.number().int().positive().optional().describe("Timeout in ms (max 1 hour)"),
};

/** Registers the GigaChat tools on a new MCP server. */
export function createServer(handlers: Handlers): McpServer {
  const server = new McpServer({ name: "gigachat-agent", version: manifest.version });

  server.registerTool(
    "ask",
    {
      description: "Ask GigaChat a question directly (no agent, no tools). Good for review, summaries and drafts.",
      inputSchema: {
        prompt: z.string(),
        system: z.string().optional(),
        model: z.string().optional(),
        files: z.array(z.string()).optional().describe("Files inside the allowed root to include as context"),
      },
      annotations: { readOnlyHint: true },
    },
    (args) => respond(() => handlers.ask(args)),
  );

  server.registerTool(
    "run_agent",
    {
      description:
        "Run an agentic task through a one-shot `opencode run` (read-only unless allow_write is set). Returns the result and a session id.",
      inputSchema: { ...runShape, agent: z.string().optional().describe("opencode agent name") },
    },
    (args) => respond(() => handlers.runAgent(args)),
  );

  server.registerTool(
    "continue_session",
    {
      description: "Continue an earlier run_agent session by its session id.",
      inputSchema: { session_id: z.string(), ...runShape },
    },
    (args) => respond(() => handlers.continueSession(args)),
  );

  server.registerTool(
    "list_models",
    {
      description: "List available models as provider/model (GigaChat and, if installed, opencode).",
      annotations: { readOnlyHint: true },
    },
    () => respond(() => handlers.listModels()),
  );

  return server;
}
