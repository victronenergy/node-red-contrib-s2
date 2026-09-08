## Context

`s2-pebc` already sends `lowerBound`/`upperBound`/`commodityQuantity` on its active-element output (see proposal.md - Why). S2 power values use a consistent sign convention across the whole protocol - positive is import/consumption, negative is export/production - and `PowerMeasurement` (already sent by flows through the same command-channel pattern `s2-pebc` uses for `PowerConstraints`/`InstructionStatus`/`Forecast`) carries a value in that same convention. Forecast capping already established the precedent of routing an existing flow-level command into `s2-pebc` for schedule-aware processing before it continues on; this change follows the same shape for `PowerMeasurement`.

The dedup state that gates `InstructionStatus: STARTED` (`lastEmittedActive`, keyed on slot identity: `startMs`/bounds/commodity) exists to suppress the CEM re-sending an identical instruction. A direction flip is not that - the instruction hasn't changed, only which side of it currently binds - so it must not interact with that state or its `InstructionStatus` side effect.

## Goals / Non-Goals

**Goals:**
- Let a flow with only one settable limit correctly enforce whichever side of an asymmetric PEBC envelope currently applies, using data it already has (its own power measurement).
- Keep this fully opt-in by wiring, with zero behavior change for flows that don't route `PowerMeasurement` into `s2-pebc`.

**Non-Goals:**
- Resolving a single numeric hardware setpoint (e.g. amps) inside `s2-pebc` - that conversion (phases, voltage) stays flow-level, unchanged from today.
- Supporting genuinely simultaneous independent import/export actuators - this addresses the single-actuator case only, per the proposal's motivation.
- Any debounce/hysteresis beyond what the flow's own measurement cadence already provides.

## Decisions

**Opt-in by wiring, not a config flag.** No new option on `s2-pebc-config`. `direction`/`limitW` are present on every active-element message regardless (defaulting to `direction: 'import'`, matching today's only behavior), but only change in response to actual measurements if the flow chooses to wire `PowerMeasurement` in. A config checkbox would still require the wiring to do anything, so it would add surface area without adding capability. Confirmed with the user in favor of this over an explicit checkbox.

**Separate re-announcement path, not a change to the existing dedup.** `emitActiveElement`'s existing duplicate-suppression (`lastEmittedActive`) and its `InstructionStatus: STARTED` side effect stay exactly as they are for schedule-driven transitions. A new, independent path handles measurement-driven direction flips: it re-emits output 1 only, tracks its own "last announced direction" state, and never touches `lastEmittedActive` or sends `InstructionStatus`. Folding this into the existing dedup was considered and rejected - it would either resend `InstructionStatus: STARTED` on every flip (wrong; the instruction didn't restart) or get silently swallowed as a duplicate slot (the flip would never reach the flow).

**Skip re-announcement when the limit wouldn't actually change.** Before re-emitting on a direction flip, compute what `limitW` would be for both directions; if they're equal (symmetric bounds, or the released `null`/`null` state), don't re-emit - direction is irrelevant to the actuator in that case, and doing so would just add noise for no behavioral effect.

**No new debounce logic.** The measurement pipeline feeding this is already rate-limited at the flow level (currently ~once/60s, likely to be tightened to ~10-15s per the user). Re-announcements can't fire faster than that arrives, and the equal-limit guard above further suppresses no-op flips near a zero crossing on symmetric envelopes.

## Risks / Trade-offs

- **[Risk]** A flow wires `PowerMeasurement` into `s2-pebc` for a commodity quantity that never matches the active schedule's commodity quantity (e.g. per-phase vs. 3-phase-symmetric mismatch), silently leaving `direction` stuck at the default. → Mitigation: this mirrors how `commodity_quantity` matching already works elsewhere in the codebase (e.g. `PowerMeasurement`/`Forecast` capping); no special handling beyond exact string match is planned, and it's visible in the emitted `direction` field for anyone debugging.
- **[Risk]** A flow relying on the current (pre-change) shape of the active-element message strictly validates against an unexpected-fields schema. → Mitigation: `direction`/`limitW` are additive; no existing field changes name, type, or meaning.
