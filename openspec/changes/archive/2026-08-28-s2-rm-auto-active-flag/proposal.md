## Why

Victron's virtual-device S2 transport deliberately leaves the D-Bus `/S2/0/Active` flag ("a control type other than NO_SELECTION/NOT_CONTROLABLE is active") for the flow to manage - it only ever resets it to `0` on Disconnect. Today nothing sets it back to `1`, so every user flow has to track control-type selection itself just to drive this one flag, duplicating state `s2-rm` already has.

## What Changes

- `s2-rm` tracks each session's `SelectControlType` and, on every selection change, emits a `/S2/0/Active` write on its transport output: `1` when the newly selected control type is anything other than `NO_SELECTION`/`NOT_CONTROLABLE`, `0` otherwise.
- No new output port - this rides the existing transport output (port 1), which already accepts plain D-Bus-path payloads alongside `s2Signal`-prefixed ones.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `s2-rm-protocol`: control-type selection handling gains a side effect - a `/S2/0/Active` transport write reflecting whether an active (non-NO_SELECTION/NOT_CONTROLABLE) control type is selected.

## Impact

- `src/nodes/s2-rm/index.ts` (`onMessage` handling for `SELECT_CONTROL_TYPE`, transport-output docblock)
- `test/nodes/s2-rm.test.ts`
- No breaking changes: purely additive output on an existing port; nothing currently listening on that port needs to change to keep working.
