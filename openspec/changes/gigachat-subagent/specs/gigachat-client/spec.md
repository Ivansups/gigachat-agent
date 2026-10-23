## ADDED Requirements

### Requirement: Chat completion
The system SHALL send chat requests to GigaChat with a valid bearer token and return the model response, supporting a non-streaming and a streaming mode.

#### Scenario: Non-streaming request
- **WHEN** a chat request is made with a model and messages
- **THEN** the system returns the assistant message and usage information

#### Scenario: Streaming request
- **WHEN** a streaming chat request is made
- **THEN** the system yields response chunks as they arrive and ends the stream on completion

### Requirement: Model listing
The system SHALL return the list of models available to the configured account.

#### Scenario: List models
- **WHEN** model listing is requested
- **THEN** the system returns model identifiers from the GigaChat models endpoint

### Requirement: OpenAI to GigaChat conversion
The system SHALL convert OpenAI-style requests and responses to and from GigaChat API format, including `tools` to `functions`, with at most one function call passed per assistant message.

#### Scenario: Tools converted
- **WHEN** an OpenAI request contains `tools`
- **THEN** the GigaChat request contains equivalent `functions`

#### Scenario: Function call response converted
- **WHEN** GigaChat returns a function call
- **THEN** the system returns it as an OpenAI-style tool call

### Requirement: Tool schema simplification
The system SHALL simplify tool schemas before sending them to GigaChat by removing unsupported constructs (such as `anyOf` and `oneOf`), limiting nesting depth and shortening long descriptions.

#### Scenario: Union types removed
- **WHEN** a tool schema contains `anyOf`
- **THEN** the converted schema contains no `anyOf` and remains valid

### Requirement: Retry policy
The system SHALL retry once with a new token on HTTP 401 and SHALL retry with backoff on HTTP 429, and SHALL retry once with an error hint when the model returns an invalid function call.

#### Scenario: Expired token mid-session
- **WHEN** a request returns HTTP 401
- **THEN** the system refreshes the token and repeats the request once

#### Scenario: Rate limited
- **WHEN** a request returns HTTP 429
- **THEN** the system waits with backoff and retries up to the configured limit

### Requirement: Input size guard
The system SHALL truncate or reject inputs that exceed the configured per-model context budget instead of sending an oversized request.

#### Scenario: Oversized input
- **WHEN** the request exceeds the context budget
- **THEN** the system truncates it according to the configured policy and reports that truncation occurred
