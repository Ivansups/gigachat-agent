## Why

Sber GigaChat is a cheap, Russia-hosted model that is useful as a subagent for narrow tasks (review, summarization, test generation, text), but it is hard to reach from agent tooling: OAuth2 with a 30-minute token, `RqUID` headers, Russian Trusted Root CA certificates, and a non-OpenAI wire format. Existing community pieces cover only part of the need: opencode plugins give GigaChat as a provider, and generic opencode MCP wrappers either require a long-running `opencode serve` or cannot select arbitrary models. We want one client-agnostic tool that any MCP-capable agent (Claude Code, Codex, Cursor, opencode) can call to delegate work to GigaChat, without a resident process.

## What Changes

- New pnpm TypeScript monorepo `gigachat-agent` with three packages.
- `core`: GigaChat OAuth with a file-based token cache (survives short-lived processes), TLS trust for Russian Trusted Root CA, chat/stream client, OpenAI <-> GigaChat converter (tool schema simplification, one function call per message, retries).
- `opencode-plugin`: thin opencode provider "GigaChat (Sberbank)" built on `core`.
- `mcp`: stdio MCP server exposing `ask` (plain model answer), `run_agent` / `continue_session` (agentic work through a one-shot `opencode run` subprocess), and `list_models`.
- Read-only by default for agent runs; writes require an explicit parameter; no auto-approval of permissions.
- No fork of opencode: opencode is used as an installed engine plus a plugin. A fork is a fallback only if the plugin API proves insufficient.

## Capabilities

### New Capabilities
- `gigachat-auth`: obtain, cache (file-based, lock-protected) and refresh GigaChat OAuth tokens; TLS trust configuration.
- `gigachat-client`: chat and streaming requests to GigaChat, model listing, OpenAI <-> GigaChat conversion, retries on 401/429.
- `opencode-provider`: opencode plugin that registers GigaChat as a provider using the core library.
- `mcp-subagent`: stdio MCP server with `ask`, `run_agent`, `continue_session`, `list_models`; read-only defaults, timeouts, output limits.

### Modified Capabilities
<!-- None: greenfield repository. -->

## Impact

- New code only: `packages/core`, `packages/opencode-plugin`, `packages/mcp`.
- Runtime dependencies: Node.js, an installed `opencode` CLI (for `run_agent` only), `@modelcontextprotocol/sdk`.
- Secrets: GigaChat authorization key supplied via `.env` / environment, never committed; scope (`GIGACHAT_API_PERS` or `GIGACHAT_API_CORP`) is configurable.
- Known limits accepted: weak multi-step tool calling in GigaChat, context size to be verified against official docs, narrow task scope recommended.
