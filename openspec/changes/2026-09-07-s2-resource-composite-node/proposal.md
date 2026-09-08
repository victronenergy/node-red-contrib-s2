## Why

Getting a minimal working S2 flow today requires 6 node instances wired in two places (`s2-rm-config`, `s2-cem-config`, `s2-websocket`, `s2-rm`, plus a control-type node and its config, e.g. `s2-ombc`/`s2-ombc-config`) - too much for new users to assemble correctly, and identical wiring is repeated per resource. A single composite node covering the common case (one transport, one control type) removes that wiring without removing the agnostic, manually-wired path `s2-rm` already offers.

## What Changes

- Add `s2-resource`: one node with a tabbed edit dialog (Connection / Resource Manager / Control Type) that internally instantiates the same session state machine `s2-rm` uses, plus a built-in transport and control type.
  - **Transport**: `WebSocket` (built-in - reuses `s2-cem-config`'s connection fields) or `External` (no built-in transport; exposes the same "to/from transport" input/output pair `s2-rm` has today, for wiring to anything else that speaks the transport-agnostic message protocol).
  - **Control type**: `OMBC` (built-in - reuses `s2-ombc-config`'s friendly editor, embedded as a tab) or `None` (no built-in control type; exposes the same "from CEM"/command input/output pair `s2-rm` has today, for wiring a dedicated control-type node instead).
  - With `Transport: External` and `Control type: None`, `s2-resource`'s port contract and behavior are identical to `s2-rm`'s today - it is a strict superset, not a replacement.
- Extract `s2-rm`'s handshake/session/routing logic out of its `registerType` callback into an instantiable module, so both `s2-rm` and `s2-resource` construct the same session behavior directly instead of one wrapping the other as a Node-RED node.
- Drop the "Abnormal only" checkbox from `s2-ombc-config`'s friendly editor (both its own dialog and `s2-resource`'s Control Type tab, since they share the same widget): it implied a partially separate transition graph the friendly editor's auto-derived, fully-connected transitions can never actually produce. Existing configs with `abnormalConditionOnly: true` on a mode are treated as `false` going forward; the field is no longer offered.

Out of scope (tracked for later, not part of this change):
- A `D-Bus` transport option (depends on `s2-dbus`/`s2-dbus-config` from the separate `2026-09-06-s2-dbus-transport` change landing first; adds one more `Transport` dropdown value, no other change to `s2-resource`).
- A `PEBC` control type option (added later the same way, as one more `Control type` dropdown value).
- Selecting more than one control type at once - today's separate-node model already allows this by wiring two control-type nodes to one `s2-rm`; `s2-resource` doesn't need to.
- A way to temporarily drop to `NOT_CONTROLABLE` at runtime (e.g. once a device reaches its setpoint) without redeploying - needs its own design, independent of this change.

## Capabilities

### New Capabilities
- `s2-resource`: a composite node combining RM session state, a built-in transport (WebSocket or none), and a built-in control type (OMBC or none) behind one tabbed edit dialog.

### Modified Capabilities
- `control-type-ombc`: `s2-ombc-config`'s friendly editor no longer offers the "Abnormal only" per-mode checkbox.

## Impact

- New: `src/nodes/s2-resource/` (`index.ts`, `index.html`), `test/nodes/s2-resource.test.ts`.
- `src/nodes/s2-rm/index.ts`: handshake/session/routing logic extracted into a module `s2-rm`'s `registerType` and `s2-resource` both construct directly - no behavior change to `s2-rm` itself.
- `src/nodes/s2-ombc-config/index.html`: remove the "Abnormal only" checkbox and its field; the operation-mode-list widget becomes reusable from `s2-resource`'s Control Type tab.
- `package.json`: `s2-resource` added to the `node-red.nodes` map. No new runtime dependencies - `Transport: WebSocket` reuses the existing `ws` dependency.
- No changes to `s2-rm`, `s2-websocket`, `s2-cem-config`, or any of their specs' requirements - `s2-resource` is additive and consumes them as-is.
