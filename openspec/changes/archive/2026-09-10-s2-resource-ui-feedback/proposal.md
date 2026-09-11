## Why

`s2-resource` (added in `2026-09-07-s2-resource-composite-node`) bundles a transport, a resource-manager identity, and a control type behind one tabbed dialog. Early usage feedback on that dialog found the defaults, labels, field order, and D-Bus-driven power-field logic don't yet match how the node is actually used on Venus OS: D-Bus is the primary transport on this platform but isn't the default; several Resource Manager identity fields ship with fabricated-looking defaults (`Victron Energy`, `Virtual RM`, `1.0.0`) for fields the S2 spec treats as optional; and the OMBC power-value fields under `Transport: D-Bus` don't yet track the referenced `s2-dbus-config`'s actual measurement type, only its phase count. This change folds a first batch of that feedback into concrete requirement changes; more batches from the same review are expected and will be added to this change before it is applied.

## What Changes

- **Connection tab (`s2-resource`)**: default `Transport` to `D-Bus` instead of `WebSocket`; rename the D-Bus transport option from "Built-in - D-Bus (Venus OS)" to "Built-in - D-Bus (Victron Energy)"; rename the D-Bus config picker's own label from "D-Bus" to "Virtual Device".
- **`s2-dbus-config` dialog**: pre-fill a new config node's `Name` with the parent `s2-resource` node's name when opened from within that node's edit dialog; move `Phases` above `Power Meas.`; restrict the `Power Meas.` "3-phase symmetric" option to when `Phases: 3`; default `Power Meas.` to "Per phase" (`L1_L2_L3`) instead of "3-phase symmetric".
- **Resource Manager tab (`s2-resource`)**: pre-fill `RM Name` with the node's own `Name`; group `Manufacturer`/`Model`/`Serial`/`Firmware` under a new "Device" section heading (matching the existing `Roles`/`Control Types` heading pattern) instead of individually prefixing each label with "Device" (which overflowed the fixed label column); change `manufacturer`'s default from `Victron Energy` to `Custom (Node-RED)`, and clear `model`'s (`Virtual RM`) and `firmwareVersion`'s (`1.0.0`) defaults to empty, so all four optional identity fields start blank; move the "Device" section above `Roles`, so device identity is described before capabilities.
- **Control Type tab (`s2-resource`), OMBC power fields**: for `Transport: D-Bus`, derive the number of power-value fields shown per operation mode from the referenced `s2-dbus-config`'s `nrOfPhases` **and** `measurementType` together (today only `nrOfPhases` is consulted) - exactly one field for `nrOfPhases: 1` or (`nrOfPhases: 3` and `measurementType: 3_PHASE_SYMMETRIC`), exactly three per-phase fields otherwise (`nrOfPhases: 2`, or `nrOfPhases: 3` with `measurementType: L1_L2_L3`).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `s2-resource`: Connection tab transport default/labels, Resource Manager tab field labels/defaults/order and RM Name pre-fill, and the OMBC per-phase field-count requirement (supersedes the existing "Same value on all phases is locked..." requirement's phase-count-only logic with phase-count-and-measurement-type logic).
- `s2-dbus-transport`: `s2-dbus-config` dialog field order, the "3-phase symmetric" option's availability, `measurementType`'s default, and Name pre-fill when opened from `s2-resource`.

## Impact

- `src/nodes/s2-resource/index.html` (`defaults.transport`, `defaults.manufacturer`/`model`/`firmwareVersion`, Connection/Resource Manager tab markup and field order, `refreshActivePhase()`).
- `src/nodes/s2-dbus-config/index.html` (`defaults.measurementType`, template field order, `oneditprepare`).
- `resources/s2-ombc-editor.js` (`setSymmetricLock`/`setActivePhase`, or their replacement, now needs `measurementType` as an input alongside `nrOfPhases`).
- `openspec/specs/s2-resource/spec.md`, `openspec/specs/s2-dbus-transport/spec.md` (delta specs below).
- No wire-protocol or D-Bus-property changes; no message-shape changes. Existing deployed flows keep their currently-saved field values (Node-RED only applies a `defaults.value` to genuinely new nodes) - only the values offered to *new* `s2-resource`/`s2-dbus-config` nodes change.
