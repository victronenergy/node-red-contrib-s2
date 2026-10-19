## Why

When a CEM selects OMBC and no operation mode is known yet (no persisted status, no default), `s2-ombc` and `s2-resource`'s built-in OMBC emit `{ topic: 'ModeRequest', payload: null }`. In the debug sidebar that reads as an empty or broken message. A forum user asked "why does S2 send null and not Off?" ([S2 issue controlling heater](https://community.victronenergy.com/t/s2-issue-controlling-heater/63523)). The flow is supposed to answer with a `ModeConfirmation` for the device's current mode, but nothing in the message says so or which modes it can choose from.

## What Changes

- `ModeRequest` keeps its topic, and its payload becomes `{ message, modes }`:
  - `message` says in plain words that no mode is known yet and a `ModeConfirmation` is expected;
  - `modes` lists the configured operation modes as `{ id, index, label }`, the identifiers a `ModeConfirmation` accepts.
- The node shows a yellow `waiting for ModeConfirmation` status until a mode is confirmed.
- **Gated by a behaviour version**, the pattern used in `victron-vrm-api`, but holding the release that introduced the behaviour: `s2-ombc` and `s2-resource` get a `version` default of `0.9.7`, and the runtime uses the new payload for nodes at `0.9.7` or later only (compared per dotted part, so `0.10.0` counts as later). Node-RED doesn't apply defaults to flows it loads, or to Paste/Import/Examples, so nodes that are already deployed keep `payload: null`. Their dialog offers "Update to latest", which sets the version on Done. The shipped examples set `"version": "0.9.7"` explicitly. No existing flow changes behaviour.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `control-type-ombc`: `ModeRequest` payload and the waiting status.

## Impact

- `src/lib/s2/ombc-controller.ts` (shared by `s2-ombc` and `s2-resource`).
- `src/nodes/s2-ombc/index.html`, `src/nodes/s2-resource/index.html`: `version` default, version notice and "Update to latest".
- `src/nodes/s2-ombc/index.ts`, `src/nodes/s2-resource/index.ts`: pass the version to the controller.
- Shipped examples with OMBC nodes: `"version": "0.9.7"`.
- `src/lib/s2/behaviour-version.ts` (new) and `versionAtLeast` in `resources/s2-common.js`: release version comparison.
- Help texts of `s2-ombc` and `s2-resource`, README, CHANGELOG.
