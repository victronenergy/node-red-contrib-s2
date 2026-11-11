## ADDED Requirements

### Requirement: Selection replay command
The RM SHALL accept a `ReplaySelection` command with a `controlType` and no `cemId`. For every connected CEM whose selected control type equals it, the RM SHALL emit `SelectControlType` with that control type and `replay: true` on its "from CEM" output, and SHALL send nothing to any CEM. Without a `controlType` the command SHALL be rejected.

#### Scenario: One of two CEMs has FRBC selected
- **WHEN** CEM A has FRBC selected, CEM B has OMBC selected, and `{ command: 'ReplaySelection', controlType: 'FILL_RATE_BASED_CONTROL' }` arrives
- **THEN** the RM emits one `SelectControlType` for A with `replay: true`, and nothing for B or to either CEM

#### Scenario: No sessions after a full deploy
- **WHEN** `ReplaySelection` arrives and no CEM is connected
- **THEN** the RM emits nothing

## MODIFIED Requirements

### Requirement: Generic status update command
The RM SHALL accept an `UpdateStatus` command containing a control-type-namespaced status payload and a `cemId`, and SHALL send the corresponding S2 status message to that CEM's session. For `FILL_RATE_BASED_CONTROL` the `frbc` namespace MAY carry any of `actuatorStatuses`, `storageStatus`, `timerStatuses`, `usageForecast` and `fillLevelTargetProfile`; the RM SHALL send one S2 message per entry present, in that order, and SHALL reject an `frbc` payload that carries none of them.

#### Scenario: Control-type node reports confirmed state
- **WHEN** an `UpdateStatus` command is received for a connected CEM with a namespaced status payload
- **THEN** the RM sends the corresponding status message (e.g. `OMBC.Status`) to that CEM

#### Scenario: FRBC storage and actuator status in one command
- **WHEN** an `UpdateStatus` command with `controlType: 'FILL_RATE_BASED_CONTROL'` and `frbc: { actuatorStatuses: [a], storageStatus: s }` is received for a connected CEM
- **THEN** the RM sends `FRBC.ActuatorStatus` for `a` followed by `FRBC.StorageStatus` for `s`, each with its own `message_id`, and both pass S2 schema validation

#### Scenario: Empty FRBC status payload
- **WHEN** an `UpdateStatus` command with `controlType: 'FILL_RATE_BASED_CONTROL'` and an `frbc` object containing none of the supported entries is received
- **THEN** the RM sends nothing and reports an error

### Requirement: Generic system description command
The RM SHALL accept a `SystemDescription` command containing a control-type-namespaced system description payload and a `cemId`, and SHALL send the corresponding S2 system description message to that CEM's session. For `FILL_RATE_BASED_CONTROL` the `frbc` namespace SHALL carry `systemDescription` (`actuators`, `storage`) and MAY carry `leakageBehaviour`; the RM SHALL send `FRBC.SystemDescription`, then `FRBC.LeakageBehaviour` if present, `valid_from` defaulting to now.

#### Scenario: Control-type node pushes its system description
- **WHEN** a `SystemDescription` command is received for a connected CEM with a namespaced system description payload
- **THEN** the RM sends the corresponding system description message (e.g. `OMBC.SystemDescription`) to that CEM

#### Scenario: FRBC system description with leakage behaviour
- **WHEN** a `SystemDescription` command with `controlType: 'FILL_RATE_BASED_CONTROL'` and `frbc: { systemDescription, leakageBehaviour }` is received for a connected CEM
- **THEN** the RM sends `FRBC.SystemDescription` followed by `FRBC.LeakageBehaviour` to that CEM
