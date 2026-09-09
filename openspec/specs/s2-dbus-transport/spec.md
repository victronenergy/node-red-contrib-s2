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

### Requirement: Power measurement relay to the CEM
The `s2-dbus` node SHALL cache the latest power value(s) received on its input (keyed by `Ac/Power` or `Ac/L{1,2,3}/Power`, matching its configured measurement type) and, while power measurement is active for a CEM, SHALL emit them as `{ command: 'PowerMeasurement', cemId, values }` for `s2-rm` to convert into S2 messages.

#### Scenario: CEM starts power measurement
- **WHEN** the node receives `{ payload: { s2Signal: 'PowerMeasurementStart' }, cemId }` and has a cached value for its configured measurement type
- **THEN** it immediately emits `{ command: 'PowerMeasurement', cemId, values }` with that cached value

#### Scenario: Value updates while active
- **WHEN** the node's input receives an updated value (e.g. `{ payload: { 'Ac/Power': 1800 } }`) while power measurement is active for a CEM
- **THEN** it emits an updated `{ command: 'PowerMeasurement', cemId, values }`

#### Scenario: CEM stops power measurement
- **WHEN** the node receives `{ payload: { s2Signal: 'PowerMeasurementStop' }, cemId }`
- **THEN** it stops emitting `PowerMeasurement` commands for that CEM until measurement is started again

### Requirement: Power measurement exposed as a D-Bus BusItem property
The `s2-dbus` node SHALL declare the property key(s) matching its configured measurement type (`Ac/Power`, or `Ac/L1/Power`/`Ac/L2/Power`/`Ac/L3/Power`) as real, readable D-Bus BusItem properties on its registered service, and SHALL update them on every value received on its input - independent of whether power measurement is currently active for any CEM.

#### Scenario: Value fed to the node's input
- **WHEN** the node receives `{ payload: { 'Ac/Power': 1800 } }` (or the per-phase equivalent) on its input
- **THEN** the corresponding D-Bus property is updated to that value, readable via `GetValue` by anything else on the Venus system

#### Scenario: Value updated before any CEM has started measurement
- **WHEN** the node receives a measurement value update and no CEM currently has power measurement active
- **THEN** the D-Bus property is still updated, even though no `PowerMeasurement` command is emitted to `s2-rm`

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
