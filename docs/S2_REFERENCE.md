# S2 Protocol Reference

This document is the starting point for understanding the S2 protocol as implemented in this package.
It covers the standard, the Venus OS D-Bus transport variant, the message flow, and known open questions.

---

## What is S2?

S2 (EN 50491-12-2) is a European standard for demand-side flexibility. It defines a protocol between:

- **CEM** (Customer Energy Manager) - the controller that optimizes energy use in a building
- **RM** (Resource Manager) - a device that exposes its flexibility to the CEM (e.g. EV charger, heat pump, battery)

The RM offers one or more **Control Types** that describe how its flexibility can be described and controlled:

| Control Type | Abbreviation | Description |
|---|---|---|
| Operation Mode Based Control | OMBC | Discrete operation modes with power ranges |
| Fill Rate Based Control | FRBC | Buffer/storage fill-rate model |
| Demand Driven Based Control | DDBC | Demand-driven actuator control |
| Power Envelope Based Control | PEBC | Power envelope constraints |
| Power Profile Based Control | PPBC | Fixed power profiles |

This package currently implements **OMBC** as RM.

---

## Specification Sources

| Resource | URL / path |
|---|---|
| S2 standard website | https://s2standard.org/ |
| S2 model reference docs | https://docs.s2standard.org/model-reference/reading-this-documentation/ |
| s2-ws-json (AsyncAPI + JSON Schema) | https://github.com/flexiblepower/s2-ws-json - checked out at `~/git/s2-ws-json` |
| s2python (CEM-side pydantic models) | https://github.com/flexiblepower/s2python - checked out at `~/git/s2-python` |
| Venus OS D-Bus S2 Interface wiki | https://github.com/victronenergy/venus/wiki/Venus-OS-D%E2%80%90Bus-S2-Interface |
| venus-s2-tools (sniffer + CEM CLI) | `~/git/venus-s2-tools` |

The `s2-ws-json` JSON schemas and `s2python` pydantic models are both authoritative sources and
**must be consulted together** - the schemas define the wire format, but s2python adds stricter
Python type constraints that can cause validation failures not visible in the JSON schema alone.

Key s2-ws-json files:
- `s2-asyncapi/s2-rm-ombc-only.yaml` - AsyncAPI spec for an RM implementing OMBC only
- `s2-json-schema/messages/OMBC.SystemDescription.schema.json`
- `s2-json-schema/messages/OMBC.Status.schema.json`
- `s2-json-schema/schemas/OMBC.OperationMode.schema.json`

Key s2python files:
- `src/s2python/ombc/ombc_operation_mode.py` - `OMBCOperationMode` pydantic model
- `src/s2python/ombc/ombc_status.py` - `OMBCStatus` pydantic model
- `src/s2python/ombc/ombc_system_description.py` - `OMBCSystemDescription` pydantic model
- `src/s2python/generated/gen_s2.py` - generated base models (field types, enums)

---

## Venus OS D-Bus Transport

Victron implements S2 over D-Bus instead of WebSocket. The interface is exposed by virtual device services
(e.g. `com.victronenergy.acload.virtual_*`) at path `/S2/0/Rm`, interface `com.victronenergy.S2`.

### D-Bus Methods (CEM -> RM)

| Member | Signature | Description |
|---|---|---|
| `Connect` | `(s client_id, i keep_alive_interval)` | CEM connects, declares keep-alive interval in seconds |
| `Disconnect` | `(s client_id)` | CEM requests disconnect |
| `Message` | `(s client_id, s json_payload)` | CEM sends an S2 JSON message |
| `KeepAlive` | `(s client_id) -> b` | CEM sends periodic keep-alive; RM returns true/false |

### D-Bus Signals (RM -> CEM)

| Member | Signature | Description |
|---|---|---|
| `Message` | `(s client_id, s json_payload)` | RM sends an S2 JSON message |
| `Disconnect` | `(s client_id, s reason)` | RM initiates disconnect |

### Debugging

Use `~/git/venus-s2-tools/s2-sniffer.py` to passively capture all S2 traffic:

```bash
python3 ~/git/venus-s2-tools/s2-sniffer.py
python3 ~/git/venus-s2-tools/s2-sniffer.py --hide-reception-status --hide-keep-alive
python3 ~/git/venus-s2-tools/s2-sniffer.py --full-log-file /tmp/s2.log
```

Use `~/git/venus-s2-tools/s2-cem-cli.py` to connect as a CEM interactively:

```bash
python3 ~/git/venus-s2-tools/s2-cem-cli.py
```

