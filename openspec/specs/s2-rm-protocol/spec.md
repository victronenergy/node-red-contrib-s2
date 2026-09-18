# s2-rm-protocol Specification

## Purpose
Defines the generic S2 protocol behavior of the `s2-rm` node: session lifecycle, control-type selection, and instruction acknowledgment/routing, independent of any specific control type's semantics.
## Requirements
### Requirement: Lower-level command interface is distinct from topic convenience messages
The shared Resource Manager interface SHALL use `msg.payload.command` for transport and control-type commands, including `Connect`, `Message`, `Disconnect`, `PowerMeasurement`, `UpdateStatus`, `SystemDescription`, `Forecast`, and runtime control-type availability updates. These commands are the lower-level protocol boundary used by `s2-rm`, transports, and dedicated control-type nodes.

Topic-based messages such as `ModeInstruction`, `ModeRequest`, `ModeConfirmation`, `PowerMeasurement`, and `ControlTypes` belong to the public convenience/control-flow interface of `s2-ombc` or `s2-resource`; they are not required to be accepted by every lower-level RM or dedicated control-type node. A composite node MAY translate a documented topic message into a command internally.

#### Scenario: RM receives a lower-level power command
- **WHEN** the RM receives `{ payload: { command: 'PowerMeasurement', cemId, values } }`
- **THEN** it forwards the S2 power measurement for the addressed CEM

#### Scenario: Topic convenience behavior remains node-specific
- **WHEN** a flow sends `{ topic: 'PowerMeasurement', payload: { values: ... } }` to a node exposing a topic convenience interface
- **THEN** that node may translate it to the lower-level command, but the shared RM command contract remains the `payload.command` form

### Requirement: Session handshake and identity exchange
The RM SHALL initiate the S2 handshake when a CEM connects, and SHALL send its `ResourceManagerDetails` once the CEM's `HandshakeResponse` is received.

#### Scenario: CEM connects and completes handshake
- **WHEN** a `Connect` command is received for a CEM and that CEM replies with `HandshakeResponse`
- **THEN** the RM sends `ResourceManagerDetails` to the CEM and the session is marked connected

### Requirement: Control-type selection without control-type-specific behavior
The RM SHALL acknowledge `SelectControlType` and SHALL NOT itself send any control-type-specific system description or status message. Providing those is the responsibility of a dedicated control-type node (see `control-type-ombc`, `control-type-pebc`).

#### Scenario: CEM selects a control type
- **WHEN** the CEM sends `SelectControlType` for any control type
- **THEN** the RM sends `ReceptionStatus(OK)` and forwards the message on its "from CEM" output, without sending a system description or status message itself

### Requirement: Instruction acknowledgment and routing
On receiving any instruction message, the RM SHALL send `ReceptionStatus(OK)` and `InstructionStatusUpdate(ACCEPTED)` (unless status updates are configured off), then emit the instruction on its "from CEM" output as a raw S2 message, the same as any other CEM message.

#### Scenario: Instruction received for a known control type
- **WHEN** the CEM sends an instruction message for a supported control type
- **THEN** the RM acknowledges it and emits it on the "from CEM" output with `msg.payload` set to the raw S2 instruction and `msg.topic` set to its `message_type` (e.g. `OMBC.Instruction`, `PEBC.Instruction`); downstream control-type nodes identify their own instructions by this `message_type` prefix

### Requirement: Fixed two-output contract
The RM SHALL expose exactly two outputs - to transport, and from CEM (including instructions) - regardless of which control types are configured or connected. No control-type-specific output port SHALL exist on this node.

#### Scenario: PEBC control type in use
- **WHEN** the RM is configured with `POWER_ENVELOPE_BASED_CONTROL` as an available control type
- **THEN** the RM still exposes only two outputs; PEBC-specific schedule data is not emitted from `s2-rm` itself

### Requirement: Generic status update command
The RM SHALL accept an `UpdateStatus` command containing a control-type-namespaced status payload and a `cemId`, and SHALL send the corresponding S2 status message to that CEM's session.

#### Scenario: Control-type node reports confirmed state
- **WHEN** an `UpdateStatus` command is received for a connected CEM with a namespaced status payload
- **THEN** the RM sends the corresponding status message (e.g. `OMBC.Status`) to that CEM

