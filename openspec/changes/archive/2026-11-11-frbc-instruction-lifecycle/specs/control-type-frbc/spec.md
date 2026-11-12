## MODIFIED Requirements

### Requirement: Confirmed instruction reported as succeeded
On an `ActuatorConfirmation`, `s2-frbc` SHALL send `InstructionStatus SUCCEEDED` for every open instruction of that actuator with the same mode and factor, and `ABORTED` for every older open instruction of that actuator that asked for something else. Each instruction SHALL receive at most one final status.

#### Scenario: Confirmation closes the instruction
- **WHEN** an `ActuatorInstruction` for actuator A, mode `heat`, factor 1 was emitted and the flow wires that payload back as `ActuatorConfirmation`
- **THEN** an `InstructionStatus` command with status `SUCCEEDED` is sent for that instruction's id

#### Scenario: Repeated instructions for the same mode
- **WHEN** three instructions for actuator A, mode `off`, factor 1 are open and one `ActuatorConfirmation` for A, `off`, factor 1 arrives
- **THEN** all three are reported `SUCCEEDED`

## ADDED Requirements

### Requirement: Overtaken instructions aborted
When `s2-frbc` emits an instruction for an actuator, it SHALL send `ABORTED` for every open, unconfirmed earlier instruction of that actuator that asked for another operation mode. An earlier instruction for the same mode SHALL stay open.

#### Scenario: Plan switches the actuator before the flow confirmed
- **WHEN** an instruction for actuator A, mode `heat` is open and an instruction for A, mode `off` arrives
- **THEN** the `heat` instruction is reported `ABORTED`

### Requirement: Revoke after an instruction reached the flow
When the CEM revokes an `FRBC.Instruction` that `s2-frbc` already emitted and that has no final status yet, `s2-frbc` SHALL send `InstructionStatus REVOKED` for it and emit `{ topic: 'Revoked', payload: { instructionId, actuatorId, operationModeId, factor }, cemId }`. A revoke for an instruction it never emitted SHALL be ignored.

#### Scenario: Re-plan revokes the running instruction
- **WHEN** the CEM sends `RevokeObject` for an instruction that was emitted as `ActuatorInstruction`
- **THEN** the CEM receives `REVOKED` for it and the flow receives a `Revoked` message

### Requirement: Open instructions aborted when FRBC control ends
`s2-frbc` SHALL send `ABORTED` for its open instructions when the CEM selects another control type, and for the oldest open instruction when more than 50 are open. When the session ends (`Disconnected`, `Connected`) it SHALL drop open instructions without a status.

#### Scenario: CEM stops FRBC control
- **WHEN** an instruction is open and the CEM selects `NOT_CONTROLABLE`
- **THEN** that instruction is reported `ABORTED`
