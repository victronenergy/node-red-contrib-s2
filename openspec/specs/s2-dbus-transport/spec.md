# s2-dbus-transport Specification

## Purpose

Provides a Venus OS D-Bus transport for S2, so a resource manager flow can speak S2 to a local CEM over D-Bus without installing node-red-contrib-victron.

## Requirements

### Requirement: D-Bus service registration
The `s2-dbus` node SHALL register a `com.victronenergy.<deviceType>.virtual_s2_<nodeId>` D-Bus service exposing the `com.victronenergy.S2` interface at `/S2/0/Rm` (Connect/Disconnect/Message/KeepAlive/Discover), where `deviceType` comes from its configuration and `nodeId` is the node's own id, sanitized to alphanumeric/underscore characters.

#### Scenario: Node deploys with valid config
- **WHEN** an `s2-dbus` node is deployed with a resolvable D-Bus connection and a valid `deviceType`
- **THEN** it registers the corresponding `com.victronenergy.<deviceType>.virtual_s2_<nodeId>` service exposing `/S2/0/Rm`

#### Scenario: S2/0/Active and S2/0/Rm are usable from the moment the service registers
- **WHEN** the service is registered
- **THEN** `S2/0/Active` and `S2/0/Rm` are declared as ordinary D-Bus BusItem properties (initial values `0` and `''`) on the registered interface, so updating them (e.g. when a CEM connects, disconnects, or selects a control type) never fails with a "Property not found" error

### Requirement: Transport message parity
The `s2-dbus` node SHALL emit and accept the exact same `msg` shapes on its input/output as `s2-websocket`, so `s2-rm` requires no changes to use either transport interchangeably.

#### Scenario: CEM calls Connect over D-Bus
- **WHEN** a CEM calls the `Connect` D-Bus method with a `cemId` and `keepAliveInterval`
- **THEN** the node sends `{ payload: { command: 'Connect', cemId, keepAliveInterval } }` on its output, identical in shape to what `s2-websocket` sends on its own `Connect`

#### Scenario: s2-rm sends a Message signal
- **WHEN** the node receives `{ payload: { s2Signal: 'Message', message } }` on its input
- **THEN** it emits that message as an S2 `Message` D-Bus signal to the connected CEM

#### Scenario: s2-rm sets the Active flag
- **WHEN** the node receives `{ payload: { 'S2/0/Active': 1 | 0 } }` on its input
- **THEN** it updates the `S2/0/Active` D-Bus property accordingly

### Requirement: Configurable D-Bus connection
The `s2-dbus-config` node SHALL support connecting via auto-detected session/system bus, an explicit system bus, or a TCP address, matching the connection modes node-red-contrib-victron's config node already offers.

#### Scenario: TCP address configured
- **WHEN** `s2-dbus-config` is set to `tcp` with an address
- **THEN** `s2-dbus` connects to that TCP address instead of a local bus

### Requirement: Config dialog orders Phases above Power Meas.
`s2-dbus-config`'s edit dialog SHALL present the `Phases` field before the `Power Meas.` field, since `Power Meas.`'s own available options depend on `Phases` (see the "3-phase symmetric" requirement below).

#### Scenario: Dialog layout
- **WHEN** `s2-dbus-config`'s edit dialog is rendered
- **THEN** `Phases` appears above `Power Meas.`

### Requirement: Phases offers only 1 or 3
`s2-dbus-config`'s `Phases` field SHALL offer only `1` and `3` - not `2`. S2 has no commodity quantity defined for a 2-phase (split-phase) device, so there is no correct way to relay a `Phases: 2` device's measurement to a CEM.

#### Scenario: Phases dropdown options
- **WHEN** `s2-dbus-config`'s edit dialog is rendered
- **THEN** the `Phases` dropdown offers exactly `1` and `3`

