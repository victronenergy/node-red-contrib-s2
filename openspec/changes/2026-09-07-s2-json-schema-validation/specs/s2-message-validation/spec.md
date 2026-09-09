## Purpose

Defines schema-based validation of S2 config and message payloads against the S2 protocol version actually deployed, so a malformed payload is rejected with a clear error at the point it is authored or sent, rather than only failing downstream on the CEM side.

## ADDED Requirements

### Requirement: Schema matches the deployed S2 protocol version
Any JSON schema used to validate S2 payloads SHALL match the S2 protocol version this repo's nodes implement (currently `0.0.2-beta`, per `src/lib/s2/messages.ts`'s `supported_protocol_versions`), not a newer or older protocol version's shape.

#### Scenario: Schema source targets a different protocol version
- **WHEN** the only available schema source (e.g. `s2-json`) targets a protocol version other than the one this repo implements
- **THEN** validation SHALL NOT be enabled against that mismatched schema; the gap SHALL be resolved (schema adaptation, an alternate source, or a documented reduced-scope check) before this capability is considered implemented

### Requirement: Config save-time validation
`s2-ombc-config` and `s2-pebc-config`'s Advanced-mode editor SHALL validate the entered `systemDescription` JSON against the applicable schema before it is saved, and SHALL surface a specific, actionable error (not just "invalid JSON") when validation fails.

#### Scenario: Advanced-mode JSON fails schema validation
- **WHEN** a user saves Advanced-mode JSON that is syntactically valid but violates the S2 schema (e.g. a wrong type, a missing required field, an out-of-range enum value)
- **THEN** the save is rejected and the editor shows a message identifying what about the JSON is invalid

#### Scenario: Advanced-mode JSON passes schema validation
- **WHEN** a user saves Advanced-mode JSON that satisfies the S2 schema
- **THEN** the save proceeds as it does today, unaffected by this capability

### Requirement: Message-path validation
`s2-rm`'s session layer SHALL validate outgoing S2 messages against the applicable schema before sending them, and SHALL validate incoming S2 messages against the applicable schema on receipt, logging a clear diagnostic when a message fails validation.

#### Scenario: An outgoing message would violate the schema
- **WHEN** a control-type node (e.g. `s2-ombc`, `s2-pebc`) constructs an outgoing message that does not satisfy the S2 schema
- **THEN** the message SHALL NOT be sent as-is, and a diagnostic is logged identifying the violation

#### Scenario: An incoming message violates the schema
- **WHEN** a message is received from the CEM that does not satisfy the S2 schema
- **THEN** the message SHALL be treated as invalid input (not forwarded into normal instruction/status handling), and a diagnostic is logged identifying the violation

#### Scenario: Valid messages are unaffected
- **WHEN** an outgoing or incoming message satisfies the S2 schema
- **THEN** it SHALL be sent/handled exactly as it is today, with no behavior change from this capability
