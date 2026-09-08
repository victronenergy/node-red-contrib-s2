## Purpose

Defines the behavior of the `s2-pebc` node: accumulating power envelope schedules from PEBC instructions and dispatching the currently active bound to the user's flow as it becomes effective.

## ADDED Requirements

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

### Requirement: Pass-through of non-PEBC instructions
`s2-pebc` SHALL pass through any instruction that is not a PEBC instruction unchanged, and SHALL raise a node status warning rather than silently dropping it or raising an error.

#### Scenario: An OMBC instruction reaches s2-pebc
- **WHEN** a non-PEBC instruction is received at `s2-pebc`
- **THEN** the message is forwarded unchanged and the node's status shows a warning

### Requirement: Configurable default power constraints
`s2-pebc-config` SHALL provide a default power constraint range (derived from a configured grid connection or explicit wattage), used until a runtime override is supplied.

#### Scenario: No runtime override has been supplied
- **WHEN** a CEM selects `POWER_ENVELOPE_BASED_CONTROL` and no runtime power constraints have been set
- **THEN** the CEM receives power constraints matching `s2-pebc-config`'s configured default
