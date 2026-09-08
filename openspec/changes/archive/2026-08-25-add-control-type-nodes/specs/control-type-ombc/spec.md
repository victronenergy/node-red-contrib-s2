## Purpose

Defines the behavior of the `s2-ombc` node: declaring OMBC operation modes to the CEM, resolving OMBC instructions into actionable events, and confirming operation mode changes back to the CEM once hardware state is confirmed.

## ADDED Requirements

### Requirement: OMBC system description from configuration
`s2-ombc` SHALL derive the OMBC system description (operation modes and transitions) from its `s2-ombc-config` node. When it observes, on `s2-rm`'s "from CEM" output, that a CEM has selected `OPERATION_MODE_BASED_CONTROL`, it SHALL push that system description back to `s2-rm` via a `SystemDescription` command for `s2-rm` to send to that CEM.

#### Scenario: OMBC becomes the active control type
- **WHEN** the CEM selects `OPERATION_MODE_BASED_CONTROL` as its control type
- **THEN** `s2-ombc` sends a `SystemDescription` command to `s2-rm` for that CEM, and the CEM receives a system description whose operation modes and transitions match `s2-ombc-config`

### Requirement: Instruction resolution into actionable output
On receiving an OMBC instruction, `s2-ombc` SHALL resolve the referenced operation mode against its configuration and emit it on its instruction output with a routable topic and the resolved mode detail.

#### Scenario: OMBC instruction selects a configured mode
- **WHEN** an OMBC instruction referencing a configured operation mode arrives at `s2-ombc`
- **THEN** the node emits a message with `msg.topic` set to that mode's diagnostic label, `msg.controlType` set to `OPERATION_MODE_BASED_CONTROL`, and `msg.ombc.operationMode` containing the mode's id, index, label, and factor

### Requirement: Pass-through of non-OMBC instructions
`s2-ombc` SHALL pass through any instruction that is not an OMBC instruction unchanged, and SHALL raise a node status warning rather than silently dropping it or raising an error.

#### Scenario: A PEBC instruction reaches s2-ombc
- **WHEN** a non-OMBC instruction is received at `s2-ombc`
- **THEN** the message is forwarded unchanged and the node's status shows a warning

### Requirement: Status is sent only on explicit confirmation
`s2-ombc` SHALL send `OMBC.Status` to the CEM only when explicitly told the operation mode is confirmed, not automatically when an instruction is accepted. When the confirmed mode differs from the previously confirmed mode, the status SHALL include the previous mode id and a transition timestamp.

#### Scenario: Confirmed mode change
- **WHEN** `s2-ombc` is told the active mode has changed to a new configured mode
- **THEN** it sends `OMBC.Status` with the new mode as active, the prior mode as `previous_operation_mode_id`, and a `transition_timestamp`

#### Scenario: Instruction accepted but not yet confirmed
- **WHEN** an OMBC instruction has been acknowledged by `s2-rm` but `s2-ombc` has not been told the mode changed
- **THEN** no `OMBC.Status` message is sent

### Requirement: Reject status updates outside the active control type
`s2-ombc` SHALL reject a confirmed-mode update and raise a warning if OMBC is not the CEM's currently selected control type, instead of sending an invalid status message.

#### Scenario: Confirmation arrives while OMBC is not selected
- **WHEN** `s2-ombc` is told a mode is confirmed but the CEM's selected control type is not `OPERATION_MODE_BASED_CONTROL`
- **THEN** no status message is sent and the node's status shows a warning
