## 1. Messages and session

- [x] 1.1 Add FRBC input/config types and `makeFRBCSystemDescription`, `makeFRBCLeakageBehaviour`, `makeFRBCActuatorStatus`, `makeFRBCStorageStatus`, `makeFRBCTimerStatus`, `makeFRBCUsageForecast`, `makeFRBCFillLevelTargetProfile` to `src/lib/s2/messages.ts`; each output passes `validateS2Message` (schema validity covered in `test/lib/session.test.ts`, which sends each through the validating `_send`)
- [x] 1.2 Extend `StatusPayload`/`SystemDescriptionPayload` and `S2Session.updateStatus`/`sendSystemDescription` with the `frbc` namespace (tests in `test/lib/session.test.ts`)
- [x] 1.3 `S2ResourceManager`: cover `SystemDescription`/`UpdateStatus` with `controlType: FILL_RATE_BASED_CONTROL` end to end (`test/lib/resource-manager.test.ts`)

## 2. Controller

- [x] 2.1 `src/lib/s2/frbc-controller.ts`: config parsing and cross-reference checks shared with the validation endpoint
- [x] 2.2 SelectControlType handling: push system description + leakage, replay stored state, emit `Selected`/`Deselected`
- [x] 2.3 Instruction resolution (element by fill level, power/fill-rate by factor, `values` shape), ABORTED on unknown actuator/mode
- [x] 2.4 Flow topics: `StorageStatus` (change-only), `ActuatorConfirmation` (+ TimerStatus, SUCCEEDED), `UsageForecast`, `FillLevelTargetProfile`, `TimerStatus`; cemId resolution
- [x] 2.5 Device state in node context (per-CEM: selection, last sent fill level, open instructions); status text
- [x] 2.6 Unit tests for 2.1-2.5 (`test/lib/frbc-controller.test.ts`)

## 3. Nodes and editor

- [x] 3.1 `s2-frbc-config` (index.ts + index.html): JSON code editors for system description and leakage, example template, `POST /s2/validate-frbc-config` on save, dark-mode-safe like the other dialogs
- [x] 3.2 `s2-frbc` (index.ts + index.html): thin wrapper, two outputs, help panel documenting topics and payloads
- [x] 3.3 Register both in `package.json` `node-red.nodes`; `src/types/config-nodes.ts`
- [x] 3.4 Node tests (`test/nodes/s2-frbc.test.ts`, `test/nodes/s2-frbc-config.test.ts`), lazy-load test updated

## 4. Docs and examples

- [x] 4.1 `examples/frbc-quickstart.json`: s2-dbus + s2-rm + s2-frbc + simulated buffer
- [x] 4.2 `docs/S2_REFERENCE.md`, `README.md`, `CHANGELOG.md`
- [x] 4.3 Manual test against the Rust EMS over D-Bus: EMS reports state valid and sends a plan; instructions arrive as `ActuatorInstruction`; revocations remove pending instructions. Done locally (x86 build, private bus, stand-in localsettings): handshake, FRBC selection, plan of 12 instructions, ACCEPTED/STARTED/SUCCEEDED all worked. Found and fixed: example ids must be UUIDs (s2energy parses IDs as UUIDs). Found on the Rust EMS side: `run_cem` panics on its first broadcast, and the connection times out after ~5 s (re-plan on every message, undrained signal queue)

## 5. Pre-PR review fixes

- [x] 5.1 `Connected` (reconnect without Disconnect) ends the FRBC selection like `Disconnected`
- [x] 5.2 s2-rm `ReplaySelection` command; s2-frbc requests it on start to recover the selection after a partial deploy
- [x] 5.3 Stored device state reconciled with the configuration on start
- [x] 5.4 Warning for unrecognised input; fill level stored even when no single target CEM
- [x] 5.5 Help texts of s2-rm-config, s2-resource and s2-rm updated; CHANGELOG
