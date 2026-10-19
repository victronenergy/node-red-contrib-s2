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

- **List form**: a non-empty `availableControlTypes` array containing valid advertised control types other than `NO_SELECTION`. The RM SHALL replace its currently advertised `available_control_types` with exactly that list (no types added or removed beyond what the caller specified).
- **Toggle form**: an `isControllable` boolean. `isControllable: false` SHALL replace the advertised list with `[NOT_CONTROLABLE]` when `NOT_CONTROLABLE` was present in the RM's deploy-time configured control types. If it was not enabled, the command SHALL be rejected because S2 requires at least one advertised control type. `isControllable: true` SHALL replace the advertised list with the RM's deploy-time configured control types (the list derived from `s2-rm-config`'s or `s2-resource`'s control-types configuration, including whether its `NOT_CONTROLABLE` checkbox was checked), discarding any list currently in effect from a prior `SetAvailableControlTypes` command.

A command payload that specifies both `availableControlTypes` and `isControllable`, or neither, SHALL be rejected without changing the advertised list.

An empty `availableControlTypes` list or a list containing `NO_SELECTION` SHALL be rejected without changing the advertised list. `NO_SELECTION` describes a session's lack of an active selection; it is not an advertised Resource Manager capability. S2 requires at least one advertised control type.

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

### Requirement: s2-rm-config resource ID is unique when added in the editor
When the user adds an `s2-rm-config` node to the editor (Node-RED marks such nodes changed), the editor SHALL generate a new `resourceId` if its `resourceId` is empty or equal to the `resourceId` of any other `s2-rm-config` or `s2-resource` node in the editor. Otherwise it SHALL keep the `resourceId`; an environment variable reference, `${NAME}` (or Node-RED's older `$(NAME)` form), SHALL always be kept. Nodes the editor adds while loading or reloading the deployed flows SHALL be left unchanged.

#### Scenario: s2-rm-config imported as a copy
- **WHEN** an import adds an `s2-rm-config` under a new node id whose `resourceId` an existing `s2-rm-config` already holds
- **THEN** the added `s2-rm-config` gets a newly generated `resourceId`

#### Scenario: Deployed flows reloaded
- **WHEN** the editor reloads the deployed flows without a page reload and two `s2-rm-config` nodes share a `resourceId`
- **THEN** neither `resourceId` is changed in the editor

### Requirement: Duplicate resource ID refuses to start
When an `s2-rm` node starts, it SHALL claim the resolved `resourceId` of its `s2-rm-config` as a Resource Manager for the running Node-RED instance, sharing one claim registry with `s2-resource`. If another running `s2-rm` or `s2-resource` node already holds that claim, or the `resourceId` is still an unresolved `${NAME}`, the node SHALL log an error saying why (naming the other node, or the variable) and how to resolve it, show a red `duplicate resource ID` or `resource ID variable not set` status, and SHALL NOT create its Resource Manager. A node SHALL release its claim when it closes, before anything else in its close handling.

#### Scenario: Two s2-rm nodes reference the same s2-rm-config
- **WHEN** two `s2-rm` nodes referencing the same `s2-rm-config` are deployed
- **THEN** the node started second logs an error naming the first node, shows a red `duplicate resource ID` status, and does not handle any input commands

#### Scenario: Example with an s2-rm imported twice
- **WHEN** an example containing an `s2-rm` and its `s2-rm-config` is imported a second time with "Import copy", and Node-RED reuses the existing identical `s2-rm-config` for the copied `s2-rm`
- **THEN** after deploying, one of the two `s2-rm` nodes is refused with a red `duplicate resource ID` status

#### Scenario: s2-rm-config shares its resource ID with an s2-resource
- **WHEN** an `s2-rm` node whose `s2-rm-config` has the same `resourceId` as a running `s2-resource` node is started after it
- **THEN** the `s2-rm` node is refused in the same way

#### Scenario: Empty resource ID
- **WHEN** an `s2-rm-config` has an empty `resourceId`, e.g. from a blank environment variable
- **THEN** the `s2-rm` node logs an error, shows a red `resource ID missing` status, and does not handle any input commands

#### Scenario: Environment variable not set
- **WHEN** an `s2-rm-config`'s `resourceId` is `${S2_RESOURCE_ID}` and that variable is not set for the `s2-rm`'s flow
- **THEN** the `s2-rm` logs an error naming `S2_RESOURCE_ID`, shows a red `resource ID variable not set` status, and does not handle any input commands

### Requirement: s2-websocket refuses a resource ID another transport is using
When an `s2-websocket` node starts, it SHALL claim the `resourceId` of its `s2-rm-config` as a transport, in the same registry; an `s2-rm` claiming that ID as a Resource Manager does not conflict. If another running transport already holds that claim, or the `resourceId` is empty, an unresolved environment variable reference or outside the S2 ID format, the `s2-websocket` SHALL log an error saying why, show the same red status as a refused `s2-rm`, and SHALL NOT connect to the CEM. It SHALL release its claim when it closes, before disconnecting.

#### Scenario: s2-rm and s2-websocket on one config
- **WHEN** one `s2-rm` and one `s2-websocket` reference the same `s2-rm-config`
- **THEN** both start normally

#### Scenario: Two pairs share one s2-rm-config
- **WHEN** two `s2-rm` + `s2-websocket` pairs reference the same `s2-rm-config`
- **THEN** the second `s2-rm` and the second `s2-websocket` are both refused, and only one WebSocket connection to the CEM is opened

#### Scenario: Transport already used by an s2-resource
- **WHEN** an `s2-resource` with `Transport: WebSocket` and `resourceId` X is running and an `s2-websocket` whose `s2-rm-config` has `resourceId` X starts after it
- **THEN** the `s2-websocket` is refused and doesn't connect

### Requirement: s2-rm and s2-websocket check the resource ID before starting
After Node-RED's environment variable substitution, `s2-rm` and `s2-websocket` SHALL refuse to start when the `resourceId` of their `s2-rm-config` is empty, an unresolved environment variable reference (`${NAME}` (or Node-RED's older `$(NAME)` form)), or not 2-64 characters of `a-z`, `A-Z`, `0-9`, `-`, `_` or `:`, with the same errors and red statuses as `s2-resource`. If a node's setup fails after it has claimed its resource ID, the claim SHALL be released.

#### Scenario: Resource ID with a space
- **WHEN** an `s2-rm-config`'s Resource ID is `my heatpump`
- **THEN** both the `s2-rm` and the `s2-websocket` using it show a red `invalid resource ID` status and don't start

#### Scenario: Malformed CEM URL
- **WHEN** an `s2-rm` or `s2-websocket`'s setup throws after claiming its resource ID because its `s2-cem-config` URL is malformed
- **THEN** the claim is released

### Requirement: s2-rm nodes sharing an s2-rm-config are flagged in the editor
The editor SHALL mark an `s2-rm` node invalid, with a message saying another `s2-rm` uses the same `s2-rm-config`, when another `s2-rm` node references the same `s2-rm-config`, since only one of them can start.

#### Scenario: s2-rm copied and pasted
- **WHEN** an `s2-rm` node is copied and pasted, and the copy references the original's `s2-rm-config`
- **THEN** the pasted `s2-rm` is marked invalid in the editor before deploy, with a message saying another `s2-rm` uses the same `s2-rm-config`; the original is marked as well the next time the editor validates it (e.g. when the flows are reloaded)
