# s2-resource Specification

## Purpose

Provides a single Node-RED node combining an S2 resource manager, a built-in transport, and a built-in control type, so a minimal S2 flow needs one node instead of wiring `s2-rm`, a transport node, and a control-type node together.

## Requirements

### Requirement: Public topic API and lower-level command API are distinct
`s2-resource` SHALL support two intentionally different message interfaces:

- **Topic form:** public convenience/control-flow messages use `msg.topic` to identify the operation and place operation data in `msg.payload`, for example `{ topic: 'ModeConfirmation', payload: { ... } }`, `{ topic: 'PowerMeasurement', payload: { ... } }`, and `{ topic: 'ControlTypes', payload: { ... } }`.
- **Command form:** lower-level Resource Manager and transport operations use `msg.payload.command`, for example `{ payload: { command: 'UpdateStatus', ... } }`, `{ payload: { command: 'SystemDescription', ... } }`, and `{ payload: { command: 'PowerMeasurement', ... } }`.

The two forms SHALL NOT be treated as a library-wide aliasing requirement. Topic messages are the convenience interface exposed by the composite node and its built-in control behavior; command messages are the transport-agnostic Resource Manager interface used to connect `s2-rm`, transports, and dedicated control-type nodes. `s2-resource` MAY translate a documented topic convenience message into the corresponding lower-level command internally.

#### Scenario: Topic convenience message reaches built-in control behavior
- **WHEN** `s2-resource` receives `{ topic: 'ModeConfirmation', payload: { id, factor } }` with built-in OMBC enabled
- **THEN** it processes the confirmation as a control-flow message rather than requiring a `payload.command` field

#### Scenario: Lower-level command reaches the Resource Manager
- **WHEN** `s2-resource` receives `{ payload: { command: 'UpdateStatus', ... } }`
- **THEN** it forwards the command to the shared Resource Manager command interface

#### Scenario: ControlTypes topic is a convenience translation
- **WHEN** `s2-resource` receives `{ topic: 'ControlTypes', payload: { isControllable: false } }`
- **THEN** it translates that message to the Resource Manager's available-control-types update operation

### Requirement: Composite session behavior
`s2-resource` SHALL exhibit the same session handshake, control-type selection, instruction acknowledgment/routing, and `S2/0/Active` transport signal behavior that `s2-rm-protocol` defines for `s2-rm`, without wiring a separate `s2-rm` node.

#### Scenario: CEM connects and completes handshake through s2-resource
- **WHEN** a CEM connects via `s2-resource`'s active transport and completes the S2 handshake
- **THEN** `s2-resource` sends `ResourceManagerDetails` and marks the session connected, per `s2-rm-protocol`'s handshake requirement

### Requirement: Selectable transport
`s2-resource`'s Connection tab SHALL offer a `Transport` setting of `WebSocket` (built-in - reuses the same connection fields as `s2-cem-config`), `D-Bus` (built-in - reuses the same connection/device fields as `s2-dbus-config`), or `External` (no built-in transport). `Transport` SHALL default to `D-Bus` for a newly added `s2-resource` node. The `D-Bus` option SHALL be labeled "Built-in - D-Bus (Victron Energy)" (not "Built-in - D-Bus (Venus OS)"), and the Connection tab's D-Bus config picker SHALL be labeled "Virtual Device" (not "D-Bus").

#### Scenario: Transport set to WebSocket
- **WHEN** `s2-resource` is configured with `Transport: WebSocket` and valid connection fields
- **THEN** it connects to the configured CEM endpoint without any separate `s2-websocket` or `s2-cem-config` node in the flow

