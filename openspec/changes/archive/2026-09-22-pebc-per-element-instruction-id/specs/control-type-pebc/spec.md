## ADDED Requirements

### Requirement: Per-element instruction attribution in flattened schedule output
Whenever `s2-pebc` flattens its accumulated per-slot schedule into a single schedule object for output or persistence - the persisted schedule file, the flow-context schedule snapshot, and output port 2's schedule dump - each element in that schedule's `elements` array SHALL include the `instructionId` of the PEBC instruction that produced it, in addition to the schedule's existing top-level `instructionId`.

#### Scenario: Schedule spans elements from two different instructions
- **WHEN** a second PEBC instruction with a different `id` arrives, contributes elements at slot start times not already occupied, and both instructions' elements remain accumulated under the same `power_constraints_id`
- **THEN** the flattened schedule's `elements` array contains each element tagged with the `instructionId` of the instruction that produced it, not a single ID shared across all elements

#### Scenario: Schedule still contains elements from only one instruction
- **WHEN** all currently accumulated elements originated from a single PEBC instruction
- **THEN** every element's `instructionId` equals the schedule's top-level `instructionId`
