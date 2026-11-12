## Why

S2 requires an `InstructionStatusUpdate` for every instruction until it reaches SUCCEEDED, REVOKED, REJECTED or ABORTED (docs.s2standard.org, InstructionStatusUpdate). `s2-frbc` left instructions at STARTED in three cases: an instruction the flow never confirmed because a newer one overtook it, repeated instructions for the same mode (only the newest was closed), and instructions the CEM revoked after they had reached the flow. The Rust EMS hits all three: it plans in 15-minute steps, often repeats a mode, and revokes its previous plan on every re-plan. The standard does not define when an FRBC instruction succeeds, what happens to a superseded instruction, or how to handle a revoke after start, so this change makes those choices explicit.

## What Changes

- A confirmation closes every open instruction it fulfils (same actuator, mode and factor) as SUCCEEDED; older open instructions of that actuator get ABORTED.
- A newer instruction for the same actuator that asks for another mode aborts unconfirmed earlier ones; an earlier one for the same mode stays open.
- A revoke for an instruction already passed to the flow gets REVOKED, and the flow receives a `Revoked` message.
- Open instructions get ABORTED when the CEM switches to another control type, and when more than 50 are open; nothing is sent when the session ends.

## Capabilities

### Modified Capabilities
- `control-type-frbc`: final instruction status in every case.

## Impact

- `src/lib/s2/frbc-controller.ts`, `src/nodes/s2-frbc/` (help, new `Revoked` output topic), tests, CHANGELOG, `docs/S2_REFERENCE.md`. No change to s2-rm.
