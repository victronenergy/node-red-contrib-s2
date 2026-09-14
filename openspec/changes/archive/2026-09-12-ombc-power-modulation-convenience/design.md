## Context

See `proposal.md` - Why. Relevant current-state details:

- `OMBCController.calculatePower()` (`src/lib/s2/ombc-controller.ts`) already interpolates a `PowerRange`'s `start_of_range`/`end_of_range` using the instructed factor and returns an S2-shaped `PowerMeasurementValue[]` (`commodityPower`). It is reused as-is; only its caller changes.
- The friendly OMBC editor's data model and rendering logic (`resources/s2-ombc-editor.js`) is shared, unmodified, between `s2-ombc-config` and `s2-resource`'s "Control Type: OMBC" tab. A change there automatically applies to both call sites.
- Note (repo correction): `docs/NODE_EDIT_DIALOG_DESIGN_GUIDE.md`, referenced by an unrelated sibling project's CLAUDE.md, does not exist in this repo - no edit-dialog design-guide check applies here. This repo's own `CLAUDE.md` has no such rule.
- **Bug found while reviewing this change**: `s2-resource`'s OMBC tab (`src/nodes/s2-resource/index.html`, `#s2-resource-ct-ombc`) has no Friendly/Advanced toggle at all - only the friendly mode list. Its `oneditprepare` falls back to `ombcEditor.defaultStandbyMode()` (not Advanced mode) whenever the saved `systemDescription` isn't friendly-representable, and `oneditsave` unconditionally rewrites `systemDescription` from friendly state - so opening and saving such a node silently replaces the real configuration with a default "Standby/off" mode. `s2-ombc-config` has the identical `isFriendlyRepresentable()` check but degrades into Advanced mode instead, so nothing is lost. This is a genuine data-loss bug, not a missing convenience.

## Goals / Non-Goals

**Goals:**
- Let a flow derive a fake `PowerMeasurement` reading directly from a `ModeInstruction` without hand-converting between the S2 commodity-quantity shape and the `values` convenience shape.
- Let the friendly OMBC editor express a genuine (non-degenerate) power range per mode, matching what `power_ranges` already supports, without requiring Advanced/JSON mode.
- Let a `ModeInstruction` payload round-trip straight back into a confirm message with no reshaping.
- Stop `s2-resource` from silently destroying a non-friendly-representable OMBC configuration.

**Non-Goals:**
- No change to any S2 wire message (`OMBC.Instruction`, `OMBC.Status`, `OMBC.SystemDescription`) - confirmed against the official schemas in `flexiblepower/s2-json` (see proposal).
- No change to `s2-pebc` or any other control type.
- No change to how `calculatePower()` interpolates a range - only how its result is additionally projected into the `values` shape.

## Decisions

