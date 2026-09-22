## Why

`s2-pebc` accumulates power envelope elements from multiple PEBC instructions into one schedule (cleared only when `power_constraints_id` changes), and each accumulated slot already tracks the ID of the instruction it came from internally. But whenever that accumulated schedule is flattened for output - the persisted schedule file, the flow-context schedule snapshot, and output port 2's schedule dump - the result exposes a single top-level `instructionId` for the whole schedule instead of per-element attribution. Once a second instruction's elements are folded in alongside a first instruction's still-pending elements, that single ID silently becomes wrong for some of the elements it's shown next to, and any external consumer can no longer tell which instruction actually produced a given slot.

## What Changes

- Add an `instructionId` field to each element in the flattened schedule output, so slots retain their originating instruction's ID wherever the schedule leaves the per-slot `pebcSlots` map: the persisted schedule file, the `SCHEDULE_CONTEXT_KEY` context snapshot, and output port 2's schedule dump payload.
- Keep the existing top-level `instructionId` field on the flattened schedule as-is (still one representative ID, for backward compatibility with existing consumers) - this change is additive, not a replacement.
- No change to `InstructionStatus` dispatch (`emitActiveElement`, `reapEndedInstructions`, `handleRevoke`) - those already read the correct per-slot `instructionId` from `pebcSlots` and are unaffected.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `control-type-pebc`: the accumulated schedule's per-element output (persisted file, context snapshot, and output port 2's schedule dump) must attribute each element to the instruction it came from, not just the whole schedule.

## Impact

- `src/lib/s2/schedule.ts`: `ScheduleElement`/`PebcSchedule` types (element shape gains `instructionId`).
- `src/nodes/s2-pebc/index.ts`: `applySchedule` (output port 2 payload), `saveSchedule`/`loadPersistedSchedule` (persisted file round-trip), `handleInstruction`/`handleRevoke`/`buildCurrentSchedule` (flattening `pebcSlots` into a `PebcSchedule`).
- Consumers of output port 2's schedule dump or the persisted schedule file gain a new per-element field; no existing field is removed or renamed.
