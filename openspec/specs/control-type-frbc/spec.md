# control-type-frbc Specification

## Purpose
Defines the behaviour of the `s2-frbc` node and its `s2-frbc-config`: declaring a Fill Rate Based Control resource (actuators, operation modes, storage, leakage) to the CEM, keeping the CEM informed of the device's fill level, actuator states, timers and forecasts, and resolving FRBC instructions into actionable output for the flow.

## Requirements

### Requirement: FRBC configuration as JSON
`s2-frbc-config` SHALL hold the FRBC system description as JSON in S2 wire shape (`actuators`, `storage`) and an optional leakage behaviour (`elements`). Its editor SHALL pre-fill a new node with a valid example.

#### Scenario: New configuration node
- **WHEN** the user adds a new `s2-frbc-config`
- **THEN** its system description and leakage fields hold an example that passes validation

### Requirement: FRBC configuration validated on save
`s2-frbc-config`'s editor SHALL refuse to save a configuration that fails S2 schema validation or the cross-reference checks: unique actuator, operation mode, transition and timer ids; every transition's `from`, `to`, `start_timers` and `blocking_timers` refer to ids within the same actuator; leakage behaviour is given if and only if `storage.provides_leakage_behaviour` is true; and values the S2 schema leaves untyped are objects. `s2-frbc` SHALL refuse to start with a configuration that fails the same checks.

#### Scenario: Update disabled while a change is being checked
- **WHEN** the user edits either field
- **THEN** **Update** is disabled until the new values pass the checks

#### Scenario: Valid configuration saves
- **WHEN** the user saves `s2-frbc-config` with a system description whose `FRBC.SystemDescription` passes schema validation and the cross-reference checks
- **THEN** the configuration is saved without errors

#### Scenario: Transition refers to an unknown mode
- **WHEN** the user saves a system description in which a transition's `to` is not an operation mode id of that actuator
- **THEN** the editor shows an error naming the transition and the unknown id, and does not save

#### Scenario: Value that must be an object is not
- **WHEN** `storage`, a `fill_level_range`, `fill_rate` or `running_costs`, or an entry of `actuators`, `operation_modes`, `elements`, `power_ranges`, `transitions` or `timers` is not an object, such as `null`
- **THEN** the editor shows an error naming its path, and does not save

#### Scenario: Leakage flag and leakage JSON disagree
- **WHEN** `storage.provides_leakage_behaviour` is false but leakage behaviour JSON is given
- **THEN** the editor shows an error and does not save

### Requirement: System description pushed on FRBC selection
When `s2-frbc` observes on `s2-rm`'s "from CEM" output that a CEM selected `FILL_RATE_BASED_CONTROL`, it SHALL send a `SystemDescription` command for that CEM carrying the configured system description and, when configured, the leakage behaviour. It SHALL then send one `UpdateStatus` command replaying the stored device state, per "Device state replayed on selection".

#### Scenario: Selection without leakage behaviour
- **WHEN** a CEM selects `FILL_RATE_BASED_CONTROL` and no leakage behaviour is configured
- **THEN** the `SystemDescription` command's `frbc` carries `systemDescription` only

### Requirement: Device state replayed on selection
`s2-frbc` SHALL keep the device's last fill level, per-actuator status, timer statuses, usage forecast and fill level target profile in node context, independent of which CEM they were sent to. On FRBC selection it SHALL replay the fill level, actuator statuses, unexpired timer statuses, and the usage forecast and fill level target profile if they still cover a future time.

#### Scenario: Fill level known before selection
- **WHEN** a flow sent `StorageStatus { fillLevel: 40 }` before any CEM selected FRBC, and a CEM then selects `FILL_RATE_BASED_CONTROL`
- **THEN** the CEM receives `FRBC.SystemDescription` followed by `FRBC.StorageStatus` with `present_fill_level` 40, without the flow resending anything

#### Scenario: No state known yet
- **WHEN** a CEM selects `FILL_RATE_BASED_CONTROL` and no status input has been received
- **THEN** only the system description (and leakage behaviour, if configured) is sent, and the node status says the fill level is not yet known

#### Scenario: Expired usage forecast
- **WHEN** a CEM selects FRBC and the stored usage forecast ended in the past
- **THEN** the replayed `UpdateStatus` does not include it

### Requirement: Selection events
`s2-frbc` SHALL emit `{ topic: 'Selected', cemId }` on its instruction output when a CEM selects FRBC, and `{ topic: 'Deselected', cemId }` when that CEM later selects another control type or disconnects.

#### Scenario: CEM disconnects while FRBC is selected
- **WHEN** a CEM with FRBC selected disconnects
- **THEN** `s2-frbc` emits `Deselected` for that CEM

### Requirement: Instruction resolution into actionable output
On an `FRBC.Instruction`, `s2-frbc` SHALL resolve its actuator and operation mode, choose the mode's element whose `fill_level_range` contains the last known fill level (else the first element, with a warning), and emit an `ActuatorInstruction` carrying the instruction id, the actuator's and mode's id, label and index, `factor`, `abnormalCondition`, `fillRate`, `commodityPower` and `values` - ranges interpolated as `start + factor x (end - start)`, without rounding.

