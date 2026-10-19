## 1. Tests first

- [x] 1.1 `test/nodes/s2-resource.test.ts`: connected + confirmed -> `CEM connected (...) | Confirmed: ...`, green; waiting for ModeConfirmation -> yellow, connection text kept; disconnect after confirm -> waiting-for-CEM text with `| Confirmed: ...`; nothing to report -> connection text only; Control type None -> unchanged.

## 2. Implementation

- [x] 2.1 In `src/nodes/s2-resource/index.ts`: keep a connection slot and a control-type slot and render them together; route the RM wrapper and transport status writes to the connection slot, and the OMBC controller's to the control-type slot.

## 3. Verify, docs, validation

- [x] 3.1 Real runtime check: status on the canvas for a connected resource with a confirmed mode (not cut off in an unreadable way).
- [x] 3.2 CHANGELOG; `npm test`, `npm run build` pass; `openspec validate resource-status-both --strict` passes.
