## Context

`S2ResourceManager` (`src/lib/s2/resource-manager.ts`) is constructed once per node with a fixed `rmDetails: RmDetails` (including `availableControlTypes`) - shared code path for both `s2-rm` and `s2-resource`. It resolves any `{{...}}` templates once (constructor time) into `resolvedDetails`, and passes that same object to every `S2Session` it creates (one per connecting CEM). Each `S2Session` (`src/lib/s2/session.ts`) sends `ResourceManagerDetails` exactly once, during handshake (`this._send(makeResourceManagerDetails(this._rmDetails))`), from a private `_rmDetails` field set at session-construction time. Nothing today mutates `availableControlTypes` after construction, and no session resends `ResourceManagerDetails` after the initial handshake.

Both `s2-rm-config`'s and `s2-resource`'s HTML editors render their own separate "Not Ctrl" checkbox (`s2-rm-config-ct-checkbox`/`s2-resource-ct-checkbox` classes, distinct markup, same `NOT_CONTROLABLE` value) as part of an otherwise-identical manually-editable control-types list.

See `proposal.md` - Why / What Changes for motivation; this document covers only how.

## Goals / Non-Goals

**Goals:**
- Make `available_control_types` mutable at runtime for any `S2ResourceManager` instance, driven by a new `SetAvailableControlTypes` command - applies uniformly to `s2-rm` and `s2-resource`, since both share this class.
- Guarantee every RM always advertises `NOT_CONTROLABLE`, enforced once in the shared `S2ResourceManager`, not duplicated per node.

**Non-Goals:**
- No time-of-day scheduling primitive. The "OMBC controllable 10:00-18:00" example is satisfied by the user wiring their own trigger (e.g. an inject/cron node, or a time-window check) to send `SetAvailableControlTypes` - this change adds the command, not a scheduler.
- No forced deselect/disconnect logic when a CEM's active control type becomes unavailable (see proposal.md and the `s2-rm-protocol` delta).
- `NO_SELECTION` (a distinct S2 value meaning "nothing chosen yet") is untouched entirely - not forced on anywhere, not part of this change.

## Decisions

### `NOT_CONTROLABLE` enforcement lives in `S2ResourceManager`, not per-node
Because this now applies uniformly to every RM (both `s2-rm` and `s2-resource` construct a `S2ResourceManager`), the union-in-`NOT_CONTROLABLE` logic belongs in the shared class itself, not duplicated in each node's `index.ts`:
- At construction, `S2ResourceManager` unions `'NOT_CONTROLABLE'` into the `availableControlTypes` it stores as mutable instance state (see below), regardless of what `rmDetails.availableControlTypes` the caller passed in.
- On `SetAvailableControlTypes`, the same union is re-applied before storing/resending, so it can never be removed at runtime either.

This means `s2-rm/index.ts` and `s2-resource/index.ts` need no special-case interception logic for this guarantee - they just pass through whatever list their own config/UI produces, same as today. The only per-node work is UI: removing the "Not Ctrl" checkbox from both `s2-rm-config/index.html` and `s2-resource/index.html`'s manual lists, since checking/unchecking it no longer has any effect.

