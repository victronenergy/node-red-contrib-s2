## Purpose

Provides a single Node-RED node combining an S2 resource manager, a built-in transport, and a built-in control type, so a minimal S2 flow needs one node instead of wiring `s2-rm`, a transport node, and a control-type node together.

## ADDED Requirements

### Requirement: Composite session behavior
`s2-resource` SHALL exhibit the same session handshake, control-type selection, instruction acknowledgment/routing, and `S2/0/Active` transport signal behavior that `s2-rm-protocol` defines for `s2-rm`, without wiring a separate `s2-rm` node.

#### Scenario: CEM connects and completes handshake through s2-resource
- **WHEN** a CEM connects via `s2-resource`'s active transport and completes the S2 handshake
- **THEN** `s2-resource` sends `ResourceManagerDetails` and marks the session connected, per `s2-rm-protocol`'s handshake requirement

### Requirement: Selectable transport
`s2-resource`'s Connection tab SHALL offer a `Transport` setting of `WebSocket` (built-in - reuses the same connection fields as `s2-cem-config`) or `External` (no built-in transport).

#### Scenario: Transport set to WebSocket
- **WHEN** `s2-resource` is configured with `Transport: WebSocket` and valid connection fields
- **THEN** it connects to the configured CEM endpoint without any separate `s2-websocket` or `s2-cem-config` node in the flow

#### Scenario: Transport set to External
- **WHEN** `s2-resource` is configured with `Transport: External`
- **THEN** it exposes a "to/from transport" input/output pair carrying the same transport-agnostic message shapes `s2-rm` accepts and emits today, for wiring to any external transport node

### Requirement: Selectable control type
`s2-resource`'s Control Type tab SHALL offer a `Control type` setting of `OMBC` (built-in - reuses `s2-ombc-config`'s friendly editor as an embedded tab) or `None` (no built-in control type).

#### Scenario: Control type set to OMBC
- **WHEN** `s2-resource` is configured with `Control type: OMBC` and at least one operation mode
- **THEN** it sends the corresponding `OMBC.SystemDescription` when a CEM selects `OPERATION_MODE_BASED_CONTROL`, resolves OMBC instructions, and sends `OMBC.Status` on confirmation, per `control-type-ombc`'s requirements, without any separate `s2-ombc` or `s2-ombc-config` node in the flow

#### Scenario: Control type set to None
- **WHEN** `s2-resource` is configured with `Control type: None`
- **THEN** it exposes a "from CEM"/command input/output pair carrying the same message shapes `s2-rm`'s corresponding ports carry today, for wiring a dedicated control-type node instead

### Requirement: Port contract is a strict superset of s2-rm
When configured with `Transport: External` and `Control type: None`, `s2-resource`'s inputs, outputs, and message shapes SHALL be identical to `s2-rm`'s, so a flow using `s2-rm` today can switch to `s2-resource` in this configuration with no other changes.

#### Scenario: Both built-ins disabled
- **WHEN** `s2-resource` is configured with `Transport: External` and `Control type: None`
- **THEN** its port count, port order, and every message shape on those ports match `s2-rm`'s exactly
