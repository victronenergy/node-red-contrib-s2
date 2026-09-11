## MODIFIED Requirements

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

### Requirement: "Same value on all phases" is hidden when the D-Bus phase count and measurement type make it unambiguous
When `Control type: OMBC` and `Transport: D-Bus` are both selected, each operation mode's "Same value on all phases" checkbox and power-value field(s) SHALL be driven by the referenced `s2-dbus-config` node's `nrOfPhases` **and** `measurementType` together, not `nrOfPhases` alone:
- `nrOfPhases: 1`: the checkbox SHALL be hidden (internally forced unchecked); the mode's power value SHALL be entered through its single active per-phase field (per the dimming requirement below).
- `nrOfPhases: 3` and `measurementType: 3_PHASE_SYMMETRIC`: the checkbox SHALL be hidden (internally forced checked); the mode's power value SHALL be entered once, through the single symmetric field.
- `nrOfPhases: 3` and `measurementType: L1_L2_L3`: the checkbox SHALL be hidden (internally forced unchecked); the mode's power value SHALL be entered through all three per-phase fields (L1, L2, L3), none dimmed.
- `nrOfPhases: 2`, or any `Transport` other than `D-Bus`: the checkbox SHALL remain visible and freely editable, unchanged from today's behavior.

A hidden checkbox offers no actual choice - the visible field count (1 vs. 3) already shows which mode is in effect - so it is hidden outright rather than shown disabled/greyed. This SHALL update on the same triggers as the per-phase dimming requirement below (the `s2-dbus-config` reference or its own `Phases`/`Power Meas.` values changing, or `Transport` changing, while the dialog is open).

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

## ADDED Requirements

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
