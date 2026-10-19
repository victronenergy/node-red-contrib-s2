## MODIFIED Requirements

### Requirement: Status request when no status is available
After sending the `SystemDescription` command for a CEM newly selecting OMBC, if that CEM has neither a persisted status nor a default available, `s2-ombc` SHALL emit a `ModeRequest` notification. For a node at behaviour version 0.9.7 or later (see "Behaviour version") it SHALL be (`{ topic: 'ModeRequest', payload: { message, modes }, cemId }`) on its instruction output, without waiting for the CEM's acknowledgment of the system description, and show a yellow `waiting for ModeConfirmation` status. `message` SHALL say in plain words that no operation mode is known yet and that the flow should send a `ModeConfirmation` with the current one; `modes` SHALL list every configured operation mode as `{ id, index, label }`, the same identifiers a `ModeConfirmation` accepts and a `ModeInstruction` carries (`label` being the mode's `diagnostic_label`, or its `id` when it has none). For a node without a behaviour version, it SHALL stay `{ topic: 'ModeRequest', payload: null, cemId }`, without the status change.

#### Scenario: No persisted status and no default
- **WHEN** a CEM selects OMBC, has no persisted status, and no default has been set
- **THEN** `s2-ombc` sends the `SystemDescription` command and then emits a `ModeRequest` on its instruction output whose payload has a `message` and lists the configured modes in `modes`, and its status shows `waiting for ModeConfirmation`

#### Scenario: Default available
- **WHEN** a CEM selects OMBC and a default status is available (per "Pre-connection default status")
- **THEN** no `ModeRequest` notification is emitted

#### Scenario: Node deployed before behaviour versions
- **WHEN** a node without a `version` property (deployed with an earlier release) emits a `ModeRequest`
- **THEN** it is `{ topic: 'ModeRequest', payload: null, cemId }`, as before

#### Scenario: Modes listed in the request
- **WHEN** the system description has modes `Off` (id `5c5b...`) and `On` (id `f65c...`), and a `ModeRequest` is emitted
- **THEN** its `payload.modes` is `[{ id: '5c5b...', index: 0, label: 'Off' }, { id: 'f65c...', index: 1, label: 'On' }]`, and sending any one of those back as a `ModeConfirmation` confirms that mode

### Requirement: Persisted status cleared when a CEM deselects OMBC
When a CEM sends `SelectControlType` for anything other than `OPERATION_MODE_BASED_CONTROL` (including `NOT_CONTROLABLE`), `s2-ombc` SHALL clear that CEM's persisted status. A later reselection of OMBC by the same CEM SHALL then be treated exactly as if it had no persisted status at all - seeded from the default status if one is set (per "Pre-connection default status"), or otherwise triggering a `ModeRequest` notification (per "Status request when no status is available") - instead of resending the stale mode from before the CEM switched away. A CEM disconnecting and reconnecting without an intervening `SelectControlType` away from OMBC is unaffected - its persisted status survives that cycle unchanged.

#### Scenario: Reselecting OMBC after switching away, no default configured
- **WHEN** a CEM has a persisted OMBC status, selects a different control type (or `NOT_CONTROLABLE`), and later selects OMBC again, with no default status configured
- **THEN** `s2-ombc` sends `SystemDescription` and emits a `ModeRequest` (per "Status request when no status is available"), instead of resending the status from before the CEM switched away

#### Scenario: Reselecting OMBC after switching away, default configured
- **WHEN** a CEM has a persisted OMBC status, selects a different control type, and later selects OMBC again, with a default status configured
- **THEN** `s2-ombc` sends `UpdateStatus` using the default status, instead of the CEM's now-cleared prior status

#### Scenario: Disconnect and reconnect without switching control type
- **WHEN** a CEM with a persisted OMBC status disconnects and later reconnects and reselects OMBC, without ever selecting a different control type in between
- **THEN** its persisted status is unaffected and is resent as before, unchanged from today's behavior

## ADDED Requirements

### Requirement: Behaviour version
`s2-ombc` and `s2-resource` SHALL have a `version` property holding the release whose behaviour the node has, which only newly added nodes get (from the palette, or set in the shipped examples). A behaviour change SHALL apply only to nodes at or above the release that introduced it, comparing versions per dotted part as numbers. A node without a version SHALL keep the earlier behaviour.

#### Scenario: Node from the palette
- **WHEN** an `s2-ombc` or `s2-resource` node is dropped from the palette
- **THEN** it has `version` `0.9.7` and uses the behaviour of that release

#### Scenario: Later release
- **WHEN** a node's `version` is `0.10.0` and a behaviour was introduced in `0.9.7`
- **THEN** the node has that behaviour, since `0.10.0` is later than `0.9.7`

#### Scenario: Existing node opened and saved
- **WHEN** an `s2-ombc` node deployed with an earlier release is opened and saved with Done, without pressing "Update to latest"
- **THEN** it still has no `version` and keeps the earlier behaviour

### Requirement: Update to latest in the dialog
When the edit dialog of a node without a `version` shows a part whose behaviour differs between versions (the OMBC control type), it SHALL say what the newer behaviour does and offer "Update to latest". Pressing it and then Done SHALL set the node to the latest version.

#### Scenario: Existing node updated
- **WHEN** "Update to latest" is pressed in that node's dialog and then Done
- **THEN** the node has the current release as `version` and uses its behaviour after deploy

#### Scenario: Notice only where behaviour differs
- **WHEN** an `s2-resource` without a `version` has `Control type: None`
- **THEN** no version notice is shown
