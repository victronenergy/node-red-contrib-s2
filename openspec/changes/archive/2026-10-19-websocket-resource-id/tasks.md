## 1. Shared validation

- [x] 1.1 Tests in `test/resources/s2-common.test.ts`: `isUuid` (any version, case-insensitive; rejects non-UUIDs); `validateResourceId` returns true for empty, a UUID and `my-heatpump-01`; a message for spaces, 1 or 65 characters, and an ID another `s2-resource`/`s2-rm-config` holds; true when only the node itself holds it.
- [x] 1.2 Implement `isUuid` and `validateResourceId` in `resources/s2-common.js`.

## 2. Editor

- [x] 2.1 Move `#node-input-resourceId` from the hidden RM-tab input to a text field under the CEM picker in the WebSocket section, with label icon and tooltip.
- [x] 2.2 Add `validate` (two arguments) on the `resourceId` default, calling `validateResourceId`.
- [x] 2.3 Live non-UUID warning under the field (`.s2-form` scoped style in `s2-styles.css`), updated on input and on dialog open.
- [x] 2.4 `oneditsave`: generate a new ID when the field is empty.
- [x] 2.5 Verify with Playwright: field visible only for WebSocket; switching transport keeps the value; invalid characters and a duplicate give a red triangle with the message; a non-UUID shows the warning; emptied field saves a new UUID; D-Bus dialog unchanged.

## 3. Docs

- [x] 3.1 `s2-resource` help text (Connection tab), README, CHANGELOG.

## 4. Validation

- [x] 4.1 `npm test` and `npm run build` pass.
- [x] 4.2 `openspec validate websocket-resource-id --strict` passes.