#### Scenario: Instruction for a known actuator and mode
- **WHEN** an `FRBC.Instruction` for a configured actuator selects a mode whose element for the current fill level has `fill_rate` 0..10 and a 3-phase-symmetric power range 0..2000, with `operation_mode_factor` 0.5
- **THEN** `s2-frbc` emits `ActuatorInstruction` with `fillRate` 5, `commodityPower` `[{ commodity_quantity: 'ELECTRIC.POWER.3_PHASE_SYMMETRIC', value: 1000 }]` and `values` 1000

#### Scenario: Instruction for an unknown actuator or mode
- **WHEN** an `FRBC.Instruction` refers to an actuator or operation mode not in the configuration
- **THEN** `s2-frbc` emits nothing on its instruction output, warns, and sends an `InstructionStatus` command with status `ABORTED` for that instruction

#### Scenario: Instruction with a factor outside 0-1
- **WHEN** an `FRBC.Instruction` has an `operation_mode_factor` below 0 or above 1
- **THEN** `s2-frbc` emits nothing on its instruction output, warns, and sends an `InstructionStatus` command with status `ABORTED` for that instruction

#### Scenario: Instruction from a CEM without FRBC selected
- **WHEN** an `FRBC.Instruction` arrives from a CEM that has not selected FRBC, or has since selected another control type
- **THEN** `s2-frbc` emits nothing on its instruction output, warns, and sends an `InstructionStatus` command with status `ABORTED` for that instruction

#### Scenario: Non-FRBC instruction
- **WHEN** an instruction of another control type reaches `s2-frbc`
- **THEN** it emits nothing and does not error

### Requirement: Fill level reporting
`s2-frbc` SHALL accept `{ topic: 'StorageStatus', payload: { fillLevel } }`, store it as the device's fill level, and, when FRBC is selected for that CEM and the value differs from the last one sent, send it as `FRBC.StorageStatus` via an `UpdateStatus` command. A `fillLevel` that is not a finite number SHALL be rejected with an error.

#### Scenario: Unchanged fill level
- **WHEN** `StorageStatus { fillLevel: 55 }` arrives twice in a row while FRBC is selected
- **THEN** only the first produces an `FRBC.StorageStatus`

### Requirement: Actuator confirmation
`s2-frbc` SHALL accept `{ topic: 'ActuatorConfirmation', payload: { actuator, operationMode, factor? } }`, where `actuator` and `operationMode` may each be an id, a 0-based index or a diagnostic label, and SHALL also accept an `ActuatorInstruction` payload wired back unchanged. It SHALL send `FRBC.ActuatorStatus`, including `previous_operation_mode_id` and `transition_timestamp` when the mode changed. `factor` defaults to 1 when omitted; any other value than a number from 0 to 1 SHALL be refused with an error, without storing or sending anything.

#### Scenario: Reference by label
- **WHEN** `ActuatorConfirmation { actuator: 'Heat pump', operationMode: 'Heating' }` arrives and those are unique diagnostic labels
- **THEN** `FRBC.ActuatorStatus` is sent with the matching actuator and mode ids

### Requirement: Transition timers started on confirmation
When an `ActuatorConfirmation` changes an actuator's mode, `s2-frbc` SHALL send `FRBC.TimerStatus` with `finished_at` = now + duration for each `start_timers` entry of the transition from the previous to the confirmed mode.

#### Scenario: Mode change with a start timer
- **WHEN** actuator A is confirmed in mode `heat` after being in `idle`, and the `idle`→`heat` transition lists timer `T` (duration 30 min) in `start_timers`
- **THEN** the CEM receives `FRBC.ActuatorStatus` with `active_operation_mode_id` `heat` and `previous_operation_mode_id` `idle`, and `FRBC.TimerStatus` for `T` with `finished_at` 30 minutes from now

### Requirement: Confirmed instruction reported as succeeded
On an `ActuatorConfirmation`, `s2-frbc` SHALL send `InstructionStatus SUCCEEDED` for every open instruction of that actuator with the same mode and factor, and `ABORTED` for every older open instruction of that actuator that asked for something else. Each instruction SHALL receive at most one final status.

#### Scenario: Confirmation closes the instruction
- **WHEN** an `ActuatorInstruction` for actuator A, mode `heat`, factor 1 was emitted and the flow wires that payload back as `ActuatorConfirmation`
- **THEN** an `InstructionStatus` command with status `SUCCEEDED` is sent for that instruction's id

#### Scenario: Repeated instructions for the same mode
- **WHEN** three instructions for actuator A, mode `off`, factor 1 are open and one `ActuatorConfirmation` for A, `off`, factor 1 arrives
- **THEN** all three are reported `SUCCEEDED`

