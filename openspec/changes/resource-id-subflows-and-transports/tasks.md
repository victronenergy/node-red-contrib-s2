## 1. Registry

- [x] 1.1 Tests: `rm` and `transport` claims for the same ID by different owners don't conflict; two `transport` claims do; release is per kind; `unresolvedEnvVar` returns the name for `${NAME}` and null for anything else.
- [x] 1.2 Add the claim kind to `claimResourceId`/`releaseResourceId` (default `rm`, so existing callers keep their meaning) and `unresolvedEnvVar` to `src/lib/s2/resource-id-registry.ts`.

## 2. Runtime nodes

- [x] 2.1 Tests `s2-resource`: refused when a transport claim is held (WebSocket and D-Bus); External doesn't claim a transport; unresolved `${NAME}` refused with the variable named and red `resource ID variable not set`; release happens even if a transport's `disconnect()` throws; the duplicate error says to deploy it again.
- [x] 2.2 Implement in `src/nodes/s2-resource/index.ts`.
- [x] 2.3 Tests `s2-rm`: unresolved `${NAME}` refused; release first; error guidance.
- [x] 2.4 Implement in `src/nodes/s2-rm/index.ts`.
- [x] 2.5 Tests `s2-websocket`: claims a transport; a second one for the same ID is refused and never connects; an `s2-rm` on the same config doesn't conflict; unresolved `${NAME}` refused; release on close before disconnect.
- [x] 2.6 Implement in `src/nodes/s2-websocket/index.ts`.

## 3. Editor

- [x] 3.1 Tests in `test/resources/s2-common.test.ts`: `isEnvRef`; `resourceIdNeedsReplacing` keeps `${NAME}`; `validateResourceId` accepts `${NAME}` even when shared and rejects `${}`/`${A B}`; `watchResourceIds` only touches nodes marked `changed` (replace the `flowsLoaded` tests).
- [x] 3.2 Implement in `resources/s2-common.js`; drop the `flowsLoaded` flag.
- [x] 3.3 `s2-resource` editor: show the Resource ID field for any transport inside a subflow template; skip the non-UUID warning for `${NAME}`.
- [x] 3.4 Verify with Playwright: field in a subflow with D-Bus; a subflow with two instances setting different `S2_RESOURCE_ID` both start (External transport) and one without it is refused; copy-paste keeps `${NAME}`; a reload of the deployed flows (`RED.nodes.clear()` + `RED.nodes.import`, as in the deploy-conflict path) leaves deployed duplicates alone; copy-paste and palette drop still regenerate.

## 4. Docs

- [x] 4.1 Help texts (`s2-resource`, `s2-rm`, `s2-websocket`), README, CHANGELOG (incl. the `s2-dbus` limitation).

## 5. Validation

- [x] 5.1 `npm test`, `npm run build`, `check-package-files` pass.
- [x] 5.2 `openspec validate resource-id-subflows-and-transports --strict` passes.
