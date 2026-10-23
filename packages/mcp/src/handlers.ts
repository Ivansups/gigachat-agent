import { isAbsolute, relative, resolve, sep } from "node:path";
import type { ChatRequest, ChatResponse } from "@gigachat-agent/core";
import type { OpencodeRunOptions, OpencodeRunResult } from "./opencode.js";

const GIGACHAT_PROVIDER = "GigaChat (Sberbank)";
const DEFAULT_ASK_MODEL = "GigaChat";
const DEFAULT_TIMEOUT_MS = 600_000;
const MAX_TIMEOUT_MS = 3_600_000;

export interface HandlerDeps {
  client: {
    chat(request: ChatRequest): Promise<ChatResponse>;
    listModels(): Promise<string[]>;
  };
  runOpencode(options: OpencodeRunOptions): Promise<OpencodeRunResult>;
  listOpencodeModels(): Promise<string[]>;
  readFile(path: string): Promise<string>;
  realpath(path: string): Promise<string>;
  /** Files and working directories must stay inside this directory. */
  root: string;
  /** Default `provider/model` for agent runs. */
  agentModel: string;
}

export interface AskArgs {
  prompt: string;
  system?: string;
  model?: string;
  files?: string[];
}

export interface AgentArgs {
  prompt: string;
  model?: string;
  cwd?: string;
  agent?: string;
  allow_write?: boolean;
  timeout_ms?: number;
}

export interface ContinueArgs extends Omit<AgentArgs, "agent"> {
  session_id: string;
}

export interface Handlers {
  ask(args: AskArgs): Promise<string>;
  runAgent(args: AgentArgs): Promise<string>;
  continueSession(args: ContinueArgs): Promise<string>;
  listModels(): Promise<string>;
}

/** Builds the tool implementations on top of injected dependencies. */
export function createHandlers(deps: HandlerDeps): Handlers {
  const isOutside = (root: string, path: string): boolean => {
    const rel = relative(root, path);
    return rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);
  };

  const inside = (path: string): string => {
    const absolute = resolve(deps.root, path);
    if (isOutside(deps.root, absolute)) {
      throw new Error(`Path is outside the allowed root (${deps.root}): ${path}`);
    }
    return absolute;
  };

  const insideReal = async (path: string): Promise<string> => {
    const [realRoot, real] = await Promise.all([deps.realpath(deps.root), deps.realpath(inside(path))]);
    if (isOutside(realRoot, real)) {
      throw new Error(`Path is outside the allowed root (${deps.root}): ${path}`);
    }
    return real;
  };

  const agentRun = async (args: AgentArgs & { sessionId?: string }): Promise<string> => {
    const result = await deps.runOpencode({
      prompt: args.prompt,
      model: args.model ?? deps.agentModel,
      cwd: await insideReal(args.cwd ?? deps.root),
      timeoutMs: Math.min(args.timeout_ms ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS),
      allowWrite: args.allow_write === true,
      ...(args.agent ? { agent: args.agent } : {}),
      ...(args.sessionId ? { sessionId: args.sessionId } : {}),
    });
    if (result.timedOut) {
      throw new Error(`opencode run timed out. Partial output:\n${result.text}`);
    }
    if (result.error || (result.exitCode ?? 0) !== 0) {
      throw new Error(result.error ?? `opencode exited with code ${result.exitCode}`);
    }
    const notes = [
      result.truncated ? "[output truncated]" : "",
      result.sessionId ? `[session_id: ${result.sessionId}]` : "",
    ].filter(Boolean);
    return [result.text, ...notes].join("\n\n");
  };

  return {
    async ask({ prompt, system, model, files }) {
      const blocks = await Promise.all(
        (files ?? []).map(async (file) => `### File: ${file}\n${await deps.readFile(inside(file))}`),
      );
      const content = [...blocks, prompt].join("\n\n");
      const response = await deps.client.chat({
        model: (model ?? DEFAULT_ASK_MODEL).split("/").at(-1) as string,
        messages: [...(system ? [{ role: "system" as const, content: system }] : []), { role: "user", content }],
      });
      const answer = response.choices[0]?.message.content ?? "";
      return response.truncated ? `${answer}\n\n[note: input was truncated to fit the context budget]` : answer;
    },

    runAgent: (args) => agentRun(args),

    continueSession: ({ session_id, ...rest }) => agentRun({ ...rest, sessionId: session_id }),

    async listModels() {
      const gigachat = (await deps.client.listModels()).map((id) => `${GIGACHAT_PROVIDER}/${id}`);
      let opencode: string[] = [];
      let note = "";
      try {
        opencode = await deps.listOpencodeModels();
      } catch (error) {
        note = `\n(opencode models unavailable: ${(error as Error).message})`;
      }
      return [...gigachat, ...opencode].join("\n") + note;
    },
  };
}
