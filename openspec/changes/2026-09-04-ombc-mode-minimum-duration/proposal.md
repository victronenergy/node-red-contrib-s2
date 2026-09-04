## Why

S2's `OMBC.SystemDescription` already has a mechanism for "once a device enters mode X, it must stay there for at least N milliseconds before it can transition away" - `timers` plus a transition's `start_timers`/`blocking_timers` - but `s2-ombc-config`'s friendly editor has no way to express it: friendly mode only recognizes (and only produces) a fully-connected transition graph with zero timers, so any minimum-duration requirement forces a user into hand-authoring the full Advanced JSON, including one timer object and correctly cross-referencing its id into every relevant transition's `start_timers`/`blocking_timers` array. This is the same class of problem the friendly editor already solved for operation modes and transitions - real-world usage (e.g. a compressor or boiler element that must not be cycled faster than every few minutes) needs a minimum-duration guarantee, but shouldn't require hand-authoring transition JSON to get it.

## What Changes

- Each operation mode in the friendly editor gains an optional "Minimum time in this mode" input, entered as minutes and seconds (two small number fields, not a raw millisecond or seconds value) - both blank/zero means no timer, the current default behavior, unchanged.
- For every mode with a configured minimum duration, friendly mode derives one S2 timer (`duration` = (minutes × 60 + seconds) × 1000 ms - the S2 wire format's unit; never exposed to the user), and wires it into the auto-derived fully-connected transition graph: every transition **into** that mode includes the timer in `start_timers`; every transition **out of** that mode includes it in `blocking_timers`. Modes with no configured minimum duration are unaffected - a device with none of its modes so configured produces byte-for-byte the same `systemDescription` as before this change.
- `isFriendlyRepresentable`/`systemDescriptionToFriendlyState` (the Advanced -> Friendly round-trip in `src/nodes/s2-ombc-config/index.html`) are extended to recognize this exact derived shape - one timer per mode, wired per the rule above, and no other timer/transition customization - as friendly-representable, and to recover each mode's minimum-duration value from it. Any other timer/transition shape (a bespoke timer, a blocked transition, a timer that isn't wired symmetrically per the rule) still falls through to Advanced mode, as it does today.
- No wire-level or runtime behavior change in `s2-ombc` itself: per the S2 spec, the CEM - not the RM - is responsible for withholding an instruction that would violate a `blocking_timers` entry. `s2-ombc` only needs to declare the timers correctly in the `SystemDescription` it already sends; it does not track timer state locally. `src/nodes/s2-ombc/index.ts` is unaffected.
- No change to the stored `systemDescription` format (still a JSON string) - this is an editor-only (`index.html`) change, same scope as the prior friendly-editor work.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `control-type-ombc`: `s2-ombc-config`'s friendly editor gains a per-mode minimum-duration field, which it expresses using the existing `timers`/`start_timers`/`blocking_timers` mechanism; the friendly/Advanced round-trip recognizes this derived shape as friendly-representable.

## Impact

- `src/nodes/s2-ombc-config/index.html` (friendly editor: new field, `friendlyStateToSystemDescription`/`buildTransitions`, `isFriendlyRepresentable`, `systemDescriptionToFriendlyState`, help text)
- `src/nodes/s2-ombc-config/index.ts` (unaffected - stored value format is unchanged)
- `src/nodes/s2-ombc/index.ts` (unaffected - no runtime timer tracking needed; the CEM enforces `blocking_timers`)
- `README.md` (if worth a short mention)
- `test/` (new/updated tests for the friendly-editor conversion functions)
- No breaking changes: existing configs with no per-mode minimum duration produce an identical `systemDescription` to today; the stored format and the S2 wire message shape are unchanged.
