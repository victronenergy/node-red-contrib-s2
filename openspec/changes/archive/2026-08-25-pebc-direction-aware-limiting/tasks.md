## 1. Core implementation

- [x] 1.1 Add `PowerMeasurement` command handling to `s2-pebc`'s input dispatcher, tracking the latest signed value per `commodity_quantity`
- [x] 1.2 Add `resolveDirection(commodityQuantity)` and `resolveLimitW(direction, lowerBound, upperBound)` helpers
- [x] 1.3 Enrich `emitActiveElement`'s output 1 message with `direction`/`limitW`
- [x] 1.4 Enrich `emitReleased`'s output 1 message with `direction`/`limitW`
- [x] 1.5 Add a measurement-driven re-announcement path, separate from `lastEmittedActive`: on a `PowerMeasurement` that flips `direction` for the currently active element, re-emit output 1 only (no `InstructionStatus` on output 3), unless the import-side and export-side `limitW` would be equal

## 2. Tests

- [x] 2.1 No measurement observed yet: `direction` is `'import'`, `limitW` equals `upperBound`
- [x] 2.2 Last known measurement is negative: `direction` is `'export'`, `limitW` equals `Math.abs(lowerBound)`
- [x] 2.3 Released state (`lowerBound`/`upperBound` both `null`): `limitW` is `null` regardless of `direction`
- [x] 2.4 Measurement flips direction on an asymmetric active element: output 1 re-emitted with updated `direction`/`limitW`, output 3 receives no `InstructionStatus`
- [x] 2.5 Measurement flips sign but import/export limits are equal (symmetric bounds, or released): no re-emit

## 3. Documentation

- [x] 3.1 Update `s2-pebc`'s module JSDoc (wiring, input, output port 1 shape) in `src/nodes/s2-pebc/index.ts`
- [x] 3.2 Update `s2-pebc`'s editor help text in `src/nodes/s2-pebc/index.html`
- [x] 3.3 Update `README.md` to document the optional `PowerMeasurement` input and the `direction`/`limitW` fields

## 4. Verification

- [x] 4.1 `npm run lint`
- [x] 4.2 `npm test`
- [x] 4.3 `npm run build`
