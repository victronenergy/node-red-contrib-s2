## Context

See proposal.md for the five bugs/features this addresses. All of them live in code shared by `s2-dbus` and `s2-resource`'s `Transport: D-Bus`:
- `src/lib/s2/power-measurement-cache.ts` (`PowerMeasurementCache`, `MEASUREMENT_TYPE_TO_PROPS`) - caches the latest value(s) fed to a node's input, builds the S2-shaped `PowerMeasurement` payload, and returns the raw D-Bus property updates for `S2DbusTransport.setMeasurementValues()`.
- `src/lib/transport/dbus.ts` (`S2DbusTransport`) - declares D-Bus properties (via `MEASUREMENT_TYPE_TO_PROPS`, independent of `nrOfPhases`/`phaseSetting` today - bug 1) and applies raw updates via `setValuesLocally`.
- `src/lib/transport/minimal-meter-properties.ts` (`buildMinimalMeterShape`) - already correctly phase-aware for the "minimal meter" shape (Position/NrOfPhases/PhaseSetting/per-phase Current/Voltage/etc.); not part of this bug.

Confirmed via user testing with real hardware and a design conversation this session:
- Reject (not fabricate) an array `values` input on a genuinely single-phase device.
- Keep the existing raw-D-Bus-key input format working unchanged; `values` is additive.
- Mirror node-red-contrib-victron's own `acload` energy auto-calculation approach (`energy-utils.js`'s `accumulateDelta`, `device-type/acload.js`'s per-phase/rollup wiring, and the `acload_auto_energy` checkbox defaulting to `true`) rather than inventing a different algorithm.

## Goals / Non-Goals

**Goals:**
- Make the declared D-Bus property set for a device always match what it can physically report (bug 1).
- Keep `Ac/Power` a true, live aggregate whenever per-phase data is available (bug 2), and give `3_PHASE_SYMMETRIC` a sensible per-phase D-Bus breakdown too (bug 3).
- Add a simpler `values`-based input shape without breaking the existing raw-key one (bug 4).
- Add opt-out Energy (kWh) auto-calculation matching an established, already-shipped algorithm (bug/feature 5).

**Non-Goals:**
- No S2 protocol/wire-format changes - `PowerMeasurement` messages still carry the same `{ commodity_quantity, value }[]` shape; only which commodities get sent, and from which input, changes.
- No Reverse (export) energy tracking - `acload`/`heatpump` are one-directional load device types in both this codebase and node-red-contrib-victron's; only `Ac/Energy/Forward` (and per-phase) is tracked.
- No changes to `s2-cem-config`/WebSocket transport - this is D-Bus-only, since only the D-Bus transport exposes these values as real BusItem properties.

## Decisions

### D1: Measurement props become a function of `(measurementType, nrOfPhases, phaseSetting)`, not a static table

`MEASUREMENT_TYPE_TO_PROPS` (a plain `Record<string, Record<string,string>>`) is replaced by a `resolveMeasurementProps(measurementType, nrOfPhases, phaseSetting): Record<string, string>` function (D-Bus key -> S2 commodity quantity):
- `L1_L2_L3`, `nrOfPhases === 1`: `{ 'Ac/L<phaseSetting>/Power': 'ELECTRIC.POWER.L<phaseSetting>' }` (one entry).
- `L1_L2_L3`, `nrOfPhases` 2 or 3: one entry per phase, `Ac/L1/Power`..`Ac/L<nrOfPhases>/Power`.
- `3_PHASE_SYMMETRIC`: unchanged, `{ 'Ac/Power': 'ELECTRIC.POWER.3_PHASE_SYMMETRIC' }` - this map is specifically "what gets sent to S2 as an independent commodity," and the derived per-phase D-Bus values for symmetric mode (D4) are never sent to S2 as separate commodities, so they don't belong in this map.
- Anything else (`''`/unrecognized): `{}`, unchanged.

