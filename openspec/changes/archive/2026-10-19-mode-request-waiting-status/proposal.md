## Why

Review comment on #76 (merged before it was addressed): from behaviour version 0.9.7, a `ModeRequest` sets the yellow `waiting for ModeConfirmation` status, but an `OMBC.Instruction` that arrives before the flow has confirmed a mode replaces it with the instructed mode's label in green. With auto-confirm off (the default), nothing has been confirmed or persisted yet, so the status hides that the flow still owes a `ModeConfirmation`.

## What Changes

- From behaviour version 0.9.7, after `s2-ombc` (or `s2-resource`'s built-in OMBC) has emitted a `ModeRequest` for a CEM, it remembers that it is waiting for that CEM. An instruction for it then shows `instructed: <label> - waiting for ModeConfirmation` in yellow. Only a successful confirmation for that CEM (from the flow, or auto-confirm) ends the wait and shows `Confirmed: <label>` in green.
- The wait also ends when that CEM switches to another control type.
- Nodes without a behaviour version are unchanged: they never show the waiting status, and an instruction shows its label in green as before.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `control-type-ombc`: the waiting status survives instructions until a mode is confirmed.

## Impact

- `src/lib/s2/ombc-controller.ts` (shared by `s2-ombc` and `s2-resource`), tests.
- CHANGELOG: folded into the existing unreleased `ModeRequest` entry.
