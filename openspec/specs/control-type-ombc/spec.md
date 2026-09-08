# control-type-ombc Specification

## Purpose
Defines the behavior of the `s2-ombc` node: declaring OMBC operation modes to the CEM, resolving OMBC instructions into actionable events, and confirming operation mode changes back to the CEM once hardware state is confirmed.
## Requirements
### Requirement: OMBC system description from configuration
`s2-ombc` SHALL derive the OMBC system description (operation modes and transitions) from its `s2-ombc-config` node. When it observes, on `s2-rm`'s "from CEM" output, that a CEM has selected `OPERATION_MODE_BASED_CONTROL`, it SHALL push that system description back to `s2-rm` via a `SystemDescription` command for `s2-rm` to send to that CEM.

#### Scenario: OMBC becomes the active control type
- **WHEN** the CEM selects `OPERATION_MODE_BASED_CONTROL` as its control type
- **THEN** `s2-ombc` sends a `SystemDescription` command to `s2-rm` for that CEM, and the CEM receives a system description whose operation modes and transitions match `s2-ombc-config`

### Requirement: Instruction resolution into actionable output
On receiving an OMBC instruction, `s2-ombc` SHALL resolve the referenced operation mode against its configuration and emit it on its instruction output with a routable topic and the resolved mode detail.

#### Scenario: OMBC instruction selects a configured mode
- **WHEN** an OMBC instruction referencing a configured operation mode arrives at `s2-ombc`
- **THEN** the node emits a message with `msg.topic` set to that mode's diagnostic label, `msg.controlType` set to `OPERATION_MODE_BASED_CONTROL`, and `msg.ombc.operationMode` containing the mode's id, index, label, and factor

### Requirement: Silent ignoring of non-OMBC instructions
`s2-ombc` SHALL ignore any instruction that is not an OMBC instruction, without emitting a message or raising an error, so that it can be wired in parallel with other control-type nodes downstream of the same `s2-rm` output.

#### Scenario: A PEBC instruction reaches s2-ombc
- **WHEN** a non-OMBC instruction is received at `s2-ombc`
- **THEN** the node emits nothing on either output and does not error

### Requirement: Status is sent only on explicit confirmation
`s2-ombc` SHALL send `OMBC.Status` to the CEM only when explicitly told the operation mode is confirmed, not automatically when an instruction is accepted. When the confirmed mode differs from the previously confirmed mode, the status SHALL include the previous mode id and a transition timestamp.

#### Scenario: Confirmed mode change
- **WHEN** `s2-ombc` is told the active mode has changed to a new configured mode
- **THEN** it sends `OMBC.Status` with the new mode as active, the prior mode as `previous_operation_mode_id`, and a `transition_timestamp`

#### Scenario: Instruction accepted but not yet confirmed
- **WHEN** an OMBC instruction has been acknowledged by `s2-rm` but `s2-ombc` has not been told the mode changed
- **THEN** no `OMBC.Status` message is sent

### Requirement: Reject status updates outside the active control type
`s2-ombc` SHALL reject a confirmed-mode update and raise a warning if OMBC is not the CEM's currently selected control type, instead of sending an invalid status message.

#### Scenario: Confirmation arrives while OMBC is not selected
- **WHEN** `s2-ombc` is told a mode is confirmed but the CEM's selected control type is not `OPERATION_MODE_BASED_CONTROL`
- **THEN** no status message is sent and the node's status shows a warning

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

### Requirement: Default operation modes
`s2-ombc-config`'s friendly editor SHALL pre-populate a "Standby/off" operation mode (zero power on all phases) for a configuration with no existing operation modes, and SHALL prevent it from being removed while in friendly mode.

#### Scenario: New config node has no modes yet
- **WHEN** a `s2-ombc-config` node is opened with no existing `systemDescription`
- **THEN** the friendly editor shows one operation mode representing standby/off (zero power on all phases), and offers no way to delete it

### Requirement: Per-mode minimum-duration timer configuration
`s2-ombc-config`'s friendly editor SHALL offer each operation mode an optional minimum-duration input, entered as minutes and seconds, defaulting to unset (no timer - equivalent to today's behavior). A configured value SHALL apply only to that mode: `s2-ombc`'s obligation is limited to declaring the timer and wiring it into the relevant transitions' `start_timers`/`blocking_timers` correctly (per "Auto-derived transitions in friendly mode"); per the S2 spec, enforcement is the CEM's responsibility - once the CEM has started that timer, it SHALL NOT instruct a transition away from that mode until the configured duration has elapsed. `s2-ombc` does not track timer state locally and cannot itself block a transition.

