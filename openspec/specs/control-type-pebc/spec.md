# control-type-pebc Specification

## Purpose
Defines the behavior of the `s2-pebc` node: accumulating power envelope schedules from PEBC instructions and dispatching the currently active bound to the user's flow as it becomes effective.
## Requirements
### Requirement: Schedule accumulation keyed by power constraints
`s2-pebc` SHALL accumulate power envelope elements from received PEBC instructions into a schedule, keyed by slot start time, and SHALL clear previously accumulated slots when the instruction's `power_constraints_id` changes.

#### Scenario: New planning period begins
- **WHEN** a PEBC instruction arrives with a `power_constraints_id` different from the one currently accumulated
- **THEN** previously accumulated slots are discarded and accumulation restarts for the new id

### Requirement: Active-slot dispatch, including not-yet-started schedules
`s2-pebc` SHALL emit the schedule's currently active element on its output when that element's start time is reached, whether or not any element was already active when the schedule was received.

#### Scenario: Schedule for a future slot with nothing currently active
- **WHEN** a PEBC instruction is received whose only element starts in the future
- **THEN** no element is emitted immediately, and the element is emitted once its start time arrives

#### Scenario: Schedule already has an active element on receipt
- **WHEN** a PEBC instruction is received whose element is already within its active window
- **THEN** that element is emitted immediately

### Requirement: Silent ignoring of non-PEBC instructions
`s2-pebc` SHALL ignore any instruction that is not a PEBC instruction, without emitting a message or raising an error, so that it can be wired in parallel with other control-type nodes downstream of the same `s2-rm` output.

#### Scenario: An OMBC instruction reaches s2-pebc
- **WHEN** a non-PEBC instruction is received at `s2-pebc`
- **THEN** the node emits nothing on output 1 and does not error

### Requirement: Configurable default power constraints
`s2-pebc-config` SHALL provide a default power constraint range (derived from a configured grid connection or explicit wattage), used until a runtime override is supplied.

#### Scenario: No runtime override has been supplied
- **WHEN** a CEM selects `POWER_ENVELOPE_BASED_CONTROL` and no runtime power constraints have been set
- **THEN** the CEM receives power constraints matching `s2-pebc-config`'s configured default

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

