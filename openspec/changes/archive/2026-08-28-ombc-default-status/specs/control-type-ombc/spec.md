## ADDED Requirements

### Requirement: Confirm messages may omit cemId
`s2-ombc` SHALL accept a confirm message with no `cemId`, resolving it to the one CEM currently tracked with `OPERATION_MODE_BASED_CONTROL` selected. If no CEM currently has OMBC selected, the confirm SHALL be treated as a default (see "Pre-connection default status"). If more than one CEM currently has OMBC selected, `s2-ombc` SHALL reject the confirm with an error asking the caller to specify `cemId`.

#### Scenario: cemId omitted with exactly one CEM on OMBC
- **WHEN** a confirm message with no `cemId` arrives and exactly one CEM currently has OMBC selected
- **THEN** the confirm applies to that CEM as if its `cemId` had been supplied

#### Scenario: cemId omitted with no CEM on OMBC
- **WHEN** a confirm message with no `cemId` arrives and no CEM currently has OMBC selected
- **THEN** the confirm is stored as the default status rather than applied to any CEM

#### Scenario: cemId omitted with more than one CEM on OMBC
- **WHEN** a confirm message with no `cemId` arrives and more than one CEM currently has OMBC selected
- **THEN** `s2-ombc` rejects the message with an error and sends no status update

### Requirement: Operation mode identified by id, index, or label
A confirm message SHALL identify the operation mode via exactly one of `confirmedOperationModeId`, `confirmedOperationModeIndex` (0-based index into the configured operation modes), or `confirmedOperationModeLabel` (matching a configured mode's `diagnostic_label`). `s2-ombc` SHALL resolve whichever is given to the mode's canonical id before building or persisting status, and SHALL validate it against the CEM's configured operation modes: `confirmedOperationModeId` SHALL match a configured mode's id, `confirmedOperationModeIndex` SHALL be within range, and `confirmedOperationModeLabel` SHALL match exactly one configured mode's `diagnostic_label`. A confirm giving none, or more than one, of these fields SHALL be rejected with an error, as SHALL one whose given identifier does not resolve to exactly one configured mode.

#### Scenario: Mode identified by index
- **WHEN** a confirm message supplies `confirmedOperationModeIndex` referencing a configured operation mode
- **THEN** the resulting status's `activeOperationModeId` is that mode's id

#### Scenario: Mode identified by label
- **WHEN** a confirm message supplies `confirmedOperationModeLabel` matching a configured mode's `diagnostic_label`
- **THEN** the resulting status's `activeOperationModeId` is that mode's id

#### Scenario: No mode identifier supplied
- **WHEN** a confirm message supplies none of `confirmedOperationModeId`, `confirmedOperationModeIndex`, or `confirmedOperationModeLabel`
- **THEN** `s2-ombc` rejects the message with an error

#### Scenario: Unknown id
- **WHEN** a confirm message supplies `confirmedOperationModeId` that does not match any configured operation mode's id
- **THEN** `s2-ombc` rejects the message with an error

#### Scenario: Label matches no configured mode
- **WHEN** a confirm message supplies `confirmedOperationModeLabel` that does not match any configured mode's `diagnostic_label`
- **THEN** `s2-ombc` rejects the message with an error

#### Scenario: Label matches more than one configured mode
- **WHEN** a confirm message supplies `confirmedOperationModeLabel` that matches more than one configured mode's `diagnostic_label`
- **THEN** `s2-ombc` rejects the message with an error

### Requirement: Pre-connection default status
`s2-ombc` SHALL accept a confirm message before any CEM has selected OMBC (or once none currently has) and store it as a single default status. When a CEM selects `OPERATION_MODE_BASED_CONTROL` and has no persisted status of its own, `s2-ombc` SHALL seed that CEM's status from the default and send the corresponding `UpdateStatus` command, exactly as it does for an existing persisted status.

#### Scenario: Default set before any CEM connects
- **WHEN** a confirm message with no resolvable CEM is received, and later a CEM selects OMBC with no persisted status of its own
- **THEN** `s2-ombc` sends `UpdateStatus` to `s2-rm` for that CEM using the stored default

#### Scenario: CEM has its own persisted status
- **WHEN** a CEM selects OMBC and already has a persisted status from a prior confirm targeting it directly
- **THEN** its own persisted status is used, not the default

### Requirement: Status request when no status is available
After sending the `SystemDescription` command for a CEM newly selecting OMBC, if that CEM has neither a persisted status nor a default available, `s2-ombc` SHALL emit a `StatusRequest` notification (`{ topic: 'StatusRequest', cemId }`) on its instruction output, without waiting for the CEM's acknowledgment of the system description.

#### Scenario: No persisted status and no default
- **WHEN** a CEM selects OMBC, has no persisted status, and no default has been set
- **THEN** `s2-ombc` sends the `SystemDescription` command and then emits `{ topic: 'StatusRequest', cemId }` on its instruction output

#### Scenario: Default available
- **WHEN** a CEM selects OMBC and a default status is available (per "Pre-connection default status")
- **THEN** no `StatusRequest` notification is emitted
