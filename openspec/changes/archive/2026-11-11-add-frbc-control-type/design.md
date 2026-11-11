## Context

`s2-ombc` and `s2-pebc` established the pattern (see archived `2026-08-25-add-control-type-nodes`): `s2-rm` is the protocol state machine; a control-type node sits on `s2-rm`'s "from CEM" output (port 2), and sends commands back into `s2-rm`'s input. The node-red wrapper is thin; behaviour lives in a controller class in `src/lib/s2/` so it is unit-testable without Node-RED.

FRBC differs from OMBC in ways that shape this design:

- A resource has one storage and **several actuators**, each with its own operation modes, transitions and timers. Instructions and actuator statuses are per actuator.
- Operation modes have **elements selected by fill level**: power and fill rate for a given mode depend on the current fill level.
- There are five runtime messages from the RM (`ActuatorStatus`, `StorageStatus`, `TimerStatus`, `UsageForecast`, `FillLevelTargetProfile`) and two description messages (`SystemDescription`, `LeakageBehaviour`).

The first consumer is the Rust EMS (`rust-ems`, CEM over D-Bus). Its `FrbcState` stores everything it receives and only plans once it has a `StorageStatus` and a `SystemDescription`; it re-plans at most every 5 s and revokes previous `FRBC.Instruction`s on each new plan (already handled by `S2ResourceManager`'s pending-instruction revocation).

## Goals / Non-Goals

**Goals:**
- A flow author can put `s2-rm` + `s2-frbc` on any transport and get a valid FRBC RM without writing S2 JSON in function nodes.
- Every outgoing FRBC message goes through `S2Session._send` (schema validation, TEMPORARY_ERROR retry).
- Reuse the existing command channel and wiring; no change to `s2-rm`'s ports.

**Non-Goals:**
- A structured form editor (follow-up change; JSON-first was chosen to unblock the Rust EMS test).
- FRBC inside `s2-resource`.
- Simulating the storage (fill level integration) inside the node - the example flow does that in a function node.

## Decisions

1. **Extend the existing commands with an `frbc` namespace rather than adding a raw "send S2 message" command.** Matches `ombc`, keeps `s2-rm` knowing which S2 message types it sends, and keeps validation/retry in one place.
   - `SystemDescription`: `{ command, cemId, controlType: 'FILL_RATE_BASED_CONTROL', frbc: { systemDescription, leakageBehaviour? } }` → `FRBC.SystemDescription`, then `FRBC.LeakageBehaviour` if present.
   - `UpdateStatus`: `{ command, cemId, controlType: 'FILL_RATE_BASED_CONTROL', frbc: { actuatorStatuses?, storageStatus?, timerStatuses?, usageForecast?, fillLevelTargetProfile? } }` → one S2 message per present entry, in that order. An `frbc` object with none of these is an error.
   - Builders fill `message_type`, `message_id`, and default `valid_from`/`start_time` to now when absent.

2. **System description JSON is the wire shape minus envelope.** The config holds `{ actuators: [...], storage: {...} }` exactly as S2 names them (snake_case), so the S2 spec and the Rust EMS's `s2energy` types can be used as documentation directly. `message_type`, `message_id`, `valid_from` are added at send time. (OMBC's camelCase `operationModes` rename is not repeated.) Leakage behaviour JSON is `{ elements: [...] }`.

3. **Save-time validation via a new admin endpoint** `POST /s2/validate-frbc-config` (permission `s2-frbc-config.write`), mirroring `/s2/validate-system-description`: builds the messages and runs `validateS2Message`. It also checks cross-references the schema can't: unique actuator/mode/timer ids, transition `from`/`to`/timer ids exist within their actuator, and `storage.provides_leakage_behaviour` is true iff leakage JSON is given.

