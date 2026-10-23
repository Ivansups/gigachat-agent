## ADDED Requirements

### Requirement: Stdio MCP server without resident processes
The system SHALL expose an MCP server over stdio that runs only for the lifetime of the client session and SHALL NOT require `opencode serve` or any other long-running helper.

#### Scenario: Server lifetime
- **WHEN** the MCP client starts and later closes the session
- **THEN** the server process starts with the client and exits when the stdio connection closes, leaving no background processes

### Requirement: ask tool
The server SHALL provide an `ask` tool that sends a prompt (with optional system prompt, model and file contents) directly to GigaChat through the core library and returns the answer.

#### Scenario: Plain question
- **WHEN** a client calls `ask` with a prompt
- **THEN** the server returns the model's answer without starting opencode

#### Scenario: Files as context
- **WHEN** a client calls `ask` with file paths
- **THEN** the file contents are included in the prompt within the context budget

### Requirement: run_agent tool
The server SHALL provide a `run_agent` tool that runs a task through a one-shot `opencode run --format json` subprocess with a selectable `provider/model`, working directory and timeout, and returns the final result and a session identifier.

#### Scenario: Agent run completes
- **WHEN** a client calls `run_agent` with a prompt and model
- **THEN** the server spawns `opencode run`, parses its event stream, returns the final text and the session id, and the subprocess has exited

#### Scenario: Timeout
- **WHEN** the run exceeds its timeout
- **THEN** the server terminates the subprocess and returns a timeout error with any partial output

### Requirement: Session continuation
The server SHALL provide `continue_session` that continues a previous run by session id with a new prompt.

#### Scenario: Continue a session
- **WHEN** a client calls `continue_session` with a valid session id and prompt
- **THEN** the server runs a new one-shot `opencode run` attached to that session and returns the result

### Requirement: Model listing
The server SHALL provide `list_models` returning the models available through GigaChat and, when opencode is installed, through opencode.

#### Scenario: List models
- **WHEN** a client calls `list_models`
- **THEN** the server returns model identifiers in `provider/model` form

### Requirement: Read-only by default
`run_agent` SHALL run with edit and shell permissions denied unless the caller sets an explicit write option, and the server SHALL NOT auto-approve permission requests.

#### Scenario: Default run cannot write
- **WHEN** `run_agent` is called without the write option and the model attempts to edit a file
- **THEN** the edit is denied and the file is unchanged

#### Scenario: Explicit write
- **WHEN** `run_agent` is called with the write option
- **THEN** the run is allowed to edit files within the working directory

### Requirement: Output and resource limits
The server SHALL truncate tool output to a configured size, enforce a default and maximum timeout, and terminate child processes when the client cancels or disconnects.

#### Scenario: Cancellation
- **WHEN** the client cancels a running request or disconnects
- **THEN** the child `opencode run` process is terminated

### Requirement: Client-agnostic registration
The server SHALL work with any MCP client that supports stdio servers, and the documentation SHALL describe registration for Claude Code, Codex, Cursor and opencode.

#### Scenario: Claude Code registration
- **WHEN** the user runs the documented `claude mcp add` command
- **THEN** the tools appear in the Claude Code session and can be called
