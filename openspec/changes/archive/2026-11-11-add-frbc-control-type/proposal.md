## Why

The Rust EMS test setup needs an FRBC (Fill Rate Based Control) Resource Manager. Today `s2-rm-config` lets a flow advertise `FILL_RATE_BASED_CONTROL` and `s2-rm` acknowledges and forwards `FRBC.Instruction`s, but nothing can send FRBC messages back: `s2-rm`'s `SystemDescription` and `UpdateStatus` commands only build OMBC messages and error with "No system description message available for control type FILL_RATE_BASED_CONTROL". A user who picks the generic `s2-rm` node therefore has no way to get an `FRBC.SystemDescription` or `FRBC.StorageStatus` to the CEM - the two messages the Rust EMS requires before it will plan (`FrbcState::is_valid()`). The only workaround is hand-building raw S2 JSON in a function node and wiring it straight into the transport, which skips outgoing schema validation and the TEMPORARY_ERROR retry.

## What Changes

- New `s2-frbc-config` node: holds the FRBC system description (actuators, operation modes, transitions, timers, storage description) and an optional leakage behaviour, as JSON in a code editor pre-filled with a working example and validated against the vendored S2 schema on save. No structured form editor in this change.
- New `s2-frbc` node, wired next to `s2-rm` exactly like `s2-ombc`/`s2-pebc`:
  - On `SelectControlType(FILL_RATE_BASED_CONTROL)` pushes `FRBC.SystemDescription` (+ `FRBC.LeakageBehaviour` when configured) and replays the last known storage status, actuator statuses and still-relevant forecast/target profile.
  - Resolves each `FRBC.Instruction` against the configuration and emits a routable `ActuatorInstruction` with actuator/mode labels, factor and the resulting power and fill rate at the current fill level.
  - Accepts flow input topics `StorageStatus`, `ActuatorConfirmation`, `UsageForecast`, `FillLevelTargetProfile`, `TimerStatus` and turns them into the matching S2 messages. `ActuatorConfirmation` also sends `FRBC.TimerStatus` for the transition's `start_timers` and `SUCCEEDED` for the instruction it confirms.
- `s2-rm` / `S2Session`: the existing `SystemDescription` and `UpdateStatus` commands gain an `frbc` namespace alongside `ombc`. No new command, port or wiring concept.
- `messages.ts`: builders for the eight outgoing FRBC message types.
- Example flow `examples/frbc-quickstart.json` (s2-dbus + s2-rm + s2-frbc, a simulated buffer).

Out of scope: a friendly form editor for `s2-frbc-config`; FRBC as a built-in control type in `s2-resource`; DDBC/PPBC; any planning or simulation logic beyond computing the instructed power/fill rate.

## Capabilities

### New Capabilities
- `control-type-frbc`: `s2-frbc` + `s2-frbc-config`, implementing FRBC-specific RM behaviour.

### Modified Capabilities
- `s2-rm-protocol`: the generic `SystemDescription` and `UpdateStatus` commands accept an `frbc` namespaced payload.

## Impact

- New: `src/nodes/s2-frbc/`, `src/nodes/s2-frbc-config/`, `src/lib/s2/frbc-controller.ts`, tests under `test/nodes/` and `test/lib/`.
- Changed: `src/lib/s2/session.ts` (`updateStatus`, `sendSystemDescription`), `src/lib/s2/messages.ts` (FRBC types and builders), `src/types/config-nodes.ts`, `package.json` (`node-red.nodes` registration), `docs/S2_REFERENCE.md`, `README.md`, `CHANGELOG.md`.
- No breaking change: existing OMBC/PEBC payloads and flows are unaffected.
