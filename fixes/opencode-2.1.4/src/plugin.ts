import { loadEnvFiles } from "../../../packages/core/src/index.js";
import { createTransport } from "./transport.js";
import { PROVIDER_ID } from "../../../packages/opencode-plugin/src/plugin.js";

/** Structural subset of @opencode/plugin 2.1.4; no runtime SDK dependency. */
export interface Context {
  provider: {
    transform(callback: (editor: {
      get(id: string): unknown;
      add(input: { info: Record<string, unknown>; models: Record<string, unknown>[] }): void;
    }) => void): Promise<{ dispose(): Promise<void> }>;
  };
  integration: {
    transform(callback: (editor: {
      method: { update(input: Record<string, unknown>): void };
    }) => void): Promise<{ dispose(): Promise<void> }>;
    connection: {
      active(id: string): Promise<unknown>;
      resolve(connection: unknown): Promise<{
        type: string; key?: string; metadata?: Record<string, unknown>;
      } | undefined>;
    };
  };
  permission: {
    hook(name: "evaluate", callback: (event: { action: string; effect: string; message?: string }) => Promise<void>):
      Promise<{ dispose(): Promise<void> }>;
  };
  aisdk: {
    hook(name: "sdk", callback: (input: { options: Record<string, unknown> }) => Promise<void>, options: {
      providerID: string;
    }): Promise<{ dispose(): Promise<void> }>;
  };
}

const MODELS = ["auto", "GigaChat", "GigaChat-2", "GigaChat-2-Pro", "GigaChat-2-Max", "GigaChat-Pro", "GigaChat-Max"];
const SCOPES = ["GIGACHAT_API_PERS", "GIGACHAT_API_CORP", "GIGACHAT_API_B2B"];

export function createPlugin(env?: Record<string, string | undefined>): {
  id: string; setup(context: Context): Promise<() => Promise<void>>;
} {
  return {
    id: "gigachat-opencode-2-1-4",
    async setup(context) {
      if (!env) loadEnvFiles(process.env);
      const registrations: { dispose(): Promise<void> }[] = [];
      try {
        const effectiveEnv = env ?? process.env;
        const readOnly = effectiveEnv["GIGACHAT_OPENCODE_READ_ONLY"] === "1";
        const denyShell = readOnly || effectiveEnv["GIGACHAT_OPENCODE_DENY_SHELL"] === "1";
        const nativeTools = effectiveEnv["GIGACHAT_OPENCODE_NATIVE_TOOLS"] === "1";
        if (readOnly || denyShell || nativeTools) {
          registrations.push(await context.permission.hook("evaluate", async (event) => {
            if ((readOnly && ["edit", "write"].includes(event.action)) ||
                (denyShell && ["shell", "bash"].includes(event.action)) ||
                (nativeTools && event.action === "execute")) {
              event.effect = "deny";
              event.message = "GigaChat MCP run does not permit this action.";
            }
          }));
        }
        registrations.push(await context.provider.transform((editor) => {
          if (editor.get(PROVIDER_ID)) return;
          editor.add({
            info: {
              id: PROVIDER_ID, integrationID: PROVIDER_ID, name: PROVIDER_ID,
              activation: "enabled", package: "aisdk:@ai-sdk/openai-compatible",
              settings: { baseURL: "https://api.gigachat.local/v1" },
            },
            models: MODELS.map((id) => ({
              id, modelID: id, providerID: PROVIDER_ID, name: id,
              capabilities: { tools: true, input: ["text"], output: ["text"] },
              variants: [], time: { released: 0 }, cost: [], status: "active", enabled: true,
              limit: { context: 128000, output: 4096 },
            })),
          });
        }));
        registrations.push(await context.integration.transform((editor) => {
          editor.method.update({
            integrationID: PROVIDER_ID,
            method: {
              type: "key", label: "GigaChat authorization key",
              form: [{
                type: "string", key: "scope", title: "Scope of your key", required: true,
                default: "GIGACHAT_API_PERS",
                options: SCOPES.map((value) => ({ value, label: value })),
              }],
            },
          });
        }));
        registrations.push(await context.aisdk.hook("sdk", async (input) => {
          const connection = await context.integration.connection.active(PROVIDER_ID);
          const credential = connection ? await context.integration.connection.resolve(connection) : undefined;
          if (credential && credential.type !== "key") {
            throw new Error("GigaChat requires a key account. Run opencode auth login 'GigaChat (Sberbank)' --method key.");
          }
          let stored: { type: "api"; key: string } | undefined;
          if (credential?.key) {
            const scope = credential.metadata?.["scope"];
            if (scope !== undefined && (typeof scope !== "string" || !SCOPES.includes(scope))) {
              throw new Error("Invalid GigaChat scope in account metadata; reconnect using opencode auth login.");
            }
            // Accept legacy scope-prefixed keys as well as v2 keys plus form metadata.
            stored = { type: "api", key: /^GIGACHAT_[A-Z0-9_]+:/.test(credential.key)
              ? credential.key : `${scope ?? "GIGACHAT_API_PERS"}:${credential.key}` };
          }
          const options = await createTransport(effectiveEnv, stored).catch((error: unknown) => {
            if (error instanceof Error && error.message.startsWith("No GigaChat credentials.")) {
              throw new Error('No GigaChat credentials. Run `opencode auth login "GigaChat (Sberbank)" --method key` or configure GIGACHAT_CREDENTIALS / GIGACHAT_CLIENT_ID and GIGACHAT_CLIENT_SECRET.');
            }
            throw error;
          });
          if (!options || typeof options["fetch"] !== "function") throw new Error("GigaChat transport initialization failed.");
          Object.assign(input.options, options, { baseURL: "https://api.gigachat.local/v1" });
        }, { providerID: PROVIDER_ID }));
      } catch (error) {
        await Promise.allSettled(registrations.reverse().map((registration) => registration.dispose()));
        throw error;
      }
      return async () => {
        await Promise.all(registrations.reverse().map((registration) => registration.dispose()));
      };
    },
  };
}

export default createPlugin();
