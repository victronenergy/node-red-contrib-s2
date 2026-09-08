## Why

Tester feedback on a relay-control flow built with `s2-rm` showed that the node's generic protocol handling and its control-type-specific behavior (OMBC mode resolution, PEBC schedule dispatch) are tangled together. Users end up writing function nodes for state tracking, UUID generation, and manual S2 message construction that the library should handle. `s2-rm` also currently only has real support for OMBC and PEBC; other control types are raw pass-through. Splitting protocol plumbing from control-type behavior - and giving each control type its own node - removes that user-side boilerplate without forcing a full "push everything into the user's flow" rewrite.

## What Changes

- **BREAKING**: `s2-rm` becomes a pure S2 protocol state machine: handshake, `SelectControlType`, generic instruction ack/routing, and enriched+namespaced instruction output (`msg.controlType`, `msg.ombc`/`msg.pebc`). Drops from 4 outputs to 3 - the PEBC-specific "schedule" port is removed.
- New `s2-ombc` node: owns OMBC system description (operation modes/transitions), resolves mode by label/index/id, tracks previous mode and transition timestamps, emits Switch-friendly `msg.topic`, and sends `UpdateStatus` back through `s2-rm`'s existing command-input channel to confirm actuator state to the CEM.
- New `s2-pebc` node: owns PEBC power-envelope schedule accumulation and timer-based active-slot dispatch - this is the scheduling logic (and the not-yet-started-schedule fix) relocated from `s2-rm`, not deleted.
- **BREAKING**: New `s2-ombc-config` and `s2-pebc-config` nodes hold each control type's domain-specific settings (operation modes/transitions; grid connection wattage / power constraints defaults), removed from `s2-rm-config`.
- **BREAKING**: `s2-rm-config` shrinks to pure RM identity fields matching the S2 spec's `ResourceManagerDetails` (resourceId, roles, name, controlTypes, serialNumber, manufacturer, model, firmwareVersion, providesPowerMeasurement, providesForecast).
- `s2-ombc`/`s2-pebc` ignore and pass through instructions that aren't their control type, and raise a `node.status()` warning rather than dropping silently or erroring - supports wiring both downstream of `s2-rm` in parallel.
- Out of scope: FRBC, DDBC, and PPBC get no dedicated node in this change: `s2-rm` continues to raw-pass-through their instructions, as it does today. Future work.
- Out of scope: whether `s2-ombc` preloads its system description at deploy time or asks for it via request/response is still undecided - to be resolved in design.md or a follow-up.

## Capabilities

### New Capabilities
- `s2-rm-protocol`: the generic S2 protocol state machine behavior of `s2-rm` (handshake, control type selection, generic instruction ack/routing, enriched+namespaced instruction output, 3 outputs).
- `control-type-ombc`: `s2-ombc` node + `s2-ombc-config`, implementing OMBC-specific protocol behavior.
- `control-type-pebc`: `s2-pebc` node + `s2-pebc-config`, implementing PEBC-specific protocol behavior (including the relocated schedule dispatch).

### Modified Capabilities
- (none - no capability specs exist yet for this project; the above are all newly formalized here)

## Impact

- `src/nodes/s2-rm/index.ts`: remove PEBC schedule/timer/persistence logic and OMBC-specific auto-status; add generic `UpdateStatus` command routing; drop 4th output.
- `src/lib/s2/session.ts`: remove `_sendOMBCSystemDescriptionAndStatus`/`updateOMBCStatus` auto-send-on-accept behavior in favor of a request/preload path owned by `s2-ombc`.
- `src/lib/s2/schedule.ts`: consumed by the new `s2-pebc` node instead of `s2-rm`.
- `src/nodes/s2-rm-config/`: remove `maxBatteryChargePower`, `maxBatteryDischargePower`, `gridConnection`, `customMaxPowerW`; add `providesPowerMeasurement`, `providesForecast` (moved from `s2-rm`).
- New: `src/nodes/s2-ombc/`, `src/nodes/s2-ombc-config/`, `src/nodes/s2-pebc/`, `src/nodes/s2-pebc-config/`.
- `package.json` node-red registration and example flows (`examples/pebc-instruction-tester.json`, relay flow) need updating for the new node set.
- No migration path required - single active flow, breaking changes accepted per user decision.
