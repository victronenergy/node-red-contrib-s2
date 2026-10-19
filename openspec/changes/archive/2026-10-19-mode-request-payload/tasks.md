## 1. Tests first

- [x] 1.1 `test/nodes/s2-ombc.test.ts`: at `version: '0.9.7'` (and a later release), a `ModeRequest` payload has a `message` string and `modes` with `{ id, index, label }` for each configured mode (label falls back to the id), the status becomes yellow `waiting for ModeConfirmation`, and a mode from `payload.modes` sent back as a `ModeConfirmation` confirms it. Without a version: `payload: null`, no status change. Same through `s2-resource`'s built-in OMBC.
- [x] 1.2 Keep the existing `ModeRequest` tests, which have no version, asserting `payload: null`.

## 2. Implementation

- [x] 2.1 `ombc-controller.ts`: option for the 0.9.7 `ModeRequest`; build the payload and set the status.
- [x] 2.2 `s2-ombc`/`s2-resource` runtime: pass `versionAtLeast(config.version, DESCRIBED_MODE_REQUEST_SINCE)`; add `behaviour-version.ts` and its editor counterpart, with tests.
- [x] 2.3 Editor: `version: { value: '0.9.7' }` default; notice with "Update to latest" when the node has no version (for `s2-resource` only with Control type OMBC); set `this.version` in `oneditsave` only when requested. No `node-input-version` field.
- [x] 2.4 Shipped examples: `"version": "0.9.7"` on their `s2-ombc`/`s2-resource` nodes.
- [x] 2.5 Verify with Playwright: palette node gets version `0.9.7`; an old node opened and saved keeps no version; "Update to latest" + Done sets `0.9.7`; the notice only shows for OMBC.

## 3. Docs and validation

- [x] 3.1 Help texts (`s2-ombc`, `s2-resource`), README, CHANGELOG.
- [x] 3.2 `npm test`, `npm run build` pass; `openspec validate mode-request-payload --strict` passes.
