import { createGigaChatPlugin } from "./plugin.js";

export const PACKAGE_NAME = "@gigachat-agent/opencode-plugin";

export { createGigaChatPlugin, PROVIDER_ID } from "./plugin.js";
export { createOpenAIFetch } from "./openai-fetch.js";

/** opencode loads this default export as a plugin module. */
export default { id: "gigachat", server: createGigaChatPlugin() };
