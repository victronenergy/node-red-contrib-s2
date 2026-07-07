# node-red-contrib-s2

Node-RED nodes for the [S2 energy management protocol](https://s2standard.org/) (EN 50491-12-2).

S2 is a European standard for demand-side energy flexibility. It defines how a Customer Energy Manager (CEM) communicates with Resource Managers (RMs) to coordinate energy consumption, production, and storage.

## Nodes

| Node | Description |
|------|-------------|
| **s2-rm** | S2 Resource Manager - manages protocol sessions with one or more CEMs |
| **s2-rm-config** | Configuration for RM identity: resource ID, name, roles, control types, serial number |
| **s2-cem-config** | Configuration for CEM connection (WebSocket URL and credentials) |
| **s2-websocket** | WebSocket transport for S2 communication with a CEM |

## Features

- S2 protocol handshake and session management
- Operation Mode Based Control (OMBC)
- Power Envelope Based Control (PEBC) with configurable power constraints
- PowerMeasurement forwarding (3-phase symmetric or per-phase L1/L2/L3)
- PowerForecast support
- Multiple concurrent CEM sessions
- Configurable RM roles (Consumer, Producer, Storage)
- Context variable templates in serial number (e.g. `{{global.vrmId}}`)

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
4. s2-rm output 2 carries S2 messages from the CEM (e.g. SelectControlType, ReceptionStatus).
5. s2-rm output 3 carries instructions from the CEM (e.g. PEBC.Instruction, OMBC.Instruction).

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

## Updating PEBC PowerConstraints

```json
{
  "payload": {
    "command": "PowerConstraints",
    "cemId": "cem",
    "constraints": {
      "commodityQuantity": "ELECTRIC.POWER.3_PHASE_SYMMETRIC",
      "minPower": -3000,
      "maxPower": 3000
    }
  }
}
```

Constraints are stored at the node level and automatically sent when a CEM selects PEBC.

## Development

```bash
npm install
npm run build
npm test
```

## License

[MIT](LICENSE) - Copyright (c) 2026 Victron Energy BV
