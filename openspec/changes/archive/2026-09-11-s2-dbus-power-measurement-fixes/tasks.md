## 1. `power-measurement-cache.ts` - phase-aware props, `values` input, aggregation

- [x] 1.1 Replace the static `MEASUREMENT_TYPE_TO_PROPS` table with a `resolveMeasurementProps(measurementType, nrOfPhases, phaseSetting): Record<string, string>` function per design.md D1 (single `Ac/L<phaseSetting>/Power` entry for `L1_L2_L3`+`nrOfPhases:1`; `Ac/L1/Power`..`Ac/L<nrOfPhases>/Power` for `nrOfPhases` 2/3; unchanged single `Ac/Power` entry for `3_PHASE_SYMMETRIC`; `{}` otherwise). Export it alongside the class.
- [x] 1.2 `PowerMeasurementCache`'s constructor takes `nrOfPhases`/`phaseSetting` alongside `measurementType`, and uses `resolveMeasurementProps()` instead of the old table lookup.
- [x] 1.3 `update()` keeps parsing the raw D-Bus-key shape unchanged, then independently parses `payload.values` per design.md D2 (scalar/array rules by `measurementType`+`nrOfPhases`), folding results into the same internal `Map<string, number>` the raw-key shape already populates. Change `update()`'s return type to also signal a rejected array-on-1-phase input (e.g. add a `warning?: string` field to `PowerMeasurementUpdate`, or return a distinguishable rejection value - pick one and use it consistently) so callers can `node.warn()` without `PowerMeasurementCache` depending on Node-RED's `warn()` itself.
- [x] 1.4 After any per-phase (`Ac/L{1,2,3}/Power`) cache write under `measurementType: L1_L2_L3`, recompute `Ac/Power` as the sum of all currently-cached per-phase values and include it in the returned `raw` (design.md D3).
- [x] 1.5 For `measurementType: 3_PHASE_SYMMETRIC`: a scalar (either input shape) splits evenly into `Ac/L1/Power`/`Ac/L2/Power`/`Ac/L3/Power` (value ÷ 3 each); a `values` array of 3 writes those three values directly, unsplit; `Ac/Power` and the single S2 `ELECTRIC.POWER.3_PHASE_SYMMETRIC` commodity both get the sum in either case (design.md D4). Include the derived per-phase values in `raw`.
- [x] 1.6 `buildS2Values()` (or its caller) uses `resolveMeasurementProps()`'s commodity map as the source of truth for what gets sent to S2 - confirm 3-phase-symmetric still sends exactly one `ELECTRIC.POWER.3_PHASE_SYMMETRIC` entry even when the per-phase D-Bus properties (1.5) are populated from an array.

## 2. `energy-accumulator.ts` (new) - kWh integration

- [x] 2.1 Create `src/lib/s2/energy-accumulator.ts` reproducing node-red-contrib-victron's `energy-utils.js` `accumulateDelta` algorithm exactly (design.md D5): `WATT_MILLISECONDS_PER_KWH = 3_600_000_000`; a small stateful `EnergyAccumulator` class with `accumulate(key, powerValue, now): number | null` - tracks each key's last power value + last timestamp internally, returns the updated running Energy-Forward total for that key (using the *previous* power value and elapsed time), or `null` on a key's first-ever call (no prior timestamp to compute a delta from).

## 3. `dbus.ts` - declaration fix, energy wiring

- [x] 3.1 In `claimDeviceInstanceAndRegister()`, replace the `MEASUREMENT_TYPE_TO_PROPS[measurementType]` lookup with `resolveMeasurementProps(measurementType, nrOfPhases, phaseSetting)` so declared properties match exactly what's now cacheable (fixes bug 1 - no more bare `Ac/L1/Power`/`Ac/L3/Power` on a single-phase device).
- [x] 3.2 For `measurementType: 3_PHASE_SYMMETRIC`, additionally declare `Ac/L1/Power`/`Ac/L2/Power`/`Ac/L3/Power` as measurement-tracked properties (initial value `0`, like the others) - today only `Ac/Power` is declared for this measurement type.
- [x] 3.3 Add `autoCalculateEnergy?: boolean` to `S2DbusTransportOptions`. When true, `setMeasurementValues()` (design.md D5) additionally: accumulates each updated `Ac/L{n}/Power` key's Energy Forward delta via a private `EnergyAccumulator` instance into `Ac/L{n}/Energy/Forward`, sums the per-phase Energy Forward totals into `Ac/Energy/Forward` - except for `3_PHASE_SYMMETRIC`, which accumulates once directly from `Ac/Power` into `Ac/Energy/Forward` instead (no per-phase multiplication). Apply the resulting Energy key(s) via `setValuesLocally` alongside the Power ones (same call or a second one - whichever keeps `setValuesLocally`'s existing "no-op before registration" guard intact for both).
- [x] 3.4 When `autoCalculateEnergy` is true, declare `Ac/Energy/Forward` and each tracked phase's `Ac/L{n}/Energy/Forward` as measurement-tracked properties too (initial `0`) - today these stay at the "minimal meter" shape's `null` default forever.

## 4. `s2-dbus-config` - new setting

