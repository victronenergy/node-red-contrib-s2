## Context

`s2-pebc` keeps an internal `pebcSlots: Map<startMs, { element, commodityQuantity, cemId, instructionId }>` (`src/nodes/s2-pebc/index.ts:114`) that already stores the correct `instructionId` per slot - populated in `handleInstruction` (`index.ts:323`) and read correctly by `InstructionStatus` dispatch (`emitActiveElement`, `reapEndedInstructions`, `handleRevoke`).

The loss happens at the three places that flatten `pebcSlots` into one `PebcSchedule` object (`handleInstruction`'s `combined`, `handleRevoke`'s `rebuilt`, and `buildCurrentSchedule`) - all three map `sorted.map(s => s.element)` into `elements`, dropping the per-slot `instructionId` and keeping only one representative ID at the schedule's top level (`schedule.ts:13-19`). That flattened object is then: emitted on output port 2 (`applySchedule`, `index.ts:290-302`, which currently maps each element to `{startTime, endTime, durationSec, lowerBound, upperBound}` with no ID at all), persisted to disk (`saveSchedule`/`loadPersistedSchedule`), and stored in flow context (`SCHEDULE_CONTEXT_KEY`).

See proposal.md - Why, for the motivation.

## Goals / Non-Goals

**Goals:**
- Every element that leaves `pebcSlots` via a flattening point (port 2 output, persisted file, context snapshot) carries the `instructionId` of the instruction it actually came from.
- `loadPersistedSchedule` round-trips that per-element `instructionId` back into `pebcSlots` on restart, so restored slots keep correct attribution (today it already reuses the top-level `instructionId` for every restored slot, which has the same flattening bug across a restart boundary).

**Non-Goals:**
- No change to `InstructionStatus` dispatch logic - it already reads per-slot IDs correctly from `pebcSlots` and needs no fix.
- No change to how/when slots are cleared (`power_constraints_id` change) or how instructions are parsed (`parsePebcInstruction`) - a single instruction's own elements already correctly share its one ID, per the S2 spec.
- Not removing or renaming the existing top-level `instructionId` field on the flattened schedule - kept for backward compatibility with any consumer reading it today.

## Decisions

**Add `instructionId` to `ScheduleElement` rather than inventing a parallel structure.** `schedule.ts`'s `ScheduleElement` (`startMs, endMs, duration, lowerBound, upperBound`) is the unit already carried inside `pebcSlots` and inside `PebcSchedule.elements`. Adding `instructionId` there means the three flattening sites just carry `slot.instructionId` through into `element.instructionId` instead of dropping it - no new map or lookup needed.

Alternative considered: keep `ScheduleElement` untouched and instead change `PebcSchedule.elements` to a wrapper array of `{ element, instructionId }` (mirroring `pebcSlots`' shape). Rejected - it duplicates the pattern `pebcSlots` already uses internally for no benefit, and forces every existing reader of `schedule.elements` (`getActiveElement`, `getNextElementStart`, `capForecastToSchedule`, output port 2's own mapping) to unwrap an extra layer even though most of them don't care about `instructionId`.

**`parsePebcInstruction` gains no new field.** It parses one `PEBC.Instruction` message where every element genuinely shares one `id` (per spec, `id` belongs to the whole instruction) - `instructionId` is stamped onto each `ScheduleElement` at the point where slots from potentially different instructions are merged (`handleInstruction`, `handleRevoke`, `buildCurrentSchedule`), not inside the parser.

**Output port 2 payload gains a per-element `instructionId` alongside the fields it already sends** (`startTime, endTime, durationSec, lowerBound, upperBound`) - additive, no existing field renamed or removed, consistent with the proposal's compatibility stance.

## Risks / Trade-offs

- [Existing consumers of output port 2 or the persisted file that do strict/closed schema validation on the elements array could reject the new field] → The field is purely additive; if this is a concern the user should confirm no downstream schema is closed (`additionalProperties: false`) before implementing.
- [Persisted schedule files written by the current code (without per-element `instructionId`) will be read after this change ships] → `loadPersistedSchedule` should fall back to the schedule's top-level `instructionId` for any element missing its own, matching today's behavior exactly for old files instead of producing `undefined`.
