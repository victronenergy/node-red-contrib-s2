## Why

`2026-09-14-control-type-availability` (shipped in v0.7.1) made every RM always advertise `NOT_CONTROLABLE` in `ResourceManagerDetails.available_control_types`, with no way to disable it - at deploy time or via the `SetAvailableControlTypes` runtime command. That was a deliberate, standards-motivated choice (the S2 spec makes the field mandatory and treats `NOT_CONTROLABLE` as CEM-selectable, not just a config artifact), but internal discussion since then concluded the "forced, can't opt out" part doesn't feel right for this project: flow authors lose the ability to say "this RM never offers a not-controllable choice" even when that's genuinely what they want, and the runtime command silently adds a value the caller didn't ask for. This change reverses that specific guarantee - `NOT_CONTROLABLE` becomes opt-out (checked by default) rather than forced - while keeping the rest of the prior change (the `SetAvailableControlTypes` command itself, no forced deselect) intact, and adds a convenience shortcut for the most common runtime use of that command: toggling a resource fully off and back on.

## What Changes

- **BREAKING**: `S2ResourceManager` no longer unions `NOT_CONTROLABLE` into `available_control_types` - neither at construction (deploy-time config) nor when handling `SetAvailableControlTypes`. `NOT_CONTROLABLE` now only appears when explicitly present in the source list, same as any other control type.
- Restore the "Not Ctrl" checkbox to `s2-rm-config`'s and `s2-resource`'s manually-editable control-types list (removed by the change being reversed). It defaults to **checked** for newly added nodes, so the common case keeps advertising `NOT_CONTROLABLE` without the author doing anything; unchecking it is an explicit, deliberate act.
- `SetAvailableControlTypes` gains an alternative payload shape for the common on/off case:
  - `{ command: 'SetAvailableControlTypes', isControllable: false }` - replace the advertised list with exactly `[NOT_CONTROLABLE]`.
  - `{ command: 'SetAvailableControlTypes', isControllable: true }` - restore the list to whatever was configured at deploy time (the node's own configured control-types list, including whether its `NOT_CONTROLABLE` checkbox was checked), discarding any runtime narrowing currently in effect.
  - The existing shape (`availableControlTypes: [...]`) is unchanged except it no longer auto-adds `NOT_CONTROLABLE`.
  - A command payload SHALL specify exactly one of `availableControlTypes` or `isControllable` - both present, or neither, is rejected.
- No change to: `SetAvailableControlTypes` applying globally with no `cemId`, resending `ResourceManagerDetails` with a fresh `message_id`, or the "no forced deselect" behavior when a CEM's active selection drops out of the list.

## Capabilities

### Modified Capabilities
- `s2-rm-protocol`: replaces the "`NOT_CONTROLABLE` is always advertised and cannot be disabled" requirement with an opt-out (checkbox-driven, default-on) model, and extends the `SetAvailableControlTypes` requirement with the `isControllable` shortcut and its restore-to-configured-list behavior.

## Impact

- `src/lib/s2/resource-manager.ts` - drop the `withNotControlable` union at construction and in `handleInput`'s `SetAvailableControlTypes` branch; retain the original deploy-time configured `availableControlTypes` separately from the mutable advertised list, so `isControllable: true` has a stable value to restore; validate the new mutually-exclusive `isControllable`/`availableControlTypes` payload shape.
- `src/nodes/s2-rm-config/index.html` - restore the `NOT_CONTROLABLE` checkbox to the control-types list, defaulted to checked for new nodes.
- `src/nodes/s2-resource/index.html` - same restoration for its own manually-editable control-types list.
- `openspec/specs/s2-rm-protocol/spec.md` - rewrite the "always advertised" requirement and extend the runtime-update requirement.
- `README.md` - update "Updating available control types at runtime" (drop the "always re-added" language, document `isControllable`).
- `CHANGELOG.md` - new entry, cross-referencing the v0.7.1 entry it reverses.
- **Compatibility**: existing deployed flows built against v0.7.1 currently advertise `NOT_CONTROLABLE` unconditionally; after this change and a redeploy, whether they still do depends on the restored checkbox's state. This needs verifying at design time: whether the Node-RED editor's node-defaults migration path actually sets the new checkbox to checked for flows saved before this change existed, or whether an already-deployed (not just already-open-in-editor) node silently loses `NOT_CONTROLABLE` on next redeploy without the author touching the dialog at all.