**1. `values` conversion lives next to `calculatePower()`, not in the node wrappers.**
A small helper (e.g. `commodityPowerToValues(commodityPower)`) converts the already-computed `PowerMeasurementValue[]` into the convenience shape: a single number when the array is the 3-phase-symmetric aggregate (all three phase values equal and derived from one `ELECTRIC.POWER.3_PHASE_SYMMETRIC` range - detect this the same way `power-measurement-cache.ts` already tracks measurement type, or simpler: track whether the resolved mode's ranges were keyed by `3_PHASE_SYMMETRIC` and branch on that, since `calculatePower()` already distinguishes the two cases internally), or a `[L1, L2, L3]` array otherwise. Keeping this in `ombc-controller.ts` (alongside `calculatePower`) avoids duplicating the shape logic in both `s2-ombc/index.ts` and `s2-resource/index.ts`, since both already just pass `OMBCController`'s emitted message through unchanged.
*Alternative considered*: convert in each node wrapper. Rejected - would duplicate the same shape logic twice for no benefit, since both wrappers already delegate entirely to `OMBCController`.

**2. `resolveModeIdentifier()` changes from an exclusivity check to a priority pick.**
Replace `providedCount !== 1 → error` with: use `id` if defined, else `index` if defined, else `label` if defined, else error. Read `factor`/`operationModeFactor` the same way `handleConfirm()` already does today (it already defaults to `1` independently of identifier resolution) - no change needed there beyond confirming the existing default still applies when `resolveModeIdentifier` is fed a full `ModeInstruction` payload.
*Alternative considered*: require the caller to strip `ModeInstruction` down to just the winning field before wiring it back. Rejected - defeats the purpose (the point is to wire the instruction's output straight into the confirm input with no intermediate function node).

**3. Power modulation is a per-mode boolean (`modulate`) alongside the existing `symmetric` boolean, not a replacement for the value fields.**
When `modulate` is false (default), behavior and saved shape are byte-identical to today (`start_of_range === end_of_range`). When true, the single value input(s) become paired "from"/"to" inputs - `valueSymmetricFrom`/`valueSymmetricTo` (symmetric) or `valueL{1,2,3}From`/`valueL{1,2,3}To` (per-phase) - mirroring the existing `symmetric` on/off pattern that already swaps which inputs are shown (`updateSymVisibility()`). This keeps the diff small and consistent with the file's existing conventions, rather than introducing a different UI pattern (e.g. a range slider) for one field.
*Alternative considered*: a single numeric "spread" field (to = from + spread). Rejected - less direct than the spec's own `start_of_range`/`end_of_range`, and does not match how the user described the feature ("from" and "to" inputs).

**4. `isFriendlyRepresentable()`'s power-range check is relaxed from equality to "consistent shape, any bounds".**
Today `isFriendlyPowerRanges()` requires `start_of_range === end_of_range` for every range. The relaxed version drops that equality requirement (accepting `start_of_range <= end_of_range` or even either order, since the spec doesn't constrain which bound is larger) while keeping every other structural check (exactly 1 symmetric range, or exactly 3 per-phase ranges covering L1/L2/L3, nothing else). `systemDescriptionToFriendlyState()` then reads both bounds into the new From/To fields, setting `modulate: start_of_range !== end_of_range`.
*Alternative considered*: keep strict equality and only add modulation going forward (existing genuine ranges keep opening in Advanced mode). Rejected - contradicts the proposal's explicit goal that opening a previously-Advanced-only config with a genuine range should now work in friendly mode, and the user's own use case (My-PV AC-Thor) may already have such a config from using Advanced mode as a workaround.

**5. `s2-resource` gets the same Friendly/Advanced tab structure as `s2-ombc-config`, reusing its logic rather than inventing a new pattern.**
Add a small tab-bar (`s2-tabs`/`s2-tab`/`s2-tab-active`, the same classes `s2-ombc-config` already uses) above the OMBC mode list, with the identical switch/JSON-`typedInput`/`isFriendlyRepresentable()` logic `s2-ombc-config`'s `oneditprepare` already has - `resources/s2-ombc-editor.js` already holds the shared conversion functions (`friendlyStateToSystemDescription`, `isFriendlyRepresentable`, `systemDescriptionToFriendlyState`), so this is wiring, not new logic. `oneditsave` changes from unconditionally rebuilding `systemDescription` from friendly state to only doing so when Friendly mode is currently active (mirroring `s2-ombc-config`'s own `oneditsave` guard), leaving a JSON edit made in Advanced mode untouched.
*Alternatives considered*: (a) a warning banner that blocks saving without offering a way to view/edit the JSON in place - rejected by the user as leaving no way to actually work with such a config from within `s2-resource` itself; (b) a read-only JSON preview - rejected for the same reason, plus it would special-case a shape `s2-ombc-config` already handles as a normal editable mode. Full parity with `s2-ombc-config` was chosen instead: it costs more UI code than (a)/(b) but reuses existing, already-tested conversion logic and gives `s2-resource` no worse an editing experience than the separate `s2-ombc-config` node it's meant to replace for the common case.

## Risks / Trade-offs

- **[Risk]** Widening `isFriendlyRepresentable()` changes which existing Advanced-mode configs now open in friendly mode instead - a behavior change for existing users, not just an additive feature. → **Mitigation**: this only affects configs whose `power_ranges` were already valid per the existing structural checks (1 symmetric or 3 per-phase, right commodity quantities) and only differed by having unequal bounds; nothing that was friendly-representable before stops being so, and Advanced mode itself is untouched (a user who prefers hand-editing JSON is unaffected either way). Covered by the "Opening a saved config with a genuine power range" scenario in the delta spec.
- **[Risk]** The `values` shape is ambiguous to derive from `commodityPower` alone if a future change makes `calculatePower()`'s output shape less regular (e.g. omitting phases with no configured range). → **Mitigation**: derive `values` from the same branch (`symmetric` vs. per-phase) `calculatePower()` already used internally, not by re-inspecting its output array's contents.
- **[Risk]** Any existing `s2-resource` node already saved with a non-representable `systemDescription` today has (per the bug) already had it silently replaced with a default mode the first time it was opened and saved since creation - this change stops it from happening *again*, but can't recover configuration already lost before the fix ships. → **Mitigation**: none possible after the fact; call this out in the CHANGELOG's Fixed entry so anyone who suspects this happened knows to check their flow's git history/backups rather than assume the node still holds what they originally configured.

## Migration Plan

No data migration - `power_ranges`/`OMBC.SystemDescription` on disk are unchanged in shape (only which values `start_of_range`/`end_of_range` may legally differ, which the schema already allowed). Existing saved `s2-ombc-config` nodes with equal-bounds ranges keep opening in friendly mode with `modulate: false`, unchanged. No rollback concerns beyond a normal code revert.
