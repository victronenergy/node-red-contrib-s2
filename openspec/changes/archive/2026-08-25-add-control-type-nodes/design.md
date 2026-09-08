## Context

See proposal.md - Why. Today `s2-rm` bundles the generic S2 protocol state machine (`S2Session` in `src/lib/s2/session.ts`) with control-type-specific behavior: OMBC mode/status handling is baked into `session.ts` (`_sendOMBCSystemDescriptionAndStatus`, `updateOMBCStatus`, auto-sent at instruction-accept time), and PEBC schedule accumulation/timer dispatch/persistence lives directly in `src/nodes/s2-rm/index.ts` (~150 lines, including the `scheduleNextDispatch` fix from this session). FRBC/DDBC/PPBC have no equivalent - their instructions are only ever ack'd and forwarded raw. `s2-rm-config` mixes pure RM identity fields (resourceId, roles, name) with control-type-specific ones (gridConnection, maxBatteryChargePower/DischargePower are PEBC-only). Only OMBC and PEBC are in active use (one live flow); FRBC/DDBC/PPBC have no current user.

## Goals / Non-Goals

**Goals:**
- Separate generic S2 protocol plumbing (`s2-rm`) from control-type-specific behavior (new `s2-ombc`, `s2-pebc` nodes), so users get ready-made building blocks instead of hand-written function nodes for UUID generation, mode/state tracking, and raw S2 message construction.
- Preserve the PEBC scheduling logic (and its recent fix) by relocating it into `s2-pebc`, not deleting it.
- Keep `s2-rm`'s output/command surface stable enough that adding a control type later (FRBC, DDBC, PPBC) doesn't require another breaking change to `s2-rm` itself.

**Non-Goals:**
- Building FRBC, DDBC, or PPBC support. Out of scope for this change; `s2-rm` keeps raw-passing-through their instructions exactly as it does today.
- Providing a migration/compat path for existing deployed flows. Not needed - single active flow, user has accepted breaking changes.
- Deciding the full "request-response state machine" pattern from the original tester proposal wholesale. This change adopts only the pieces needed for OMBC/PEBC (a generic `UpdateStatus` command); a broader request/ask mechanism is not introduced.

## Decisions

1. **Split `s2-rm` into a protocol layer + per-control-type nodes**, rather than (a) leaving control-type logic embedded in `s2-rm` as today, or (b) fully generalizing `s2-rm` into a state machine and pushing all control-type logic into user flows (the tester's original proposal). Keeps `s2-rm` reusable across control types while still giving users ready-made behavior, and avoids losing the just-fixed PEBC scheduler.

2. **Control-type nodes talk back to `s2-rm` via its existing command-based input channel** (`msg.payload.command`), adding a new `UpdateStatus` command, rather than inventing a new port/protocol pairing between `s2-rm` and its control-type nodes. Reuses an established pattern already used by `Connect`/`Message`/`PowerConstraints`/`Forecast`/`InstructionStatus` - no new wiring concept for users.

3. **`s2-rm` emits all instructions on one enriched output, namespaced by `msg.controlType`** (with `msg.ombc` / `msg.pebc` payloads), rather than a dedicated output port per control type. Keeps `s2-rm`'s output count independent of how many control types exist or get added later.

4. **Control-type nodes pass through non-matching instructions unchanged and raise a `node.status()` warning**, rather than silently dropping them or erroring. Lets `s2-ombc` and `s2-pebc` be wired in parallel downstream of the same `s2-rm` output without one node consuming messages meant for the other, while still surfacing likely misconfiguration.

5. **Each control-type node owns a dedicated config node** for its domain-specific settings (operation modes/transitions for `s2-ombc`; grid wattage / power-constraint defaults for `s2-pebc`), rather than a shared JSON blob on `s2-rm` or extra fields bolted onto `s2-rm-config`. Mirrors the S2 spec's own separation (`ResourceManagerDetails` vs. per-control-type `SystemDescription`) and keeps `s2-rm-config` from growing with every control type added later.

6. **`s2-rm` drops from 4 outputs to 3**, removing the PEBC-specific "schedule" port (now `s2-pebc`'s own output) rather than keeping a vestigial control-type-specific port on an otherwise generic node.

7. **`s2-ombc` preloads its system description by pushing it through a new `SystemDescription` command**, mirroring `UpdateStatus`: `s2-ombc` observes `SelectControlType` on `s2-rm`'s "from CEM" output, then sends `{ command: 'SystemDescription', cemId, controlType, ombc: {...} }` back through `s2-rm`'s existing command-input channel for `s2-rm` to relay to the CEM. Resolves the prior open question in favor of matching today's behavior without introducing a new request/response mechanism (a non-goal for this change).

## Risks / Trade-offs

- [More nodes to wire per flow: `s2-rm` + `s2-ombc`/`s2-pebc` + their configs, vs. today's single `s2-rm`] → Mitigation: still fewer nodes than today's flows that need function nodes for UUID generation and state tracking; update example flows to show the new minimal pattern.
- [FRBC/DDBC/PPBC stay raw-pass-through, so a CEM offering those gets a worse experience than OMBC/PEBC] → Mitigation: explicitly out of scope and documented as future work; no regression vs. current behavior for those types.
- [Breaking `s2-rm-config` schema (removing PEBC-only fields) affects anyone relying on the current shape] → Mitigation: accepted - single active flow, no other known consumers.
- [Relocating rather than rewriting the PEBC scheduler risks reintroducing bugs during the move] → Mitigation: `schedule.ts` and its test suite move together with the code; the `scheduleNextDispatch` regression test added this session comes with it.

## Migration Plan

- Current `main` keeps receiving non-breaking patches as needed in the meantime.
- This change is developed on its own branch/track. The one live flow stays on current `main` until `s2-rm` (trimmed) + `s2-ombc` + `s2-pebc` are ready, then cuts over in a single step - no gradual or parallel-run migration required.

## Open Questions

- ~~**System description delivery for `s2-ombc`**~~ - Resolved: preload, pushed via command. `s2-ombc` wires to `s2-rm`'s "from CEM" output to observe `SelectControlType`, then pushes the system description back to `s2-rm` via a new `SystemDescription` command (same command-channel pattern as `UpdateStatus`) for `s2-rm` to send to the CEM. Matches today's behavior; no new request/response protocol introduced.
