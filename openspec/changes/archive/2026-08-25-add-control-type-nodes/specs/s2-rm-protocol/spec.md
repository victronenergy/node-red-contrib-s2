## Purpose

Defines the generic S2 protocol behavior of the `s2-rm` node: session lifecycle, control-type selection, and instruction acknowledgment/routing, independent of any specific control type's semantics.

## ADDED Requirements

### Requirement: Session handshake and identity exchange
The RM SHALL initiate the S2 handshake when a CEM connects, and SHALL send its `ResourceManagerDetails` once the CEM's `HandshakeResponse` is received.

#### Scenario: CEM connects and completes handshake
- **WHEN** a `Connect` command is received for a CEM and that CEM replies with `HandshakeResponse`
- **THEN** the RM sends `ResourceManagerDetails` to the CEM and the session is marked connected

### Requirement: Control-type selection without control-type-specific behavior
The RM SHALL acknowledge `SelectControlType` and SHALL NOT itself send any control-type-specific system description or status message. Providing those is the responsibility of a dedicated control-type node (see `control-type-ombc`, `control-type-pebc`).

#### Scenario: CEM selects a control type
- **WHEN** the CEM sends `SelectControlType` for any control type
- **THEN** the RM sends `ReceptionStatus(OK)` and forwards the message on its "from CEM" output, without sending a system description or status message itself

### Requirement: Instruction acknowledgment and enriched routing
On receiving any instruction message, the RM SHALL send `ReceptionStatus(OK)` and `InstructionStatusUpdate(ACCEPTED)` (unless status updates are configured off), then emit the instruction on its instructions output enriched with the resolved control type.

#### Scenario: Instruction received for a known control type
- **WHEN** the CEM sends an instruction message for a supported control type
- **THEN** the RM acknowledges it and emits it on the instructions output with `msg.controlType` set to that control type and the instruction payload namespaced under the matching key (e.g. `msg.ombc`, `msg.pebc`)

### Requirement: Fixed three-output contract
The RM SHALL expose exactly three outputs - to transport, from CEM, and instructions - regardless of which control types are configured or connected. No control-type-specific output port SHALL exist on this node.

#### Scenario: PEBC control type in use
- **WHEN** the RM is configured with `POWER_ENVELOPE_BASED_CONTROL` as an available control type
- **THEN** the RM still exposes only three outputs; PEBC-specific schedule data is not emitted from `s2-rm` itself

### Requirement: Generic status update command
The RM SHALL accept an `UpdateStatus` command containing a control-type-namespaced status payload and a `cemId`, and SHALL send the corresponding S2 status message to that CEM's session.

#### Scenario: Control-type node reports confirmed state
- **WHEN** an `UpdateStatus` command is received for a connected CEM with a namespaced status payload
- **THEN** the RM sends the corresponding status message (e.g. `OMBC.Status`) to that CEM

### Requirement: Generic system description command
The RM SHALL accept a `SystemDescription` command containing a control-type-namespaced system description payload and a `cemId`, and SHALL send the corresponding S2 system description message to that CEM's session.

#### Scenario: Control-type node pushes its system description
- **WHEN** a `SystemDescription` command is received for a connected CEM with a namespaced system description payload
- **THEN** the RM sends the corresponding system description message (e.g. `OMBC.SystemDescription`) to that CEM
