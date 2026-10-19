## 1. Tests first

- [x] 1.1 `test/nodes/s2-ombc.test.ts`: request -> instruction -> confirmation at 0.9.7 (yellow "instructed: ... - waiting for ModeConfirmation", then green "Confirmed: ...", then a later instruction green); auto-confirm path; legacy node unchanged; switching control type ends the wait.

## 2. Implementation

- [x] 2.1 `ombc-controller.ts`: per-CEM "awaiting confirmation" state, set when a 0.9.7 `ModeRequest` is emitted, cleared on a successful confirm or a control-type switch; instruction status uses it.

## 3. Docs and validation

- [x] 3.1 CHANGELOG (extend the unreleased `ModeRequest` entry); `npm test`, `npm run build` pass; `openspec validate mode-request-waiting-status --strict` passes; no new strict warnings once archived.
