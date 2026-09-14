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
On receiving an OMBC instruction, `s2-ombc` SHALL resolve the referenced operation mode against its configuration and emit it on its instruction output with a routable topic and the resolved mode detail, including the requested power in both S2's own commodity-quantity shape and the `values` convenience shape.

#### Scenario: OMBC instruction selects a configured mode
- **WHEN** an OMBC instruction referencing a configured operation mode arrives at `s2-ombc`
- **THEN** the node emits a message with `msg.topic` set to `'ModeInstruction'` and `msg.payload` containing the resolved mode's `id`, `index`, `label`, and `factor`, plus `commodityPower` (an array of `{commodity_quantity, value}` pairs, one per phase, computed from the mode's power ranges and the instructed factor)

#### Scenario: Requested power also expressed in the values convenience shape
- **WHEN** an OMBC instruction resolves to a configured mode, as in the prior scenario
- **THEN** the emitted message's `msg.payload` also includes a `values` field: a plain number when the mode's power ranges are 3-phase-symmetric, or a 3-element `[L1, L2, L3]` array when they are per-phase - the same shape `PowerMeasurement` input already accepts on `s2-dbus`/`s2-resource`, so a flow can feed `msg.payload.values` directly into a `PowerMeasurement` input without conversion

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
A confirm message SHALL identify the operation mode via `id` (or legacy `confirmedOperationModeId`), `index` (or legacy `confirmedOperationModeIndex`, a 0-based index into the configured operation modes), or `label` (or legacy `confirmedOperationModeLabel`, matching a configured mode's `diagnostic_label`), resolved in that priority order when more than one is present: `id` wins over `index`, which wins over `label`. `s2-ombc` SHALL resolve whichever field wins to the mode's canonical id before building or persisting status, and SHALL validate it against the CEM's configured operation modes: an `id` SHALL match a configured mode's id, an `index` SHALL be within range, and a `label` SHALL match exactly one configured mode's `diagnostic_label`. A confirm message giving none of `id`/`index`/`label` (in either field-naming style) SHALL be rejected with an error, as SHALL one whose winning identifier does not resolve to exactly one configured mode. A confirm message MAY also include a `factor` (or legacy `operationModeFactor`); when present and numeric it SHALL be used as the operation mode factor, and SHALL default to `1` otherwise. Any other field present in the confirm payload SHALL be ignored. This lets a flow pass an entire `ModeInstruction` payload (see "Instruction resolution into actionable output") straight back in as a confirmation.

#### Scenario: Mode identified by index
- **WHEN** a confirm message supplies `index` referencing a configured operation mode, and no `id`
- **THEN** the resulting status's `activeOperationModeId` is that mode's id

#### Scenario: Mode identified by label
- **WHEN** a confirm message supplies `label` matching a configured mode's `diagnostic_label`, and neither `id` nor `index`
- **THEN** the resulting status's `activeOperationModeId` is that mode's id

#### Scenario: No mode identifier supplied
- **WHEN** a confirm message supplies none of `id`/`confirmedOperationModeId`, `index`/`confirmedOperationModeIndex`, or `label`/`confirmedOperationModeLabel`
- **THEN** `s2-ombc` rejects the message with an error

#### Scenario: Unknown id
- **WHEN** a confirm message supplies `id` that does not match any configured operation mode's id
- **THEN** `s2-ombc` rejects the message with an error

#### Scenario: Label matches no configured mode
- **WHEN** a confirm message supplies `label` that does not match any configured mode's `diagnostic_label`, and no `id` or `index`
- **THEN** `s2-ombc` rejects the message with an error

#### Scenario: Label matches more than one configured mode
- **WHEN** a confirm message supplies `label` that matches more than one configured mode's `diagnostic_label`, and no `id` or `index`
- **THEN** `s2-ombc` rejects the message with an error

#### Scenario: id takes priority when multiple identifiers are present
- **WHEN** a confirm message supplies `id`, `index`, and `label` together, and `id` matches a configured mode
- **THEN** the resulting status's `activeOperationModeId` is the mode matched by `id`, regardless of what `index` or `label` refer to

#### Scenario: A whole ModeInstruction payload confirms its own mode
- **WHEN** a confirm message's payload is exactly a previously-emitted `ModeInstruction` payload (`{ id, index, label, factor, commodityPower, values }`)
- **THEN** it resolves to the mode named by `id`, using that payload's `factor` as the operation mode factor, and the extra `commodityPower`/`values` fields are ignored

#### Scenario: Confirm message omits factor
- **WHEN** a confirm message identifies a valid mode and includes neither `factor` nor `operationModeFactor`
- **THEN** the resulting status's operation mode factor is `1`

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

### Requirement: Optional power modulation per mode in friendly mode
`s2-ombc-config`'s friendly editor SHALL offer each operation mode an optional "power modulation" toggle. When off (the default), the mode keeps today's single-value behavior: one power value (symmetric, or per-phase) that becomes a `power_ranges` entry whose `start_of_range` and `end_of_range` are equal. When on, the mode instead takes two power values - "from" (associated with an instructed factor of 0) and "to" (associated with a factor of 1) - per phase grouping (symmetric, or per-phase), which become a `power_ranges` entry with differing `start_of_range`/`end_of_range`. Toggling between off and on SHALL NOT be blocked by, or force a switch to, Advanced mode.

#### Scenario: Mode with modulation off
- **WHEN** an operation mode's power modulation toggle is off and a single power value (or per-phase values) is entered
- **THEN** the saved `systemDescription`'s corresponding `power_ranges` entry (or entries) has `start_of_range` equal to `end_of_range`, matching today's fixed-power behavior

#### Scenario: Mode with modulation on
- **WHEN** an operation mode's power modulation toggle is on and "from"/"to" values are entered (symmetric, or per-phase)
- **THEN** the saved `systemDescription`'s corresponding `power_ranges` entry (or entries) has `start_of_range` set to the "from" value and `end_of_range` set to the "to" value

#### Scenario: Opening a saved config with a genuine power range
- **WHEN** a `s2-ombc-config` node whose saved `systemDescription` has an operation mode with `start_of_range` different from `end_of_range` (symmetric, or consistently across all three phases) is opened
- **THEN** the friendly editor opens directly (not Advanced mode), showing that mode with power modulation on and its "from"/"to" fields populated from `start_of_range`/`end_of_range`

#### Scenario: Modes with inconsistent per-phase ranges still require Advanced mode
- **WHEN** a `s2-ombc-config` node whose saved `systemDescription` has an operation mode with a `power_ranges` shape friendly mode still can't represent (e.g. only some phases modulating, or a range on an unsupported commodity quantity) is opened
- **THEN** the editor opens in Advanced mode, as it did before this change

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

### Requirement: No abnormal-condition-only toggle
`s2-ombc-config`'s friendly editor SHALL NOT offer a per-mode "abnormal condition only" toggle: the friendly editor's auto-derived transitions are always fully connected, so a mode reachable only under abnormal conditions can never actually be represented. A previously-saved mode with `abnormal_condition_only: true` SHALL be treated as `false` when opened in friendly mode.

#### Scenario: Friendly editor renders a mode
- **WHEN** the friendly editor renders an operation-mode row, built in or user-added
- **THEN** no "abnormal condition only" control is shown for that row

#### Scenario: Opening a config saved before this change
- **WHEN** a `s2-ombc-config` node whose saved `systemDescription` has a mode with `abnormal_condition_only: true` is opened in friendly mode
- **THEN** the mode displays and saves with `abnormal_condition_only: false`

### Requirement: Backward compatibility with existing configurations
`s2-ombc-config`'s editor SHALL open an existing, previously-saved raw-JSON `systemDescription` directly into friendly mode when its shape matches what friendly mode can represent, and into Advanced mode otherwise.

#### Scenario: Opening a node saved before this change, in a representable shape
- **WHEN** a `s2-ombc-config` node whose existing `systemDescription` matches friendly mode's shape is opened
- **THEN** its operation modes display in friendly mode

#### Scenario: Opening a node saved before this change, in a non-representable shape
- **WHEN** a `s2-ombc-config` node whose existing `systemDescription` does not match friendly mode's shape (e.g. hand-authored transitions, a blocked transition, or a timer not wired exactly per the per-mode minimum-duration pattern) is opened
- **THEN** the editor opens in Advanced mode showing that JSON unchanged

### Requirement: s2-resource never silently discards a non-representable OMBC configuration
`s2-resource`'s OMBC tab SHALL provide the same Friendly/Advanced mode toggle `s2-ombc-config` provides. When the node's saved `systemDescription` is not representable by the friendly editor, opening the node SHALL show that configuration as editable raw JSON in Advanced mode, exactly as `s2-ombc-config` does - never falling back to a default mode list that discards the saved configuration. Saving the node while in Advanced mode SHALL persist the JSON as edited, without passing it through the friendly editor's state first; saving while in Friendly mode SHALL persist the friendly editor's state, as today.

#### Scenario: Opening a node with a non-representable configuration
- **WHEN** a `s2-resource` node whose saved `systemDescription` is not representable by the friendly editor is opened
- **THEN** its OMBC tab shows that configuration as raw JSON in Advanced mode, unchanged from what was saved

#### Scenario: Saving a non-representable configuration unchanged
- **WHEN** a `s2-resource` node opened per the prior scenario is saved without switching to Friendly mode
- **THEN** the node's `systemDescription` after saving is unchanged (byte-identical JSON, modulo formatting), not replaced by a default operation mode

#### Scenario: Opening a representable configuration is unaffected
- **WHEN** a `s2-resource` node whose saved `systemDescription` is representable by the friendly editor is opened
- **THEN** its OMBC tab opens in Friendly mode showing that configuration, exactly as before this change

#### Scenario: Switching between modes matches s2-ombc-config's behavior
- **WHEN** a `s2-resource` node's OMBC tab is switched between Friendly and Advanced mode
- **THEN** it converts and validates the same way `s2-ombc-config`'s own Friendly/Advanced toggle does (see "Friendly/Advanced mode toggle"), including refusing to switch back to Friendly mode from a JSON edit that Friendly mode can't represent

