## MODIFIED Requirements

### Requirement: Power measurement relay to the CEM
The `s2-dbus` node SHALL cache the latest power value(s) received on its input and, while power measurement is active for a CEM, SHALL emit them as `{ command: 'PowerMeasurement', cemId, values }` for `s2-rm` to convert into S2 messages. Two independent input shapes SHALL be recognized on every message, checked independently (a message can use either):
- **Raw D-Bus-key shape** (unchanged from today): keyed by `Ac/Power` or `Ac/L{1,2,3}/Power`, matching the configured measurement type - e.g. `{ payload: { 'Ac/Power': 1800 } }`.
- **`values` shape** (new): `{ payload: { values: <number | number[]> } }`, whose meaning is derived from the configured `measurementType`/`nrOfPhases`/`phaseSetting`:
  - `measurementType: L1_L2_L3`, `nrOfPhases: 1`: a scalar `values` is the single wired phase's power (`phaseSetting` names which S2 commodity, e.g. `ELECTRIC.POWER.L2`). An array `values` SHALL be rejected (a `node.warn` and no cache update) - a genuinely single-phase device has no second or third line to attribute array elements to.
  - `measurementType: L1_L2_L3`, `nrOfPhases: 2` or `3`: an array `values` of length exactly `nrOfPhases` maps element-by-element to `ELECTRIC.POWER.L1`, `L2`, `L3` in order. A scalar `values` SHALL be broadcast as that same value to every declared phase's commodity.
  - `measurementType: 3_PHASE_SYMMETRIC` (only valid at `nrOfPhases: 3`): a scalar `values` is sent as a single `ELECTRIC.POWER.3_PHASE_SYMMETRIC` value. An array `values` of length 3 is summed into a single `ELECTRIC.POWER.3_PHASE_SYMMETRIC` value for S2 (the array elements individually affect only the D-Bus per-phase properties - see the BusItem requirement below).
  - `measurementType: ''` (None): `values` has nothing configured to map to - no-op, matching the raw-key shape's own behavior with no measurement type configured.

#### Scenario: CEM starts power measurement
- **WHEN** the node receives `{ payload: { s2Signal: 'PowerMeasurementStart' }, cemId }` and has a cached value for its configured measurement type
- **THEN** it immediately emits `{ command: 'PowerMeasurement', cemId, values }` with that cached value

#### Scenario: Value updates while active
- **WHEN** the node's input receives an updated value (e.g. `{ payload: { 'Ac/Power': 1800 } }`) while power measurement is active for a CEM
- **THEN** it emits an updated `{ command: 'PowerMeasurement', cemId, values }`

#### Scenario: CEM stops power measurement
- **WHEN** the node receives `{ payload: { s2Signal: 'PowerMeasurementStop' }, cemId }`
- **THEN** it stops emitting `PowerMeasurement` commands for that CEM until measurement is started again

#### Scenario: Scalar `values` on a single-phase, per-phase-measured device
- **WHEN** `measurementType: L1_L2_L3`, `nrOfPhases: 1`, `phaseSetting: 2`, and the node receives `{ payload: { values: 10 } }` while measurement is active
- **THEN** it emits a `PowerMeasurement` with a single `{ commodity_quantity: 'ELECTRIC.POWER.L2', value: 10 }`

#### Scenario: Array `values` rejected on a single-phase device
- **WHEN** `measurementType: L1_L2_L3`, `nrOfPhases: 1`, and the node receives `{ payload: { values: [11, 22, 33] } }`
- **THEN** the cache is not updated, a warning is logged, and no `PowerMeasurement` reflecting those values is ever emitted

#### Scenario: Array `values` on a 3-phase, per-phase-measured device
- **WHEN** `measurementType: L1_L2_L3`, `nrOfPhases: 3`, and the node receives `{ payload: { values: [11, 22, 33] } }` while measurement is active
- **THEN** it emits a `PowerMeasurement` with `{ commodity_quantity: 'ELECTRIC.POWER.L1', value: 11 }`, `{ ...L2, value: 22 }`, `{ ...L3, value: 33 }`

