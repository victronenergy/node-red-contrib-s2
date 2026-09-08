## 1. `s2-rm-config`: shrink to pure RM identity

- [x] 1.1 Remove `maxBatteryChargePower`, `maxBatteryDischargePower`, `gridConnection`, `customMaxPowerW` from `S2RmConfigNode` (`src/types/config-nodes.ts`) and from the constructor in `src/nodes/s2-rm-config/index.ts`
- [x] 1.2 Add `providesPowerMeasurement` and `providesForecast` fields to `S2RmConfigNode` and the constructor (moved from `s2-rm`'s own config, matching `ResourceManagerDetails`)
- [x] 1.3 Update `src/nodes/s2-rm-config/index.html`: remove grid-connection/battery-limit fields and their `oneditprepare` visibility logic, add `providesPowerMeasurement`/`providesForecast` fields (reuse the UI copied from `s2-rm/index.html`)
- [x] 1.4 Remove the now-unused `GRID_CONNECTIONS` JS map from `s2-rm-config/index.html` (moves to `s2-pebc-config`)

## 2. `S2Session`: drop control-type-specific behavior

- [x] 2.1 Remove `_sendOMBCSystemDescriptionAndStatus` and the OMBC branch in `_handleSelectControlType` (`src/lib/s2/session.ts`) - `s2-rm` no longer sends system description or status on `SelectControlType`
- [x] 2.2 Remove the automatic `updateOMBCStatus(...)` call inside `_ackAndForward` for `OMBC_INSTRUCTION` - status is now sent only on explicit confirmation from `s2-ombc`
- [x] 2.3 Replace `updateOMBCStatus(status)` with a generic `updateStatus(controlType, payload)` that dispatches to the correct `make*Status` builder (only `OMBC.Status` exists today); keep sending it immediately when `CONNECTED`, drop the transition-diff computation (that responsibility moves to `s2-ombc`, per `control-type-ombc` spec)
- [x] 2.4 Add a generic `sendSystemDescription(controlType, payload)` that dispatches to the correct `make*SystemDescription` builder (only `OMBC.SystemDescription` exists today)
- [x] 2.5 Keep `setPEBCPowerConstraints`/the PEBC resend-on-`SelectControlType` behavior unchanged - `PEBC.PowerConstraints` is not a "system description or status" message per the `s2-rm-protocol` spec, and the `PowerConstraints` command is unchanged by this proposal
- [x] 2.6 Update `test/lib/session.test.ts`: remove tests for auto-sent OMBC system description/status on `SelectControlType` and on instruction accept; add tests for `updateStatus`/`sendSystemDescription` dispatch and for `CONNECTED`-gating

## 3. `s2-rm`: pure protocol state machine, 3 outputs

- [x] 3.1 Remove PEBC schedule accumulation/dispatch/persistence from `src/nodes/s2-rm/index.ts` (`pebcSlots`, `pebcConstraintsId`, `scheduleTimer`, `scheduleNextDispatch`, `emitActiveElement`, `applySchedule`, `loadPersistedSchedule`/`saveSchedule`, `SCHEDULE_CONTEXT_KEY`, dedupe tracking) - relocates to `s2-pebc` in section 6
- [x] 3.2 Remove OMBC-specific logic from `s2-rm/index.ts` (`resolveOMBCMode`, `controlTypeConfig` parsing, `OMBC_STATUS_KEY`/`persistOMBCStatusIfInstruction`, the `savedOmbcStatus` restore-on-`Connect` block) - resolution/persistence moves to `s2-ombc`
- [x] 3.3 Simplify `onInstruction`: drop the PEBC/OMBC branching and pending-instruction poll-and-resolve special cases; keep generic `ReceptionStatus`/`InstructionStatusUpdate(ACCEPTED)` ack (already in `S2Session`) and immediate/queued dispatch by `execution_time`, now enriching outgoing messages with `msg.controlType` and the namespaced payload (`msg.ombc`/`msg.pebc`/etc., keyed off `message_type`'s prefix) instead of `msg.topic`/`msg.operationMode`. (PEBC instructions bypass the execution_time queue entirely, matching prior behavior, and are delivered immediately so `s2-pebc` can own per-element dispatch timing.)
- [x] 3.4 Drop the node's 4th output everywhere: `node.send([...])` call sites, the `S2RmConfig`/wiring doc comment at the top of the file, and `src/nodes/s2-rm/index.html` (`outputs: 3`, output label/help text)
- [x] 3.5 Add `UpdateStatus` command handling to the `node.on('input', ...)` switch: validate `cemId`/`controlType`/namespaced payload, look up the session, call `session.updateStatus(...)`
- [x] 3.6 Add `SystemDescription` command handling to the same switch, calling `session.sendSystemDescription(...)`
- [x] 3.7 Remove `gridConnectionToWatts`-derived `pendingPEBCConstraints` default wiring sourced from `rmConfigNode.gridConnection`/`customMaxPowerW` (fields removed in 1.1) - `PowerConstraints` command remains, just without a config-driven default; `s2-pebc` supplies its own default (section 6)
- [x] 3.8 Update the wiring/I-O doc comment at the top of `src/nodes/s2-rm/index.ts` and `src/nodes/s2-rm/index.html` help text to describe the 3-output contract and the new `UpdateStatus`/`SystemDescription` commands
- [x] 3.9 Update `test/nodes/s2-rm.test.ts`: remove PEBC-schedule and OMBC-mode-resolution test coverage (moves to new node test files in sections 5/6), update all `node.send` output-index assertions for the 3-output contract, add coverage for `UpdateStatus`/`SystemDescription` command routing and `msg.controlType`-enriched instruction output

## 4. `s2-ombc-config`

- [x] 4.1 Create `src/nodes/s2-ombc-config/index.ts`: config node holding `operationModes`/`transitions`/`timers` (the `OMBCSystemDescriptionConfig` shape), server-side type in `src/types/config-nodes.ts` (`S2OmbcConfigNode`)
- [x] 4.2 Create `src/nodes/s2-ombc-config/index.html`: editor UI for operation modes (id, label, factor, power ranges) and transitions, adapted from the JSON-blob `controlTypeConfig` field previously on `s2-rm`

## 5. `s2-ombc`

- [x] 5.1 Create `src/nodes/s2-ombc/index.ts`: reads its `s2-ombc-config` reference; two inputs are implied by wiring (from `s2-rm`'s "from CEM" output and its instructions output) via a single node input, distinguished by message shape
- [x] 5.2 On seeing `SelectControlType(OPERATION_MODE_BASED_CONTROL)` (from `s2-rm`'s "from CEM" output), send `{ command: 'SystemDescription', cemId, controlType: 'OPERATION_MODE_BASED_CONTROL', ombc: {...} }` on an output wired back to `s2-rm`'s input, per the resolved design decision 7
- [x] 5.3 On an OMBC instruction (`msg.controlType === 'OPERATION_MODE_BASED_CONTROL'`), resolve the referenced mode against `s2-ombc-config`, emit `msg.topic` (mode's diagnostic label), `msg.controlType`, `msg.ombc.operationMode` (id/index/label/factor) on the instruction output
- [x] 5.4 Pass through any non-OMBC instruction unchanged and raise a `node.status()` warning (do not drop or error)
- [x] 5.5 Add a "confirm mode" input path (e.g. `msg.payload.confirmedOperationModeId` or similar) that: tracks previous mode + transition timestamp, and only when OMBC is the CEM's currently selected control type, sends `{ command: 'UpdateStatus', cemId, controlType: 'OPERATION_MODE_BASED_CONTROL', ombc: {...} }` back to `s2-rm`; otherwise raises a warning and sends nothing
- [x] 5.6 Track selected-control-type state per `cemId` (from observed `SelectControlType`/`Disconnected` events) so 5.5's guard can evaluate "OMBC is not the CEM's currently selected control type" (reconnect naturally re-triggers `SelectControlType` from the CEM, so no separate `Connected` handling is needed)
- [x] 5.7 Persist last-confirmed mode per `cemId` (node context) and resend it via `SystemDescription`+`UpdateStatus` when `SelectControlType(OMBC)` is next observed (covers reconnect), preserving the reconnect-resilience behavior previously on `s2-rm` (removed in 3.2)
- [x] 5.8 Create `src/nodes/s2-ombc/index.html`: config reference field, help text documenting wiring (from `s2-rm` "from CEM" + instructions outputs in, confirm-mode input in, instruction output out, command output back to `s2-rm`)
- [x] 5.9 Create `test/nodes/s2-ombc.test.ts` covering: system description push on control-type selection, instruction resolution/enrichment, pass-through+warning for non-OMBC instructions, status-on-confirmation-only, rejection when OMBC not selected, reconnect resend

## 6. `s2-pebc-config`

- [x] 6.1 Create `src/nodes/s2-pebc-config/index.ts`: config node holding `gridConnection`/`customMaxPowerW` (moved from `s2-rm-config`, using the existing `gridConnectionToWatts` helper), server-side type in `src/types/config-nodes.ts` (`S2PebcConfigNode`)
- [x] 6.2 Create `src/nodes/s2-pebc-config/index.html`: editor UI for grid connection preset / custom max watts, adapted from the removed fields in `s2-rm-config/index.html`

## 7. `s2-pebc`

- [x] 7.1 Create `src/nodes/s2-pebc/index.ts`: reads its `s2-pebc-config` reference; on deploy, sends `{ command: 'PowerConstraints', constraints }` (default derived via `gridConnectionToWatts`) back to `s2-rm`'s input for the "used until a runtime override is supplied" default behavior. (Required loosening `s2-rm`'s generic `cemId`-required input guard for the `PowerConstraints` command specifically, since it applies globally and is pushed before any CEM has connected - see `s2-rm/index.ts`.)
- [x] 7.2 Move `pebcSlots`/`pebcConstraintsId` accumulation logic from old `s2-rm/index.ts` (section 3.1) into `s2-pebc`: on a PEBC instruction (`msg.controlType === 'POWER_ENVELOPE_BASED_CONTROL'`), accumulate elements keyed by slot start time, clear when `power_constraints_id` changes
- [x] 7.3 Move `scheduleNextDispatch`/`emitActiveElement`/`applySchedule`/dedupe-tracking from old `s2-rm/index.ts` into `s2-pebc`, dispatching the active element (including already-active-on-receipt) on `s2-pebc`'s own output. (`InstructionStatus` STARTED, previously sent directly via the session, is now sent back to `s2-rm` via the existing generic `InstructionStatus` command.)
- [x] 7.4 Move schedule persistence (`saveSchedule`/`loadPersistedSchedule`, file under `<userDir>/.s2/<node.id>-schedule.json`) into `s2-pebc`
- [x] 7.5 Pass through any non-PEBC instruction unchanged and raise a `node.status()` warning (do not drop or error)
- [x] 7.6 Handle `RevokeObject` for a pending PEBC instruction: `s2-pebc` needs the revoked-instruction cleanup logic moved from `s2-rm/index.ts`'s `onMessage` handler (rebuild/clear `pebcSlots`) - requires `s2-pebc` to also see `RevokeObject` messages from `s2-rm`'s "from CEM" output
- [x] 7.7 Create `src/nodes/s2-pebc/index.html`: config reference field, help text documenting wiring (instructions + "from CEM" outputs in, schedule-dispatch output out, command output back to `s2-rm`)
- [x] 7.8 Move `test/lib/schedule.test.ts` scenarios and PEBC-specific cases from `test/nodes/s2-rm.test.ts` into a new `test/nodes/s2-pebc.test.ts` (`test/lib/schedule.test.ts` itself stays - `schedule.ts` is still a standalone lib, just consumed by a different node now); add coverage for the default-constraints push, revoke handling, and persistence. (Test harness isolates each node's schedule file under a fresh temp `userDir` per test - the original `s2-rm.test.ts` PEBC tests lacked this and could read/write the real `~/.node-red/.s2/` directory; fixed in the new file.)

## 8. Registration and packaging

- [x] 8.1 Register `s2-ombc-config`, `s2-ombc`, `s2-pebc-config`, `s2-pebc` in `package.json`'s `node-red.nodes` map
- [x] 8.2 Verify `scripts/copy-html.js` and `scripts/check-package-files.js` pick up the new node directories without hardcoded lists needing changes (update if they hardcode node names) - confirmed both derive node names from `package.json`'s `node-red.nodes` map, no hardcoded lists
- [x] 8.3 Run `npm run build` and `npm run check-package-files` to confirm the new nodes package correctly

## 9. Example flows

- [x] 9.1 Update `examples/boiler-ombc-demo.json` to the new node topology (`s2-rm` + `s2-ombc` + `s2-ombc-config`, with `s2-rm-config` trimmed). Also added a "Confirm mode achieved" change node simulating instant hardware feedback, since `s2-ombc` now sends `OMBC.Status` only on explicit confirmation rather than automatically.
- [x] 9.2 Review `examples/pebc-instruction-tester.json` - confirmed it's CEM-side/HTTP-only, wires no RM nodes and references no old `s2-rm` output/field shape; no changes needed

## 10. Documentation

- [x] 10.1 Update `README.md`'s node table, Quick start wiring steps, and any PowerConstraints/PowerMeasurement examples to reflect the 3-output `s2-rm`, new `s2-ombc`/`s2-ombc-config`/`s2-pebc`/`s2-pebc-config` nodes, and trimmed `s2-rm-config`

## 11. Full verification

- [x] 11.1 `npm run lint` (0 errors; 5 pre-existing warnings in `test/lib/reconnect.test.ts`, unrelated to this change)
- [x] 11.2 `npm run test:unit` (254/254 tests green across 10 suites)
- [x] 11.3 Deployed `examples/boiler-ombc-demo.json` into a real Node-RED 4.1.10 instance (scratch userDir, package installed via `npm install <repo>`): all 8 node types register with no "missing type" errors, editor HTML/CSS/icon assets serve correctly (`/resources/...`, `/icons/...`), and the flow starts and runs cleanly (transport connect/disconnect, and the periodic PowerMeasurement pipeline through the new node graph, all behave as expected with no real CEM attached). The full OMBC golden path (CEM selects OMBC -> system description push -> instruction resolution -> simulated confirm -> UpdateStatus) was **not** exercised live - that requires a running CEM (real or mock) to connect to, which wasn't available in this environment. Recommend the user do a live end-to-end check against their actual CEM before relying on this in production.
