> Reset 2026-09-17: the first implementation pass was fully reverted (working tree restored to
> `HEAD`, no committed history to unwind) after a placement correction - see task 3.1. Re-doing
> tasks 1-6 below from a clean tree; nothing here is implemented yet.

## 1. `S2ResourceManager` - remove forced union, add `configuredControlTypes`

- [x] 1.1 Add failing/updated tests in `test/lib/resource-manager.test.ts` first (TDD): rewrite `'always includes NOT_CONTROLABLE even when the configured list omits it'` to assert the opposite (omitted list stays omitted); rewrite `'SetAvailableControlTypes replaces the list, re-including NOT_CONTROLABLE, and resends ResourceManagerDetails to a connected session'` to assert the list form no longer re-adds it; add new cases for `{ isControllable: false }` (advertises exactly `['NOT_CONTROLABLE']`), `{ isControllable: true }` (restores the constructor's configured list, including after a prior list-form `SetAvailableControlTypes` call), and rejection when both/neither of `availableControlTypes`/`isControllable` are present
- [x] 1.2 In `src/lib/s2/resource-manager.ts`: delete `withNotControlable` and its class-doc comment; constructor sets `this.rmDetails = { ...opts.rmDetails }` (no union) and a new `private readonly configuredControlTypes: string[]` copied from `opts.rmDetails.availableControlTypes`
- [x] 1.3 Rewrite the `SetAvailableControlTypes` branch in `handleInput` per design.md's Decisions section: mutually-exclusive `availableControlTypes`/`isControllable` handling, list form assigns verbatim, `isControllable: false` -> `[ControlType.NOT_CONTROLABLE]`, `isControllable: true` -> copy of `this.configuredControlTypes`
- [x] 1.4 Run `npm test` and confirm all `resource-manager.test.ts` cases pass

## 2. `s2-rm-config` editor - restore opt-out checkbox

- [x] 2.1 In `src/nodes/s2-rm-config/index.html`: re-add the `NOT_CONTROLABLE`/"Not Ctrl" checkbox to `.s2-control-types-container` (same markup `ac6612d` removed); change `defaults.controlTypes.value` to `'OPERATION_MODE_BASED_CONTROL,NOT_CONTROLABLE'`; revert the Control Types label tooltip and the Identity help-panel paragraph to their pre-`ac6612d` wording (checkbox exists, not forced)
- [x] 2.2 Verify existing `oneditprepare`/`oneditsave` checkbox-derived logic (already generic over `.s2-rm-config-ct-checkbox`) picks up the new checkbox with no other JS changes needed

## 3. `s2-resource` editor - standalone opt-out checkbox on the Control tab

- [x] 3.1 In `src/nodes/s2-resource/index.html`: add a standalone `NOT_CONTROLABLE` checkbox (`#node-input-notControlable`) inside `#s2-resource-panel-ct` (the **Control** tab), directly under the `Control type` (OMBC/None) selector and outside both `#s2-resource-ct-ombc` and the None-mode manual control-types list, so it renders once and stays visible/effective for both modes. **Correction from the first pass:** the checkbox was originally placed in the RM tab (near Roles/Control Types) - moved to the Control tab per design.md's updated Decisions section, since that's where every other control-type-related choice on this node lives; initialize its checked state from `savedCt` the same way the other checkboxes are
- [x] 3.2 Update `oneditsave` (around the `if ($('#node-input-controlType').val() === 'ombc') { ... } else { ... }` block) so both branches union the standalone checkbox's value into `this.controlTypes` before joining
- [x] 3.3 Change `defaults.controlTypes.value` to `'OPERATION_MODE_BASED_CONTROL,NOT_CONTROLABLE'`
- [x] 3.4 Update the Control Types tooltip (RM tab) and the node's help-panel paragraphs to match the new opt-out model and the checkbox's Control-tab location: the Identity section paragraph no longer mentions a Not-Ctrl checkbox (it moved out of the RM tab), the Control Type tab paragraph gains a mention of it, and the `SetAvailableControlTypes` example (currently says "NOT_CONTROLABLE is always included, even if omitted") is updated
- [x] 3.5 Add/update tests in `test/nodes/s2-resource.test.ts` covering: default-checked new node advertises `NOT_CONTROLABLE`; unchecking it (both in OMBC and None modes) omits it from advertised control types (also update any pre-existing status-text assertions elsewhere in the file that incidentally assert the old forced `,NC` suffix)

## 4. Housekeeping in adjacent code

- [x] 4.1 Update the `isKnownAdvisoryError` comment in `src/lib/s2/schema-validation.ts` (lines ~21-25) - the `maxItems: 5` discrepancy is about the S2 `ControlType` enum having 6 values vs. the upstream schema's cap, not about a forced-union guarantee; reword without implying `NOT_CONTROLABLE` is still always advertised. No logic change.

## 5. Documentation

- [x] 5.1 Update `README.md`'s "Updating available control types at runtime" section: drop "NOT_CONTROLABLE is always re-added automatically if omitted"; document the checkbox opt-out at config time; document `isControllable: true`/`false` alongside the existing `availableControlTypes` example; update the "Sending `availableControlTypes: []`..." paragraph (superseded by `isControllable: false`, but `[]` still works literally)
- [x] 5.2 Update `src/nodes/s2-rm/index.ts`'s header comment (the `SetAvailableControlTypes` example around line 40) to match the new command shape and behavior
- [x] 5.3 Update `src/nodes/s2-resource/index.html`'s help panel `SetAvailableControlTypes` paragraph (already covered by 3.4, cross-check it's consistent with 5.1)
- [x] 5.4 Add a `CHANGELOG.md` entry reversing the relevant v0.7.1 entry, explicitly telling users who rely on the old guarantee to check "Not Ctrl" on `s2-rm-config`/`s2-resource` before their next redeploy (see design.md's Risks/Trade-offs - no automatic migration is possible)

## 6a. NOT_CONTROLABLE sorts first when checked (added mid-implementation, per user request)

- [x] 6a.1 `s2-rm-config/index.html`: change `defaults.controlTypes.value` to `'NOT_CONTROLABLE,OPERATION_MODE_BASED_CONTROL'`; `oneditsave` moves `NOT_CONTROLABLE` to the front of the checked-checkbox array before joining, regardless of its checkbox's position in the list
- [x] 6a.2 `s2-resource/index.html`: same `defaults.controlTypes.value` change; `oneditsave` unshifts (not pushes) `NOT_CONTROLABLE` in the `Control type: None` branch, and orders the OMBC branch's literal string with `NOT_CONTROLABLE` first
- [x] 6a.3 Update `test/nodes/s2-resource.test.ts`'s NOT_CONTROLABLE-opt-out test fixtures/assertions to the new `NOT_CONTROLABLE`-first order
- [x] 6a.4 `npm test` passes in full after the reorder

## 6b. Label rename + bug fix found during live browser verification (6.3)

- [x] 6b.1 Renamed the checkbox label from "Not Ctrl" to "Not Controllable" in both `s2-rm-config/index.html` and `s2-resource/index.html` (checkbox label + help-panel prose), per user request; documented in README that status-bar `NC` is short for `NOT_CONTROLABLE`
- [x] 6b.2 **Pre-existing bug found via live Node-RED testing, not caught by unit tests:** `s2-resource/index.html`'s `oneditsave` assigned `this.controlTypes = ...` directly, but `#node-input-controlTypes` is a real (hidden) form field - Node-RED's own automatic property-extraction step runs *after* `oneditsave` and silently overwrote that assignment with the (stale, dialog-open-time) value of the hidden input, since nothing ever wrote the computed value back into it (unlike `roles`, which already did this correctly). This meant the Control Types field - including the new "Not Controllable" checkbox - never actually round-tripped through the editor at all, for either `Control type: OMBC` or `None`, predating this change entirely. Fixed by writing into `$('#node-input-controlTypes').val(...)` instead of `this.controlTypes` directly, matching the existing `roles`/`systemDescription` pattern. No unit test caught this, since `test/nodes/s2-resource.test.ts` constructs runtime config directly rather than driving the editor DOM - confirmed only by scripting the actual Node-RED editor via `javascript_tool` (screenshots/`read_page` time out on this page's persistent websocket, so `RED.editor.edit(...)` + direct DOM/jQuery calls were used instead).

## 6. Verification

- [x] 6.1 `npm test` passes in full (522/522; also fixed 2 pre-existing status-text/RMD assertions in `test/nodes/s2-rm.test.ts` that incidentally depended on the old forced-union behavior)
- [x] 6.2 `npm run build` succeeds (`tsc` + `copy-html` + `copy-schemas` - no bundler step touches the editor JS in this repo)
- [x] 6.3 Manually exercised both editors in a running Node-RED instance via `RED.editor.edit()` + scripted DOM/jQuery calls (screenshots/`read_page` time out on this page's persistent websocket): confirmed the checkbox appears (Control tab for `s2-resource`, checked by default), and persists correctly on save/reload in both `Control type: OMBC` and `None`, and for `s2-rm-config`. Found and fixed two real pre-existing bugs in the process (see 6b) that unit tests never caught. Extended per user request: ran a real S2 handshake against the actual device via `mcp__venus__s2_call` (`Connect` + `HandshakeResponse` against `com.victronenergy.acload.virtual_s2_res1`'s `/S2/0/Rm` D-Bus interface), then exercised `isControllable: false`/`true` via the flow's own inject nodes and confirmed the node's status text on the real device changed `- OMBC` -> `- NC` -> `- OMBC` accordingly, and that a command with both `isControllable` and `availableControlTypes` set is rejected (logged error, list unchanged).
