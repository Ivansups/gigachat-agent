export const PACKAGE_NAME = "@gigachat-agent/mcp";

export { createHandlers, type Handlers, type HandlerDeps } from "./handlers.js";
export { createServer } from "./server.js";
export { runOpencode, READ_ONLY_CONFIG, type OpencodeRunOptions, type OpencodeRunResult } from "./opencode.js";
export { parseOpencodeEvents } from "./events.js";
