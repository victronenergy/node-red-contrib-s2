## Context

See proposal.md - Why/What Changes for motivation. Current state (post `2026-09-14-control-type-availability`, v0.7.1):

- `S2ResourceManager` (`src/lib/s2/resource-manager.ts`) unions `NOT_CONTROLABLE` into `availableControlTypes` in two places: once at construction (`this.withNotControlable(opts.rmDetails.availableControlTypes)`), and again in `handleInput`'s `SetAvailableControlTypes` branch (`this.withNotControlable(availableControlTypes)`). `withNotControlable` is the only place this union happens.
- `s2-rm-config/index.html` and `s2-resource/index.html` both had a "Not Ctrl" checkbox in their manually-editable control-types list; both were removed in `ac6612d` (the commit implementing the change now being reversed). `s2-resource`'s checkbox lived inside `#s2-resource-controltypes-section`, which is only shown when `Control type: None` is selected - when `Control type: OMBC` is selected, `oneditsave` hardcodes `this.controlTypes = 'OPERATION_MODE_BASED_CONTROL'` and the whole section is hidden, so there was never a `NOT_CONTROLABLE` checkbox reachable from the OMBC path even before `ac6612d`.
- Both editors persist `controlTypes` as a single comma-separated string (`node-config-input-controlTypes` / `node-input-controlTypes`), rebuilt from checked boxes in `oneditsave` and used to re-check boxes from in `oneditprepare`. Node-RED does not track *why* a value is what it is - a stored string without `NOT_CONTROLABLE` is indistinguishable from "user unchecked it" vs. "this flow predates the checkbox entirely."
- `src/lib/s2/schema-validation.ts` has an existing `isKnownAdvisoryError` bypass for the upstream S2 JSON schema's `maxItems: 5` on `available_control_types` - the *S2 `ControlType` enum itself* has 6 values (5 real control types + `NOT_CONTROLABLE`), so a resource advertising all 6 legitimately exceeds the upstream schema's (buggy) cap regardless of how `NOT_CONTROLABLE` gets into the list. This bypass is independent of the forced-union behavior and needs no functional change - only its comment's phrasing references the now-reversed guarantee.

## Goals / Non-Goals

**Goals:**
- Remove the forced union everywhere (deploy-time and runtime), per the user's explicit direction, while keeping the common case working the same as today by default (checkbox checked).
- Give `SetAvailableControlTypes` a stateless, single-call way to toggle a resource fully off (`[NOT_CONTROLABLE]` only) and back on (the deploy-time configured list) without the caller tracking or re-sending the full list itself.
- Keep `s2-rm` and `s2-resource` behaviorally identical for this feature, consistent with both being thin wrappers around the same `S2ResourceManager`.

**Non-Goals:**
- No migration of already-persisted `controlTypes` values - see Risks/Trade-offs; there is no reliable signal to migrate on.
- No change to `isKnownAdvisoryError`'s bypass logic itself (only its comment).
- No new validation preventing an empty `availableControlTypes: []` runtime payload - "explicit only" means the caller owns that choice now, same as any other value in the list.

## Decisions

### Track the deploy-time configured list separately from the mutable advertised list
`S2ResourceManager` gains a second, readonly field alongside the existing mutable `this.rmDetails.availableControlTypes`:

```ts
private readonly configuredControlTypes: string[]
```

Set once in the constructor from `opts.rmDetails.availableControlTypes` (copied, not referenced - same shallow-copy rationale as the existing `rmDetails` comment), and never reassigned afterward. `isControllable: true` restores `this.rmDetails.availableControlTypes` from this field. This is the same pattern the archived change's own design.md used to justify keeping `rmDetails` mutable instance state ("resolved fresh per use") - extended with one more piece of stable state to restore to, rather than trying to reconstruct "what was configured" from `this.rmDetails` after it's been mutated by prior `SetAvailableControlTypes` calls.

