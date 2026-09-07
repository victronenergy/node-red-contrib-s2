## Context

See proposal.md - Why. This only touches `src/nodes/s2-ombc-config/index.html`'s existing friendly/Advanced conversion functions (`friendlyStateToSystemDescription`, `buildTransitions`, `isFriendlyRepresentable`, `systemDescriptionToFriendlyState`) - no runtime (`s2-ombc`) or wire-format change.

## Goals / Non-Goals

**Goals:**
- A deterministic, round-trippable mapping between a mode's minutes/seconds minimum-duration input and the `timers`/`start_timers`/`blocking_timers` shape, so `isFriendlyRepresentable` can recognize it exactly (no false negatives forcing a user into Advanced mode for something friendly mode itself produced).

**Non-Goals:**
- Any minimum-duration semantics beyond "block leaving this mode until N seconds have elapsed since entering it" (e.g. no separate on-time vs. off-time concept, no per-transition-pair timers) - one dwell timer per mode covers both cases already, since it's applied to whichever mode (the "on" mode or the "off" mode) the user configures it on.
- Any local timer tracking/enforcement in `s2-ombc` - per the S2 spec the CEM enforces `blocking_timers` before issuing an instruction; the RM's only obligation is to declare them correctly.

## Decisions

**Deterministic timer id, derived from the mode id, not a fresh UUID per save - but still a valid UUID4 string.**
`buildTransitions`/`friendlyStateToSystemDescription` already assign fresh UUIDs to transitions on every save (transitions are fully re-derived each time, so identity doesn't matter for them). Timers are different: `isFriendlyRepresentable` needs to confirm "this timer is wired into exactly the transitions the rule says it should be" without caring what its id happens to be, so a stable id is preferred purely so that repeated saves of an unchanged friendly-mode config produce a byte-identical `systemDescription` (no spurious diffs from regenerated timer ids) - consistent with how `s2-ombc-config` already behaves for operation mode ids (stable, assigned once by `generateUuid()` in `addModeItem`, not regenerated).

A plain custom-format string (e.g. `'min-duration:' + mode.id`) is **not** an option: per CEM-side review, `s2-python` (the CEM implementation Venus OS ships, v0.8.1 against S2 `0.0.2-beta`) validates every S2 id field as a UUID4 string and rejects anything else, so the timer's `id` must be indistinguishable in shape from a real `generateUuid()` output. The fix is a deterministic sibling of `generateUuid()`: seed a small PRNG from a hash of the mode's own id (already a stable UUID4, assigned once in `addModeItem`) and use it in place of `Math.random()` in the same `'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'` template - keeping the version (`4`) and variant (`8`-`b`) nibbles forced exactly as `generateUuid()` already forces them. The result is a structurally valid UUID4 (passes `s2-python`'s validation like any other id in the payload) that is also fully deterministic for a given mode id, so an unchanged config re-saves byte-identical. This is an implementation detail local to `index.html`; no new dependency (e.g. `uuid`'s v5 namespaced UUIDs, which are a different, non-v4 format and wouldn't fit here anyway).

**`isFriendlyRepresentable` validates structurally, not by recomputing and comparing.**
Rather than re-running `friendlyStateToSystemDescription` on a guessed friendly state and deep-equal-comparing, the existing function continues its current approach: walk the JSON and check the invariants hold (fully-connected transition graph; each timer belongs to exactly one mode; that mode's inbound transitions all start it and outbound transitions all block it; no other timer references or transition customization exists). This matches the existing style (see the current mode/transition/pair checks) and avoids coupling representability-checking to a specific id-generation scheme.

**Minutes/seconds are a UI-only split, not a stored shape.**
The stored `systemDescription` continues to hold only the S2 wire format (`timers[].duration` in milliseconds). Minutes and seconds are combined to milliseconds on save (`(minutes * 60 + seconds) * 1000`, always a whole number). Splitting back out when populating the friendly editor from an existing/Advanced-mode JSON is a representability check, not a display convenience: a duration is only friendly-representable when `duration % 1000 === 0`, in which case `minutes = Math.floor(duration / 60000)` and `seconds = Math.floor((duration % 60000) / 1000)` (integer division on an already-whole number of seconds - no rounding involved). A duration with a sub-second remainder (e.g. 90500 ms) fails that check and the timer is treated as non-representable, per the Risks/Trade-offs entry below - `Math.round` is deliberately not used anywhere in this path, since it would silently turn a non-representable duration into a representable-looking one.

## Risks / Trade-offs

- [A hand-authored Advanced-mode timer that happens to structurally match the derived pattern (right shape, wrong intent) round-trips into friendly mode and silently becomes editable/regenerable as a per-mode minimum duration] -> Acceptable: this is the same trade-off the existing friendly/Advanced round-trip already makes for operation modes and transitions (structural match is treated as "friendly mode produced this," regardless of authorship) - no new class of risk.
- [Sub-second precision loss if a hand-authored Advanced timer has a duration not a whole number of seconds, e.g. 90500 ms] -> Treated as non-representable (falls through to Advanced mode with the existing warning), since the friendly UI only offers whole seconds - no silent rounding.

## Open Questions

(none for this proposal itself - see proposal.md Capabilities for the single affected capability.)

**Deferred:** PR review on this proposal suggested validating `systemDescription` against the formal JSON schemas from [flexiblepower/s2-json](https://github.com/flexiblepower/s2-json) (raising validation errors before send/receive, not just on save). That's a cross-cutting concern for every S2 config editor and message path in this repo, not something scoped to per-mode minimum-duration timers - out of scope here and better tracked as its own proposal if pursued. Note also that Venus OS currently ships `s2-python` v0.8.1 against S2 `0.0.2-beta` (confirmed against `src/lib/s2/messages.ts`'s `supported_protocol_versions`), not the newer `s2-json`/v1.0.0 schemas, which would need reconciling first.
