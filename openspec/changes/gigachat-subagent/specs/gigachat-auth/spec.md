## ADDED Requirements

### Requirement: Obtain an access token
The system SHALL obtain a GigaChat access token via `POST /api/v2/oauth` using the configured authorization key as a Basic credential, a fresh uuid4 `RqUID` header and the configured `scope` form field.

#### Scenario: Successful token request
- **WHEN** no valid token is available and the client needs one
- **THEN** the system sends the OAuth request with `Authorization: Basic <key>`, a uuid4 `RqUID` and the scope, and stores the returned `access_token` and `expires_at`

#### Scenario: Invalid authorization key
- **WHEN** the OAuth endpoint rejects the key
- **THEN** the system fails with an authentication error that does not contain the key value

### Requirement: Persistent token cache
The system SHALL cache the token and its expiry in a file in the user cache directory with owner-only permissions, so that separate short-lived processes reuse it.

#### Scenario: Reuse across processes
- **WHEN** a second process starts while the cached token is still valid
- **THEN** it uses the cached token without calling the OAuth endpoint

#### Scenario: Cache file permissions
- **WHEN** the cache file is created
- **THEN** it is readable and writable only by the current user

### Requirement: Proactive refresh with a single refresh call
The system SHALL refresh the token when fewer than 5 minutes remain before expiry, and concurrent callers (in-process or cross-process) SHALL share a single refresh request.

#### Scenario: Refresh near expiry
- **WHEN** a request is made and the cached token expires in less than 5 minutes
- **THEN** the system obtains a new token before sending the request

#### Scenario: Concurrent refresh
- **WHEN** several requests need a refresh at the same time
- **THEN** exactly one OAuth request is sent and all requests use its result

### Requirement: TLS trust for Russian Trusted Root CA
The system SHALL verify TLS using the configured CA bundle, falling back to bundled Russian Trusted Root CA certificates, and SHALL allow disabling verification only through an explicit setting.

#### Scenario: Default verification
- **WHEN** no CA bundle path is configured
- **THEN** the system verifies the GigaChat endpoint against the bundled Russian Trusted Root CA certificates

#### Scenario: Explicit opt-out
- **WHEN** verification is disabled by an explicit setting
- **THEN** the system skips certificate verification and logs a warning

### Requirement: Credentials from environment
The system SHALL read the authorization key and scope from environment variables or a `.env` file and SHALL NOT write the key to logs, errors or the token cache.

#### Scenario: Key not leaked
- **WHEN** any error or debug message is produced
- **THEN** it does not contain the authorization key or the access token
