## ADDED Requirements

### Requirement: GigaChat provider in opencode
The plugin SHALL register a provider named "GigaChat (Sberbank)" in opencode backed by the shared core library, usable as `GigaChat (Sberbank)/<model>`.

#### Scenario: Run with GigaChat model
- **WHEN** the user runs `opencode run --model "GigaChat (Sberbank)/GigaChat"` with the plugin installed
- **THEN** opencode sends the request to GigaChat through the core library and prints the answer

### Requirement: Login through opencode
The plugin SHALL support `opencode providers login` for the provider, accepting the authorization key and scope, and SHALL also accept credentials from environment variables.

#### Scenario: Login with key and scope
- **WHEN** the user logs in with a key and a scope
- **THEN** the credentials are stored in the opencode auth store and used for subsequent requests

### Requirement: Tool calling through the provider
The plugin SHALL pass opencode tool definitions through the core converter so that GigaChat can call opencode tools.

#### Scenario: File read via tool
- **WHEN** the user asks the model to read a project file
- **THEN** the model's function call is translated to an opencode tool call and the result is returned to the model

### Requirement: Thin adapter
The plugin SHALL contain no OAuth or format-conversion logic of its own and SHALL delegate to the core library.

#### Scenario: Shared behaviour
- **WHEN** token handling changes in the core library
- **THEN** the plugin picks it up without code changes in the plugin package
