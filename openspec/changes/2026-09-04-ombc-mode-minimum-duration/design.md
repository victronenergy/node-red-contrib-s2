## Context

See proposal.md - Why. This only touches `src/nodes/s2-ombc-config/index.html`'s existing friendly/Advanced conversion functions (`friendlyStateToSystemDescription`, `buildTransitions`, `isFriendlyRepresentable`, `systemDescriptionToFriendlyState`) - no runtime (`s2-ombc`) or wire-format change.

## Goals / Non-Goals

**Goals:**
- A deterministic, round-trippable mapping between a mode's minutes/seconds minimum-duration input and the `timers`/`start_timers`/`blocking_timers` shape, so `isFriendlyRepresentable` can recognize it exactly (no false negatives forcing a user into Advanced mode for something friendly mode itself produced).

**Non-Goals:**
- Any minimum-duration semantics beyond "block leaving this mode until N seconds have elapsed since entering it" (e.g. no separate on-time vs. off-time concept, no per-transition-pair timers) - one dwell timer per mode covers both cases already, since it's applied to whichever mode (the "on" mode or the "off" mode) the user configures it on.
- Any local timer tracking/enforcement in `s2-ombc` - per the S2 spec the CEM enforces `blocking_timers` before issuing an instruction; the RM's only obligation is to declare them correctly.

## Decisions

**Deterministic timer id, derived from the mode id, not a fresh UUID per save.**
`buildTransitions`/`friendlyStateToSystemDescription` already assign fresh UUIDs to transitions on every save (transitions are fully re-derived each time, so identity doesn't matter for them). Timers are different: `isFriendlyRepresentable` needs to confirm "this timer is wired into exactly the transitions the rule says it should be" without caring what its id happens to be, so any id would technically round-trip correctly. A deterministic id (e.g. `'min-duration:' + mode.id`) is still preferred over a fresh UUID per save, purely so that repeated saves of an unchanged friendly-mode config produce a byte-identical `systemDescription` (no spurious diffs from regenerated timer ids) - consistent with how `s2-ombc-config` already behaves for operation mode ids (stable, assigned once by `generateUuid()` in `addModeItem`, not regenerated).

**`isFriendlyRepresentable` validates structurally, not by recomputing and comparing.**
Rather than re-running `friendlyStateToSystemDescription` on a guessed friendly state and deep-equal-comparing, the existing function continues its current approach: walk the JSON and check the invariants hold (fully-connected transition graph; each timer belongs to exactly one mode; that mode's inbound transitions all start it and outbound transitions all block it; no other timer references or transition customization exists). This matches the existing style (see the current mode/transition/pair checks) and avoids coupling representability-checking to a specific id-generation scheme.

**Minutes/seconds are a UI-only split, not a stored shape.**
The stored `systemDescription` continues to hold only the S2 wire format (`timers[].duration` in milliseconds). Minutes and seconds are combined to milliseconds on save and split back out (via `Math.floor(ms / 60000)` and `Math.round((ms % 60000) / 1000)`) when populating the friendly editor from an existing/Advanced-mode JSON - the same pattern the editor already uses for the symmetric/per-phase power split.

## Risks / Trade-offs

- [A hand-authored Advanced-mode timer that happens to structurally match the derived pattern (right shape, wrong intent) round-trips into friendly mode and silently becomes editable/regenerable as a per-mode minimum duration] -> Acceptable: this is the same trade-off the existing friendly/Advanced round-trip already makes for operation modes and transitions (structural match is treated as "friendly mode produced this," regardless of authorship) - no new class of risk.
- [Sub-second precision loss if a hand-authored Advanced timer has a duration not a whole number of seconds, e.g. 90500 ms] -> Treated as non-representable (falls through to Advanced mode with the existing warning), since the friendly UI only offers whole seconds - no silent rounding.

## Open Questions

(none - see proposal.md Capabilities for the single affected capability.)