Both `S2DbusTransport` (property declaration) and `PowerMeasurementCache` (input parsing/caching) call this same function with the same three inputs, so the declared property set and the accepted input keys can never drift apart - the earlier bug was exactly that split (`dbus.ts` declared from a table that didn't know about `phaseSetting`).

**Alternatives considered:** keeping per-`nrOfPhases` variants as static table entries (`L1_L2_L3_1PHASE_L2`, etc.) - rejected, combinatorially awkward and still needs a function to pick the right table key anyway.

### D2: `values` input is parsed into the same internal per-key cache `PowerMeasurementCache` already keeps

`PowerMeasurementCache.update(payload)` tries the raw-key shape first (unchanged), then independently checks for `payload.values`. When present, it's resolved against `resolveMeasurementProps()`'s current key set (per the rules in proposal.md/the spec delta - scalar maps to the single key for `nrOfPhases:1`/broadcasts to all keys for 2-3, array maps element-by-element and is rejected with `node.warn`-worthy signal for `nrOfPhases:1`, 3-phase-symmetric has its own scalar/array handling per D4) and folded into the *same* internal `Map<string, number>` the raw-key shape already populates. Both shapes end up indistinguishable once cached - `Ac/Power` aggregation (D3) and the S2 snapshot (`buildS2Values()`) work identically regardless of which shape produced a given cached value.

`update()`'s return type grows a validation outcome so callers can `node.warn()` on a rejected array without `PowerMeasurementCache` itself depending on a specific node's `warn()` method (keeps the class Node-RED-agnostic, matching its existing design).

**Alternatives considered:** a fully separate `updateFromValues()` method - rejected, would duplicate the phase-aware key resolution and the "what's currently cached" bookkeeping that `update()` already owns.

### D3: `Ac/Power` is always recomputed from whatever per-phase values are currently cached, not tracked as its own independent value

After any `Ac/L{1,2,3}/Power` cache write (from either input shape), when `measurementType: L1_L2_L3`, `PowerMeasurementCache` recomputes `Ac/Power` as the sum of every currently-cached per-phase value (phases with no cached value yet contribute `0`, matching the existing "starts at `0`" BusItem convention for measurement-tracked properties) and includes it in the returned `raw` update. This makes `Ac/Power`'s freshness a pure function of the cache rather than separate state that could fall out of sync.

### D4: `3_PHASE_SYMMETRIC` gains a derived, D-Bus-only per-phase breakdown, kept separate from what's sent to S2

For `measurementType: 3_PHASE_SYMMETRIC`, `S2DbusTransport` now also declares `Ac/L1/Power`/`Ac/L2/Power`/`Ac/L3/Power` (previously left at the "minimal meter" shape's own `null` default forever). `PowerMeasurementCache` computes these as part of the same `update()` call:
- Scalar input (either shape): split evenly, `Ac/L{1,2,3}/Power = value / 3`.
- Array input (`values` shape only - the raw-key shape has no way to express three D-Bus keys for a `3_PHASE_SYMMETRIC`-configured device today, and that's unchanged): the three elements go to `Ac/L1/Power`/`Ac/L2/Power`/`Ac/L3/Power` directly, unsplit; `Ac/Power` and the single S2 `ELECTRIC.POWER.3_PHASE_SYMMETRIC` commodity both get the sum.

This is the one place `resolveMeasurementProps()`'s S2-commodity map (D1) and the D-Bus properties actually written (D3/D4) diverge on purpose - S2 only ever sees one number for symmetric measurement (per the S2 spec's own `3_PHASE_SYMMETRIC` commodity quantity), while the D-Bus per-phase breakdown is a local-only convenience for the Victron UI/other D-Bus consumers.

### D5: Energy auto-calculation lives in a new small pure module, driven by `S2DbusTransport`

A new `src/lib/s2/energy-accumulator.ts` reproduces node-red-contrib-victron's `energy-utils.js` algorithm exactly (`WATT_MILLISECONDS_PER_KWH = 3_600_000_000`; on each key's update, `deltaKwh = max(0, previousValue) * (now - previousTimestamp) / WATT_MILLISECONDS_PER_KWH`, added onto that key's running total) as a small stateful `EnergyAccumulator` class - `accumulate(key, newPowerValue, now): number | null` returns the updated Energy total for that key (or `null` if there's no previous timestamp yet, i.e. the very first reading).

`S2DbusTransport.setMeasurementValues(values)` is where this plugs in (not `PowerMeasurementCache`, and not the node-level `index.ts` files) - it's the single shared funnel both `s2-dbus` and `s2-dbus`'s composite sibling already call with every `raw` Power update, so it needs no changes to either node's own `input` handler:
1. Apply the incoming `Ac/L{1,2,3}/Power`/`Ac/Power` values via `setValuesLocally` as today.
2. If `autoCalculateEnergy` was set at construction, for each `Ac/L{n}/Power` key just updated, accumulate its Energy Forward delta into `Ac/L{n}/Energy/Forward` via the same `EnergyAccumulator`, then roll the per-phase Energy Forward totals up into `Ac/Energy/Forward` as their sum - mirroring `acload.js`'s `onPropertiesChanged` exactly (per-phase accumulate, then sum into the top-level key).
3. For `3_PHASE_SYMMETRIC`, accumulate once directly from `Ac/Power`'s own value-over-time into `Ac/Energy/Forward` - not from each of the three derived (D4) per-phase values, which would triple-count the same underlying reading three times over.
4. Apply the resulting Energy key(s) via a second `setValuesLocally` call alongside the Power ones.

A new `autoCalculateEnergy?: boolean` option is added to `S2DbusTransportOptions`, sourced from a new `s2-dbus-config` field (`autoCalculateEnergy`, default `true`, checkbox labeled "Auto-calculate energy (Ac/Energy/Forward)" with the same tooltip wording as node-red-contrib-victron's own equivalent field, for consistency across the two projects' UX). `s2-dbus`/`s2-resource`'s `index.ts` pass it through to `S2DbusTransport`'s constructor the same way they already pass `measurementType`/`nrOfPhases`/etc.

**Alternatives considered:** computing energy inside `PowerMeasurementCache` alongside the Power aggregation (D2/D3) - rejected: `PowerMeasurementCache` is also used identically regardless of whether energy tracking is wanted, and its `update()` return shape is already relied on by `s2-resource`'s tests; keeping energy accumulation as a distinct, optional concern in `S2DbusTransport` (which already conditionally declares extra properties based on options, e.g. `measurementType`) fits the existing pattern better and keeps `PowerMeasurementCache` fully Node-RED/D-Bus-agnostic.

### D6: Both input shapes stay permanently supported side by side

No deprecation, no preference order beyond "check raw keys, then check `values`" (arbitrary but deterministic) - each is evaluated independently against the same incoming payload object, so a message could theoretically (if unusually) carry both and have both take effect. This matches the explicit instruction to keep the existing, possibly-already-in-use raw-key format working unchanged.

## Risks / Trade-offs

- [A device previously (buggily) declaring `Ac/L1/Power`/`Ac/L3/Power` at `nrOfPhases: 1` will stop declaring them after this change - anything external (a VRM widget, another D-Bus service) that came to depend on those paths existing on that specific service would break] -> These paths were never meant to exist per the already-shipped "Single-phase device reports under its configured line" requirement; removing them is a bug fix, not a design change. Call out explicitly in the release notes/changelog rather than silently.
- [`EnergyAccumulator`'s per-key timestamp state resets on every Node-RED redeploy/restart (in-memory only, like the rest of `PowerMeasurementCache`'s state) - a redeploy briefly loses the "previous timestamp" for delta computation, so the interval immediately after a redeploy contributes no energy (matches `acload.js`'s own behavior, which has the identical limitation - `instance[tsKey]` is regular JS object state, not persisted either)] -> Accepted, matching the reference implementation's own known limitation; not attempting persistence here since `acload.js` doesn't either.
- [Broadcasting a scalar `values` to every phase for `nrOfPhases: 2` or `3` is an assumption, not something the user directly confirmed (they only walked through `nrOfPhases: 1`/3-phase-symmetric cases)] -> Documented explicitly in the spec delta and this design; low risk since it's the more permissive, obviously-reversible-later choice (a later change could make it stricter without breaking anyone relying on the broadcast, whereas starting strict and loosening later is the same either way) - flagged to the user in the change summary rather than silently assumed.

## Migration Plan

None required for existing deployed flows: `s2-dbus-config`'s new `autoCalculateEnergy` field defaults `true` for *newly added* nodes only (Node-RED applies `defaults.value` only where absent from saved flow JSON) - an already-deployed config node has no `autoCalculateEnergy` key in its saved JSON, so at runtime `index.ts`'s own fallback determines whether existing nodes get it on or off by default; see tasks.md for the explicit choice (recommend `config.autoCalculateEnergy !== false` so existing nodes also get it, matching "default true," consistent with how energy tracking is purely additive/non-breaking - previously-`null` properties gaining live values is a strict improvement, not a behavior removal). The `Ac/L1/Power`/`Ac/L3/Power` removal for single-phase devices (a risk noted above) needs no data migration - it only changes which D-Bus properties get declared at next registration/redeploy.
