# node-red-contrib-s2

Node-RED nodes for the [S2 energy management protocol](https://s2standard.org/) (EN 50491-12-2).

S2 is a European standard for demand-side energy flexibility. It defines how a Customer Energy Manager (CEM) communicates with Resource Managers (RMs) to coordinate energy consumption, production, and storage.

## Requirements

- Node-RED >= 4.1.0
- Node.js >= 24

## Nodes

| Node | Description |
|------|-------------|
| **s2-rm** | S2 Resource Manager - generic S2 protocol state machine (handshake, control-type selection, instruction ack/routing) for one or more CEMs, independent of any specific control type |
| **s2-rm-config** | Configuration for RM identity: resource ID, name, roles, control types, serial number, power measurement/forecast |
| **s2-ombc** | Operation Mode Based Control - declares the OMBC system description, resolves OMBC instructions, and confirms operation mode changes back to the CEM |
| **s2-ombc-config** | Configuration for `s2-ombc`: OMBC system description (operation modes, transitions, timers) |
| **s2-pebc** | Power Envelope Based Control - accumulates power envelope schedules from PEBC instructions, dispatches the active bound as it becomes effective, caps outgoing PowerForecasts to the accumulated schedule, and (optionally) resolves which side of an asymmetric bound currently applies from your PowerMeasurement |
| **s2-pebc-config** | Configuration for `s2-pebc`: default power constraints (grid connection preset or custom wattage) |
| **s2-cem-config** | Configuration for CEM connection (WebSocket URL and credentials) |
| **s2-websocket** | WebSocket transport for S2 communication with a CEM |

## Features

- S2 protocol handshake and session management
- Operation Mode Based Control (OMBC), via the dedicated **s2-ombc** node
- Power Envelope Based Control (PEBC) with configurable power constraints, via the dedicated **s2-pebc** node
- PowerMeasurement forwarding (3-phase symmetric or per-phase L1/L2/L3)
- PowerForecast support
- Multiple concurrent CEM sessions
- Configurable RM roles (Consumer, Producer, Storage)
- Context variable templates in serial number (e.g. `{{global.vrmId}}`)

Other S2 control types (FRBC, DDBC, PPBC) have no dedicated node yet - **s2-rm** forwards their instructions on its instructions output, enriched with `msg.controlType`, for you to handle in your own flow.

## Installation

Install via the Node-RED palette manager, or from the command line:

```bash
cd ~/.node-red
npm install node-red-contrib-s2
```

## Quick start

1. Add an **s2-rm-config** node and configure your Resource Manager identity (name, roles, control types).
2. Add an **s2-cem-config** node with the WebSocket URL and credentials of your CEM.
3. Wire an **s2-websocket** node to an **s2-rm** node:
   - s2-websocket output 2 -> s2-rm input
   - s2-rm output 1 -> s2-websocket input
4. s2-rm output 2 carries S2 messages from the CEM (e.g. SelectControlType, ReceptionStatus, RevokeObject).
5. s2-rm output 3 carries instructions from the CEM, enriched with `msg.controlType` and namespaced under a matching key (e.g. `msg.ombc`, `msg.pebc`).
6. For OMBC or PEBC, add the matching control-type node (**s2-ombc** + **s2-ombc-config**, or **s2-pebc** + **s2-pebc-config**) and wire it up:
   - s2-rm output 2 -> control-type node input (so it can observe `SelectControlType`/`RevokeObject`)
   - s2-rm output 3 -> control-type node input (so it can resolve its instructions)
   - control-type node's command output -> s2-rm input (routes `UpdateStatus`/`SystemDescription`/`PowerConstraints`/`InstructionStatus` commands back through s2-rm)

   `s2-ombc` and `s2-pebc` can be wired in parallel downstream of the same `s2-rm` - each passes through instructions meant for the other control type unchanged.

   If you're sending PowerForecasts and using `s2-pebc`, route your Forecast command into `s2-pebc`'s input too (instead of directly into s2-rm) - see [Sending PowerForecasts](#sending-powerforecasts).

See `examples/boiler-ombc-demo.json` for a complete working OMBC flow.

## Sending PowerMeasurements

To send power measurements to the CEM, inject a message into the s2-rm input:

```json
{
  "payload": {
    "command": "PowerMeasurement",
    "cemId": "cem",
    "values": [
      { "commodity_quantity": "ELECTRIC.POWER.3_PHASE_SYMMETRIC", "value": 1500 }
    ]
  }
}
```

The s2-rm node emits a `PowerMeasurementStart` signal on output 1 when the CEM selects a control type, so you can use that to trigger periodic measurements.

### Direction-aware limiting with s2-pebc

A PEBC power envelope can be asymmetric (different import and export bounds), but many devices only expose a single settable limit. If your `s2-pebc` node's input is also wired to your `PowerMeasurement` command (in addition to wherever else it already goes - no changes needed to what you send to `s2-rm`), it tracks your last measurement's sign and adds two fields to its active-element output:

- `direction`: `'import'` or `'export'`, from the sign of your last measurement for that commodity (defaults to `'import'` if none has been seen yet).
- `limitW`: the magnitude, in watts, of whichever bound applies - `upperBound` for import, `|lowerBound|` for export (or `null` if that bound is unbounded).

Apply `limitW` to your single actuator instead of always using `upperBound`. If your measurement's direction flips mid-slot on an asymmetric bound, `s2-pebc` re-emits output 1 with the updated values (without resending `InstructionStatus`, since the instruction itself hasn't changed) - so a flow reading `limitW` stays correct as flow direction changes, not just at the start of each slot.

## Sending PowerForecasts

```json
{
  "payload": {
    "command": "Forecast",
    "cemId": "cem",
    "forecast": {
      "startTime": "2026-04-14T10:00:00Z",
      "elements": [
        {
          "duration": 900000,
          "power_values": [
            { "commodity_quantity": "ELECTRIC.POWER.3_PHASE_SYMMETRIC", "value_expected": 1500 }
          ]
        }
      ]
    }
  }
}
```

If a `s2-pebc` node is present, inject this into its input instead of directly into `s2-rm` - `s2-pebc` caps `forecast.elements` to its currently accumulated PEBC schedule (tightest overlapping bound per element) before forwarding the command to `s2-rm` on its output 3. With no accumulated schedule, or without `s2-pebc` in the path, the forecast is forwarded/sent unchanged.

## Updating PEBC PowerConstraints

`s2-pebc` pushes a default constraints range on deploy (derived from its `s2-pebc-config`). To override it at runtime, inject a message into the s2-rm input - unlike every other command, `PowerConstraints` applies globally and does not require a `cemId`:

```json
{
  "payload": {
    "command": "PowerConstraints",
    "constraints": {
      "commodityQuantity": "ELECTRIC.POWER.3_PHASE_SYMMETRIC",
      "minPower": -3000,
      "maxPower": 3000
    }
  }
}
```

Constraints are stored at the node level and automatically (re-)sent whenever a CEM selects PEBC.

## Development

```bash
npm install
npm run build
npm test
```

## License

[MIT](LICENSE) - Copyright (c) 2026 Victron Energy BV
