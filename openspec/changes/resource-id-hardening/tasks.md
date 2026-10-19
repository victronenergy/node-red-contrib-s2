## 1. Shared runtime check

- [x] 1.1 Tests: `resourceIdProblem` returns null for a UUID, `my-heatpump-01` and the number `42`; `resource ID missing` for `''`/undefined; `resource ID variable not set` for `${A}` and `$(A)`; `invalid resource ID` for `boiler 1` and a 65-character value. `unresolvedEnvVar('$(A)')` returns `A`. `releaseAllResourceIds` frees both claim kinds of one owner only.
- [x] 1.2 Implement in `src/lib/s2/resource-id-registry.ts`.

## 2. Runtime nodes

- [x] 2.1 Tests (`s2-resource`, `s2-rm`, `s2-websocket`): empty, invalid and blank-variable IDs are refused with the right status and nothing started; a number ID starts as its string form; a setup that throws after the claim releases it (malformed CEM URL for `s2-rm`, throwing transport `connect()` for `s2-websocket` and `s2-resource`). Give the fixtures that relied on a runtime-generated ID an explicit one.
- [x] 2.2 Implement: shared check; constructor wrapper with `releaseAllResourceIds`; close handlers use `releaseAllResourceIds`.

## 3. Editor

- [x] 3.1 Tests: `isEnvRef('$(A)')` is true; `validateResourceId` accepts `$(A)`; `rmConfigSharedBy` returns the other `s2-rm` that uses the same config, or null.
- [x] 3.2 Implement in `resources/s2-common.js`; `validate` on `s2-rm`'s `rmConfig`; show `s2-resource`'s Resource ID section when its value is an environment variable reference.
- [x] 3.3 Verify with Playwright: an `${NAME}` D-Bus node outside a subflow shows the field; a pasted `s2-rm` gets the red triangle with the message (the original only after the editor re-validates it, e.g. on reload); at runtime an empty ID and a blank subflow variable are refused with `resource ID missing`, and `$(NAME)` resolves.

## 4. Docs

- [x] 4.1 Help texts, README, CHANGELOG (behaviour change for empty IDs; precise wording on copied `s2-rm`).

## 5. Validation

- [x] 5.1 `npm test`, `npm run build`, `check-package-files` pass.
- [x] 5.2 `openspec validate resource-id-hardening --strict` passes.
