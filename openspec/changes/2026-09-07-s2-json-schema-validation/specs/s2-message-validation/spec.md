## Purpose

Defines schema-based validation of S2 config and message payloads against the S2 protocol version actually deployed, so a malformed payload is rejected with a clear error at the point it is authored or sent, rather than only failing downstream on the CEM side.

## ADDED Requirements

### Requirement: Schema matches the deployed S2 protocol version
Any JSON schema used to validate S2 payloads SHALL match the S2 protocol version this repo's nodes implement (currently `0.0.2-beta`, per `src/lib/s2/messages.ts`'s `supported_protocol_versions`), not a newer or older protocol version's shape. The schema source used SHALL be `flexiblepower/s2-json`'s `v0.0.2-beta` git tag.

#### Scenario: Schema source targets a different protocol version
- **WHEN** the only available schema source (e.g. `s2-json`) targets a protocol version other than the one this repo implements
- **THEN** validation SHALL NOT be enabled against that mismatched schema; the gap SHALL be resolved (schema adaptation, an alternate source, or a documented reduced-scope check) before this capability is considered implemented

### Requirement: Known upstream schema discrepancies do not block valid messages
Where the vendored `v0.0.2-beta` schema is known to diverge from the human-readable S2 standard in a way that would reject an otherwise-conformant message this repo legitimately sends, that specific constraint SHALL be treated as advisory (logged, not enforced) rather than causing the message to be rejected or blocked from sending. This currently applies to two known cases on `ResourceManagerDetails.schema.json`: `maxItems: 5` on `available_control_types`, and `minItems: 1` on `provides_power_measurement_types` - neither appears in the S2 standard's own `ResourceManagerDetails` documentation, and both are suspected to be schema-authoring defects (unconfirmed with upstream as of this writing).

#### Scenario: A resource advertises all five real control types plus NOT_CONTROLABLE
- **WHEN** an outgoing `ResourceManagerDetails.available_control_types` has 6 entries (5 real control types plus `NOT_CONTROLABLE`, per `s2-rm-protocol`'s always-advertised guarantee)
- **THEN** the message SHALL still be sent, not rejected by validation, despite exceeding the vendored schema's `maxItems: 5` constraint on that field

#### Scenario: A resource explicitly configured to provide no power measurement
- **WHEN** an outgoing `ResourceManagerDetails.provides_power_measurement_types` is an empty array (a resource deliberately configured to provide no power measurement)
- **THEN** the message SHALL still be sent, not rejected by validation, despite violating the vendored schema's `minItems: 1` constraint on that field

### Requirement: New RM config nodes default to providing power measurement
Since the S2 standard marks `provides_power_measurement_types` mandatory without clarifying whether an empty value is acceptable (see the advisory-discrepancy requirement above), and this repo has not yet reached S2 protocol version `1.0.0` (so its own defaults remain free to change), `s2-rm-config` and `s2-resource` SHALL each offer a "Provides power measurement" checkbox, checked by default for a newly added node, gating the existing power-measurement-type selector (3-phase-symmetric / per-phase). Unchecking it SHALL still be possible, for a device that genuinely provides none - producing the advisory-only empty-array case above, not a validation failure.

#### Scenario: Newly added node defaults to providing power measurement
- **WHEN** a new `s2-rm-config` or `s2-resource` node's edit dialog is opened for the first time
- **THEN** "Provides power measurement" is checked, and the existing type selector (3-phase-symmetric / per-phase) is shown and usable

#### Scenario: Unchecking still allows saving a no-measurement configuration
- **WHEN** a user unchecks "Provides power measurement" and saves
- **THEN** the node deploys advertising `provides_power_measurement_types: []`, without a validation error blocking the save or the message-path send

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
