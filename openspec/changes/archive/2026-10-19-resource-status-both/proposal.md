## Why

`s2-resource` has one node status, written by its connection (the Resource Manager and built-in transport: `waiting for CEM`, `CEM connected (...) - NC,OMBC`, `registering...`) and, separately, by its built-in OMBC control type (`Confirmed: Off`, `default: ...`, `waiting for ModeConfirmation`). Whichever wrote last wins. A forum user's resource showed "Confirmed Off" while it was missing from GX Opportunity Loads, and nothing on the canvas said whether a CEM was connected at all ([Opportunity loads aircon cloud controlled](https://community.victronenergy.com/t/opportunity-loads-aircon-cloud-controlled/63386), #14).

## What Changes

- `s2-resource` keeps the latest connection status and the latest control-type status separately and shows both: `<connection> | <control type>`, e.g. `CEM connected (opportunity_loads) - NC,OMBC | Confirmed: Off`.
- The colour and shape come from the connection, unless the control-type status is a warning (yellow) or an error (red), which then sets the colour.
- The control type's initial `idle` status adds nothing, so a node with nothing to report about OMBC shows only its connection, as before.
- `Control type: None` and the standalone nodes (`s2-rm`, `s2-ombc`) are unchanged.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `s2-resource`: the node status shows both the connection and the control-type state.

## Impact

- `src/nodes/s2-resource/index.ts` only. Status text is not part of any message contract, so this isn't behind a behaviour version.
- CHANGELOG.
