## Why

The hardware an `s2-pebc` flow controls often exposes only one settable power/current limit, not independent import and export limits. A PEBC power envelope can be asymmetric (different `lower_limit`/`upper_limit`), so applying only `upperBound` - as `s2-pebc` does today - silently leaves the export side of the envelope unenforced whenever it is tighter than the import side. Since the flow already knows its current net power measurement (the same signed convention as the envelope bounds), `s2-pebc` can resolve which bound is presently binding and let the flow apply the right one to its single actuator.

## What Changes

- `s2-pebc` accepts an optional `PowerMeasurement` command on its input (the same message shape already sent to `s2-rm`), and tracks the latest signed value per `commodity_quantity`.
- Active-element messages on output 1 (including the released/`null`-bound case) gain two fields: `direction` (`'import'` or `'export'`, from the sign of the last known measurement, defaulting to `'import'` when no measurement has been observed) and `limitW` (the magnitude, in watts, of whichever bound applies to that direction).
- `s2-pebc` re-announces the active element on output 1 (only - no `InstructionStatus` resend on output 3) when an incoming measurement changes `direction` for an asymmetric active element, independent of any schedule change.
- Purely additive and opt-in by wiring: a flow that never routes `PowerMeasurement` into `s2-pebc` sees no behavior change beyond the two new fields always being present with `direction: 'import'` (matching today's import-only behavior).

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `control-type-pebc`: active-element dispatch gains direction-aware limit resolution, and `s2-pebc` gains a `PowerMeasurement` input.

## Impact

- `src/nodes/s2-pebc/index.ts` (input handling, active-element/released emission, new direction/limit resolution)
- `src/nodes/s2-pebc/index.html` (help text)
- `test/nodes/s2-pebc.test.ts`
- `README.md`
- No breaking changes: existing `lowerBound`/`upperBound`/`commodityQuantity` fields are unchanged; `direction`/`limitW` are additive.