#### Scenario: Scalar `values` under 3-phase symmetric measurement
- **WHEN** `measurementType: 3_PHASE_SYMMETRIC` and the node receives `{ payload: { values: 10 } }` while measurement is active
- **THEN** it emits a `PowerMeasurement` with a single `{ commodity_quantity: 'ELECTRIC.POWER.3_PHASE_SYMMETRIC', value: 10 }`

#### Scenario: Array `values` under 3-phase symmetric measurement is summed for S2
- **WHEN** `measurementType: 3_PHASE_SYMMETRIC` and the node receives `{ payload: { values: [11, 22, 33] } }` while measurement is active
- **THEN** it emits a `PowerMeasurement` with a single `{ commodity_quantity: 'ELECTRIC.POWER.3_PHASE_SYMMETRIC', value: 66 }`

### Requirement: Power measurement exposed as a D-Bus BusItem property
The `s2-dbus` node SHALL declare and update, as real readable D-Bus BusItem properties, exactly the property key(s) that correspond to its configured `measurementType`/`nrOfPhases`/`phaseSetting` - independent of whether power measurement is currently active for any CEM:
- `measurementType: L1_L2_L3`, `nrOfPhases: 1`: exactly one property, `Ac/L<phaseSetting>/Power` - never `Ac/L1/Power` or `Ac/L3/Power` when wired to a different line.
- `measurementType: L1_L2_L3`, `nrOfPhases: 2` or `3`: `Ac/L1/Power` through `Ac/L<nrOfPhases>/Power`.
- `measurementType: 3_PHASE_SYMMETRIC`: `Ac/Power`, plus (new) `Ac/L1/Power`, `Ac/L2/Power`, `Ac/L3/Power` (derived - see the scenarios below).
- `measurementType: ''` (None): no measurement-tracked properties; the minimal-meter shape's own defaults apply (see "Full node-red-contrib-victron-compatible D-Bus shape" below).

Whenever any `Ac/L{1,2,3}/Power` value is written (from either input shape above), `Ac/Power` SHALL be updated to the sum of every currently-known per-phase `Power` value for that device (not just the one that changed) - a device whose measurement type is per-phase never leaves `Ac/Power` stale or unset while its per-phase readings are live.

#### Scenario: Single-phase device declares only its wired line
- **WHEN** `measurementType: L1_L2_L3`, `nrOfPhases: 1`, `phaseSetting: 2`
- **THEN** the registered service declares `Ac/L2/Power` as a measurement-tracked property, and neither `Ac/L1/Power` nor `Ac/L3/Power` is declared as one (they may still exist as `null`-defaulted "minimal meter" placeholders per the shape requirement below, but are never written to by measurement input)

#### Scenario: Value fed to the node's input
- **WHEN** the node receives `{ payload: { 'Ac/Power': 1800 } }` (or the per-phase equivalent) on its input
- **THEN** the corresponding D-Bus property is updated to that value, readable via `GetValue` by anything else on the Venus system

#### Scenario: Per-phase value updates keep Ac/Power in sync
- **WHEN** `measurementType: L1_L2_L3`, `nrOfPhases: 3`, and the node receives `Ac/L1/Power: 100`, then later `Ac/L2/Power: 200` (via either input shape)
- **THEN** after the first update `Ac/Power` reads `100`, and after the second it reads `300` (both known phases summed; `Ac/L3/Power` still unset contributes `0`)

#### Scenario: 3-phase-symmetric scalar splits evenly across per-phase properties
- **WHEN** `measurementType: 3_PHASE_SYMMETRIC` and the node receives a scalar measurement of `9` (via either input shape)
- **THEN** `Ac/Power` reads `9`, and `Ac/L1/Power`, `Ac/L2/Power`, `Ac/L3/Power` each read `3` (one third)