#### Scenario: Transport set to D-Bus
- **WHEN** `s2-resource` is configured with `Transport: D-Bus` and a valid device type
- **THEN** it registers the same `com.victronenergy.<deviceType>.virtual_s2_<nodeId>` D-Bus service `s2-dbus` would (`nodeId` being this node's own id, not its S2 resourceId), without any separate `s2-dbus` or `s2-dbus-config` node in the flow

#### Scenario: Transport set to D-Bus relays power measurement
- **WHEN** `s2-resource` is configured with `Transport: D-Bus`, a value matching the configured measurement type is fed to its input, and a CEM has started power measurement
- **THEN** it relays that value to the CEM as a `PowerMeasurement` command, the same way the standalone `s2-dbus` node's power-measurement relay does

#### Scenario: Transport set to D-Bus exposes power measurement on D-Bus
- **WHEN** `s2-resource` is configured with `Transport: D-Bus` and a value matching the configured measurement type is fed to its input
- **THEN** the corresponding D-Bus property (e.g. `Ac/Power`) is updated on the registered service, independent of whether any CEM currently has power measurement active - the same as the standalone `s2-dbus` node

#### Scenario: Transport set to External
- **WHEN** `s2-resource` is configured with `Transport: External`
- **THEN** it exposes a "to/from transport" input/output pair carrying the same transport-agnostic message shapes `s2-rm` accepts and emits today, for wiring to any external transport node

#### Scenario: Newly added node defaults to D-Bus
- **WHEN** a new `s2-resource` node is dragged into a flow and its edit dialog is opened for the first time
- **THEN** the Connection tab's `Transport` field reads `D-Bus`, labeled "Built-in - D-Bus (Victron Energy)"

### Requirement: Selectable control type
`s2-resource`'s Control Type tab SHALL offer a `Control type` setting of `OMBC` (built-in - reuses `s2-ombc-config`'s friendly editor as an embedded tab) or `None` (no built-in control type).

#### Scenario: Control type set to OMBC
- **WHEN** `s2-resource` is configured with `Control type: OMBC` and at least one operation mode
- **THEN** it sends the corresponding `OMBC.SystemDescription` when a CEM selects `OPERATION_MODE_BASED_CONTROL`, resolves OMBC instructions, and sends `OMBC.Status` on confirmation, per `control-type-ombc`'s requirements, without any separate `s2-ombc` or `s2-ombc-config` node in the flow

#### Scenario: Control type set to None
- **WHEN** `s2-resource` is configured with `Control type: None`
- **THEN** it exposes a "from CEM"/command input/output pair carrying the same message shapes `s2-rm`'s corresponding ports carry today, for wiring a dedicated control-type node instead

### Requirement: Advertised control type follows the Control Type tab when built in
When `Control type: OMBC` is selected, `s2-resource`'s Resource Manager tab SHALL NOT offer a separate, manually-editable list of advertised control types for OMBC - the advertised `ResourceManagerDetails.available_control_types` SHALL include `OPERATION_MODE_BASED_CONTROL` automatically. The manually-editable advertised-control-types list SHALL be offered only when `Control type: None`, for whatever control-type node(s) are wired externally. Regardless of `Control type`, the Control Type tab SHALL also offer the standalone `NOT_CONTROLABLE`/"Not Controllable" checkbox described in `s2-rm-protocol`'s "`NOT_CONTROLABLE` is opt-out, checked by default" requirement - it is a single control specific to this node, applying whether `Control type` is `OMBC` or `None`, not part of the manually-editable list itself.

#### Scenario: Control type: OMBC advertises OMBC without manual selection
- **WHEN** `s2-resource` is configured with `Control type: OMBC`
- **THEN** it advertises `OPERATION_MODE_BASED_CONTROL` to the CEM regardless of any other manual control-type selection

#### Scenario: Control type: None still allows advertising other control types
- **WHEN** `s2-resource` is configured with `Control type: None` and the Resource Manager tab's control-types selection includes e.g. `POWER_ENVELOPE_BASED_CONTROL`
- **THEN** it advertises that selection to the CEM, unchanged from today's `s2-rm-config` behavior

#### Scenario: Control type: None manual list has no Not Ctrl checkbox among the manual options
- **WHEN** the Resource Manager tab's manually-editable control-types list is rendered (`Control type: None`)
- **THEN** no checkbox for `NOT_CONTROLABLE` is shown among FRBC/DDBC/PPBC/PEBC - it remains the Control Type tab's separate, standalone checkbox instead

#### Scenario: Not Controllable checkbox applies regardless of Control type
- **WHEN** the Control Type tab is rendered, with `Control type` set to either `OMBC` or `None`
- **THEN** the standalone "Not Controllable" checkbox is shown and, when checked, `NOT_CONTROLABLE` is included in `ResourceManagerDetails.available_control_types`