### Requirement: Forecast, target profile and timer inputs
`s2-frbc` SHALL accept `UsageForecast` and `FillLevelTargetProfile` topics (`{ startTime?, elements }`, `startTime` defaulting to now) and a `TimerStatus` topic (`{ actuator, timerId, finishedAt }`), and SHALL send the matching FRBC message via `UpdateStatus`. It SHALL reject a usage forecast or fill level target profile with a warning when the configured storage description has the corresponding `provides_usage_forecast` or `provides_fill_level_target_profile` set to false.

#### Scenario: Usage forecast not declared
- **WHEN** a `UsageForecast` message arrives and `storage.provides_usage_forecast` is false
- **THEN** nothing is sent and the node warns that the system description does not declare a usage forecast

### Requirement: Inputs while FRBC is not selected
Status, forecast, target profile and timer inputs received while no CEM has FRBC selected SHALL be stored and SHALL NOT be sent; they are replayed on selection per "System description pushed on FRBC selection". When `cemId` is omitted it SHALL resolve to the single CEM with FRBC selected, and SHALL be an error if more than one CEM has FRBC selected.

#### Scenario: Two CEMs with FRBC selected
- **WHEN** two CEMs have FRBC selected and a `StorageStatus` arrives without `cemId`
- **THEN** nothing is sent, the fill level is still stored, and the node reports that `cemId` is required

### Requirement: Session end clears the selection
`s2-frbc` SHALL treat `Disconnected` and `Connected` for a CEM with FRBC selected as the end of that selection: it SHALL forget the CEM's open instructions and last sent fill level, emit `Deselected` with `reason` `disconnected` or `reconnected`, and only store inputs for that CEM until it selects FRBC again. `Connected` covers a CEM that reconnects without a `Disconnect`, which replaces its session.

#### Scenario: CEM reconnects without a Disconnect
- **WHEN** a CEM with FRBC selected reconnects and s2-rm emits `Connected` for it
- **THEN** `s2-frbc` emits `Deselected` with `reason: 'reconnected'`, and a following `StorageStatus` is stored but not sent

### Requirement: Selection recovered after a restart
When `s2-frbc` starts, it SHALL send s2-rm a `ReplaySelection` command for `FILL_RATE_BASED_CONTROL`, and SHALL handle a replayed `SelectControlType` like a received one, so that after a partial deploy a CEM that kept FRBC selected receives the current system description and state.

#### Scenario: s2-frbc-config edited and deployed
- **WHEN** only `s2-frbc` restarts while s2-rm keeps a session with FRBC selected
- **THEN** that CEM receives the new `FRBC.SystemDescription` without selecting FRBC again

### Requirement: Stored state reconciled with the configuration
When `s2-frbc` starts, it SHALL drop stored actuator statuses whose actuator or active mode the configuration no longer has, previous-mode fields that refer to a removed mode, timer statuses for removed timers, and a stored usage forecast or fill level target profile the storage no longer provides.

#### Scenario: Operation mode removed
- **WHEN** the stored status of actuator A names mode M, and the redeployed configuration no longer has M
- **THEN** no `FRBC.ActuatorStatus` for A is replayed on the next FRBC selection

### Requirement: Unrecognised input is reported
`s2-frbc` SHALL warn about input that is neither an S2 message from s2-rm nor one of its flow topics, naming the expected topics, and SHALL otherwise ignore it.

#### Scenario: Instruction wired back unchanged
- **WHEN** an `ActuatorInstruction` message arrives with its topic unchanged
- **THEN** nothing is sent, and the warning says to use topic `ActuatorConfirmation`

### Requirement: Overtaken instructions aborted
When `s2-frbc` emits an instruction for an actuator, it SHALL send `ABORTED` for every open, unconfirmed earlier instruction of that actuator that asked for another operation mode. An earlier instruction for the same mode SHALL stay open.

#### Scenario: Plan switches the actuator before the flow confirmed
- **WHEN** an instruction for actuator A, mode `heat` is open and an instruction for A, mode `off` arrives
- **THEN** the `heat` instruction is reported `ABORTED`

### Requirement: Revoke after an instruction reached the flow
When the CEM revokes an `FRBC.Instruction` that `s2-frbc` already emitted and that has no final status yet, `s2-frbc` SHALL send `InstructionStatus REVOKED` for it and emit `{ topic: 'Revoked', payload: { instructionId, actuatorId, operationModeId, factor }, cemId }`. A revoke for an instruction it never emitted SHALL be ignored.

#### Scenario: Re-plan revokes the running instruction
- **WHEN** the CEM sends `RevokeObject` for an instruction that was emitted as `ActuatorInstruction`
- **THEN** the CEM receives `REVOKED` for it and the flow receives a `Revoked` message

### Requirement: Open instructions aborted when FRBC control ends
`s2-frbc` SHALL send `ABORTED` for its open instructions when the CEM selects another control type, and for the oldest open instruction when more than 50 are open. Selecting FRBC again SHALL leave open instructions open. When the session ends (`Disconnected`, `Connected`) it SHALL drop open instructions without a status.

#### Scenario: CEM stops FRBC control
- **WHEN** an instruction is open and the CEM selects `NOT_CONTROLABLE`
- **THEN** that instruction is reported `ABORTED`
