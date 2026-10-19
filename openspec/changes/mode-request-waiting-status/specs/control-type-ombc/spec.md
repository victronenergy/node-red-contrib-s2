## ADDED Requirements

### Requirement: Waiting status lasts until a mode is confirmed
From behaviour version 0.9.7, once a `ModeRequest` has been emitted for a CEM, an `OMBC.Instruction` from that CEM SHALL show `instructed: <label> - waiting for ModeConfirmation` in yellow, until a mode is confirmed for that CEM (by a `ModeConfirmation` or by auto-confirm), which shows `Confirmed: <label>` in green. Switching that CEM to another control type SHALL also end the wait. A node without a behaviour version SHALL show an instruction's label in green as before.

#### Scenario: Instruction before the first confirmation
- **WHEN** a node at 0.9.7 with auto-confirm off has emitted a `ModeRequest`, and the CEM then sends an `OMBC.Instruction` for `On`
- **THEN** the status shows `instructed: On - waiting for ModeConfirmation`, yellow, and the `ModeInstruction` is emitted as usual

#### Scenario: Confirmation after the instruction
- **WHEN** the flow then sends a `ModeConfirmation` for `On`
- **THEN** the status shows `Confirmed: On`, green, and a later instruction shows its label in green

#### Scenario: Auto-confirm
- **WHEN** auto-confirm is on and an instruction arrives after a `ModeRequest`
- **THEN** the instruction is confirmed right away and the status shows `Confirmed: <label>`, green

#### Scenario: Node without a behaviour version
- **WHEN** a node without a version receives an instruction after its `ModeRequest`
- **THEN** the status shows the instructed label in green, as before