Use the `mcp__venus__s2_call` MCP tool (from `~/git/mcp-venus/`) to drive S2 sessions
programmatically from Claude Code. This enables scripted testing without the interactive CLI:

```
s2_call(service, method="Connect",    cem_id, keep_alive_interval=300)
s2_call(service, method="Message",    cem_id, payload=<S2 JSON string>)
s2_call(service, method="KeepAlive",  cem_id)   # returns {"result": true/false}
s2_call(service, method="Disconnect", cem_id)
```

Use `mcp__venus__list_services` to find the right `com.victronenergy.acload.virtual_*` service name.
Note: use a long `keep_alive_interval` (e.g. 300s) during interactive testing to avoid
the RM disconnecting between steps.

---

## Message Flow

### 1. Session Establishment

```
CEM                                    RM
 |                                      |
 |-- Connect(cemId, keepAliveInterval) ->|  (D-Bus method call)
 |                                      |
 |<-- Message: Handshake ---------------| role=RM, supported_protocol_versions=[...]
 |                                      |
 |-- Message: ReceptionStatus(OK) ----> | subject_message_id = Handshake.message_id
 |-- Message: HandshakeResponse ------> | selected_protocol_version
 |                                      |
 |<-- Message: ResourceManagerDetails --| available_control_types, name, roles, ...
 |                                      |
 |-- Message: ReceptionStatus(OK) ----> |
```

Note: The CEM sends `ReceptionStatus` for the `Handshake` before sending `HandshakeResponse`.
The RM does NOT wait for that `ReceptionStatus` before sending `ResourceManagerDetails` -
it sends `ResourceManagerDetails` as soon as `HandshakeResponse` is received.

### 2. Control Type Selection (OMBC example)

```
CEM                                    RM
 |                                      |
 |-- Message: SelectControlType ------> | control_type=OPERATION_MODE_BASED_CONTROL
 |                                      |
 |<-- Message: ReceptionStatus(OK) -----| subject_message_id = SelectControlType.message_id
 |<-- Message: OMBC.SystemDescription --| operation_modes, transitions, timers
 |<-- Message: OMBC.Status -------------| active_operation_mode_id, operation_mode_factor
 |                                      |
 |-- Message: ReceptionStatus(OK) ----> | subject_message_id = OMBC.SystemDescription.message_id
```

**Open question:** The spec is ambiguous about whether the RM should wait for the CEM's
`ReceptionStatus` for `OMBC.SystemDescription` before sending `OMBC.Status`. The current
implementation sends both immediately (fire-and-forget). The reference CEM (`s2-cem-cli.py`)
accepts this. If a stricter CEM rejects it, the session should be reworked to wait for ack
before sending `OMBC.Status`.

### 3. Keep-Alive (periodic, during session)

```
CEM                                    RM
 |                                      |
 |-- KeepAlive(cemId) ----------------> |  (D-Bus method call, every keepAliveInterval seconds)
 |<-- reply: true ----------------------|  (D-Bus method return)
```

The RM disconnects the CEM if no `KeepAlive` is received within the declared interval.

### 4. Instruction Handling (OMBC example)

```
CEM                                    RM
 |                                      |
 |-- Message: OMBC.Instruction -------> |
 |                                      |
 |<-- Message: ReceptionStatus(OK) -----|
```

The RM acks every instruction immediately and forwards it downstream for the flow to act on.

### 5. Disconnect

```
CEM                                    RM
 |                                      |
 |-- Disconnect(cemId) ---------------> |  (D-Bus method call, CEM-initiated)
 |   OR                                 |
 |<-- Signal: Disconnect(cemId, reason) |  (RM-initiated, e.g. "KeepAlive missed")
```

---

## ReceptionStatus Rules

Every S2 message that has a `message_id` field MUST be acknowledged with a `ReceptionStatus`.

Exceptions:
- `ReceptionStatus` itself is never acked
- Messages without `message_id` are not acked

The `status` field is one of: `OK`, `INVALID_DATA`, `INVALID_MESSAGE`, `INVALID_CONTENT`,
`TEMPORARY_ERROR`, `PERMANENT_ERROR`.

These values match `ReceptionStatusValues` in s2python (`gen_s2.py`). Do not use other strings -
s2python will reject them with a pydantic validation error.

---

## OMBC Operation Mode Notes

