# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Fixed

- `s2-dbus`/`s2-resource` (`Transport: D-Bus`): a single-phase device no longer declares bogus `Ac/L1/Power`/`Ac/L3/Power` D-Bus properties for lines it doesn't have; `Ac/Power` is now always kept as the live sum of known per-phase readings; `3-phase symmetric` measurement now also populates per-phase D-Bus properties (evenly split for a scalar reading, written directly for a per-phase array).
- `s2-resource`'s Connection tab: alignment/layout fixes, `Transport` defaults to `D-Bus`, and the D-Bus config picker is labeled "Virtual Device"; Resource Manager tab fields (`Manufacturer`/`Model`/`Serial`/`Firmware`) are grouped under a "Device" heading, blank by default, and pre-fill from the node's own `Name`.
- `s2-dbus-config`: "3-phase symmetric" is only selectable when `Phases: 3`; `Power Meas.` defaults to "Per phase"; a newly added config node's `Name` pre-fills from the parent `s2-resource` node.
- Label text on `s2-resource`'s blue canvas/palette entries is now white, for readable contrast against the blue background (was black).

### Added

- `s2-dbus`/`s2-resource`: a simpler `{ payload: { values: <number | number[]> } }` input shape for power measurement, alongside the existing raw D-Bus-key shape (`{ payload: { 'Ac/Power': 1500 } }`) - see [Sending power measurements over D-Bus](README.md#sending-power-measurements-over-d-bus).
- `s2-dbus-config`: "Auto-calculate energy" setting (on by default) - integrates power over time into `Ac/Energy/Forward` (and per-phase `Ac/L<n>/Energy/Forward`), the same approach node-red-contrib-victron's own virtual `acload`/`heatpump` devices use.

### Changed

- Every node's palette/canvas display label drops the redundant "s2-" prefix (e.g. `s2-resource` shows as "resource") - internal type names (used in flow JSON) are unchanged, so existing flows are unaffected.
- `s2-resource` now shows with a blue background and white icon (`icons/s2-logo-white.svg`), instead of the white background/colored icon every other node uses, so it stands out as the recommended starting point.

## [0.4.1]

### Fixed

- `s2-resource`'s OMBC "Same value on all phases" checkbox now locks to the referenced D-Bus config's phase count.

## [0.4.0]

### Added

- `s2-dbus` node: Venus OS D-Bus transport for S2 - registers a `com.victronenergy.<deviceType>.virtual_s2_<nodeId>` D-Bus service exposing the S2-over-D-Bus session protocol, with the same message shapes `s2-websocket` uses so `s2-rm` needs no changes to use either transport. Also relays power measurement as real, readable D-Bus BusItem properties.
- `s2-dbus-config` node: configuration for `s2-dbus`'s D-Bus connection, device type, and power measurement type.
- `s2-resource` node: a composite node combining `s2-rm`'s session state machine, a built-in transport (`WebSocket`, `D-Bus`, or `External`), and a built-in control type (`OMBC` or `None`) behind one tabbed edit dialog - a minimal S2 flow now needs one node instead of wiring `s2-rm`, a transport node, and a control-type node together.

## [0.1.0]

### Added

- `s2-rm` node: S2 Resource Manager session handling (handshake, control type selection, instructions).
- `s2-rm-config` / `s2-cem-config` nodes for RM identity and CEM connection configuration.
- `s2-websocket` node: WebSocket transport to a CEM, with reconnect/backoff handling.
- Operation Mode Based Control (OMBC) and Power Envelope Based Control (PEBC) support.
- PowerMeasurement and PowerForecast forwarding.
- Multiple concurrent CEM sessions.
