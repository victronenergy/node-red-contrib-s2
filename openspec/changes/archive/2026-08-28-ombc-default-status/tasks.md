## 1. Mode identifier resolution

- [x] 1.1 In `src/nodes/s2-ombc/index.ts`, add a helper that resolves `confirmedOperationModeId` / `confirmedOperationModeIndex` / `confirmedOperationModeLabel` (exactly one required) against `systemDescription.operationModes` down to a canonical mode id; errors on zero or multiple identifiers given, an id matching no configured mode, an out-of-range index, or a label matching zero or more than one configured mode
- [x] 1.2 Wire `handleConfirm` to use this helper instead of reading `confirmedOperationModeId` directly

## 2. cemId resolution and default status

- [x] 2.1 Add default-status storage: a single `node.context()` key (e.g. `s2OmbcDefaultStatus`), separate from the per-CEM `PERSISTED_STATUS_KEY_PREFIX` entries
- [x] 2.2 In `handleConfirm`, when `cemId` is omitted: resolve against CEMs currently in `cemStates` with `selectedControlType === ControlType.OMBC`; zero matches stores the default, one match proceeds as if that `cemId` were given, more than one errors
- [x] 2.3 In `handleSelectControlType`, when a CEM selects OMBC and has no persisted status of its own, seed it from the default (if any) and send `UpdateStatus` as it does today for an existing persisted status

## 3. Status request notification

- [x] 3.1 In `handleSelectControlType`, after sending `SystemDescription`, if the CEM has neither a persisted status nor a default, emit `{ topic: 'StatusRequest', cemId }` on output port 1

## 4. Documentation

- [x] 4.1 Update the node's top-of-file docblock (Input/Output sections) for the optional `cemId`, the three mode-identifier fields, and the new `StatusRequest` output message
- [x] 4.2 `README.md`, if it documents the confirm-message shape (it doesn't - no-op)

## 5. Tests

- [x] 5.1 `test/nodes/s2-ombc.test.ts`: confirm resolved by index and by label produce the same status as by id
- [x] 5.2 `test/nodes/s2-ombc.test.ts`: confirm with zero or multiple mode identifiers is rejected
- [x] 5.3 `test/nodes/s2-ombc.test.ts`: confirm with no `cemId` and exactly one CEM on OMBC applies to that CEM
- [x] 5.4 `test/nodes/s2-ombc.test.ts`: confirm with no `cemId` and no CEM on OMBC stores a default; a later `SelectControlType(OMBC)` for a fresh CEM is seeded from it
- [x] 5.5 `test/nodes/s2-ombc.test.ts`: confirm with no `cemId` and more than one CEM on OMBC is rejected
- [x] 5.6 `test/nodes/s2-ombc.test.ts`: `SelectControlType(OMBC)` with neither persisted status nor default emits `StatusRequest`; with a default or persisted status available, it does not
- [x] 5.7 `test/nodes/s2-ombc.test.ts`: existing `cemId` + `confirmedOperationModeId` confirm still behaves exactly as before (regression) - covered by the pre-existing confirm tests, unmodified except the one asserting the now-intentionally-changed no-cemId-errors behavior
- [x] 5.8 `test/nodes/s2-ombc.test.ts`: confirm with `confirmedOperationModeId` matching no configured mode is rejected
- [x] 5.9 `test/nodes/s2-ombc.test.ts`: confirm with `confirmedOperationModeIndex` out of range is rejected
- [x] 5.10 `test/nodes/s2-ombc.test.ts`: confirm with `confirmedOperationModeLabel` matching zero configured modes is rejected
- [x] 5.11 `test/nodes/s2-ombc.test.ts`: confirm with `confirmedOperationModeLabel` matching more than one configured mode is rejected

## 6. Verification

- [x] 6.1 `npm run lint`
- [x] 6.2 `npm run build`
- [x] 6.3 `npm test`
