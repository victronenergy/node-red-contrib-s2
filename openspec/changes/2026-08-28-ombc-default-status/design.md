## Context

`s2-ombc` keeps per-CEM state in two places: an in-memory `cemStates` map (`selectedControlType`, populated from `SelectControlType`/`Disconnected`) and a `node.context()`-persisted status keyed `PERSISTED_STATUS_KEY_PREFIX + cemId`. Neither has anywhere to put a status that isn't tied to a `cemId` yet. See proposal.md for motivation.

## Goals / Non-Goals

**Goals:**
- Let a confirm message be injected at flow-deploy time, before any CEM exists, and have it apply to whichever CEM later selects OMBC.
- Let a confirm message identify the operation mode without the caller having to know its config-authored UUID.
- Tell the flow, deterministically, when it must supply a status.

**Non-Goals:**
- Multi-CEM OMBC fan-out (the ambiguous case is an error, not a feature).
- Changing the `OMBC.Status` wire message itself.

## Decisions

**cemId resolution.** Reuse the existing `cemStates` map: filter for `selectedControlType === ControlType.OMBC`. Zero matches -> default case (see below). One match -> use it, existing confirm logic unchanged from there. More than one -> `done(new Error(...))`, same failure style as today's missing-field validation.

**Mode identifier resolution.** Exactly one of `confirmedOperationModeId` / `confirmedOperationModeIndex` / `confirmedOperationModeLabel` is accepted per message. Requiring exactly one (erroring on zero or on more than one) keeps resolution unambiguous and matches this node's existing all-or-nothing validation style for `handleConfirm`, rather than adding a silent precedence order that would be easy to misread. All three are resolved against `systemDescription.operationModes` (the same array `resolveMode` already reads) down to the canonical `id` before anything is stored - `activeOperationModeId` on the persisted/default status is always an id, matching the wire format.

`confirmedOperationModeId` is validated against the configured list too, not just passed through - the S2 schema (`OMBC.OperationMode.id`) requires it to be a UUID unique within the announced system description, and `s2python` enforces `uuid.UUID` on it; today's `handleConfirm` sends whatever string it's given straight into `active_operation_mode_id` with no check, so this closes a real, pre-existing gap while this code is already being touched.

`confirmedOperationModeLabel` must match exactly one configured mode. The S2 schema declares `diagnostic_label` optional and does not declare it unique (only `id` is documented as unique), so zero matches and multiple matches are both real possibilities, not edge cases to hand-wave - both are rejected with an error rather than silently picking a mode.

**Default storage.** A single `node.context()` key (e.g. `s2OmbcDefaultStatus`), separate from the per-CEM `PERSISTED_STATUS_KEY_PREFIX + cemId` entries - not a map, since only one default is meaningful (there is one system description per `s2-ombc` node). Consulted only when a CEM has no persisted status of its own, in `handleSelectControlType`, at the same point that existing persisted status is consulted today.

**StatusRequest shape.** `{ topic: 'StatusRequest', cemId }` on the instruction output (port 1), matching the existing lifecycle-event convention used elsewhere (`{ topic: 'Connected', cemId }` in `s2-rm`) rather than inventing a new envelope shape. Sent immediately after the `SystemDescription` command, not gated on the CEM's `ReceptionStatus` for it.

## Risks / Trade-offs

- Rejecting on a duplicate `diagnostic_label` means a config with two identically-labeled modes (nothing in the S2 schema forbids this) makes `confirmedOperationModeLabel` unusable for those modes until the labels are made unique; `confirmedOperationModeId`/`Index` remain usable in that case.
- Treating "zero CEMs with OMBC selected" as the default case (rather than only "before any CEM has ever connected") means a confirm sent with no `cemId` after a CEM disconnects also updates the default, not a stale per-CEM entry. This is intentional - it is the simplest rule that covers both the pre-connection case and re-arming a default after a disconnect - but it means a caller cannot use a `cemId`-less confirm to target "the last CEM I talked to" once that CEM's OMBC selection has lapsed; they must pass `cemId` explicitly for that.