**Alternative considered (from this change's earlier draft):** enforce it at each node's `index.ts` boundary instead of centrally. That was the right call when this was scoped to `s2-resource` only (an `s2-resource`-specific UX decision, deliberately not shared with `s2-rm-config`); now that the guarantee applies to every RM, centralizing it in `S2ResourceManager` avoids duplicating identical union logic in two places and can't drift between them.

### `rmDetails.availableControlTypes` becomes mutable, resolved fresh per use
`S2ResourceManager` keeps `availableControlTypes` as mutable instance state rather than a value baked into a single `resolvedDetails` object at construction. `SetAvailableControlTypes` updates that state (always re-including `NOT_CONTROLABLE`), then:
- re-sends `ResourceManagerDetails` to every currently connected session (looping `this.sessions.values()`, the same iteration pattern already used elsewhere in `resource-manager.ts`, e.g. for broadcasting on disconnect), and
- is picked up automatically by any session created afterward, since new sessions read the current state at construction rather than a stale snapshot.

`S2Session` needs a way to send `ResourceManagerDetails` outside of the initial handshake path - either a small public method (e.g. `resendResourceManagerDetails(details)`) or by updating `_rmDetails` and re-invoking the existing private send call. The resent message reuses `makeResourceManagerDetails` with the RM's full current `rmDetails` (only `available_control_types` differs from the original send; `resource_id`, `roles`, `instruction_processing_delay`, etc. stay as configured) and gets a fresh `message_id`, since [`ResourceManagerDetails.message_id`](https://docs.s2standard.org/model-reference/Common/ResourceManagerDetails/) is mandatory and each S2 message needs its own. Exact method shape is an implementation detail for tasks.md, not a spec-level concern.

### Command shape: full replace, no `cemId`
`SetAvailableControlTypes` carries the complete new list (`{ command: 'SetAvailableControlTypes', availableControlTypes: [...] }`), consistent with the user's choice and the existing `UpdateStatus`/`SystemDescription` commands' shape (namespaced payload, dispatched via the same `command`-field switch in `S2ResourceManager.handleInput`). No `cemId` is needed since it isn't addressed to one session - it changes the RM's own advertised capabilities, applied to all sessions.

**Alternative considered:** per-type enable/disable toggles. Rejected per the user's explicit preference - replace-the-list keeps the RM stateless with respect to toggle history and matches the existing generic-command precedent.

### No forced deselect
Per proposal.md and the `s2-rm-protocol` delta: when `SetAvailableControlTypes` removes a CEM's currently-selected control type, `S2ResourceManager` only resends `ResourceManagerDetails` - it does not touch the session's active state, send a synthetic `SelectControlType`, or disconnect. This matches the user's choice and avoids inventing protocol-initiated deselect behavior the S2 standard doesn't define.

## Risks / Trade-offs

- **Mid-session `ResourceManagerDetails` resend is not addressed by the S2 standard at all** ([confirmed against the standard's own docs](https://docs.s2standard.org/model-reference/Common/ResourceManagerDetails/): no guidance on resending or on control-type availability changing after the initial handshake) - real CEM implementations may not expect or handle a second one gracefully -> Mitigation: exercise this against the project's mock-CEM test tooling (see tasks.md) before merging, and ideally against a real CEM if one is available for manual testing. Not a blocking research gap the way the `2026-09-07-s2-json-schema-validation` proposal's protocol-version mismatch was - `ResourceManagerDetails` is structurally the same message resent, not a different shape - but worth flagging as spec-silent territory.
- **Every existing deployed `s2-rm`/`s2-resource` flow's advertised control types change on next redeploy** (gains `NOT_CONTROLABLE` where it may not have had it) -> Mitigation: additive-only (no existing value removed, no message shape change); called out explicitly in proposal.md's Compatibility note and in release notes (see tasks.md).
- **Replace-the-list shape requires the sender to always know and resend the full desired list** (not just "toggle OMBC off") -> Mitigation: this is the user's deliberate choice; document it clearly in `s2-resource`'s/`s2-rm`'s help text/tooltip with a worked example (time-window use case), so flow authors don't try to send a partial/incremental list.

## Migration Plan

No data migration. Nothing to run - the behavior change takes effect automatically on the next deploy of any flow containing `s2-rm` or `s2-resource`, since it's derived at construction time from existing config rather than stored state. No rollback mechanism beyond reverting the code change (there is no persisted flag this change introduces that would need cleanup). Call out the advertised-control-types change in this release's changelog so integrators watching `ResourceManagerDetails` on the CEM side aren't surprised (see tasks.md).

## Open Questions

- If a flow needs several independent sources to gate different control types simultaneously (e.g. one trigger for OMBC's time window, another for a separate PEBC condition), the replace-the-list shape pushes list-merging responsibility onto the flow author. Whether a future per-type toggle command is worth adding is left open - it doesn't change this change's specs or approach, only a possible follow-up.