### Requirement: Advertised power measurement follows the D-Bus config when Transport: D-Bus
When `Transport: D-Bus` is selected, `s2-resource`'s Resource Manager tab's Power Meas. field SHALL NOT determine the advertised power-measurement capability - `ResourceManagerDetails.provides_power_measurement_types` SHALL be derived from the referenced `s2-dbus-config` node's measurement type instead, the same value that determines the actual declared D-Bus propert(y/ies). For any other `Transport`, the Resource Manager tab's Power Meas. field SHALL be used, unchanged from today's `s2-rm-config` behavior.

#### Scenario: Transport: D-Bus advertises the D-Bus config's measurement type
- **WHEN** `s2-resource` is configured with `Transport: D-Bus` and an `s2-dbus-config` node with a given measurement type
- **THEN** it advertises that measurement type to the CEM, regardless of the Resource Manager tab's own Power Meas. field

#### Scenario: Transport: WebSocket or External still uses the Resource Manager tab's field
- **WHEN** `s2-resource` is configured with `Transport: WebSocket` or `Transport: External` and a Power Meas. value on the Resource Manager tab
- **THEN** it advertises that value to the CEM, unchanged from today's `s2-rm-config` behavior

### Requirement: Resource Manager tab pre-fills RM Name from the node's own Name
`s2-resource`'s Resource Manager tab SHALL keep the `RM Name` field mirroring the node's own `Name` field (Connection tab's top-level field) on every change to `Name`, for as long as `RM Name` is either empty or still holds exactly the value this mirroring last wrote into it - both on initial add and while the dialog remains open. The moment `RM Name` holds anything else (typed by the user, or loaded from a saved node), mirroring SHALL stop until `RM Name` becomes empty again (by the user clearing it), at which point mirroring SHALL resume.

#### Scenario: New node, Name filled in before opening Resource Manager tab
- **WHEN** a new `s2-resource` node has its `Name` field set to "Boiler" and the user switches to the Resource Manager tab
- **THEN** `RM Name` reads "Boiler"

#### Scenario: Typing continues past the first character
- **WHEN** a new `s2-resource` node has nothing yet typed into `RM Name`, and the user types "software" into `Name` one character at a time
- **THEN** `RM Name` reads "software" once typing finishes, not just "s"

#### Scenario: RM Name already set
- **WHEN** an existing `s2-resource` node has both `Name` and a different, already-saved `RM Name`
- **THEN** opening the dialog leaves the saved `RM Name` unchanged

#### Scenario: User edits RM Name directly
- **WHEN** the user types into `RM Name` directly, setting it to some value other than what `Name` would currently produce, then continues editing `Name`
- **THEN** `RM Name` no longer follows `Name`'s further changes

#### Scenario: User clears a manually-set or loaded RM Name
- **WHEN** `RM Name` currently holds a value the user typed directly, or one loaded from a saved node (not one this mirroring wrote itself), and the user clears `RM Name` back to empty
- **THEN** `RM Name` resumes mirroring `Name` on the next change to `Name`

### Requirement: Resource Manager identity fields are grouped under a "Device" heading, optional, and blank by default
`s2-resource`'s Resource Manager tab SHALL present the `manufacturer`, `model`, `serialNumber`, and `firmwareVersion` fields under a full-width "Device" section heading (the same section-heading pattern used for `Roles`/`Control Types`), labeled plainly "Manufacturer", "Model", "Serial", and "Firmware" - the heading, not a per-field prefix, carries the distinction that these describe the physical device rather than the S2 Resource Manager entity. All four SHALL default to an empty string for a newly added node - none SHALL be pre-filled with a fabricated identity value (e.g. `Victron Energy`, `Virtual RM`, `1.0.0`).

#### Scenario: Newly added node
- **WHEN** a new `s2-resource` node's edit dialog is opened for the first time
- **THEN** the Resource Manager tab's "Device" section shows empty "Manufacturer", "Model", "Serial", and "Firmware" fields

### Requirement: Resource Manager tab orders the Device section above capabilities
`s2-resource`'s Resource Manager tab SHALL present the "Device" section (Manufacturer/Model/Serial/Firmware) before the `Roles` section, so the device's identity is described before its S2 capabilities (Roles, Control Types, Power Meas., Forecast).

#### Scenario: Tab layout
- **WHEN** the Resource Manager tab is rendered
- **THEN** the "Device" section heading and its Manufacturer/Model/Serial/Firmware fields appear above the `Roles` checkboxes

### Requirement: Resource ID is not shown on the RM tab
`s2-resource`'s `resourceId` SHALL NOT be shown as a visible field on the Resource Manager tab. For `Transport: D-Bus` and `Transport: External` it SHALL NOT be shown anywhere in the dialog unless the node is inside a subflow template, consistent with other auto-generated internal identifiers this node doesn't surface (e.g. the D-Bus `DeviceInstance`). It SHALL still be auto-generated once (on first add, if not already set) and persisted unchanged across redeploys.

#### Scenario: RM tab has no visible Resource ID field
- **WHEN** the Resource Manager tab is rendered
- **THEN** no visible field shows or edits `resourceId`

#### Scenario: Resource ID is still generated and stable
- **WHEN** a new `s2-resource` node is added, and later redeployed one or more times
- **THEN** `resourceId` is generated once on the first add and never changes on subsequent redeploys

#### Scenario: Resource ID hidden for D-Bus
- **WHEN** the Connection tab of an `s2-resource` that is not inside a subflow template is rendered with `Transport: D-Bus` or `Transport: External`
- **THEN** no visible field shows or edits `resourceId`

### Requirement: Inapplicable per-phase OMBC fields are dimmed for a single-phase D-Bus device
When `Control type: OMBC` and `Transport: D-Bus` are both selected and the referenced `s2-dbus-config` node has `nrOfPhases: 1`, the OMBC tab's per-phase L1/L2/L3 power fields SHALL be dimmed and disabled for every phase except the configured `phaseSetting` ("Wired to"), on every operation mode row - since a single-phase device never reports the other two. This SHALL update if the `s2-dbus-config` reference, its `Phases`/`Wired to` values, or `Transport` change while the dialog is open.

#### Scenario: Single-phase D-Bus device wired to L2
- **WHEN** `Transport: D-Bus` references an `s2-dbus-config` with `Phases: 1` and `Wired to: L2`
- **THEN** each mode's L1 and L3 power fields are dimmed and disabled, and L2 remains editable

#### Scenario: Multi-phase D-Bus device
- **WHEN** the referenced `s2-dbus-config` has `Phases: 2` or `Phases: 3` (or `Transport` is not `D-Bus`)
- **THEN** all three per-phase fields remain enabled (though for `Phases: 3` with `Power Meas.: 3-phase symmetric` they are also hidden behind a single symmetric value field - see the requirement below), unchanged from today's field-enablement behavior

### Requirement: "Same value on all phases" is hidden when the D-Bus phase count and measurement type make it unambiguous
When `Control type: OMBC` and `Transport: D-Bus` are both selected, each operation mode's "Same value on all phases" checkbox and power-value field(s) SHALL be driven by the referenced `s2-dbus-config` node's `nrOfPhases` **and** `measurementType` together, not `nrOfPhases` alone:
- `nrOfPhases: 1`: the checkbox SHALL be hidden (internally forced unchecked); the mode's power value SHALL be entered through its single active per-phase field (per the dimming requirement above).
- `nrOfPhases: 3` and `measurementType: 3_PHASE_SYMMETRIC`: the checkbox SHALL be hidden (internally forced checked); the mode's power value SHALL be entered once, through the single symmetric field.
- `nrOfPhases: 3` and `measurementType: L1_L2_L3`: the checkbox SHALL be hidden (internally forced unchecked); the mode's power value SHALL be entered through all three per-phase fields (L1, L2, L3), none dimmed.
- `nrOfPhases: 2`, or any `Transport` other than `D-Bus`: the checkbox SHALL remain visible and freely editable, unchanged from today's behavior.

A hidden checkbox offers no actual choice - the visible field count (1 vs. 3) already shows which mode is in effect - so it is hidden outright rather than shown disabled/greyed. This SHALL update on the same triggers as the per-phase dimming requirement above.

#### Scenario: Single-phase D-Bus device
- **WHEN** `Transport: D-Bus` references an `s2-dbus-config` with `Phases: 1`
- **THEN** each mode's "Same value on all phases" checkbox is not shown, and the mode's power value is entered through its single active per-phase field

#### Scenario: Exactly-3-phase, symmetric D-Bus device
- **WHEN** `Transport: D-Bus` references an `s2-dbus-config` with `Phases: 3` and `Power Meas.: 3-phase symmetric`
- **THEN** each mode's "Same value on all phases" checkbox is not shown, and the per-phase L1/L2/L3 fields are hidden in favor of the single symmetric value field

#### Scenario: Exactly-3-phase, per-phase D-Bus device
- **WHEN** `Transport: D-Bus` references an `s2-dbus-config` with `Phases: 3` and `Power Meas.: Per phase`
- **THEN** each mode's "Same value on all phases" checkbox is not shown, and all three per-phase L1/L2/L3 fields are shown and editable, none dimmed

#### Scenario: Two-phase D-Bus device, or no D-Bus transport
- **WHEN** the referenced `s2-dbus-config` has `Phases: 2`, or `Transport` is not `D-Bus`
- **THEN** each mode's "Same value on all phases" checkbox remains visible and freely editable, unchanged from today's behavior

### Requirement: Default OMBC mode without external wiring
When `Control type: OMBC` is selected, `s2-resource`'s Control Type tab SHALL offer a "Default mode" selection among the tab's own configured operation modes (plus "None"). When set, `s2-resource` SHALL confirm that mode as the resource's default status at deploy time, equivalent to sending `{ confirmedOperationModeId: <id> }` to its own input before any CEM has connected - without requiring a separately-wired node to do so.

#### Scenario: CEM selects OMBC with a default mode configured
- **WHEN** `s2-resource` is configured with `Control type: OMBC` and a "Default mode" selection, and a CEM selects `OPERATION_MODE_BASED_CONTROL` before anything else has confirmed a status
- **THEN** it sends the corresponding `OMBC.Status` for that default mode, the same as if a `ModeConfirmation` had been sent to its input before the CEM connected

#### Scenario: A later confirmation overrides the default
- **WHEN** a `ModeConfirmation` (from the CEM, or the node's own input) is processed after the default mode was seeded
- **THEN** it overrides the default status normally, per `control-type-ombc`'s existing confirm-handling requirements

#### Scenario: No default mode configured
- **WHEN** `s2-resource` is configured with `Control type: OMBC` and "Default mode: None"
- **THEN** no status is reported until something explicitly confirms one, unchanged from today's behavior

### Requirement: Auto-confirm OMBC mode instructions
When `Control type: OMBC` is selected, `s2-resource`'s Control Type tab SHALL offer an "Auto-confirm mode-switch requests (OMBC.Instruction)" setting, unchecked by default. When checked, `s2-resource` SHALL confirm an instructed mode change back to the CEM as active immediately after resolving the instruction, without waiting for a separate `ModeConfirmation`. When unchecked, confirmation SHALL only happen as a result of an explicit `ModeConfirmation` (from the CEM's own protocol messages via the flow, or sent directly to this node's input) - a flow confirming based on real device state is more reliable than assuming the switch happened, so this is the recommended default; checking it suits only a resource with no independent way to report its own hardware state back to the flow.

#### Scenario: Checked - CEM instructs a mode change
- **WHEN** `s2-resource` is configured with `Control type: OMBC` and "Auto-confirm mode-switch requests (OMBC.Instruction)" checked, and a CEM sends an `OMBC.Instruction` for a configured mode
- **THEN** it emits the resolved `ModeInstruction` downstream (unchanged) and also sends `OMBC.Status` confirming that mode as active, without any `ModeConfirmation` message

#### Scenario: Default (unchecked) - CEM instructs a mode change
- **WHEN** `s2-resource` is configured with `Control type: OMBC` and "Auto-confirm mode-switch requests (OMBC.Instruction)" unchecked, and a CEM sends an `OMBC.Instruction` for a configured mode
- **THEN** it emits the resolved `ModeInstruction` downstream but sends no `OMBC.Status`, until a `ModeConfirmation` is sent to this node's input

### Requirement: Raw S2 messages visible in the Debug sidebar
When its "Show raw S2 messages in debug sidebar" setting is enabled, `s2-resource` SHALL publish every S2 message to/from the CEM, and every CEM Connect/Disconnect event, to the Node-RED editor's Debug sidebar (for both `Transport: WebSocket` and `Transport: D-Bus`), without requiring a Debug node to be wired into the flow. Every published entry's topic SHALL include the cemId it applies to.

#### Scenario: Setting enabled - message traffic
- **WHEN** "Show raw S2 messages in debug sidebar" is checked and a message is sent to or received from the CEM
- **THEN** that message appears in the Debug sidebar, attributed to this node, with a topic naming the cemId it was sent to or received from

#### Scenario: Setting enabled - Connect/Disconnect
- **WHEN** "Show raw S2 messages in debug sidebar" is checked and a CEM connects or disconnects
- **THEN** a corresponding entry (topic suffixed `(Connect)`/`(Disconnect)`) appears in the Debug sidebar, naming that CEM's id

#### Scenario: Setting disabled
- **WHEN** "Show raw S2 messages in debug sidebar" is unchecked
- **THEN** no message content is published to the Debug sidebar

### Requirement: Status reflects transport readiness while idle
For a built-in transport (`Transport: WebSocket` or `Transport: D-Bus`), when no CEM is currently connected but the transport itself is up, `s2-resource` SHALL show a green "waiting for CEM" status - not the generic grey status a resource manager with no known transport state would show.

#### Scenario: D-Bus service registered, no CEM connected yet
- **WHEN** `Transport: D-Bus` has successfully registered its D-Bus service and no CEM has connected
- **THEN** the node's status is green "waiting for CEM"

#### Scenario: A CEM disconnects after having been connected (D-Bus)
- **WHEN** `Transport: D-Bus` is registered and a previously-connected CEM disconnects
- **THEN** the node's status returns to green "waiting for CEM", not grey - the D-Bus service itself remains registered and listening

#### Scenario: WebSocket connection genuinely drops
- **WHEN** `Transport: WebSocket`'s connection closes (a real transport-level disconnect, not a CEM-level event)
- **THEN** the node's status shows grey "waiting for CEM" (or a more specific disconnected/reconnecting status), since the transport itself is not currently usable

### Requirement: Port contract is a strict superset of s2-rm
When configured with `Transport: External` and `Control type: None`, `s2-resource`'s inputs, outputs, and message shapes SHALL be identical to `s2-rm`'s, so a flow using `s2-rm` today can switch to `s2-resource` in this configuration with no other changes.

#### Scenario: Both built-ins disabled
- **WHEN** `s2-resource` is configured with `Transport: External` and `Control type: None`
- **THEN** its port count, port order, and every message shape on those ports match `s2-rm`'s exactly
</content>

### Requirement: Resource ID is unique when a node is added in the editor
When the user adds an `s2-resource` node to the editor (from the palette, by paste, through the Import dialog or from Examples; Node-RED marks such nodes changed), the editor SHALL generate a new `resourceId` if its `resourceId` is empty or equal to that of any other `s2-resource` or `s2-rm-config` node in the editor; otherwise it SHALL keep it. An environment variable reference, `${NAME}` (or Node-RED's older `$(NAME)` form), SHALL be kept. Nodes the editor adds while loading or reloading the deployed flows SHALL be left unchanged.

#### Scenario: Node dropped from the palette
- **WHEN** a new `s2-resource` node is dropped from the palette
- **THEN** it gets a newly generated `resourceId` without its edit dialog being opened

#### Scenario: Node copied and pasted
- **WHEN** an existing `s2-resource` node is copied and pasted while the original is still in the workspace
- **THEN** the pasted node gets a newly generated `resourceId` and the original keeps its own

#### Scenario: Node cut and pasted
- **WHEN** an `s2-resource` node is cut and pasted, so no other node holds its `resourceId`
- **THEN** the pasted node keeps its `resourceId`

#### Scenario: Example imported twice
- **WHEN** the same example flow, which brings its own flow tab, is imported a second time with "Import copy" while the first import is still in the workspace
- **THEN** each `s2-resource` node from the second import gets a newly generated `resourceId`

#### Scenario: Deployed duplicates are not changed on load
- **WHEN** the editor loads deployed flows that already contain two `s2-resource` nodes with the same `resourceId`
- **THEN** neither node's `resourceId` is changed in the editor and no node is marked changed

#### Scenario: Deployed duplicates are not changed on reload
- **WHEN** the editor reloads the deployed flows without a page reload (e.g. after a deploy conflict or a project switch) and they contain two `s2-resource` nodes with the same `resourceId`
- **THEN** neither node's `resourceId` is changed in the editor

#### Scenario: Resource ID held by an s2-rm-config node
- **WHEN** an `s2-resource` node is added whose `resourceId` equals an existing `s2-rm-config` node's `resourceId`
- **THEN** the added node gets a newly generated `resourceId`

#### Scenario: Environment variable copied
- **WHEN** an `s2-resource` node whose `resourceId` is `${S2_RESOURCE_ID}` is copied and pasted
- **THEN** the pasted node keeps `${S2_RESOURCE_ID}`

### Requirement: Duplicate resource ID refuses to start
When an `s2-resource` node starts, it SHALL claim its resolved `resourceId` as a Resource Manager for the running Node-RED instance and, with `Transport: WebSocket` or `Transport: D-Bus`, also as a transport. If another running node already holds either claim for that `resourceId`, the node SHALL log an error naming the other node's id and saying it starts once it is deployed again after that node is gone, show a red `duplicate resource ID` status, and SHALL NOT create its Resource Manager, transport (no D-Bus service registration, no WebSocket connection) or built-in control type. A node SHALL release its claims when it closes, before anything else in its close handling.

#### Scenario: Two deployed nodes share a resource ID
- **WHEN** two `s2-resource` nodes with the same `resourceId` are deployed
- **THEN** the node started second logs an error naming the first node, shows a red `duplicate resource ID` status, and registers no D-Bus service and opens no WebSocket connection, while the first node runs normally

#### Scenario: Redeploying a node keeps its claim
- **WHEN** an `s2-resource` node is redeployed with the same `resourceId`
- **THEN** it starts normally, because the previous instance released its claim on close

#### Scenario: Duplicate removed
- **WHEN** the node holding a `resourceId` is closed (deleted or redeployed with a different `resourceId`) and the refused node is then redeployed
- **THEN** the redeployed node claims the `resourceId` and starts normally

#### Scenario: Transport already used by an s2-websocket
- **WHEN** an `s2-websocket` node is connected for `resourceId` X and an `s2-resource` with `Transport: WebSocket` and `resourceId` X is started after it
- **THEN** the `s2-resource` is refused in the same way

#### Scenario: Closing transport throws
- **WHEN** disconnecting the transport throws while an `s2-resource` node closes
- **THEN** its `resourceId` is released anyway

### Requirement: Resource ID is editable for WebSocket transport and inside subflows
With `Transport: WebSocket`, for any transport when the node is inside a subflow template, or whenever its `resourceId` is an environment variable reference, the Connection tab SHALL show the node's `resourceId` in an editable Resource ID field. Changing the transport SHALL NOT change the node's `resourceId`. Saving the dialog with the field empty SHALL store a newly generated ID.

#### Scenario: Field shown for WebSocket
- **WHEN** the Connection tab is rendered with `Transport: WebSocket`
- **THEN** a Resource ID field under the CEM picker shows the node's current `resourceId` and can be edited

#### Scenario: Field shown inside a subflow
- **WHEN** the Connection tab of an `s2-resource` inside a subflow template is rendered with `Transport: D-Bus`
- **THEN** an editable Resource ID field shows the node's current `resourceId`

#### Scenario: User sets the ID their CEM expects
- **WHEN** the user enters `my-heatpump-01` and saves
- **THEN** the node's `resourceId` is `my-heatpump-01`, and it is used in `ResourceManagerDetails` and the CEM URL after deploy

#### Scenario: Transport switched away and back
- **WHEN** a node with a user-set `resourceId` is switched to `Transport: D-Bus`, saved, and later switched back to `Transport: WebSocket`
- **THEN** the field shows the same user-set `resourceId`

#### Scenario: Field emptied
- **WHEN** the user clears the field and saves
- **THEN** the node's `resourceId` is a newly generated UUID

#### Scenario: Environment variable outside a subflow
- **WHEN** an `s2-resource` with `Transport: D-Bus` whose `resourceId` is `${S2_RESOURCE_ID}` is moved out of a subflow template into a flow
- **THEN** its dialog still shows the Resource ID field, so the reference can be replaced

### Requirement: Resource ID is validated in the editor
The editor SHALL treat a non-empty `resourceId` as invalid, with a message saying why, when it is neither an environment variable reference (`${NAME}` (or Node-RED's older `$(NAME)` form), `NAME` without whitespace) nor 2-64 characters of `a-z`, `A-Z`, `0-9`, `-`, `_` or `:`, or when it is not an environment variable reference and another `s2-resource` or `s2-rm-config` node in the editor has the same `resourceId`. When the value is a valid ID but not a UUID, the dialog SHALL show a non-blocking warning that CEMs built on s2python only accept UUIDs.

#### Scenario: Invalid characters
- **WHEN** the Resource ID is set to `my heatpump`
- **THEN** the node is shown as invalid, with a message naming the allowed characters and length

#### Scenario: ID used by another node
- **WHEN** the Resource ID is set to the `resourceId` of another `s2-resource` or `s2-rm-config` node
- **THEN** the node is shown as invalid, with a message saying another S2 node already uses this ID

#### Scenario: Valid non-UUID
- **WHEN** the Resource ID is set to `my-heatpump-01`
- **THEN** the node is valid, and the dialog shows a warning under the field that s2python-based CEMs require a UUID

#### Scenario: UUID
- **WHEN** the Resource ID is a UUID
- **THEN** the node is valid and no warning is shown

#### Scenario: Environment variable
- **WHEN** the Resource ID is set to `${S2_RESOURCE_ID}`, also when another node uses the same reference
- **THEN** the node is valid and no warning is shown

#### Scenario: Older environment variable form
- **WHEN** the Resource ID is set to `$(S2_RESOURCE_ID)`
- **THEN** the node is valid and no warning is shown

### Requirement: Resource ID from an environment variable
An `s2-resource` whose `resourceId` is `${NAME}` (or Node-RED's older `$(NAME)` form) SHALL use the value Node-RED substitutes from its environment (subflow instance properties, then flow and global environment) as its resource ID. If the variable is not set, so the reference is still in place when the node starts, the node SHALL log an error naming the variable, show a red `resource ID variable not set` status, and SHALL NOT start, as for a duplicate.

#### Scenario: Subflow instances with their own IDs
- **WHEN** a subflow containing an `s2-resource` with `resourceId` `${S2_RESOURCE_ID}` is placed twice, each instance setting `S2_RESOURCE_ID` to a different UUID
- **THEN** both instances start, each sending its own UUID as `resource_id`

#### Scenario: Variable not set
- **WHEN** a subflow instance doesn't set `S2_RESOURCE_ID`, and no flow or global environment does
- **THEN** that instance logs an error naming `S2_RESOURCE_ID`, shows a red `resource ID variable not set` status, and doesn't start

#### Scenario: Variable set but blank
- **WHEN** a subflow instance sets `S2_RESOURCE_ID` to an empty value
- **THEN** that instance logs an error saying the resource ID is empty, shows a red `resource ID missing` status, and doesn't start

### Requirement: Resource ID is checked before starting
After Node-RED's environment variable substitution, an `s2-resource` SHALL refuse to start, as for a duplicate, when its `resourceId` is empty (red `resource ID missing`) or is not 2-64 characters of `a-z`, `A-Z`, `0-9`, `-`, `_` or `:` (red `invalid resource ID`), logging an error that says which and how to fix it. A non-string value SHALL be checked and used as its string form.

#### Scenario: Empty resource ID
- **WHEN** an `s2-resource` starts with an empty `resourceId`
- **THEN** it logs an error, shows a red `resource ID missing` status, and registers no D-Bus service and opens no WebSocket connection

#### Scenario: Resolved value outside the S2 ID format
- **WHEN** a subflow instance sets the variable used as resource ID to `boiler 1`
- **THEN** that instance logs an error naming the value, shows a red `invalid resource ID` status, and doesn't start

#### Scenario: Number from an environment variable
- **WHEN** the variable used as resource ID is a number property `42`
- **THEN** the node starts with resource ID `42`

### Requirement: Claims are released when setup fails
If an `s2-resource`'s setup throws after it has claimed its resource ID, it SHALL release its claims before the error reaches Node-RED, since Node-RED never closes a node whose constructor threw.

#### Scenario: Setup fails after claiming
- **WHEN** an `s2-resource`'s setup throws after it claimed its resource ID (e.g. a malformed CEM URL)
- **THEN** its claims are released, so a corrected node with the same resource ID can start without restarting Node-RED