4. **Instruction resolution.** On `FRBC.Instruction`, look up `actuator_id` and `operation_mode`; pick the element whose `fill_level_range` contains the last known fill level (if none known, or none matches, the first element, with a warning in status). Emit on port 1:
   `{ topic: 'ActuatorInstruction', payload: { instructionId, actuatorId, actuatorLabel, actuatorIndex, operationModeId, operationModeLabel, operationModeIndex, factor, abnormalCondition, fillRate, commodityPower, values }, cemId, rawS2Message }`
   where `fillRate` and each `commodityPower` value are `start + factor * (end - start)` of the element's ranges, and `values` follows `s2-ombc`'s convenience shape (number for `3_PHASE_SYMMETRIC`, array for L1/L2/L3). Unknown actuator/mode: warning, no output; the RM has already sent ACCEPTED (unchanged behaviour), so `s2-frbc` sends `InstructionStatus ABORTED` for it.

5. **Flow input topics** (`msg.topic` + `msg.payload`, like `s2-ombc`'s `ModeConfirmation`):
   - `StorageStatus` `{ fillLevel }` - sent only when the value changed since the last send for that CEM; always stored.
   - `ActuatorConfirmation` `{ actuator: id|index|label, operationMode: id|index|label, factor? }` - an emitted `ActuatorInstruction` payload can be wired straight back (its `actuatorId`/`operationModeId`/`factor` are accepted too). Sends `FRBC.ActuatorStatus` with `previous_operation_mode_id`/`transition_timestamp` when the mode changed, `FRBC.TimerStatus` (`finished_at = now + duration`) for each `start_timers` entry of the matching transition, and `InstructionStatus SUCCEEDED` for the most recent open instruction for that actuator whose mode and factor match.
   - `UsageForecast` / `FillLevelTargetProfile` `{ startTime?, elements }` - rejected with a warning when the storage description says the RM does not provide it.
   - `TimerStatus` `{ actuator, timerId, finishedAt }` - for timers the flow manages itself.
   - `cemId` optional; resolved as in `s2-ombc` (the single CEM with FRBC selected; error if several).

6. **Device state is stored in node context and replayed on select.** It describes the device, not a CEM: last storage status, per-actuator status, latest usage forecast and fill level target profile (only if they still cover a future time), unexpired timer statuses. Inputs that arrive while FRBC isn't selected are stored but not sent - so a fill level fed in at deploy time reaches the CEM as soon as it selects FRBC. This is what makes the Rust EMS's `is_valid()` true without the flow having to resend.

7. **Selection survives a partial deploy via s2-rm.** A restarted `s2-frbc` sends s2-rm `ReplaySelection`; s2-rm re-emits `SelectControlType` (`replay: true`) for CEMs that still have FRBC selected. Keeping the selection in node context instead fails on a full deploy, where s2-rm has no sessions and every re-send would warn about an unknown CEM. `Connected`/`Disconnected` end a selection; stored state the new configuration doesn't cover is dropped on start.

8. **Two outputs, same as `s2-ombc`:** port 1 instructions (+ `topic: 'Selected'`/`'Deselected'` so a flow can start/stop pushing fill levels), port 2 commands to `s2-rm`. Non-FRBC instructions are ignored silently.

## Risks / Trade-offs

- [JSON editing of a three-level structure is error-prone] → pre-filled example (one heat-pump-buffer actuator with idle/heat modes, 0-100 % storage), schema + cross-reference validation on save, error paths shown in the editor.
- [Fill level pushed every second from D-Bus floods the CEM] → change-only sending (decision 5). A dead-band or rate limit is left as an open question rather than guessed.
- [Auto-`SUCCEEDED` might fire for the wrong instruction if the CEM sends several for one actuator] → match on actuator + mode + factor and pick the most recent; documented in the help panel. Flows can still send `InstructionStatus` themselves.
- [Element choice depends on a fill level that may be stale] → uses last known value and says so in status when none is known.

## Migration Plan

Additive. Ship as a minor release; existing flows unaffected.

## Open Questions

- Should `StorageStatus` have a configurable dead-band (e.g. 0.5 % of range) or minimum interval in `s2-frbc-config`? Decide after testing against the Rust EMS.
- ~~Re-send the system description after a partial deploy?~~ Resolved: yes, through `ReplaySelection` (decision 7).
