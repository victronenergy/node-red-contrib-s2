# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Fixed

- `s2-resource` (`Transport: D-Bus`): a `topic: 'PowerMeasurement'` message on a node with a built-in OMBC control type, and any `command: 'PowerMeasurement'` message (native S2 values), now update the D-Bus measurement cache and its BusItems - previously they were relayed to the CEM only, silently skipping D-Bus exposure.

## [0.9.0]

### Changed

- **Breaking:** Reverses the `[0.7.0]` change below - `NOT_CONTROLABLE` in `ResourceManagerDetails.available_control_types` is opt-out again, not forced. `s2-rm-config`'s and `s2-resource`'s control-types lists get their "Not Controllable" checkbox back (checked by default for newly created nodes), and `SetAvailableControlTypes`'s list form no longer re-adds `NOT_CONTROLABLE` if omitted - it now also accepts an `isControllable: true`/`false` shortcut for the common on/off case. When checked, `NOT_CONTROLABLE` always sorts first in the configured list (and its `NC` status-bar abbreviation always appears first too), regardless of the checkbox's own position in the list. **If you rely on the previous guarantee** (a flow deployed since `[0.7.0]`, with no "Not Controllable" checkbox to check because it didn't exist yet), open that node's `s2-rm-config`/`s2-resource` dialog and check "Not Controllable" before your next redeploy - there is no automatic migration, since a persisted config with `NOT_CONTROLABLE` omitted looks identical whether it was never checked or predates the checkbox entirely.

- `s2-ombc` and D-Bus-backed `s2-resource` now emit S2-aligned `commodityPower` and `values` payloads for symmetric, single-phase, and three-phase per-phase measurements. `ModeInstruction` payloads can be reused directly as `ModeConfirmation` or `PowerMeasurement`; `PowerMeasurement` accepts `commodityPower` as a fallback when `values` is absent.
- Power measurement input now supports phase-aware conversion and validation, including single-phase selection from three-phase arrays, equal distribution of a three-phase scalar, symmetric array summing, silent zero defaults for `null` and numeric `0` (an explicit `values: undefined` is rejected with a warning instead), and warnings for non-trivial conversions.
- Runtime control-type updates now validate control types before changing Resource Manager state. The `s2-resource` `ControlTypes` topic convenience path follows the deploy-time "Not Controllable" checkbox and rejects invalid uncontrollable states that would produce an empty S2 control-type list.
- `s2-resource`: complete `ModeInstruction` payloads passed back as `ModeConfirmation` now reach OMBC status handling instead of being interpreted as D-Bus measurements.
- Runtime control-type updates now reject malformed `isControllable` values, empty advertised control-type lists, and `NO_SELECTION` before changing Resource Manager state.

## [0.7.0]

### Fixed

- `s2-dbus`/`s2-resource` (`Transport: D-Bus`): a single-phase device no longer declares bogus `Ac/L1/Power`/`Ac/L3/Power` D-Bus properties for lines it doesn't have; `Ac/Power` is now always kept as the live sum of known per-phase readings; `3-phase symmetric` measurement now also populates per-phase D-Bus properties (evenly split for a scalar reading, written directly for a per-phase array).
- `s2-resource`'s Connection tab: alignment/layout fixes, `Transport` defaults to `D-Bus`, and the D-Bus config picker is labeled "Virtual Device"; Resource Manager tab fields (`Manufacturer`/`Model`/`Serial`/`Firmware`) are grouped under a "Device" heading, blank by default, and pre-fill from the node's own `Name`.
- `s2-dbus-config`: "3-phase symmetric" is only selectable when `Phases: 3`; `Power Meas.` defaults to "Per phase"; a newly added config node's `Name` pre-fills from the parent `s2-resource` node.
- Label text on `s2-resource`'s blue canvas/palette entries is now white, for readable contrast against the blue background (was black).
- `s2-resource`'s edit dialog no longer balloons to ~1000px wide or wraps its own tab bar onto two lines - it now settles at a stable ~540px across all three tabs.
- `s2-dbus`/`s2-resource`: `Ac/Power` now starts at `0` like the per-phase properties it aggregates, instead of staying at the generic `null`/"unknown" placeholder for a single-phase device.
- `s2-dbus-config`: rejecting an array `values` of the wrong length for `3-phase symmetric` now logs a warning, matching the existing per-phase rejection warnings (previously silently ignored).
- `s2-dbus-config`: changing `Phases` away from `3` while `Power Meas.: 3-phase symmetric` is selected now immediately updates the `Power Meas.` dropdown's own displayed value in the still-open dialog, instead of only after the next redeploy.
- `s2-resource`'s OMBC tab no longer silently discards a saved `systemDescription` it can't represent in Friendly mode (a genuine power range from before this release's modulation support, a blocked transition, a custom timer, or hand-edited JSON) - it now opens as editable raw JSON in a new Advanced (JSON) mode, the same escape hatch `s2-ombc-config` already had. **If you suspect this already happened to one of your `s2-resource` nodes** (opening and saving it silently replaced your configuration with a default "Standby/off" mode) **before this fix, that configuration cannot be recovered from within Node-RED** - check your flow's version control history or backups.
- `s2-dbus`/`s2-resource` (`Transport: D-Bus`): the registered device's `CustomName` (what the GX device list/VRM actually display, in preference to the generic `ProductName`) now reflects the node's own configured `Name` (`s2-resource`'s `RM Name` if set, otherwise falls back to `Virtual <deviceType>`) instead of always showing the generic "Virtual AC load"/"Virtual heat pump".
- `s2-dbus`/`s2-resource` (`Power Meas.: Per phase`, single-phase device): the raw D-Bus-key input `{ payload: { 'Ac/Power': ... } }` is now accepted as an alias for that device's one wired-phase key (e.g. `Ac/L2/Power`) - previously only the phase-specific key worked, silently rejecting the generic key the node's own help text already documented as valid. A multi-phase device still requires the phase-specific key(s), since `Ac/Power` alone would be ambiguous there.
- `s2-resource`'s canvas icon no longer bleeds to the node's edge - it's now inset a few px, matching the palette icon's proportions instead of stretching to fill its full 30x30 box.
- `s2-rm`'s `PEBC.PowerConstraints` no longer sends `valid_until: null` - the S2 schema requires that field to be a string or absent entirely, so a strict CEM could reject it; it's now simply omitted.

### Added

- `s2-rm`'s session layer now validates every outgoing and incoming S2 message against the real S2 JSON schema (vendored from [flexiblepower/s2-json](https://github.com/flexiblepower/s2-json)'s `v0.0.2-beta` tag, matching this repo's own `supported_protocol_versions`) - a malformed message is rejected with a clear diagnostic instead of only failing downstream on the CEM side. Two known upstream schema discrepancies (`available_control_types` capped at 5 items, `provides_power_measurement_types` requiring at least 1) are treated as advisory rather than blocking.
- `s2-ombc-config`'s Advanced (JSON) mode - and `s2-resource`'s embedded OMBC editor - now validates the entered `systemDescription` against the real `OMBC.SystemDescription` S2 schema as you type, disabling Update/Done and showing the specific problem until it's fixed.
- `s2-rm-config`/`s2-resource` gain a "Provides power measurement" checkbox on the Power Meas. field, checked by default for a newly added node, gating the existing 3-phase-symmetric/per-phase type selector.
- `s2-dbus`/`s2-resource`: a simpler `{ payload: { values: <number | number[]> } }` input shape for power measurement, alongside the existing raw D-Bus-key shape (`{ payload: { 'Ac/Power': 1500 } }`) - see [Sending power measurements over D-Bus](README.md#sending-power-measurements-over-d-bus).
- `s2-dbus-config`: "Auto-calculate energy" setting (on by default) - integrates power over time into `Ac/Energy/Forward` (and per-phase `Ac/L<n>/Energy/Forward`), the same approach node-red-contrib-victron's own virtual `acload`/`heatpump` devices use.
- `s2-ombc`/`s2-resource`'s `ModeInstruction` output payload gains a `values` field, in the same convenience shape `PowerMeasurement` input already accepts - feed it straight in to report back exactly the power you were just instructed to produce, with no shape conversion needed.
- `s2-ombc-config`'s (and `s2-resource`'s built-in OMBC) friendly operation-mode editor gains a per-mode "Support power modulation" option, for a mode whose power ranges between a "from" and "to" value (e.g. a continuously-modulating load) instead of a single fixed value - no longer requires switching to Advanced/JSON mode.
- `s2-rm`/`s2-resource` accept a new `SetAvailableControlTypes` command (`{ command: 'SetAvailableControlTypes', availableControlTypes: [...] }`, no `cemId`) that replaces the advertised control types at runtime and re-sends `ResourceManagerDetails` to every connected CEM, without redeploying - e.g. to make an OMBC resource controllable only during a time window.

### Changed

- Every node's palette/canvas display label drops the redundant "s2-" prefix (e.g. `s2-resource` shows as "resource") - internal type names (used in flow JSON) are unchanged, so existing flows are unaffected.
- `s2-resource` now shows with a blue background and white icon (`icons/s2-logo-white.svg`), instead of the white background/colored icon every other node uses, so it stands out as the recommended starting point.
- `s2-resource`'s inner tabs are labeled `Connection`/`RM`/`Control` (previously `Connection`/`Resource Manager`/`Control Type`), keeping the tab bar itself narrow.
- Lowered the minimum supported Node.js version from 24 to 18.14 - nothing in this package actually requires newer, and the stricter requirement was flagged by the [Flow Library scorecard](https://flows.nodered.org/node/node-red-contrib-s2/scorecard) as exceeding what the latest Node-RED release itself needs. CI now runs against Node 18/20/22/24.
- Removed the "Requirements" section from the README - `package.json`'s own `engines`/`node-red` fields (surfaced on the Flow Library page) are the authoritative source, so a separate prose copy can only drift out of sync.
- **Breaking:** `s2-dbus-config`'s `Phases` field no longer offers `2` - S2 has no commodity quantity for a genuinely 2-phase (split-phase) device, so relaying its measurement was never really correct. Existing configs with `Phases: 2` should be reconfigured to `1` or `3`.
- `s2-dbus`/`s2-resource` (`Power Meas.: Per phase`, `Phases: 3`): a scalar `values` input is now rejected (with a warning) instead of being broadcast to every phase - which single line a lone value belongs to was ambiguous.
- `s2-resource`'s Resource Manager tab no longer shows the `Resource ID` field - it's still generated once and persisted unchanged across redeploys, just not something the user needs to see or edit.
- `s2-ombc`/`s2-resource`: a `ModeConfirmation` (or legacy confirm) message may now include more than one of `id`/`index`/`label` at once, resolved by priority (`id` wins over `index`, which wins over `label`) instead of being rejected - so a previously-emitted `ModeInstruction` payload (which already carries all three, plus `factor`) can be wired straight back in as its own confirmation.
- **Every** `s2-rm`/`s2-resource` now always advertises `NOT_CONTROLABLE` in `ResourceManagerDetails.available_control_types`, regardless of configured/selected control types - a CEM can always choose not to control the resource. It's no longer offered as a checkbox (removed from both `s2-rm-config`'s and `s2-resource`'s control-types lists), since it's no longer a configurable option. Existing flows will advertise this additional value on their next redeploy.

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