- `OMBC.SystemDescription` defines the available operation modes. Send it after `SelectControlType` and whenever the available modes change.
- `OMBC.Status` reports the current active mode. Send it immediately after `SystemDescription` and whenever the active mode or factor changes.
- `operation_mode_factor` is a float 0..1 indicating how fully the mode is active (1 = fully active).
- `OMBC.Instruction` from the CEM sets the desired operation mode. The RM MUST ack it and then act on it.

### s2python type constraints (stricter than JSON schema)

The s2python pydantic models enforce tighter types than the JSON schema for some fields:

| Field | JSON schema type | s2python type | Implication |
|---|---|---|---|
| `ResourceManagerDetails.resource_id` | `ID` (string pattern) | `uuid.UUID` | Must be a proper UUID - Node-RED node IDs (hex strings) are rejected |
| `ResourceManagerDetails.message_id` | `ID` (string pattern) | `uuid.UUID` | Use `generateId()` which produces UUIDs |
| `OMBCOperationMode.id` | `ID` (string pattern) | `uuid.UUID` | Must be a valid UUID string, not a plain name like `"normal"` |
| `OMBCStatus.message_id` | `ID` (string pattern) | `uuid.UUID` | Use `generateId()` which produces UUIDs |
| `OMBCSystemDescription.message_id` | `ID` (string pattern) | `uuid.UUID` | Same |
| `ReceptionStatus.subject_message_id` | `ID` (string pattern) | `uuid.UUID` | Fine as long as the CEM sends UUID message IDs (s2-cem-cli does) |

The `ID` JSON schema pattern `[a-zA-Z0-9\-_:]{2,64}` is more permissive than `uuid.UUID`.
Always use proper UUIDs for any field that s2python maps to `uuid.UUID`.

---

## Planned Architecture (next steps)

The intended Node-RED flow structure is:

```
[Transport node]  <->  [RM node]  -->  [device control]
```

**Transport node** (handles D-Bus or network):
- Current: `victron-virtual` acload node (Venus OS D-Bus)
- Future: `s2-websocket` node (direct WebSocket to CEM)
- Future: `s2-mqtt` node
- All transports speak the same internal command interface so they are drop-in replacements

**RM node** (`s2-rm`, currently named `s2-message-handling`):
- Owns all S2 protocol logic
- Configured via node UI with a JSON block:
  - Supported control types (OMBC now, PEBC next, others later)
  - Per-control-type config: operation modes / power ranges / constraints
  - Phase info (1/2/3-phase)
  - Hysteresis settings
  - Firmware version, model, manufacturer
- Port 1 out: messages to send back to the transport (to the CEM)
- Port 2 out: S2 messages received from the CEM (for downstream processing)
- Port 3 out: device control commands derived from received instructions

The node is designed to support multiple control types. The JSON config should be structured
per control type so new ones can be added without changing the node interface:

```json
{
  "controlTypes": {
    "OMBC": {
      "operationModes": [...],
      "transitions": [],
      "timers": []
    },
    "PEBC": {
      "powerConstraints": [...]
    }
  }
}
```

The CEM selects which control type to use via `SelectControlType`. The RM node routes to the
appropriate handler. Priority order for implementation: OMBC (done), PEBC (next), others later.

### Disabling CEM control via input

To tell a connected CEM to stop controlling the device without disconnecting the session,
re-send `ResourceManagerDetails` with `available_control_types: []`. The CEM must respect
this and stop sending instructions. This is the spec-correct "no control" mode.

The RM node input should accept a command to trigger this, e.g.:
```json
{ "payload": { "command": "SetControlTypes", "controlTypes": [] } }
```

To re-enable: send `SetControlTypes` with the desired list (e.g. `["OPERATION_MODE_BASED_CONTROL"]`).

`SessionRequest: TERMINATE` is available too but fully disconnects - use it only when you want
the CEM to disconnect and reconnect from scratch, not just to pause control.

---

## Known Limitations / TODO

- WebSocket transport (`s2-websocket` node) is not yet implemented
- `s2-message-handling` node should be renamed to `s2-rm` (S2 Resource Manager)
- OMBC system description + operation modes should move from hardcoded defaults to JSON config in the RM node
- Phase and hysteresis config not yet exposed
- Only OMBC control type is currently supported in `S2Session`; PEBC is the next planned control type
- No `SessionRequest` (reconnect/terminate) handling
- No `RevokeObject` handling
- No `PowerMeasurement` / `PowerForecast` sending
- KeepAlive timeout enforcement on the RM side is not implemented (the D-Bus layer in Venus OS handles this, but the Node-RED session does not independently monitor it)
- `SetControlTypes` input command (re-advertise capabilities / disable control) not yet implemented
