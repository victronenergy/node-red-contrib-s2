## Why

Venus OS already has a working, non-WebSocket way to speak S2: a CEM on the same GX device can call an S2 D-Bus service directly. Today the only way to reach it from node-red-contrib-s2 is to wire a `node-red-contrib-victron` virtual device (acload/heatpump with "S2 support" enabled) into `s2-rm` - that palette ships with Venus firmware, so installing it isn't the issue. The issue is that it repurposes an AC-load/heat-pump device just to get an S2 endpoint: users configure phase counts, product type, and other AC-metering fields that have nothing to do with S2, for a "device" that isn't actually powering anything. A dedicated `s2-dbus` node simplifies this to a purpose-built S2 transport - matching `s2-websocket`'s scope and config surface - with no dependency, soft or hard, on node-red-contrib-victron.

## What Changes

- Add `s2-dbus`: a transport node that registers a `com.victronenergy.<deviceType>.virtual_s2_<nodeId>` D-Bus service exposing `/S2/0/Rm` (`com.victronenergy.S2`: Connect/Disconnect/Message/KeepAlive/Discover). `nodeId` is the node's own id (short, already unique), not the S2 resourceId (typically a long UUID, and unsanitized would break the D-Bus name outright) - matches node-red-contrib-victron's own virtual-device service naming.
- Add `s2-dbus-config`: holds the D-Bus connection (auto/system/tcp) and device type (`acload` | `heatpump`).
- `s2-dbus` reproduces the exact same wire message shape `s2-websocket` already uses with `s2-rm` (see `s2-websocket/index.ts` header comment) - `s2-rm` needs no changes and cannot tell the two transports apart.
- New hard dependencies: `dbus-victron-virtual` and `dbus-native-victron` (the same two standalone, pure-JS packages node-red-contrib-victron's own virtual-device S2 support builds on). No dependency, soft or hard, on node-red-contrib-victron itself.
- `s2-dbus` also relays power measurement: it caches the latest value(s) fed to its input (e.g. `{payload: {'Ac/Power': 1500}}`, from wherever the flow gets them - typically the controlled load's own API), exposes them as real, readable D-Bus BusItem properties on the same service (e.g. `Ac/Power`, or `Ac/L1/Power`/`Ac/L2/Power`/`Ac/L3/Power` per the configured measurement type - the same key names `victron-virtual`'s minimal-meter shape uses, but only those keys, not the full meter shape), and, while a CEM has an active `PowerMeasurementStart`, also emits them as `{command: 'PowerMeasurement', cemId, values}` for `s2-rm` to turn into S2 messages.

- D-Bus registration lives in a shared class, `S2DbusTransport` (`src/lib/transport/dbus.ts`), the same shape as the existing `S2WebSocketTransport` - `2026-09-07-s2-resource-composite-node`'s `Transport: D-Bus` option constructs it directly, so this change and that one now land together rather than the D-Bus option waiting for a later follow-up.

Out of scope (tracked separately, not part of this change): dynamic OMBC add/remove, and the full `victron-virtual`-style minimal-meter shape (energy counters, frequency, power factor, per-phase voltage/current, `NrOfPhases`/`Position`/`Connected` etc.) - only the power-reading keys already tracked for S2 are exposed, not a general-purpose meter device.

## Capabilities

### New Capabilities
- `s2-dbus-transport`: a Venus OS D-Bus transport node/config pair for S2, conforming to the transport contract `s2-rm-protocol` already defines from the RM side.

### Modified Capabilities
(none - `s2-rm-protocol`'s existing transport contract is consumed as-is, not changed)

## Impact

- New files: `src/nodes/s2-dbus/`, `src/nodes/s2-dbus-config/`, `src/lib/transport/dbus.ts`, plus their `test/` and doc coverage.
- `package.json`: two new runtime dependencies (`dbus-victron-virtual`, `dbus-native-victron`); `s2-dbus`/`s2-dbus-config` added to the `node-red.nodes` map.
- No changes to `s2-rm`, `s2-websocket`, or any existing spec's requirements.
- `2026-09-07-s2-resource-composite-node`'s `Transport: D-Bus` option depends on `src/lib/transport/dbus.ts` from this change.
