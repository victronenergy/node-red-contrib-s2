## Why

`s2-ombc-config`'s only authoring path today is a single raw-JSON field for the entire OMBC system description (operation modes, transitions with hand-written UUID cross-references, timers). Real-world configs are overwhelmingly simple - a Standby/off mode, a small number of active modes with a single fixed power level each, a fully-connected transition graph between them, and no timers - but users have to hand-author and cross-reference UUIDs in JSON to express even that simplest case.

## What Changes

- `s2-ombc-config` gains a friendly editor for operation modes: an add/remove/reorder list, each with a diagnostic label, an "abnormal condition only" flag, and per-phase (L1/L2/L3) watt values with a "same value on all phases" convenience. A Standby/off mode is pre-seeded and protected from accidental deletion.
- In friendly mode, transitions between configured modes are always auto-derived as a fully-connected graph (every mode to every other mode, no timers) - matching observed real-world usage - so the user never authors a transition directly.
- An explicit "Friendly" / "Advanced (JSON)" mode toggle. Advanced mode is the full raw `systemDescription` JSON (operation modes, transitions, timers) for anything friendly mode doesn't cover - blocking a specific transition, attaching a timer, or any other custom shape. Switching to Advanced converts the current friendly state to JSON once; switching back re-derives friendly state from the JSON if its shape matches what friendly mode can represent, otherwise stays in Advanced mode with a warning rather than silently discarding the customization.
- No change to the stored `systemDescription` format (still a JSON string) or to any runtime/`s2-ombc` behavior - this is an editor-only (`index.html`) change. Existing deployed configs, authored as raw JSON, load straight into the friendly editor if their shape matches, otherwise open directly into Advanced mode.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `control-type-ombc`: `s2-ombc-config`'s editor gains a friendly authoring UI (default modes, auto-derived transitions, raw-JSON round-trip) alongside the existing raw-JSON path.

## Impact

- `src/nodes/s2-ombc-config/index.html` (editor rewrite)
- `src/nodes/s2-ombc-config/index.ts` (unaffected - stored value format is unchanged)
- `README.md` (if worth a short mention)
- No breaking changes: stored `systemDescription` format, `s2-ombc` runtime behavior, and the S2 wire message are all unchanged.