#### Scenario: 3-phase-symmetric array writes per-phase properties directly, unsplit
- **WHEN** `measurementType: 3_PHASE_SYMMETRIC` and the node receives `{ payload: { values: [11, 22, 33] } }`
- **THEN** `Ac/Power` reads `66` (the sum), and `Ac/L1/Power`, `Ac/L2/Power`, `Ac/L3/Power` read `11`, `22`, `33` respectively (not each divided by 3 again)

#### Scenario: Value updated before any CEM has started measurement
- **WHEN** the node receives a measurement value update and no CEM currently has power measurement active
- **THEN** every corresponding D-Bus property (including `Ac/Power` aggregation/distribution above) is still updated, even though no `PowerMeasurement` command is emitted to `s2-rm`

#### Scenario: No measurement type configured
- **WHEN** `s2-dbus-config`'s measurement type is set to "None"
- **THEN** the minimal-meter shape's own `Ac/Power`/`Ac/L{1,2,3}/Power` properties (see "Full node-red-contrib-victron-compatible D-Bus shape" below) are still declared, but stay at their default `null` ("unknown") value - no property key is added or removed based on measurement type, only whether it's live-tracked

## ADDED Requirements

### Requirement: Auto-calculated Energy (kWh) from Power over time
`s2-dbus-config` SHALL offer an "Auto-calculate energy" setting, defaulting to enabled for a newly added node, mirroring node-red-contrib-victron's own virtual `acload`/`heatpump` devices (same integration approach as their `accumulateDelta` helper: on every `Power` update, before applying the new value, the time elapsed since that same property's last update is multiplied by `max(0, previous power)` and added, converted to kWh, onto that property's running Energy Forward total - never negative, so only forward/import energy is tracked, matching `acload`'s own one-directional behavior with no Reverse tracking). When enabled, the `s2-dbus` node SHALL:
- Accumulate each declared `Ac/L{1,2,3}/Power` property's integrated energy into the corresponding `Ac/L{1,2,3}/Energy/Forward` property, and roll the per-phase totals up into `Ac/Energy/Forward` as their sum.
- For `measurementType: 3_PHASE_SYMMETRIC`, accumulate once directly from `Ac/Power` into `Ac/Energy/Forward` (not separately from each derived per-phase value, which would triple-count the same underlying reading).
- Leave `Ac/Energy/Forward`/`Ac/L{1,2,3}/Energy/Forward` at their `null` ("unknown") default when the setting is disabled, unchanged from today's behavior.

#### Scenario: Newly added config node has auto-calculation enabled
- **WHEN** a new `s2-dbus-config` node's edit dialog is opened for the first time
- **THEN** "Auto-calculate energy" is checked

#### Scenario: Per-phase energy accumulates from per-phase power
- **WHEN** "Auto-calculate energy" is enabled, `measurementType: L1_L2_L3`, `nrOfPhases: 1`, `phaseSetting: 2`, and `Ac/L2/Power` is updated to `100` at time T0 and again to `150` at time T0+3600000ms (1 hour)
- **THEN** at the second update, `Ac/L2/Energy/Forward` has increased by `0.1` kWh (100W for 1 hour), using the *previous* power value (100), and `Ac/Energy/Forward` reflects the same increase

#### Scenario: 3-phase-symmetric energy accumulates once from Ac/Power
- **WHEN** "Auto-calculate energy" is enabled and `measurementType: 3_PHASE_SYMMETRIC`
- **THEN** `Ac/Energy/Forward` accumulates directly from `Ac/Power`'s own value-over-time, not as a sum of three separately-accumulated derived per-phase values

#### Scenario: Negative power never decreases Energy Forward
- **WHEN** "Auto-calculate energy" is enabled and a tracked `Power` property's previous value was negative
- **THEN** no energy is subtracted for the interval since that value applied (only non-negative power contributes)

#### Scenario: Setting disabled
- **WHEN** "Auto-calculate energy" is unchecked
- **THEN** `Ac/Energy/Forward` and every `Ac/L{1,2,3}/Energy/Forward` stay at their `null` default, unchanged from today's behavior