### Requirement: Generic system description command
The RM SHALL accept a `SystemDescription` command containing a control-type-namespaced system description payload and a `cemId`, and SHALL send the corresponding S2 system description message to that CEM's session.

#### Scenario: Control-type node pushes its system description
- **WHEN** a `SystemDescription` command is received for a connected CEM with a namespaced system description payload
- **THEN** the RM sends the corresponding system description message (e.g. `OMBC.SystemDescription`) to that CEM

### Requirement: Transport Active flag reflects control-type selection
On every `SelectControlType` message, in addition to its existing acknowledgment behavior, the RM SHALL emit a `/S2/0/Active` write on its transport output: `1` when the newly selected control type is anything other than `NO_SELECTION` or `NOT_CONTROLABLE`, and `0` when it is `NO_SELECTION` or `NOT_CONTROLABLE`. This write requires no dedicated output port or `cemId`.

#### Scenario: CEM selects an active control type
- **WHEN** the CEM sends `SelectControlType` with a control type other than `NO_SELECTION` or `NOT_CONTROLABLE`
- **THEN** the RM emits `{ payload: { 'S2/0/Active': 1 } }` on its transport output

#### Scenario: CEM deselects control
- **WHEN** the CEM sends `SelectControlType` with `NO_SELECTION` or `NOT_CONTROLABLE`
- **THEN** the RM emits `{ payload: { 'S2/0/Active': 0 } }` on its transport output

### Requirement: `NOT_CONTROLABLE` is opt-out, checked by default
Every RM (both `s2-rm`, configured via `s2-rm-config`, and `s2-resource`) SHALL include `NOT_CONTROLABLE` in `ResourceManagerDetails.available_control_types` only when it is present in the RM's currently configured or currently advertised control types - it is no longer forced. `s2-rm-config`'s and `s2-resource`'s manually-editable control-types lists SHALL offer a `NOT_CONTROLABLE`/"Not Controllable" checkbox, checked by default for newly created nodes, so a CEM can still choose not to control the resource unless a flow author explicitly unchecks it. When checked, the deploy-time configured control-types list SHALL place `NOT_CONTROLABLE` first, ahead of any other configured control type, regardless of the checkbox's own position in either editor's list.

#### Scenario: Newly deployed s2-rm advertises NOT_CONTROLABLE by default
- **WHEN** a new `s2-rm` node is deployed with `s2-rm-config`'s default control types
- **THEN** `ResourceManagerDetails.available_control_types` includes `NOT_CONTROLABLE`, because the "Not Controllable" checkbox defaults to checked

#### Scenario: NOT_CONTROLABLE explicitly unchecked at config time
- **WHEN** `s2-rm-config`'s "Not Controllable" checkbox is unchecked and the node is deployed
- **THEN** `ResourceManagerDetails.available_control_types` does not include `NOT_CONTROLABLE`

#### Scenario: s2-rm-config's manual list offers a Not Controllable checkbox
- **WHEN** `s2-rm-config`'s control-types checkbox list is rendered
- **THEN** a checkbox for `NOT_CONTROLABLE` is shown alongside OMBC/FRBC/DDBC/PPBC/PEBC

#### Scenario: NOT_CONTROLABLE sorts first in the configured list when checked
- **WHEN** `s2-rm-config`'s or `s2-resource`'s "Not Controllable" checkbox is checked alongside one or more other control types, and the node is deployed
- **THEN** `NOT_CONTROLABLE` appears first in the resulting configured control-types list (and therefore first in `ResourceManagerDetails.available_control_types` and its `NC` status-bar abbreviation), regardless of the checkbox's own position among the others

#### Scenario: Runtime list omitting NOT_CONTROLABLE no longer advertises it
- **WHEN** a `SetAvailableControlTypes` command is sent to an RM's input with an `availableControlTypes` list that does not include `NOT_CONTROLABLE`
- **THEN** the RM advertises exactly the list the command specified, without `NOT_CONTROLABLE`

### Requirement: Runtime control-type availability update
The RM SHALL accept a `SetAvailableControlTypes` command specifying a replacement for its advertised control types in one of two mutually exclusive forms (no `cemId` in either form, since it is not addressed to a specific CEM session):

