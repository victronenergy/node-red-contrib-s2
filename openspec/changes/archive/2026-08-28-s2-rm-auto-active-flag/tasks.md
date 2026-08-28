## 1. Implementation

- [x] 1.1 In `src/nodes/s2-rm/index.ts`'s `onMessage` handler, after existing `SELECT_CONTROL_TYPE` handling, emit `{ payload: { 'S2/0/Active': isActive ? 1 : 0 } }` on output port 1, where `isActive` is `control_type !== ControlType.NO_SELECTION && control_type !== ControlType.NOT_CONTROLABLE`
- [x] 1.2 Update the node's top-of-file docblock ("Output port 1") to document this write

## 2. Tests

- [x] 2.1 `test/nodes/s2-rm.test.ts`: SelectControlType with an active control type (e.g. OMBC) emits `S2/0/Active: 1` on port 1
- [x] 2.2 `test/nodes/s2-rm.test.ts`: SelectControlType with `NO_SELECTION` or `NOT_CONTROLABLE` emits `S2/0/Active: 0` on port 1
- [x] 2.3 `test/nodes/s2-rm.test.ts`: confirm existing port-1 behavior (`s2Signal: 'Message'`, `PowerMeasurementStart`) is unaffected

## 3. Verification

- [x] 3.1 `npm run lint`
- [x] 3.2 `npm run build`
- [x] 3.3 `npm test`
