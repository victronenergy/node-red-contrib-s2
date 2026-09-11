# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Fixed

- `s2-resource`'s Connection tab: alignment/layout fixes, `Transport` defaults to `D-Bus`, and the D-Bus config picker is labeled "Virtual Device"; Resource Manager tab fields (`Manufacturer`/`Model`/`Serial`/`Firmware`) are grouped under a "Device" heading, blank by default, and pre-fill from the node's own `Name`.
- `s2-dbus-config`: "3-phase symmetric" is only selectable when `Phases: 3`; `Power Meas.` defaults to "Per phase"; a newly added config node's `Name` pre-fills from the parent `s2-resource` node.

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