### Requirement: "3-phase symmetric" power measurement requires exactly 3 phases
`s2-dbus-config`'s `Power Meas.` field SHALL offer "3-phase symmetric" (`3_PHASE_SYMMETRIC`) only when `Phases: 3`. For `Phases: 1`, that option SHALL be unavailable, and if `Power Meas.` was previously set to `3_PHASE_SYMMETRIC` and `Phases` changes away from `3`, `Power Meas.` SHALL fall back to another valid option for the new `Phases` value rather than silently keeping an inapplicable selection - including visibly, in the dropdown itself, the moment `Phases` changes, not only after the next redeploy.

#### Scenario: Phases: 3
- **WHEN** `Phases` is set to `3`
- **THEN** the `Power Meas.` dropdown offers "None", "3-phase symmetric", and "Per phase"

#### Scenario: Phases: 1
- **WHEN** `Phases` is set to `1`
- **THEN** the `Power Meas.` dropdown offers only "None" and "Per phase" - "3-phase symmetric" is not selectable

#### Scenario: Changing Phases away from 3 while 3-phase symmetric is selected
- **WHEN** `Power Meas.: 3-phase symmetric` is selected and `Phases` is changed from `3` to `1`
- **THEN** `Power Meas.` immediately reads "Per phase" in the still-open dialog, not just after the next redeploy

### Requirement: New config nodes default to per-phase power measurement
`s2-dbus-config`'s `Power Meas.` field SHALL default to "Per phase" (`L1_L2_L3`) for a newly added node, not "3-phase symmetric".

#### Scenario: Newly added node
- **WHEN** a new `s2-dbus-config` node's edit dialog is opened for the first time
- **THEN** `Power Meas.` reads "Per phase"

### Requirement: Config node Name pre-fills from the parent s2-resource node
When an `s2-dbus-config` node is created via the "add new" flow from inside an `s2-resource` node's edit dialog, and the parent `s2-resource` node's own `Name` field is non-empty, `s2-dbus-config`'s `Name` field SHALL pre-fill with that value if the config node's `Name` is otherwise empty. Opening an existing `s2-dbus-config` node, or adding one from any other context (e.g. directly from the palette, or from `s2-dbus`), SHALL NOT be affected.

#### Scenario: Adding a new D-Bus config from within a named s2-resource node
- **WHEN** an `s2-resource` node named "Boiler" has its Connection tab's "Virtual Device" picker used to add a new `s2-dbus-config` node
- **THEN** the new config node's `Name` field pre-fills with "Boiler"

#### Scenario: Adding a new D-Bus config from the standalone s2-dbus node
- **WHEN** a new `s2-dbus-config` node is added from `s2-dbus`'s own edit dialog
- **THEN** its `Name` field is empty, unchanged from today's behavior

### Requirement: Power measurement relay to the CEM
The `s2-dbus` node SHALL cache the latest power value(s) received on its input and, while power measurement is active for a CEM, SHALL emit them as `{ command: 'PowerMeasurement', cemId, values }` for `s2-rm` to convert into S2 messages. Two independent input shapes SHALL be recognized on every message, checked independently (a message can use either):
- **Raw D-Bus-key shape**: keyed by `Ac/Power` or `Ac/L{1,2,3}/Power`, matching the configured measurement type - e.g. `{ payload: { 'Ac/Power': 1800 } }`.
- **`values` shape**: `{ payload: { values: <number | number[]> } }`, whose meaning is derived from the configured `measurementType`/`nrOfPhases`/`phaseSetting`:
  - `measurementType: L1_L2_L3`, `nrOfPhases: 1`: a scalar `values` is the single wired phase's power (`phaseSetting` names which S2 commodity, e.g. `ELECTRIC.POWER.L2`). An array `values` SHALL be rejected (a `node.warn` and no cache update) - a genuinely single-phase device has no second or third line to attribute array elements to.
  - `measurementType: L1_L2_L3`, `nrOfPhases: 3`: only an array `values` of length exactly 3 is accepted, mapping element-by-element to `ELECTRIC.POWER.L1`, `L2`, `L3` in order. A scalar `values` SHALL be rejected (a `node.warn` and no cache update), not broadcast - which single phase a lone value belongs to is ambiguous for a per-phase measurement.
  - `measurementType: 3_PHASE_SYMMETRIC` (only valid at `nrOfPhases: 3`): a scalar `values` is sent as a single `ELECTRIC.POWER.3_PHASE_SYMMETRIC` value. An array `values` of length 3 is summed into a single `ELECTRIC.POWER.3_PHASE_SYMMETRIC` value for S2 (the array elements individually affect only the D-Bus per-phase properties - see the BusItem requirement below). An array of any other length SHALL be rejected (a `node.warn` and no cache update).
  - `measurementType: ''` (None): `values` has nothing configured to map to - no-op, matching the raw-key shape's own behavior with no measurement type configured.