#### Scenario: Mode has no minimum duration configured
- **WHEN** an operation mode's minimum-duration minutes and seconds fields are both left unset or zero
- **THEN** no timer is generated for that mode and no transition into or out of it references any timer

#### Scenario: Mode has a minimum duration configured
- **WHEN** an operation mode's minimum-duration fields are set to M minutes and S seconds (M and/or S > 0)
- **THEN** the saved `systemDescription` includes exactly one timer for that mode with `duration` of (M x 60 + S) x 1000 milliseconds, wired per the "Auto-derived transitions in friendly mode" requirement

### Requirement: Auto-derived transitions in friendly mode
While in friendly mode, `s2-ombc-config`'s editor SHALL derive a fully-connected transition graph - every configured operation mode able to transition to every other configured operation mode - from the current operation-mode list, without the user authoring any transition directly. For any mode with a configured minimum-duration timer, every transition into that mode SHALL include that timer's id in `start_timers`, and every transition out of that mode SHALL include that timer's id in `blocking_timers`. Transitions where neither endpoint has a configured minimum duration SHALL have empty `start_timers` and `blocking_timers`, as before.

#### Scenario: Two or more operation modes are configured
- **WHEN** the friendly editor's operation-mode list contains N modes, none with a minimum duration configured, and the editor is in friendly mode
- **THEN** the saved `systemDescription`'s transitions include one transition for every ordered pair of distinct modes, each with empty `start_timers` and `blocking_timers`, and `timers` is empty

#### Scenario: A mode has a configured minimum duration
- **WHEN** the friendly editor is in friendly mode and one mode has a minimum-duration value configured
- **THEN** the saved `systemDescription`'s `timers` includes one timer for that mode with `duration` equal to the configured minutes/seconds converted to milliseconds, every transition whose `to` is that mode includes the timer's id in `start_timers`, and every transition whose `from` is that mode includes the timer's id in `blocking_timers`

### Requirement: Friendly/Advanced mode toggle
`s2-ombc-config`'s editor SHALL provide an explicit toggle between friendly mode (the operation-modes list) and Advanced mode (the raw `systemDescription` JSON). Switching to Advanced mode SHALL convert the current friendly state to JSON once. Switching back to friendly mode SHALL re-derive friendly state from the JSON if its shape matches what friendly mode can represent, and SHALL otherwise remain in Advanced mode with a warning rather than discarding content friendly mode cannot express.

#### Scenario: Switching to Advanced mode
- **WHEN** the user switches from friendly mode to Advanced mode
- **THEN** the JSON view is populated with the `systemDescription` equivalent to the current friendly-mode state

#### Scenario: Switching back with a representable shape
- **WHEN** the user switches from Advanced mode back to friendly mode, and the current JSON's operation modes and transitions match what friendly mode produces (a protected standby mode present, a fully-connected transition graph, and any timers present matching exactly one per-mode minimum-duration timer each, wired per the auto-derived-transitions rule)
- **THEN** the friendly editor displays that operation-mode list, with each mode's minimum-duration minutes/seconds fields populated from the duration of the timer wired to it, if any

#### Scenario: Switching back with a non-representable shape
- **WHEN** the user switches from Advanced mode back to friendly mode, and the current JSON contains anything friendly mode cannot express (e.g. a missing standby mode, a non-fully-connected transition graph, a blocked transition, or a timer not wired exactly per the per-mode minimum-duration pattern)
- **THEN** the editor remains in Advanced mode and shows a warning explaining why, instead of silently discarding the customization

### Requirement: Backward compatibility with existing configurations
`s2-ombc-config`'s editor SHALL open an existing, previously-saved raw-JSON `systemDescription` directly into friendly mode when its shape matches what friendly mode can represent, and into Advanced mode otherwise.

#### Scenario: Opening a node saved before this change, in a representable shape
- **WHEN** a `s2-ombc-config` node whose existing `systemDescription` matches friendly mode's shape is opened
- **THEN** its operation modes display in friendly mode

#### Scenario: Opening a node saved before this change, in a non-representable shape
- **WHEN** a `s2-ombc-config` node whose existing `systemDescription` does not match friendly mode's shape (e.g. hand-authored transitions, a blocked transition, or a timer not wired exactly per the per-mode minimum-duration pattern) is opened
- **THEN** the editor opens in Advanced mode showing that JSON unchanged