**Alternative considered:** re-read `opts.rmDetails.availableControlTypes` directly instead of a dedicated field. Rejected - `opts` is retained on `this.opts` for callbacks, but reaching back into `opts.rmDetails` from two different call sites (constructor union removal, and the new restore path) is more fragile than one clearly-named field documenting its purpose.

### Drop `withNotControlable`, both call sites become plain assignment
- Constructor: `this.rmDetails = { ...opts.rmDetails }` (no union - the shallow-copy-to-avoid-mutating-the-caller's-object rationale in the existing comment stays, only the union itself goes).
- `handleInput`'s `SetAvailableControlTypes` branch: `this.rmDetails.availableControlTypes = availableControlTypes` (the caller's list, verbatim, when the list form is used).
- `withNotControlable` and the class-doc comment referencing it are deleted, not deprecated - nothing else calls it.

### `isControllable` shortcut: mutually exclusive with `availableControlTypes`, no new command name
Extends the existing `SetAvailableControlTypes` command rather than adding a new one, since it's the same operation (replace the advertised list) with a different way of specifying the replacement:

```ts
const { availableControlTypes, isControllable } = msg.payload as {
  availableControlTypes?: string[]
  isControllable?: boolean
}
const hasList = availableControlTypes !== undefined
const hasFlag = isControllable !== undefined
if (hasList === hasFlag) {
  done(new Error("SetAvailableControlTypes requires exactly one of 'availableControlTypes' or 'isControllable'"))
  return
}
if (hasList) {
  if (!Array.isArray(availableControlTypes)) { done(new Error('...')); return }
  this.rmDetails.availableControlTypes = availableControlTypes
} else {
  this.rmDetails.availableControlTypes = isControllable
    ? [...this.configuredControlTypes]
    : [ControlType.NOT_CONTROLABLE]
}
```
`hasList === hasFlag` catches both "neither provided" (existing required-field validation, preserved) and "both provided" (new - ambiguous, rejected rather than picking a precedence order).

**Alternative considered:** let `isControllable` compose with `availableControlTypes` (e.g. `isControllable: false` overrides an also-present list). Rejected - two ways to specify the same outcome invites contradictory payloads (`{ availableControlTypes: ['OMBC'], isControllable: false }` - which wins?) for no real use case; a caller who wants a specific non-`NOT_CONTROLABLE`-only list already has the full-replace form.

### Checkbox restoration: same UI pattern, new default value
`s2-rm-config/index.html`: reinstate the exact checkbox line removed in `ac6612d` (`value="NOT_CONTROLABLE"`, "Not Ctrl" label) inside the existing `.s2-control-types-container`, and revert the tooltip/help text touched in that same commit back to the pre-`ac6612d` wording. "Checked by default for new nodes" falls out of the existing `oneditprepare` mechanism (checkbox state is derived from the stored `controlTypes` string) plus one default-value change: `defaults.controlTypes.value` becomes `'OPERATION_MODE_BASED_CONTROL,NOT_CONTROLABLE'` instead of `'OPERATION_MODE_BASED_CONTROL'`, since that value is what a newly-dragged-in node starts with before any save. No new "default checked" logic is needed - it's the same string-derived-checkbox mechanism already in place, just fed a different default string.