#### Scenario: CEM starts power measurement
- **WHEN** the node receives `{ payload: { s2Signal: 'PowerMeasurementStart' }, cemId }` and has a cached value for its configured measurement type
- **THEN** it immediately emits `{ command: 'PowerMeasurement', cemId, values }` with that cached value

#### Scenario: Value updates while active
- **WHEN** the node's input receives an updated value (e.g. `{ payload: { 'Ac/Power': 1800 } }`) while power measurement is active for a CEM
- **THEN** it emits an updated `{ command: 'PowerMeasurement', cemId, values }`

#### Scenario: CEM stops power measurement
- **WHEN** the node receives `{ payload: { s2Signal: 'PowerMeasurementStop' }, cemId }`
- **THEN** it stops emitting `PowerMeasurement` commands for that CEM until measurement is started again

#### Scenario: Scalar `values` on a single-phase, per-phase-measured device
- **WHEN** `measurementType: L1_L2_L3`, `nrOfPhases: 1`, `phaseSetting: 2`, and the node receives `{ payload: { values: 10 } }` while measurement is active
- **THEN** it emits a `PowerMeasurement` with a single `{ commodity_quantity: 'ELECTRIC.POWER.L2', value: 10 }`

#### Scenario: Array `values` rejected on a single-phase device
- **WHEN** `measurementType: L1_L2_L3`, `nrOfPhases: 1`, and the node receives `{ payload: { values: [11, 22, 33] } }`
- **THEN** the cache is not updated, a warning is logged, and no `PowerMeasurement` reflecting those values is ever emitted

#### Scenario: Array `values` on a 3-phase, per-phase-measured device
- **WHEN** `measurementType: L1_L2_L3`, `nrOfPhases: 3`, and the node receives `{ payload: { values: [11, 22, 33] } }` while measurement is active
- **THEN** it emits a `PowerMeasurement` with `{ commodity_quantity: 'ELECTRIC.POWER.L1', value: 11 }`, `{ ...L2, value: 22 }`, `{ ...L3, value: 33 }`

#### Scenario: Scalar `values` rejected on a 3-phase, per-phase-measured device
- **WHEN** `measurementType: L1_L2_L3`, `nrOfPhases: 3`, and the node receives `{ payload: { values: 10 } }`
- **THEN** the cache is not updated, a warning is logged, and no `PowerMeasurement` reflecting that value is ever emitted

#### Scenario: Scalar `values` under 3-phase symmetric measurement
- **WHEN** `measurementType: 3_PHASE_SYMMETRIC` and the node receives `{ payload: { values: 10 } }` while measurement is active
- **THEN** it emits a `PowerMeasurement` with a single `{ commodity_quantity: 'ELECTRIC.POWER.3_PHASE_SYMMETRIC', value: 10 }`

#### Scenario: Array `values` under 3-phase symmetric measurement is summed for S2
- **WHEN** `measurementType: 3_PHASE_SYMMETRIC` and the node receives `{ payload: { values: [11, 22, 33] } }` while measurement is active
- **THEN** it emits a `PowerMeasurement` with a single `{ commodity_quantity: 'ELECTRIC.POWER.3_PHASE_SYMMETRIC', value: 66 }`

#### Scenario: Array `values` of the wrong length rejected under 3-phase symmetric measurement
- **WHEN** `measurementType: 3_PHASE_SYMMETRIC` and the node receives `{ payload: { values: [11, 22] } }`
- **THEN** the cache is not updated, a warning is logged, and no `PowerMeasurement` reflecting those values is ever emitted

