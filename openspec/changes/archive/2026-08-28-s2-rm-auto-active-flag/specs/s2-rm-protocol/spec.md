## ADDED Requirements

### Requirement: Transport Active flag reflects control-type selection
On every `SelectControlType` message, in addition to its existing acknowledgment behavior, the RM SHALL emit a `/S2/0/Active` write on its transport output: `1` when the newly selected control type is anything other than `NO_SELECTION` or `NOT_CONTROLABLE`, and `0` when it is `NO_SELECTION` or `NOT_CONTROLABLE`. This write requires no dedicated output port or `cemId`.

#### Scenario: CEM selects an active control type
- **WHEN** the CEM sends `SelectControlType` with a control type other than `NO_SELECTION` or `NOT_CONTROLABLE`
- **THEN** the RM emits `{ payload: { 'S2/0/Active': 1 } }` on its transport output

#### Scenario: CEM deselects control
- **WHEN** the CEM sends `SelectControlType` with `NO_SELECTION` or `NOT_CONTROLABLE`
- **THEN** the RM emits `{ payload: { 'S2/0/Active': 0 } }` on its transport output
