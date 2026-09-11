## Why

Real-hardware testing of `Transport: D-Bus`'s power-measurement relay (shared by `s2-dbus` and `s2-resource`) turned up several bugs and a missing feature: a single-phase device wired to one line still declares bogus D-Bus properties for the other two lines, the `Ac/Power` aggregate is never kept in sync with per-phase readings, `3_PHASE_SYMMETRIC` never populates the per-phase properties at all, the input contract requires callers to already know the exact D-Bus property key (no simpler "just give me the value(s)" shape), and there is no way to get Energy (kWh) tracked automatically the way node-red-contrib-victron's own virtual `acload` device already does.

## What Changes

- **Property declaration respects phase count** (`s2-dbus-transport`): for `nrOfPhases: 1`, `measurementType: L1_L2_L3` now declares and tracks exactly one D-Bus property (`Ac/L<phaseSetting>/Power`) and one S2 commodity (`ELECTRIC.POWER.L<phaseSetting>`) - not all three `Ac/L1-3/Power`. For `nrOfPhases: 2` or `3`, it declares `Ac/L1/Power`..`Ac/L<nrOfPhases>/Power`.
- **`Ac/Power` aggregation**: whenever any per-phase `Power` value is written (`L1_L2_L3` measurement), `Ac/Power` is updated to the sum of all currently-known per-phase values.
- **`3_PHASE_SYMMETRIC` now also populates per-phase properties**: a scalar splits evenly across `Ac/L1-3/Power` (value ÷ 3 each); an array of 3 writes those three values directly (unsplit) while S2 and `Ac/Power` still get the sum.
- **New `values` input shape, additive to the existing raw D-Bus-key input**: `{ payload: { values: <number | number[]> } }` is now recognized alongside (not instead of) today's `{ payload: { 'Ac/Power': 1500 } }`-style input. Its meaning depends on the configured `measurementType`/`nrOfPhases`/`phaseSetting` - see design.md for the full mapping, including the confirmed decision to reject an array on a genuinely single-phase device rather than fabricate readings for lines it doesn't have.
- **New "Auto-calculate energy" setting on `s2-dbus-config`**: mirrors node-red-contrib-victron's own `acload` device (`accumulateDelta` in `energy-utils.js`) - integrates `Power` over time into `Ac/Energy/Forward` (and per-phase `Ac/L<n>/Energy/Forward`), defaulting on. No Reverse tracking, matching `acload`'s own one-directional behavior.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `s2-dbus-transport`: phase-aware measurement property declaration, `Ac/Power` aggregation, `3_PHASE_SYMMETRIC` per-phase distribution, the new `values` input shape, and the new energy auto-calculation setting/behavior.

## Impact

- `src/lib/s2/power-measurement-cache.ts` (`PowerMeasurementCache`, `MEASUREMENT_TYPE_TO_PROPS`) - needs `nrOfPhases`/`phaseSetting` awareness and `values`-shape parsing.
- `src/lib/transport/dbus.ts` (`S2DbusTransport`) - property declaration and `setMeasurementValues` now derive from phase-aware props; new energy-accumulation state.
- `src/nodes/s2-dbus/index.ts` and `src/nodes/s2-resource/index.ts` - both feed the same shared `PowerMeasurementCache`/`S2DbusTransport`, so both get every fix identically; their `node.on('input', ...)` handlers need to route the new `values` shape through the cache the same way they already route raw D-Bus keys.
- `src/nodes/s2-dbus-config/index.html` / `index.ts` - new "Auto-calculate energy" checkbox.
- `openspec/specs/s2-dbus-transport/spec.md` - delta spec below.
- No wire-format changes to the S2 protocol itself (still standard `PowerMeasurement`/commodity-quantity messages); no breaking change to the existing raw-D-Bus-key input, which keeps working unchanged.