### Requirement: Power measurement exposed as a D-Bus BusItem property
The `s2-dbus` node SHALL declare and update, as real readable D-Bus BusItem properties, exactly the property key(s) that correspond to its configured `measurementType`/`nrOfPhases`/`phaseSetting` - independent of whether power measurement is currently active for any CEM:
- `measurementType: L1_L2_L3`, `nrOfPhases: 1`: exactly one property, `Ac/L<phaseSetting>/Power` - never `Ac/L1/Power` or `Ac/L3/Power` when wired to a different line.
- `measurementType: L1_L2_L3`, `nrOfPhases: 3`: `Ac/L1/Power`, `Ac/L2/Power`, `Ac/L3/Power`.
- `measurementType: 3_PHASE_SYMMETRIC`: `Ac/Power`, plus `Ac/L1/Power`, `Ac/L2/Power`, `Ac/L3/Power` (derived - see the scenarios below).
- `measurementType: ''` (None): no measurement-tracked properties; the minimal-meter shape's own defaults apply (see "Full node-red-contrib-victron-compatible D-Bus shape" below).

Whenever any measurement type is configured, `Ac/Power` SHALL start at `0` (not the minimal-meter shape's generic `null` "unknown" placeholder) and SHALL be kept as the live sum of every currently-known per-phase `Power` value for that device (not just the one that changed) - including for a single-phase device, whose only known line contributes the whole sum.

#### Scenario: Single-phase device declares only its wired line
- **WHEN** `measurementType: L1_L2_L3`, `nrOfPhases: 1`, `phaseSetting: 2`
- **THEN** the registered service declares `Ac/L2/Power` as a measurement-tracked property, and neither `Ac/L1/Power` nor `Ac/L3/Power` is declared as one (they may still exist as `null`-defaulted "minimal meter" placeholders per the shape requirement below, but are never written to by measurement input)

#### Scenario: Single-phase device's Ac/Power starts at 0, consistent with its wired line
- **WHEN** `measurementType: L1_L2_L3`, `nrOfPhases: 1`, `phaseSetting: 2`, and the node has just registered with no measurement received yet
- **THEN** both `Ac/L2/Power` and `Ac/Power` read `0` - never one at `0` and the other at `null`/unknown

#### Scenario: Value fed to the node's input
- **WHEN** the node receives `{ payload: { 'Ac/Power': 1800 } }` (or the per-phase equivalent) on its input
- **THEN** the corresponding D-Bus property is updated to that value, readable via `GetValue` by anything else on the Venus system

#### Scenario: Per-phase value updates keep Ac/Power in sync
- **WHEN** `measurementType: L1_L2_L3`, `nrOfPhases: 3`, and the node receives `Ac/L1/Power: 100`, then later `Ac/L2/Power: 200` (via either input shape)
- **THEN** after the first update `Ac/Power` reads `100`, and after the second it reads `300` (both known phases summed; `Ac/L3/Power` still unset contributes `0`)

#### Scenario: 3-phase-symmetric scalar splits evenly across per-phase properties
- **WHEN** `measurementType: 3_PHASE_SYMMETRIC` and the node receives a scalar measurement of `9` (via either input shape)
- **THEN** `Ac/Power` reads `9`, and `Ac/L1/Power`, `Ac/L2/Power`, `Ac/L3/Power` each read `3` (one third)

#### Scenario: 3-phase-symmetric array writes per-phase properties directly, unsplit
- **WHEN** `measurementType: 3_PHASE_SYMMETRIC` and the node receives `{ payload: { values: [11, 22, 33] } }`
- **THEN** `Ac/Power` reads `66` (the sum), and `Ac/L1/Power`, `Ac/L2/Power`, `Ac/L3/Power` read `11`, `22`, `33` respectively (not each divided by 3 again)

#### Scenario: Value updated before any CEM has started measurement
- **WHEN** the node receives a measurement value update and no CEM currently has power measurement active
- **THEN** every corresponding D-Bus property (including `Ac/Power` aggregation/distribution above) is still updated, even though no `PowerMeasurement` command is emitted to `s2-rm`

#### Scenario: No measurement type configured
- **WHEN** `s2-dbus-config`'s measurement type is set to "None"
- **THEN** the minimal-meter shape's own `Ac/Power`/`Ac/L{1,2,3}/Power` properties (see "Full node-red-contrib-victron-compatible D-Bus shape" below) are still declared, but stay at their default `null` ("unknown") value - no property key is added or removed based on measurement type, only whether it's live-tracked

### Requirement: Full node-red-contrib-victron-compatible D-Bus shape
The `s2-dbus` node SHALL declare the same "minimal meter" D-Bus BusItem properties node-red-contrib-victron's virtual `acload`/`heatpump` devices expose (Position, NrOfPhases, PhaseSetting, Connected, DeviceType, ErrorCode, IsGenericEnergyMeter, per-phase Current/Energy Forward/Energy Reverse/Power/PowerFactor/Voltage, and the top-level Ac/Energy Forward/Reverse/Frequency/Power/PowerFactor aggregates), independent of its `measurementType` setting, so the Victron UI (VRM, the GX device list) finds every path it expects on any registered service. `NrOfPhases`, `Position`, and `PhaseSetting` SHALL be configurable on `s2-dbus-config` and reported with their real, configured values. Every other declared numeric path SHALL default to `null` ("unknown", per BusItem convention) unless the node has an actual data source for it (currently: the `measurementType`-tracked power key(s), which start at `0` and stay live via the power-measurement mechanism above) - never a fabricated reading.

#### Scenario: Single-phase device reports under its configured line
- **WHEN** `s2-dbus-config` has `nrOfPhases: 1` and `phaseSetting: 2`
- **THEN** the per-phase properties are declared as `Ac/L2/*` (not `Ac/L1/*`), and `PhaseSetting` reports `2`

#### Scenario: Multi-phase device declares one property set per phase
- **WHEN** `s2-dbus-config` has `nrOfPhases: 3`
- **THEN** `Ac/L1/*`, `Ac/L2/*`, and `Ac/L3/*` are all declared, and no `PhaseSetting` property is declared

#### Scenario: Unknown numeric paths are never fabricated
- **WHEN** the node registers and has no data source for a given path (e.g. `Ac/L1/Voltage`, with no configured measurement covering it)
- **THEN** that property's initial value is `null`, not `0` or any other guessed number

### Requirement: Auto-calculated Energy (kWh) from Power over time
`s2-dbus-config` SHALL offer an "Auto-calculate energy" setting, defaulting to enabled for a newly added node, mirroring node-red-contrib-victron's own virtual `acload`/`heatpump` devices (same integration approach as their `accumulateDelta` helper: on every `Power` update, before applying the new value, the time elapsed since that same property's last update is multiplied by `max(0, previous power)` and added, converted to kWh, onto that property's running Energy Forward total - never negative, so only forward/import energy is tracked, matching `acload`'s own one-directional behavior with no Reverse tracking). When enabled, the `s2-dbus` node SHALL:
- Accumulate each declared `Ac/L{1,2,3}/Power` property's integrated energy into the corresponding `Ac/L{1,2,3}/Energy/Forward` property, and roll the per-phase totals up into `Ac/Energy/Forward` as their sum.
- For `measurementType: 3_PHASE_SYMMETRIC`, accumulate once directly from `Ac/Power` into `Ac/Energy/Forward` (not separately from each derived per-phase value, which would triple-count the same underlying reading).
- Leave `Ac/Energy/Forward`/`Ac/L{1,2,3}/Energy/Forward` at their `null` ("unknown") default when the setting is disabled, unchanged from today's behavior.