- [x] 4.1 Add `autoCalculateEnergy: boolean` to `S2DbusConfigNode` in `src/types/config-nodes.ts`.
- [x] 4.2 `src/nodes/s2-dbus-config/index.ts`: `this.autoCalculateEnergy = config.autoCalculateEnergy !== false` (defaults true for both new *and* already-deployed nodes without the field, per design.md's Migration Plan - purely additive, not a behavior removal).
- [x] 4.3 `src/nodes/s2-dbus-config/index.html`: add `autoCalculateEnergy: { value: true }` to `defaults`; add a checkbox row after the `Power Meas.` row, labeled "Auto-calculate energy (Ac/Energy/Forward)" with tooltip "Integrates power over time to estimate energy. Precision improves with higher update frequency." (same wording as node-red-contrib-victron's own equivalent field, per design.md D5).
- [x] 4.4 Update the `s2-dbus-config` help text (`data-help-name` block) to mention the new setting and that `Ac/Power` is now always kept as the live sum of per-phase readings.

## 5. `s2-dbus` / `s2-resource` - wiring

- [x] 5.1 `src/nodes/s2-dbus/index.ts`: pass `dbusConfig.nrOfPhases`/`dbusConfig.phaseSetting` into `new PowerMeasurementCache(...)`, and `dbusConfig.autoCalculateEnergy` into `new S2DbusTransport({...})`. If `measurementCache.update()` signals a rejected array (task 1.3), call `node.warn(...)`.
- [x] 5.2 `src/nodes/s2-resource/index.ts`: same two wiring changes, at its own `PowerMeasurementCache`/`S2DbusTransport` construction sites.
- [x] 5.3 Update both nodes' JSDoc input-contract comments (and `s2-dbus`'s `data-help-name` block) to document the new `{ payload: { values: <number | number[]> } }` shape alongside the existing raw-key example.

## 6. Tests

- [x] 6.1 New `test/lib/power-measurement-cache.test.ts`: dedicated unit coverage for `resolveMeasurementProps()` and `PowerMeasurementCache.update()` across the full matrix - `L1_L2_L3` at `nrOfPhases` 1/2/3 (scalar and array `values`, raw-key input), the single-phase array-rejection case (with a warning signal), `Ac/Power` aggregation as phases arrive one at a time, `3_PHASE_SYMMETRIC` scalar-split and array-direct cases, and `measurementType: ''` (no-op for both shapes).
- [x] 6.2 New `test/lib/energy-accumulator.test.ts`: `EnergyAccumulator.accumulate()` - first call returns `null` (no prior timestamp), a known elapsed time + power produces the expected kWh delta, negative/zero power contributes nothing, multiple keys tracked independently.
- [x] 6.3 Extend `test/lib/dbus-transport.test.ts`'s "measurement properties" describe block: single-phase device no longer declares the other two phases' `Power` property (bug 1 regression test); `3_PHASE_SYMMETRIC` also declares `Ac/L1-3/Power`; new "energy auto-calculation" describe block covering `autoCalculateEnergy: true`/`false` declaring (or not) `Ac/Energy/Forward`/per-phase Energy properties, and `setMeasurementValues` producing the expected Energy update via `setValuesLocally`.
- [x] 6.4 Update `test/nodes/s2-dbus.test.ts` and `test/nodes/s2-resource.test.ts`: a couple of integration-level tests confirming `values`-shape input reaches the transport/S2 output correctly end-to-end (not the full matrix - that's 6.1's job), and that `dbusConfig.nrOfPhases`/`phaseSetting`/`autoCalculateEnergy` are actually passed through to the constructed `PowerMeasurementCache`/`S2DbusTransport`.
- [x] 6.5 Update `test/nodes/s2-dbus-config.test.ts` for the new `autoCalculateEnergy` default (`true`) and explicit-`false` cases.

## 7. Validation

- [x] 7.1 `npm run build`
- [x] 7.2 `npm test` (467/467 passing, lint clean)
- [x] 7.3 Manually verified live (http://localhost:1880 + Venus MCP, after a full server restart) against a real `s2-resource` node's D-Bus service (`com.victronenergy.acload.virtual_s2_dd1c2687b8fdc2dc`):
  - `Phases:1`/`Wired to: L2`: `Ac/L1/Power`/`Ac/L3/Power` now 404 (not declared at all, was previously leaking as bare `0`-valued properties) - bug 1 fixed
  - Same config, raw-key `{"Ac/L2/Power":10}`: `Ac/L2/Power` -> `10.0` and `Ac/Power` -> `10.0` (was staying unset) - bug 2 fixed
  - Same config, `{"values":[11,22,33]}`: rejected - `Ac/L2/Power` stayed `10.0`, unchanged, and `node.warn()`'s exact message appeared in the Debug sidebar
  - `Auto-calculate energy` (default on): `Ac/L2/Energy/Forward`/`Ac/Energy/Forward` started at `0.0`, then increased by a small, real, time-proportional delta after a further update
  - Reconfigured to `Phases:3`/`3-phase symmetric`: `{"values":[11,22,33]}` -> `Ac/L1/Power:11`, `Ac/L2/Power:22`, `Ac/L3/Power:33`, `Ac/Power:66` (sum, unsplit array) - bug 3 (array case) fixed
  - Same config, `{"Ac/Power":90}`: `Ac/L1/L2/L3/Power` all -> `30.0` (even split), `Ac/Power` -> `90.0` - bug 3 (scalar-split case) fixed
