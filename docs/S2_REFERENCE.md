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

This package implements the RM side. **OMBC** (`s2-ombc`, or `s2-resource`'s built-in control type) and
**PEBC** (`s2-pebc`) have dedicated nodes; FRBC, DDBC and PPBC instructions are acknowledged and forwarded
as raw S2 messages on `s2-rm`'s "from CEM" output, for the flow to handle.

---

## Specification Sources

| Resource | URL / path |
|---|---|
| S2 standard website | https://s2standard.org/ |
| S2 model reference docs | https://docs.s2standard.org/model-reference/reading-this-documentation/ |
| s2-ws-json (AsyncAPI + JSON Schema) | https://github.com/flexiblepower/s2-json (renamed from `s2-ws-json` - GitHub redirects the old URL) - checked out locally at `~/git/s2-ws-json` |
| s2python (CEM-side pydantic models) | https://github.com/flexiblepower/s2python - checked out at `~/git/s2-python` |
| Venus OS D-Bus S2 Interface wiki | https://github.com/victronenergy/venus/wiki/Venus-OS-D%E2%80%90Bus-S2-Interface |
| venus-s2-tools (sniffer + CEM CLI) | `~/git/venus-s2-tools` |

The `s2-ws-json` JSON schemas and `s2python` pydantic models are both authoritative sources and
**must be consulted together** - the schemas define the wire format, but s2python adds stricter
Python type constraints that can cause validation failures not visible in the JSON schema alone.

This repo now also carries its own vendored, pinned copy of the `v0.0.2-beta`-tagged schema set at
`src/lib/s2/s2-json-schema/` (see `VENDORED.md` there), precompiled into a runtime validator that
`s2-rm`'s session layer and the Advanced-mode JSON editors validate against - see the
`s2-message-validation` capability under `openspec/specs/`. Prefer that vendored copy over the live
checkout below when checking what this package actually validates against; use the live checkout
for researching newer/different protocol versions.

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

The **`s2-dbus`** node implements this transport directly (via `dbus-victron-virtual`/`dbus-native-victron`,
no dependency on node-red-contrib-victron), producing the exact same output shape `s2-websocket` does - wire
it to `s2-rm` the same way. `s2-resource`'s Connection tab also offers it as a built-in `Transport: D-Bus`
option.

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

`OMBC.SystemDescription` and `OMBC.Status` are not sent by `s2-rm` itself: the OMBC control type
(`s2-ombc`, or `s2-resource` with `Control type: OMBC`) sees `SelectControlType` on `s2-rm`'s "from CEM"
output and pushes them back as `SystemDescription`/`UpdateStatus` commands. With no default mode
configured and no `ModeConfirmation` yet, there is no `OMBC.Status` to send; the control type emits
a `ModeRequest` for the flow to report the current mode instead.

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
 |<-- Message: InstructionStatusUpdate -| status=ACCEPTED
 |                                      |  (at execution_time)
 |<-- Message: InstructionStatusUpdate -| status=STARTED
 |<-- Message: OMBC.Status -------------| once the flow confirms the new mode
```

The RM acks every instruction immediately with `ReceptionStatus` and `InstructionStatusUpdate(ACCEPTED)`.
An instruction whose `execution_time` is in the future is queued (in flow context, polled every
`instructionPollIntervalMs`) and forwarded when due; one that is due already is forwarded at once.
On forwarding, the RM sends `InstructionStatusUpdate(STARTED)`, unless "Skip instruction status updates" is
checked in the RM config. A `RevokeObject` for a queued instruction removes it and sends `REVOKED`. PEBC
instructions skip this queue: `s2-pebc` schedules them itself.

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
| `ResourceManagerDetails.resource_id` | `ID` (string pattern) | `uuid.UUID` | Must be a proper UUID - Node-RED node IDs (hex strings) are rejected. Generated IDs are UUIDs; a non-UUID entered on `s2-resource`'s WebSocket Resource ID field gets a warning in the dialog |
| `ResourceManagerDetails.message_id` | `ID` (string pattern) | `uuid.UUID` | Use `generateId()` which produces UUIDs |
| `OMBCOperationMode.id` | `ID` (string pattern) | `uuid.UUID` | Must be a valid UUID string, not a plain name like `"normal"` |
| `OMBCStatus.message_id` | `ID` (string pattern) | `uuid.UUID` | Use `generateId()` which produces UUIDs |
| `OMBCSystemDescription.message_id` | `ID` (string pattern) | `uuid.UUID` | Same |
| `ReceptionStatus.subject_message_id` | `ID` (string pattern) | `uuid.UUID` | Fine as long as the CEM sends UUID message IDs (s2-cem-cli does) |

The `ID` JSON schema pattern `[a-zA-Z0-9\-_:]{2,64}` is more permissive than `uuid.UUID`.
Always use proper UUIDs for any field that s2python maps to `uuid.UUID`.

---

## Recommended starting point: s2-resource

For a new flow, start with the `s2-resource` node instead of wiring the individual nodes below
by hand - it combines `s2-rm`'s session state machine, a built-in transport (WebSocket or D-Bus),
and a built-in OMBC control type behind one tabbed edit dialog, collapsing the minimal 6-node OMBC
flow (`s2-rm-config`, `s2-cem-config`, `s2-websocket`, `s2-rm`, `s2-ombc-config`, `s2-ombc`) down
to one node with no wiring. `Transport: D-Bus` covers the same session, D-Bus registration, and
power-measurement relay (including exposing the reading as a real D-Bus BusItem property) as the
standalone `s2-dbus` node below. `Transport: External` and `Control type: None` fall back to the
exact same ports/message shapes as `s2-rm` below, for anything the built-ins don't cover yet
(PEBC, FRBC/DDBC/PPBC) - see its own help panel for the full port contract.

The individual nodes documented below remain the manually-wired/advanced path: reach for them
directly when you need more than one control type on the same RM, a shared CEM connection across
several `s2-resource`-shaped resources (`s2-cem-config` is still just a config node either way),
or a transport `s2-resource` doesn't offer a built-in for yet.

## Node architecture

```
[transport]  <->  [s2-rm]  <->  [control-type node]  <->  [device flow]
```

- **Transport:** `s2-websocket` (the RM dials out to a CEM) or `s2-dbus` (registers a
  `com.victronenergy.<acload|heatpump>.virtual_s2_<nodeId>` service a CEM on the GX calls into).
  Both speak the same command interface to `s2-rm`, so they are drop-in replacements.
- **`s2-rm`:** the generic S2 session (handshake, `ResourceManagerDetails`, control-type selection,
  instruction ack/queue/routing), configured by `s2-rm-config`. Output 1 goes back to the transport,
  output 2 carries every S2 message from the CEM, plus `Connected`/`Disconnected` lifecycle events.
- **Control-type nodes:** `s2-ombc` (+ `s2-ombc-config`) and `s2-pebc` (+ `s2-pebc-config`) read
  `s2-rm`'s output 2, turn instructions into device-level output, and send their commands
  (`SystemDescription`, `UpdateStatus`, `PowerConstraints`, `InstructionStatus`) back into `s2-rm`.
- **`s2-resource`:** all of the above in one node - `s2-rm` plus a built-in transport (WebSocket,
  D-Bus, or External) and a built-in control type (OMBC, or None).

Each RM is identified to the CEM by its resource ID only. The runtime refuses a second running RM, or
a second transport, with the same resource ID (see the `s2-resource` and `s2-rm-protocol` specs under
`openspec/specs/`).

### Disabling CEM control at runtime

To stop a connected CEM from controlling the device without ending the session, re-send
`ResourceManagerDetails` with a narrower `available_control_types`. Send this to `s2-rm` or
`s2-resource` (no `cemId` needed):

```json
{ "payload": { "command": "SetAvailableControlTypes", "isControllable": false } }
```

This advertises exactly `["NOT_CONTROLABLE"]`, and requires "Not Controllable" to have been enabled in
the node's configured control types. `isControllable: true` restores the configured list. The list form,
`"availableControlTypes": ["OPERATION_MODE_BASED_CONTROL"]`, replaces the advertised list verbatim. An
empty list is rejected: S2 requires at least one advertised control type. See the README for the full
contract.

`SessionRequest: TERMINATE` is available too but fully disconnects - use it only when you want
the CEM to disconnect and reconnect from scratch, not just to pause control.

---

## Known Limitations / TODO

- No dedicated nodes for FRBC, DDBC and PPBC: their instructions are acknowledged and forwarded raw
- `SessionRequest` from the CEM (reconnect/terminate) is forwarded on `s2-rm`'s output 2 but not acted on
- The optional D-Bus RM settings (`S2/0/RmSettings/OnHysteresis`, `OffHysteresis`, `PowerSetting`) are not exposed
- `s2-dbus` doesn't know the resource ID, so it can't refuse a duplicate the way `s2-websocket` does; an
  `s2-dbus` wired to a refused `s2-rm` registers a D-Bus service that never completes a handshake
- See the open question under "Control Type Selection" about waiting for the `OMBC.SystemDescription` ack