- **List form**: an `availableControlTypes` array. The RM SHALL replace its currently advertised `available_control_types` with exactly that list (no types added or removed beyond what the caller specified).
- **Toggle form**: an `isControllable` boolean. `isControllable: false` SHALL replace the advertised list with `[NOT_CONTROLABLE]` when `NOT_CONTROLABLE` was present in the RM's deploy-time configured control types. If it was not enabled, the command SHALL be rejected because S2 requires at least one advertised control type. `isControllable: true` SHALL replace the advertised list with the RM's deploy-time configured control types (the list derived from `s2-rm-config`'s or `s2-resource`'s control-types configuration, including whether its `NOT_CONTROLABLE` checkbox was checked), discarding any list currently in effect from a prior `SetAvailableControlTypes` command.

A command payload that specifies both `availableControlTypes` and `isControllable`, or neither, SHALL be rejected without changing the advertised list.

In either form, once the new list is determined, the RM SHALL re-send `ResourceManagerDetails` - with a fresh `message_id` and all of its other mandatory and optional fields (`resource_id`, `roles`, `instruction_processing_delay`, `provides_forecast`, `provides_power_measurement_types`, `name`, `manufacturer`, `model`, `serial_number`, `firmware_version`) unchanged from what the RM would otherwise send - to every currently connected CEM's session, without requiring a node redeploy. If no CEM is currently connected, the updated list SHALL still apply and SHALL be used in `ResourceManagerDetails` the next time a CEM completes the handshake.

#### Scenario: Command received while a CEM is connected
- **WHEN** a `SetAvailableControlTypes` command with the list form is received with a new `availableControlTypes` list, and a CEM is currently connected
- **THEN** the RM sends that CEM an updated `ResourceManagerDetails` reflecting the new list, with a fresh `message_id` and its other fields unchanged, without the CEM having reconnected or the node having redeployed

#### Scenario: Command received before any CEM connects
- **WHEN** a `SetAvailableControlTypes` command is received before any CEM has connected
- **THEN** the next CEM to complete the handshake receives a `ResourceManagerDetails` reflecting the updated list

#### Scenario: Multiple connected CEMs
- **WHEN** a `SetAvailableControlTypes` command is received while more than one CEM session is connected
- **THEN** each connected CEM receives its own updated `ResourceManagerDetails` reflecting the new list

#### Scenario: isControllable false preserves the initial Not Controllable choice
- **WHEN** a `SetAvailableControlTypes` command `{ isControllable: false }` is received
- **THEN** the RM advertises exactly `['NOT_CONTROLABLE']` if it was present in the deploy-time configured list, otherwise it rejects the command because an empty S2 control-type list is invalid

#### Scenario: isControllable true restores the deploy-time configured list
- **WHEN** an RM configured with `['OPERATION_MODE_BASED_CONTROL', 'NOT_CONTROLABLE']` has previously received `{ isControllable: false }`, and then receives `{ isControllable: true }`
- **THEN** the RM's advertised `available_control_types` becomes exactly `['OPERATION_MODE_BASED_CONTROL', 'NOT_CONTROLABLE']` again

#### Scenario: Command specifying both forms is rejected
- **WHEN** a `SetAvailableControlTypes` command is received with both `availableControlTypes` and `isControllable` set
- **THEN** the RM rejects the command with an error and does not change its currently advertised list

#### Scenario: Command specifying neither form is rejected
- **WHEN** a `SetAvailableControlTypes` command is received with neither `availableControlTypes` nor `isControllable` set
- **THEN** the RM rejects the command with an error and does not change its currently advertised list

### Requirement: No forced deselect when a selected control type becomes unavailable
When a `SetAvailableControlTypes` command removes a control type that a connected CEM currently has active (via a prior `SelectControlType`) from the advertised list, the RM SHALL NOT itself deselect, disconnect, or otherwise alter that session's currently active control type - it SHALL only send the updated `ResourceManagerDetails`. Whether and how the CEM reacts (e.g. by sending its own `SelectControlType` afterward) is left entirely to the CEM.

#### Scenario: Active control type removed from availability
- **WHEN** a CEM currently has `OPERATION_MODE_BASED_CONTROL` selected and a `SetAvailableControlTypes` command removes it from the advertised list
- **THEN** the RM sends the CEM an updated `ResourceManagerDetails` without `OPERATION_MODE_BASED_CONTROL`, and the session's active control type and any in-progress instruction/status flow continue unchanged unless the CEM itself sends a new `SelectControlType`

