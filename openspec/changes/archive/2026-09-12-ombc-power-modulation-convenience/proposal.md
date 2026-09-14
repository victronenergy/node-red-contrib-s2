## Why

User feedback on the SG Ready and My-PV AC-Thor example flows identified three friction points in `s2-ombc`/`s2-ombc-config` that all stem from the same root cause: OMBC's power information only exists in S2's own `{commodity_quantity, value}` shape, and the friendly config editor can't express a genuine power range (a modulating operation mode), forcing users into Advanced/raw-JSON mode for a case (like the AC-Thor, which modulates continuously between a floor and ceiling wattage) that the S2 standard already supports natively. All three requests were verified against the official S2 JSON schemas (`flexiblepower/s2-json`) and none require deviating from the protocol - they're either pure Node-RED-side convenience or exposing an already-implemented spec feature through the friendly UI.

## What Changes

- `s2-ombc`'s `ModeInstruction` output payload gains a `values` field alongside the existing `commodityPower` field, in the same convenience shape (`number` for 3-phase-symmetric, `[L1, L2, L3]` for per-phase) that `PowerMeasurement` input already accepts on `s2-dbus`/`s2-resource` - so a flow can echo the instructed power straight back into a `PowerMeasurement` input without hand-converting shapes.
- `s2-ombc-config`'s friendly operation-mode editor gains a per-mode "Support power modulation" option that reveals "from"/"to" power inputs (instead of a single value), mapping directly onto the `power_ranges` field's existing `start_of_range`/`end_of_range` pair. No change to how power ranges are interpreted - `OMBCController.calculatePower()` already interpolates between the two bounds using the operation mode factor.
- A confirm message (`ModeConfirmation`) resolving the active operation mode now accepts the whole `ModeInstruction` payload object as-is - using `id` if present, otherwise `index`, otherwise `label`, and `factor` if present (else `1`) - instead of requiring exactly one identifying field and erroring on the others. This lets a flow wire `ModeInstruction`'s output directly back into the confirm input.
- Corrects `control-type-ombc`'s "Instruction resolution into actionable output" requirement text, which had drifted from the shipped behavior (it described `msg.topic` as the mode's diagnostic label and the payload nested under `msg.ombc.operationMode`; the actual, unchanged-by-this-change shape is `msg.topic: 'ModeInstruction'` with a flat payload of `{ id, index, label, factor, commodityPower }`).
- **Bug fix, found while reviewing this change**: `s2-resource`'s OMBC tab has no Advanced/JSON escape hatch at all (unlike `s2-ombc-config`'s edit dialog), and when its saved `systemDescription` isn't friendly-representable, opening the node silently discards it in favor of a fresh default "Standby/off" mode - then overwrites the saved config with that default the moment the dialog is saved, with no warning. `s2-resource` gains the same Friendly/Advanced tab toggle `s2-ombc-config` already has, so a non-representable config is shown as editable raw JSON instead of being destroyed.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `control-type-ombc`: "Instruction resolution into actionable output" gains the `values` convenience field (and its description is corrected to match shipped behavior); "Operation mode identified by id, index, or label" changes from an exclusivity rule to a priority-resolution rule that also accepts a `factor`; the friendly editor's per-mode fields gain an optional power-range ("modulation") input; and a new requirement guarantees `s2-resource` never silently discards a non-representable saved `systemDescription`.

## Impact

- `src/lib/s2/ombc-controller.ts`: `calculatePower()`'s return shape is unchanged; a new conversion step derives the `values` convenience field from it, and `resolveModeIdentifier()` changes from exclusivity to priority resolution.
- `resources/s2-ombc-editor.js` (the shared friendly-editor widget used by both `s2-ombc-config` and `s2-resource`'s Control Type: OMBC tab): new per-mode "Support power modulation" toggle + from/to inputs, and relaxed `isFriendlyRepresentable()`/round-trip logic so a genuine power range no longer forces Advanced mode.
- `src/nodes/s2-ombc-config/index.html`: help text updated to describe the new option (it no longer needs to tell users a genuine power range requires Advanced mode).
- `src/nodes/s2-resource/index.html`: help text updated as above, plus a new Friendly/Advanced tab toggle for the OMBC section (mirroring `s2-ombc-config`'s existing one) so a non-representable `systemDescription` is shown as editable JSON instead of silently discarded, and `oneditsave` only rebuilds `systemDescription` from friendly state while friendly mode is active (matching how `s2-ombc-config` already guards its own save step).
- `src/nodes/s2-ombc/index.ts`, `src/nodes/s2-resource/index.ts`: no code change expected (both already pass `OMBCController`'s emitted messages through unchanged), but their JSDoc/help text documenting the `ModeInstruction` shape needs updating to mention `values`.
- `README.md`: OMBC/My-PV/SG-Ready example documentation should mention the new `values` field and the friendly editor's power-modulation option.
- No wire-protocol change: `OMBC.Instruction`, `OMBC.Status`, and `OMBC.SystemDescription` messages sent to/from the CEM are unaffected - all three changes are Node-RED-side convenience or friendly-editor UI reaching an already-supported `power_ranges` shape.
