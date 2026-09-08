## Context

`s2-ombc-config` stores `systemDescription` as a JSON string (see proposal.md - Why); nothing downstream (`s2-ombc-config/index.ts`, `s2-ombc`, the wire message) needs to change. Three real-world examples reviewed while researching this change (the boiler demo, and two independent flows shared by the user) all share the same shape: a Standby/off mode plus a small number of fixed-power active modes, a fully-connected bidirectional transition graph with empty timer arrays, and per-phase (`ELECTRIC.POWER.L1/L2/L3`) power ranges rather than `3_PHASE_SYMMETRIC` - despite the latter being what the current editor's default scaffold seeds.

This is purely a Node-RED admin-editor change: jQuery + Node-RED's existing `typedInput`/`editableList` client-side APIs, in `src/nodes/s2-ombc-config/index.html`. No new dependency, no build-time or runtime code involved.

## Goals / Non-Goals

**Goals:**
- Make the common case (Standby/off plus N fixed-power modes, full transition mesh, no timers) require no JSON authoring at all.
- Never silently discard something the user expressed in Advanced/JSON mode that friendly mode can't represent.
- Zero migration: every existing deployed config keeps working, either by loading straight into friendly mode or by opening into Advanced mode unchanged.

**Non-Goals:**
- Modeling every S2 OMBC feature in the friendly UI (genuine power ranges where `start_of_range !== end_of_range`, non-electric commodities, per-transition timers, per-transition `abnormal_condition_only`). These stay Advanced-mode-only, by design - see proposal.md.
- Any runtime/protocol change. `s2-ombc-config/index.ts` and `s2-ombc` are unaffected.
- Live two-way sync between friendly and Advanced views (see the mode-toggle decision below).

## Decisions

**Friendly/Advanced mode toggle, not continuous two-way sync.** Confirmed with the user. Two tabs; switching converts once. While in Advanced mode, the JSON textarea is the sole source of truth - it can express anything, including shapes the friendly model doesn't understand. Switching back to friendly mode re-derives friendly state from the *current* JSON content by checking whether it matches what friendly mode can produce (see below); if not, the editor stays in Advanced mode with a warning instead of guessing or discarding data. This avoids the real complexity of continuous bidirectional sync (every friendly edit re-serializing live, every JSON edit needing a defined fallback) for a UI that's opened once at a time in a modal dialog anyway.

**"Friendly-representable" shape check.** A `systemDescription` is representable in friendly mode when, and only when:
- Every operation mode's `power_ranges` is *either* exactly one range with `commodity_quantity: 'ELECTRIC.POWER.3_PHASE_SYMMETRIC'`, *or* exactly three ranges covering `L1`, `L2`, and `L3` - and in both cases every range has `start_of_range === end_of_range` (a fixed value, not a genuine range).
- `transitions` is exactly the fully-connected graph over the current operation-mode id set (every ordered pair of distinct modes, each present exactly once, `start_timers: []`, `blocking_timers: []`).
- `timers` is empty.

This check runs fresh against the current JSON content each time the user switches to friendly mode - not against cached state - so edits made directly in Advanced mode are correctly picked up (or correctly rejected) rather than compared against a stale snapshot.

**Per-mode power entry: three phase fields plus a "symmetric" toggle, not a phase-mode selector.** Each mode row shows L1/L2/L3 watt inputs. A "same value on all phases" checkbox, when checked, shows a single input and saves the mode with one `3_PHASE_SYMMETRIC` range (the semantically correct representation for a genuinely symmetric load); unchecked, it saves three explicit `L1`/`L2`/`L3` ranges (matching the two real single-phase examples, where unused phases are explicit zero ranges, not omitted). This was chosen over a config-level "commodity mode" selector (mirroring `s2-rm-config`'s `providesPowerMeasurement` field) because power representation here can legitimately vary per mode within one device in principle, and a per-mode toggle costs nothing extra in the common case (it defaults to whichever shape the existing config already uses, or to symmetric for a brand-new mode).

**Standby/off is seeded, not hardcoded.** The pre-seeded mode is a regular entry in the operation-modes list (editable label, deletable in Advanced mode via JSON, just not removable through the friendly list's own remove control) rather than a special-cased first element the runtime treats differently - `s2-ombc`/`s2-ombc-config`'s runtime side has no concept of "the standby mode" today and this change doesn't introduce one. It is presence-checked for the "friendly-representable" test only insofar as at least one mode exists; there's no requirement that a mode specifically be *labeled* "Standby" for the shape check to pass, since the label is free text.

## Risks / Trade-offs

- **[Risk]** A config using any feature outside the friendly model (a genuine power range, a non-electric commodity, a blocked transition pair, a timer) always opens in Advanced mode, even if 95% of it is otherwise simple. → Mitigation: intentional - Advanced mode is the deliberate, fully-capable escape hatch, not a failure state; the friendly model targets the common case rather than trying to partially represent everything.
- **[Risk]** A bug in the shape-match check could misclassify a JSON shape and, on switching back to friendly and later saving, silently narrow it (e.g. drop a legitimate `abnormal_condition_only: true` on a transition friendly mode always sets to `false`). → Mitigation: keep the check a strict structural comparison (exact set/field equality against what friendly mode would itself produce), not a heuristic; nothing is written back to the stored `systemDescription` until the node is actually saved/deployed, so an incorrect classification is recoverable by not saving.
- **[Risk]** The current default scaffold (seeded in today's `oneditprepare`) uses `3_PHASE_SYMMETRIC` for its one mode - after this change, a brand-new node instead seeds a Standby/off mode. This only affects nodes not yet configured (no existing deployed config is affected), so there's nothing to migrate.
