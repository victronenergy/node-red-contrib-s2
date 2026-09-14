## Why

Two related gaps in how RMs advertise and offer control today:

1. No RM (`s2-rm` via `s2-rm-config`, or `s2-resource`) is guaranteed to advertise `NOT_CONTROLABLE` (the S2 protocol's "no control" choice - per [the S2 standard](https://docs.s2standard.org/model-reference/Common/ControlType/), it describes a resource the CEM should not currently control, and is a value the CEM can explicitly select via `SelectControlType`, not merely a description of a permanently broken device) in [`ResourceManagerDetails.available_control_types`](https://docs.s2standard.org/model-reference/Common/ResourceManagerDetails/) (a mandatory field per the standard). Today it's just one more optional checkbox (`s2-rm-config`'s "Not Ctrl", mirrored in `s2-resource`'s `Control type: None` list) that defaults unchecked, and isn't offered at all when `s2-resource` uses `Control type: OMBC` (the list is forced to `[OPERATION_MODE_BASED_CONTROL]` only). A CEM talking to any RM in this project today has no guaranteed way to choose "don't control this resource right now."
2. `available_control_types` is fixed at deploy time from static config on both `s2-rm` and `s2-resource`. There is no way for a flow to change what's currently controllable after deployment - e.g. making an OMBC resource controllable only between 10:00 and 18:00 - without redeploying the node.

## What Changes

- Every RM built on the shared `S2ResourceManager` protocol layer - both `s2-rm` (config-driven via `s2-rm-config`) and `s2-resource` - SHALL always include `NOT_CONTROLABLE` in its advertised `available_control_types`, regardless of configured control types (`s2-rm-config`'s checkbox list) or `s2-resource`'s `Control type` selection (`None` or `OMBC`). This is enforced centrally in the shared protocol layer, not per-node: the existing "Not Ctrl" checkbox is removed from both `s2-rm-config`'s and `s2-resource`'s manually-editable control-types lists, since it is no longer a configurable option - a CEM always being able to select "don't control this resource" is a baseline guarantee.
- **Compatibility note:** this changes advertised protocol behavior for every existing deployed `s2-rm`/`s2-resource` flow on its next redeploy - CEMs will see `NOT_CONTROLABLE` in `available_control_types` where they may not have before. This is additive (no existing advertised value is removed, no existing message shape changes) and is a deliberate, explicit decision for this change, not an oversight.
- The shared protocol layer SHALL accept a new runtime command, `SetAvailableControlTypes`, that replaces the currently-advertised `available_control_types` list and re-sends `ResourceManagerDetails` (with a fresh `message_id`, all of `ResourceManagerDetails`' other mandatory/optional fields unchanged) to every connected CEM's session, without requiring a redeploy. `NOT_CONTROLABLE` cannot be removed via this command on any RM - the same always-on guarantee applies at runtime as at deploy time.
- If a CEM currently has a control type selected that the new list no longer includes, the RM SHALL NOT force a deselect or disconnect - it sends the updated `ResourceManagerDetails` and otherwise leaves the current session/selection alone, consistent with the S2 standard not defining any RM-initiated forced-deselect behavior, nor any guidance on resending `ResourceManagerDetails` mid-session at all (an open gap in the standard itself, not something this project can resolve unilaterally - see design.md).
- `NO_SELECTION` (the S2 "nothing chosen yet" placeholder, distinct from `NOT_CONTROLABLE`) is untouched by this change - it keeps its existing meaning and existing `s2-rm-protocol` handling (e.g. the Active-flag requirement already treating it alongside `NOT_CONTROLABLE`); it is just not the value this change forces on.

## Capabilities

### Modified Capabilities
- `s2-rm-protocol`: `available_control_types` always includes `NOT_CONTROLABLE` for any RM (with no way to disable it), and a new `SetAvailableControlTypes` runtime command updates advertised control types and re-sends `ResourceManagerDetails` to connected CEMs, without forcing any deselect when the CEM's current selection is no longer in the list.
- `s2-resource`: its `Control type: None` manually-editable control-types list no longer offers a `NOT_CONTROLABLE`/"Not Ctrl" checkbox (inherited from the shared protocol guarantee above, not a separate mechanism).

## Impact

- `src/lib/s2/resource-manager.ts` (union `NOT_CONTROLABLE` into `availableControlTypes` both at construction and on `SetAvailableControlTypes`; track it as mutable state; resend `ResourceManagerDetails` to connected sessions)
- `src/lib/s2/session.ts` (support resending `ResourceManagerDetails` outside the initial handshake)
- `src/nodes/s2-rm-config/index.html` (remove the "Not Ctrl"/`NOT_CONTROLABLE` checkbox from the manual control-types list)
- `src/nodes/s2-resource/index.html` (remove the same checkbox from its own manual control-types list)
- `src/nodes/s2-rm/index.ts`, `src/nodes/s2-resource/index.ts` (both already forward `command`-bearing input payloads to the shared `S2ResourceManager.handleInput` - confirm/wire `SetAvailableControlTypes` through that existing path, same as `UpdateStatus`/`SystemDescription`)
- `src/lib/s2/messages.ts` (no enum change needed - `NOT_CONTROLABLE` already exists; message-type constant for the new command)
- No changes to `s2-rm`'s or `s2-resource`'s existing port contract (the new command rides the existing command input)
