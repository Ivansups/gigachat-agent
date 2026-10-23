## Context

GigaChat (Sber) authenticates via OAuth2: `POST /api/v2/oauth` with `Authorization: Basic <authorization key>`, a `RqUID` (uuid4) header and `scope` form field. The access token lives ~30 minutes (`expires_at` is returned); token requests are limited to 10/s. The API is served with Russian Trusted Root CA certificates, and tool calling uses GigaChat `functions` (one function call per message), not the OpenAI `tools` format. The older auth URL is being retired in favour of `api.giga.chat`.

Existing community plugins for opencode (PetrIIvanov, Overman775, konstant16-Z) already convert formats and refresh tokens in memory. Existing opencode MCP wrappers either need a resident `opencode serve` (AlaeddineMessadi, mcp-subagents-opencode, Dheerax) or are small unverified projects (nosolosoft, aoalejo). Nothing combines: no resident process, any `provider/model`, and GigaChat support.

Constraint from the owner: no permanent background process; MCP over stdio; usable from any agent (Claude Code, Codex, Cursor, opencode).

## Goals / Non-Goals

**Goals:**
- One shared `core` library for GigaChat access, used by both the opencode plugin and the MCP server.
- Token cache on disk so short-lived processes do not re-authenticate every call.
- MCP server that lives only as long as the client session; each agentic run is a one-shot subprocess.
- Safe defaults: agent runs are read-only unless writes are requested explicitly.
- Works with any MCP client; model selected as `provider/model`.

**Non-Goals:**
- Forking opencode (fallback only, see Decisions).
- A resident daemon or `opencode serve` dependency.
- Matching Claude-level multi-step agentic quality; GigaChat is for narrow tasks.
- Multi-account support in one plugin instance.
- Publishing to npm or upstreaming in this change.

## Decisions

1. **Plugin + MCP over a fork.** The plugin API covers the provider and OAuth needs; a fork would need constant upstream syncing. Alternative considered: fork with a built-in `opencode mcp-serve` command running the core in-process. Kept as a fallback if the plugin API (step "opencode-plugin") proves insufficient.
2. **Layered monorepo (`core`, `opencode-plugin`, `mcp`), pnpm + TypeScript strict + vitest.** `core` has no process of its own; plugin and MCP are thin adapters. Alternative: a single package with everything; rejected because the plugin must be loadable by opencode without MCP SDK dependencies.
3. **Two MCP modes.** `ask` calls `core` directly (no opencode, fast, prompt-only; files are passed in by the caller). `run_agent` / `continue_session` spawn `opencode run --format json` per call and parse the event stream. Alternative: always go through opencode; rejected because simple tasks should not pay opencode startup cost.
4. **File-based token cache with lock.** Stored under the user cache directory (e.g. `~/.cache/gigachat/token.json`, mode 0600), refreshed when less than 5 minutes remain; a lock file ensures concurrent processes share one refresh. Alternative: in-memory only (what existing plugins do); rejected because each one-shot process would re-authenticate.
5. **Converter simplifies tool schemas.** Strip `anyOf`/`oneOf`, limit nesting, shorten descriptions; retry once with an error hint on invalid function call output. Based on behaviour of existing plugins, verified against real GigaChat in end-to-end tests.
6. **Safety defaults.** `run_agent` runs a read-only opencode agent (edit and bash denied) unless `allow_write=true`; permissions are never auto-approved; output is truncated to a limit; each run has a timeout and is killed on cancel.
7. **Credentials via environment / `.env`**, never committed (`.gitignore`); scope configurable (`GIGACHAT_API_PERS`, `GIGACHAT_API_CORP`; the business scope name is to be verified in official docs).
8. **TDD throughout.** Tests are written first on mocked fetch / mocked subprocess; real GigaChat is touched only in the manual verification and end-to-end steps.

## Risks / Trade-offs

- [GigaChat tool calling is weak at multi-step work] → narrow read-only default, simplified schemas, retries; position it for review, summaries, test generation.
- [Context limit unknown; 32k was only an example config value] → verify per-model limits in official docs; truncate inputs and tool output in `core`/`mcp`.
- [opencode plugin API may be insufficient] → decision gate at the plugin step; fallback is a fork with the same `core`.
- [`opencode run --format json` event format and flags may change] → isolate parsing in one module with tests on recorded fixtures; check `opencode run --help` against the installed version.
- [Third-party plugin code is a reference, not a dependency] → logic is re-implemented and tested here; license (MIT) acknowledged where code is adapted.
- [Child processes run with the user's permissions] → read-only default and explicit opt-in for writes.

## Open Questions

- RESOLVED: context is 128 000 tokens per official model pages; scopes are PERS, B2B (prepaid packages) and CORP (pay-as-you-go). Output limit is not published.
- RESOLVED: the plugin API allows a custom `fetch` through the auth `loader`; the virtual base URL is only a placeholder. Verified on opencode 1.18.29. Note: the loader only runs when credentials are stored in the auth store, and undici must not be bundled into the plugin because it breaks loading under Bun.
- PARTIAL: flags confirmed from `opencode run --help` (1.18.29); `step_start` and `error` events seen live, the `text` event shape is still an assumption.
- Which MCP clients to cover in end-to-end tests beyond Claude Code (Codex, Cursor, opencode).