#### Scenario: Newly added config node has auto-calculation enabled
- **WHEN** a new `s2-dbus-config` node's edit dialog is opened for the first time
- **THEN** "Auto-calculate energy" is checked

#### Scenario: Per-phase energy accumulates from per-phase power
- **WHEN** "Auto-calculate energy" is enabled, `measurementType: L1_L2_L3`, `nrOfPhases: 1`, `phaseSetting: 2`, and `Ac/L2/Power` is updated to `100` at time T0 and again to `150` at time T0+3600000ms (1 hour)
- **THEN** at the second update, `Ac/L2/Energy/Forward` has increased by `0.1` kWh (100W for 1 hour), using the *previous* power value (100), and `Ac/Energy/Forward` reflects the same increase

#### Scenario: 3-phase-symmetric energy accumulates once from Ac/Power
- **WHEN** "Auto-calculate energy" is enabled and `measurementType: 3_PHASE_SYMMETRIC`
- **THEN** `Ac/Energy/Forward` accumulates directly from `Ac/Power`'s own value-over-time, not as a sum of three separately-accumulated derived per-phase values

#### Scenario: Negative power never decreases Energy Forward
- **WHEN** "Auto-calculate energy" is enabled and a tracked `Power` property's previous value was negative
- **THEN** no energy is subtracted for the interval since that value applied (only non-negative power contributes)

