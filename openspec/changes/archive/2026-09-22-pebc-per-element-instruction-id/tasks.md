## 1. Types

- [x] 1.1 Add `instructionId: string` to `ScheduleElement` in `src/lib/s2/schedule.ts`.

## 2. Flattening sites

- [x] 2.1 `handleInstruction`'s `combined` (`src/nodes/s2-pebc/index.ts`): carry each slot's `instructionId` onto its `element` when building `elements`.
- [x] 2.2 `handleRevoke`'s `rebuilt`: same, when rebuilding after a revoke.
- [x] 2.3 `buildCurrentSchedule`: same, when building the schedule used for forecast capping and direction re-announcement.

## 3. Output and persistence

- [x] 3.1 `applySchedule`'s output port 2 payload (`index.ts`): include `instructionId` per element alongside `startTime, endTime, durationSec, lowerBound, upperBound`.
- [x] 3.2 `loadPersistedSchedule`: when repopulating `pebcSlots` from a persisted file, use each element's own `instructionId` if present, falling back to the schedule's top-level `instructionId` for files written before this change.

## 4. Tests

- [x] 4.1 Add a test to `test/nodes/s2-pebc.test.ts` covering a schedule with elements from two different instructions (different `id`s, non-overlapping slot times, same `power_constraints_id`) - assert each element's `instructionId` matches the instruction that produced it, both in output port 2's payload and in the persisted schedule file.
- [x] 4.2 Add a test asserting a schedule with elements from only one instruction still has every element's `instructionId` equal to the schedule's top-level `instructionId`.
- [x] 4.3 Add a test for `loadPersistedSchedule` reading a schedule file with no per-element `instructionId` (old format) - assert restored slots fall back to the file's top-level `instructionId`.

## 5. Validation

- [x] 5.1 `npm run lint` / `npm test` pass.
- [x] 5.2 `openspec validate pebc-per-element-instruction-id --strict` passes.
