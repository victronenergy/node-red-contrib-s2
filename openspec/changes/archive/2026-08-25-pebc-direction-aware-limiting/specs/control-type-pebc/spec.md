## ADDED Requirements

### Requirement: Direction-aware limit resolution
`s2-pebc` SHALL accept a `PowerMeasurement` command on its input, matching the command already sent to `s2-rm`, and SHALL track the latest signed value per `commodity_quantity`. Every active-element message on output 1 - including the released (`null`-bound) state - SHALL include a `direction` field (`'import'` or `'export'`, derived from the sign of the last known measurement for that element's commodity quantity, defaulting to `'import'` when no measurement has been observed) and a `limitW` field (the magnitude, in watts, of whichever bound applies to that direction: `upperBound` for `'import'`, the absolute value of `lowerBound` for `'export'`).

#### Scenario: No measurement observed yet
- **WHEN** an active element is emitted and no `PowerMeasurement` has been received for its commodity quantity
- **THEN** `direction` is `'import'` and `limitW` equals `upperBound`

#### Scenario: Last known measurement is exporting
- **WHEN** an active element is emitted and the last known measurement for its commodity quantity is negative
- **THEN** `direction` is `'export'` and `limitW` equals the absolute value of `lowerBound`

#### Scenario: Relevant bound is unbounded
- **WHEN** the bound corresponding to the resolved `direction` is `null` (including the released state, where both bounds are `null`)
- **THEN** `limitW` is `null`

### Requirement: Direction-change re-announcement
`s2-pebc` SHALL re-emit the currently active element on output 1 - without resending `InstructionStatus` on output 3 - when an incoming `PowerMeasurement` changes the resolved `direction` for that element, unless the import-side and export-side limits resolve to the same `limitW`.

#### Scenario: Measurement flips direction on an asymmetric bound
- **WHEN** a `PowerMeasurement` arrives whose sign differs from the direction last announced for the active element, and that element's import-side and export-side limits differ
- **THEN** `s2-pebc` re-emits the active element on output 1 with the updated `direction` and `limitW`, and does not send `InstructionStatus` on output 3

#### Scenario: Measurement flips sign but the limit would not change
- **WHEN** a `PowerMeasurement` arrives whose sign differs from the direction last announced, but the active element's import-side and export-side limits are equal (symmetric bounds, or both bounds `null`)
- **THEN** `s2-pebc` does not re-emit
