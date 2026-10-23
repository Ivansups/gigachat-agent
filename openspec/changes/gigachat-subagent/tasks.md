## 1. Scaffold

- [x] 1.1 Init git repo, `.gitignore` (including `.env`, `node_modules`, token cache), `.env.example` with `GIGACHAT_CREDENTIALS`, `GIGACHAT_SCOPE`, `GIGACHAT_CA_BUNDLE_FILE`, `GIGACHAT_VERIFY_SSL`
- [x] 1.2 pnpm workspace with `packages/core`, `packages/opencode-plugin`, `packages/mcp`; TypeScript strict, vitest, ESLint
- [x] 1.3 Root scripts `lint`, `typecheck`, `test`; one green placeholder test per package; `pnpm lint && pnpm typecheck` clean

## 2. Manual GigaChat verification (needs the authorization key in `.env`)

- [ ] 2.1 Ask the owner to put the key and scope into `.env` (never in chat)
- [ ] 2.2 Install Russian Trusted Root CA certificates and verify TLS with `curl`
- [ ] 2.3 Request a token via `/api/v2/oauth` and call `/models` and `/chat/completions` by hand
- [ ] 2.4 Record real per-model context limits and confirm the business scope name (`B2B` vs `CORP`) from official docs; update design Open Questions

## 3. Core: auth (tests first)

- [ ] 3.1 Test and implement token request (Basic key, uuid4 `RqUID`, scope) on mocked fetch
- [ ] 3.2 Test and implement file token cache with 0600 permissions and reuse across processes
- [ ] 3.3 Test and implement refresh 5 minutes before expiry with a single shared refresh (in-process and file lock)
- [ ] 3.4 Test and implement TLS configuration: CA bundle path, bundled fallback, explicit opt-out with warning
- [ ] 3.5 Test that the key and tokens never appear in errors or logs

## 4. Core: client and converter (tests first)

- [ ] 4.1 Test and implement `chat()` and `stream()` with bearer token
- [ ] 4.2 Test and implement `listModels()`
- [ ] 4.3 Test and implement OpenAI <-> GigaChat conversion, including `tools` -> `functions`, one function call per message
- [ ] 4.4 Test and implement tool schema simplification (`anyOf`/`oneOf`, depth, description length)
- [ ] 4.5 Test and implement retry policy: 401 refresh once, 429 backoff, invalid function call retry with hint
- [ ] 4.6 Test and implement input size guard with truncation report

## 5. opencode plugin

- [ ] 5.1 Read opencode plugin docs and the installed `opencode --help`; decide plugin vs fork (decision gate), note result in design
- [ ] 5.2 Implement provider "GigaChat (Sberbank)" as a thin adapter over `core`
- [ ] 5.3 Implement `opencode providers login` flow for key and scope, plus env fallback
- [ ] 5.4 Verify `opencode run --model "GigaChat (Sberbank)/GigaChat"` for a plain answer and a file-read tool call

## 6. MCP server

- [ ] 6.1 Implement stdio server skeleton with `@modelcontextprotocol/sdk` and lifecycle tests (exits when stdio closes)
- [ ] 6.2 Test and implement `ask` with optional files and context budget
- [ ] 6.3 Capture a real `opencode run --format json` event stream as fixtures and implement the parser in one module
- [ ] 6.4 Test and implement `run_agent` (one-shot subprocess, model, cwd, timeout, result and session id)
- [ ] 6.5 Test and implement `continue_session`
- [ ] 6.6 Test and implement `list_models`
- [ ] 6.7 Implement read-only default (edit and bash denied), explicit `allow_write`, no auto-approval
- [ ] 6.8 Implement output truncation, default and maximum timeouts, child termination on cancel or disconnect

## 7. End-to-end and docs

- [ ] 7.1 Register in Claude Code with `claude mcp add` and run scenarios: diff review, test generation, file edit in a sandbox with `allow_write`
- [ ] 7.2 Register and smoke-test in Codex, Cursor and opencode (`mcp` section)
- [ ] 7.3 Document limits found (tool calling quality, context size) and recommended task types
- [ ] 7.4 Write README in Russian: install, keys, registration per client, safety defaults, troubleshooting