#### Scenario: Setting disabled
- **WHEN** "Auto-calculate energy" is unchecked
- **THEN** `Ac/Energy/Forward` and every `Ac/L{1,2,3}/Energy/Forward` stay at their `null` default, unchanged from today's behavior

### Requirement: Persisted DeviceInstance
The `s2-dbus` node SHALL claim its D-Bus `DeviceInstance` via `AddSettings` against `com.victronenergy.settings` (path `/Settings/Devices/virtual_s2_<nodeId>/ClassAndVrmInstance`, default `<deviceType>:100`), the same mechanism node-red-contrib-victron's virtual devices use, rather than a user-configured fixed number - so the instance is stable across redeploys and restarts and cannot collide with another device's user-picked value.

#### Scenario: First deploy claims a new instance
- **WHEN** an `s2-dbus` node is deployed for the first time
- **THEN** it registers its D-Bus service using the `DeviceInstance` number `com.victronenergy.settings` assigns for its settings path

#### Scenario: Redeploy reuses the previously-claimed instance
- **WHEN** an `s2-dbus` node is redeployed or the Node-RED process restarts, and its settings path already holds a previously-assigned instance
- **THEN** it registers its D-Bus service using that same `DeviceInstance` number again

#### Scenario: Settings service temporarily unavailable
- **WHEN** `com.victronenergy.settings` is not yet available when `s2-dbus` deploys
- **THEN** the node retries the `AddSettings` call with backoff instead of failing immediately

### Requirement: Raw S2 messages visible in the Debug sidebar
When its "Show raw S2 messages in debug sidebar" setting is enabled, the `s2-dbus` node SHALL publish every S2 message to/from the CEM, and every CEM Connect/Disconnect event, to the Node-RED editor's Debug sidebar, without requiring a Debug node to be wired into the flow. Every published entry's topic SHALL include the cemId it applies to.

#### Scenario: Setting enabled - message traffic
- **WHEN** "Show raw S2 messages in debug sidebar" is checked and a message is sent to or received from the CEM
- **THEN** that message appears in the Debug sidebar, attributed to this node, with a topic naming the cemId it was sent to or received from

#### Scenario: Setting enabled - Connect/Disconnect
- **WHEN** "Show raw S2 messages in debug sidebar" is checked and a CEM connects or disconnects
- **THEN** a corresponding entry (topic suffixed `(Connect)`/`(Disconnect)`) appears in the Debug sidebar, naming that CEM's id

#### Scenario: Setting disabled
- **WHEN** "Show raw S2 messages in debug sidebar" is unchecked
- **THEN** no message content is published to the Debug sidebar

### Requirement: Device type restricted to known products
The `s2-dbus-config` node SHALL restrict `deviceType` to a value `dbus-victron-virtual` recognizes as a product (at minimum `acload` and `heatpump`).

#### Scenario: Unrecognized device type
- **WHEN** `s2-dbus-config` is configured with a `deviceType` not recognized by `dbus-victron-virtual`
- **THEN** the node fails to register its D-Bus service and reports an error status instead of registering a malformed service
</content>
