## 1. Extract s2-rm's session logic

- [ ] 1.1 Write/port tests for the extracted class against `test/nodes/s2-rm.test.ts`'s existing scenarios (handshake, control-type selection, instruction ack/routing, `S2/0/Active` signal, generic `UpdateStatus`/`SystemDescription` commands) so both the class and the `s2-rm` wrapper are covered
- [ ] 1.2 Implement `S2ResourceManager` in `src/lib/s2/resource-manager.ts`: same behavior as today's `registerType` body, callback-based ("send to transport", "emit to CEM output") instead of `node.send()`
- [ ] 1.3 Rewrite `src/nodes/s2-rm/index.ts`'s `registerType` as a thin wrapper constructing `S2ResourceManager` and wiring its callbacks to the node's two ports
- [ ] 1.4 Run `test/nodes/s2-rm.test.ts` unchanged and confirm it still passes against the wrapper

## 2. Extract the shared OMBC friendly-editor widget

- [ ] 2.1 Move the friendly-editor functions (`addModeItem`, `defaultStandbyMode`, friendly/advanced conversion) out of `src/nodes/s2-ombc-config/index.html` into a shared client-side script loaded by both `s2-ombc-config` and `s2-resource`
- [ ] 2.2 Remove the "Abnormal only" checkbox and `abnormalConditionOnly`/`abnormal_condition_only` field from the widget; on load, coerce any existing `true` value to `false`
- [ ] 2.3 Update `test/nodes/s2-ombc-config.test.ts` (or equivalent) to drop abnormal-only coverage and add a case for the true-to-false coercion on open
- [ ] 2.4 Manually re-open `s2-ombc-config` in the editor and confirm the friendly editor still renders and saves identically apart from the removed checkbox

## 3. s2-resource: Connection + Resource Manager tabs

- [ ] 3.1 Write tests for RM identity handling (resourceId auto-generation, roles) reusing `s2-rm-config`'s existing test patterns, now inline in `s2-resource`
- [ ] 3.2 Write tests for `Transport: WebSocket` wiring to an `s2-cem-config` reference, and `Transport: External` exposing the transport-in/out ports with `s2-rm`-identical message shapes
- [ ] 3.3 Implement `src/nodes/s2-resource/index.ts`: constructs `S2ResourceManager`, wires transport slots to either the built-in WebSocket client or external ports per `Transport`
- [ ] 3.4 Implement `src/nodes/s2-resource/index.html`'s Connection and Resource Manager tabs (RM name, resourceId, roles; Transport select; CEM config-node picker with edit pencil; keep-alive)

## 4. s2-resource: Control Type tab

- [ ] 4.1 Write tests for `Control type: OMBC` wiring the built-in operation-mode config into `S2ResourceManager`'s CEM-output path, and `Control type: None` exposing the CEM-in/out ports with `s2-rm`-identical message shapes
- [ ] 4.2 Implement the OMBC wiring path in `src/nodes/s2-resource/index.ts`, reusing the shared widget's saved-`systemDescription` shape directly (no `s2-ombc-config` node instance)
- [ ] 4.3 Implement `src/nodes/s2-resource/index.html`'s Control Type tab: Control type select, embedded OMBC friendly editor (via the shared script from task 2.1), "None" panel matching the mockup's explanatory text

## 5. Port contract and dynamic ports

- [ ] 5.1 Write a test asserting `Transport: External` + `Control type: None` produces the exact same port count, order, and message shapes as `s2-rm` (per the `s2-resource` spec's port-contract requirement)
- [ ] 5.2 Implement `oneditsave` port recomputation from the two selects, following `victron-virtual`'s existing dynamic-outputs pattern, changing `node.inputs`/`node.outputs` only when the resolved slot exposure actually differs from the last-deployed state

## 6. Integration and docs

- [ ] 6.1 Register `s2-resource` in `package.json`'s `node-red.nodes` map
- [ ] 6.2 Update `docs/S2_REFERENCE.md` to introduce `s2-resource` as the recommended starting point, with `s2-rm` + individual nodes kept as the manually-wired/advanced path
- [ ] 6.3 Add an example flow showing the 6-node OMBC quickstart collapsed to `s2-resource` alone (`Transport: WebSocket`, `Control type: OMBC`)
- [ ] 6.4 Run `npm test` and confirm lint + full suite pass