`s2-resource/index.html`: same checkbox addition, but placed in the **Control tab** (`#s2-resource-panel-ct`) - directly under the `Control type` selector, outside both `#s2-resource-ct-ombc` and the None-mode manual control-types list - so it renders once and stays visible and effective for both `Control type: OMBC` and `Control type: None`, since neither path currently offers any `NOT_CONTROLABLE` control. (Earlier draft of this decision placed it in the RM tab, next to Roles/Control Types; corrected per review - the RM tab is Identity/Roles/Power Meas., the Control tab is where every other control-type-related choice on this node lives, and that's where a control-type-availability toggle belongs.) `oneditsave` changes from:
```js
if ($('#node-input-controlType').val() === 'ombc') {
  this.controlTypes = 'OPERATION_MODE_BASED_CONTROL'
} else {
  var checkedCt = []
  $('.s2-resource-ct-checkbox:checked').each(function () { checkedCt.push($(this).val()) })
  this.controlTypes = checkedCt.join(',')
}
```
to unioning the standalone checkbox's value into both branches' result before joining. `defaults.controlTypes.value` gets the same `,NOT_CONTROLABLE` suffix as `s2-rm-config`.

**Alternative considered:** two separate checkboxes (one inside the OMBC tab, one inside the None section) instead of one standalone control. Rejected - it's the same boolean for the same node either way; one shared checkbox avoids the two copies drifting (e.g. one checked, one not, depending on which `Control type` was last active when saved).

### NOT_CONTROLABLE sorts first in the configured list when checked
Per user request: both editors' `oneditsave` place `NOT_CONTROLABLE` at the front of the resulting `controlTypes` string when its checkbox is checked, regardless of the checkbox's own position in the DOM or the order of the rest of the manually-picked list (`s2-rm-config`'s checkbox is visually last in its list; `s2-resource`'s standalone checkbox is unshifted into the array, not pushed). `defaults.controlTypes.value` on both nodes becomes `'NOT_CONTROLABLE,OPERATION_MODE_BASED_CONTROL'` (was `'OPERATION_MODE_BASED_CONTROL,NOT_CONTROLABLE'`) so a newly-dragged-in node's starting value already matches. This is purely a deploy-time config-generation convention - it does not extend to `SetAvailableControlTypes`'s list form, which still assigns the caller's array verbatim (no reordering), per that command's "exactly that list" spec requirement.

## Risks / Trade-offs

- **No reliable migration for already-deployed flows.** Any `s2-rm`/`s2-resource` flow deployed between v0.7.1's release and this change has a persisted `controlTypes` string with no `NOT_CONTROLABLE` in it (there was no checkbox to check, and the old default value didn't include it) - the runtime added it unconditionally regardless of stored config. Restoring the checkbox and changing the *default* only affects *newly created* nodes going forward; it does nothing for already-persisted config, because Node-RED's stored value carries no signal distinguishing "explicitly unchecked" from "checkbox didn't exist yet" - both look identical (`NOT_CONTROLABLE` absent from the string). On this change's rollout, any such flow that gets redeployed **silently stops advertising `NOT_CONTROLABLE`** unless someone opens its config node and checks the box. -> Mitigation: this is a one-time, disclosed behavior change, not a bug to code around - call it out prominently in CHANGELOG.md (cross-referencing the v0.7.1 entry it reverses) and in proposal.md's Impact section (already done), instructing anyone relying on the guarantee to open `s2-rm-config`/`s2-resource` and check "Not Ctrl" before their next redeploy. No code-level migration is attempted because none can distinguish the two cases.
- **`[]` (or any list omitting `NOT_CONTROLABLE`) is now taken literally**, including via `SetAvailableControlTypes`'s list form - a resource can end up advertising zero selectable control types, which the S2 standard's "mandatory field" intent arguably discourages. -> Mitigation: this is the explicit behavior the user asked for ("only work explicitly"); `isControllable: false` is the documented, recommended way to reach "not controllable only" without relying on list contents, and README documents the distinction.
- **`s2-resource`'s two `Control type` modes (OMBC / None) now share one `NOT_CONTROLABLE` checkbox** rather than each having its own historical checkbox inside the (sometimes-hidden) manual list. -> Mitigation: this is a deliberate simplification (see Decisions) - functionally equivalent to two checkboxes kept in sync, without the sync-drift risk.

## Migration Plan

No data migration (none possible - see Risks). Deploy steps:
1. Merge and release. Existing deployed flows keep their current stored `controlTypes` string unchanged; the *behavior* they get on next redeploy depends solely on whether that string already contained `NOT_CONTROLABLE` (it didn't, for anything deployed under v0.7.1's forced-union regime).
2. CHANGELOG.md entry explicitly tells users who rely on the guarantee to check the box before redeploying.
3. Rollback: revert the code change. No persisted state introduced by this change needs cleanup (the `configuredControlTypes` field is in-memory only, rebuilt from config on every restart/redeploy).
