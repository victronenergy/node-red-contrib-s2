## 1. `s2-common.js` - pending config-name handoff

- [x] 1.1 Add `setPendingConfigName(configType, name)` and `takePendingConfigName(configType)` (read-and-clear) to `window.__s2Common` in `resources/s2-common.js`, scoped by `configType` per design.md D1.

## 2. `s2-dbus-config` dialog

- [x] 2.1 Reorder the template so `Phases` (`node-config-input-nrOfPhases`) appears above `Power Meas.` (`node-config-input-measurementType`).
- [x] 2.2 Change `defaults.measurementType.value` from `'3_PHASE_SYMMETRIC'` to `'L1_L2_L3'`.
- [x] 2.3 In `oneditprepare`, add a function that disables/hides the "3-phase symmetric" `<option>` when `nrOfPhases !== 3`, re-enables it when `nrOfPhases === 3`, resets `measurementType` to `L1_L2_L3` if it was `3_PHASE_SYMMETRIC` at the moment `nrOfPhases` changes away from `3`, and runs once on prepare plus on the `nrOfPhases` `change` handler alongside the existing `showPhaseSettingRow()`.
- [x] 2.4 In `oneditprepare`, call `__s2Common.takePendingConfigName('s2-dbus-config')` and, if it returns a non-empty value and `#node-config-input-name` is currently empty, set it.

## 3. `s2-resource` dialog - Connection tab

- [x] 3.1 Change `defaults.transport.value` from `'websocket'` to `'dbus'`.
- [x] 3.2 Rename the D-Bus `<option>` label from "Built-in - D-Bus (Venus OS)" to "Built-in - D-Bus (Victron Energy)".
- [x] 3.3 Rename the `#node-input-dbusConfig` field's `<label>` text from "D-Bus" to "Virtual Device" (keep the existing tooltip content, field id, and `type: 's2-dbus-config'` unchanged).
- [x] 3.4 In `oneditprepare`, bind an additional `click` handler on `#node-input-btn-dbusConfig-add` (Node-RED's existing "add new" button for this field) that reads `$('#node-input-name').val()` and calls `__s2Common.setPendingConfigName('s2-dbus-config', ...)` when non-empty, per design.md D1. Do not remove or replace Node-RED's own handler on that button.
- [x] 3.5 In `oneditsave` and `oneditcancel`, call `__s2Common.takePendingConfigName('s2-dbus-config')` unconditionally (discarding the result) to clear any stale pending value left over from an abandoned add.
- [x] 3.6 (Found during manual verification, pre-existing, not in the original proposal) Remove the `s2-full-row` class from the three tab-panel containers (`#s2-resource-panel-conn`/`-rm`/`-ct`). That class's `margin-left: 110px` rule is meant for an indented checkbox-grid *row inside* a form, but these divs are whole-tab-panel wrappers that reused the same class as a "full width" marker - so every field in every tab was shifted 110px right (visible as "Transport"/"Virtual Device" labels sitting far right of the Name field above them). Plain `<div>`s are block-level by default, so no replacement class is needed.

## 4. `s2-resource` dialog - Resource Manager tab

- [x] 4.1 Change label text: "Manufacturer" -> "Device manufacturer", "Model" -> "Device model", "Serial" -> "Device serial", "Firmware" -> "Device firmware" (keep field ids/tooltips otherwise unchanged).
- [x] 4.2 Change `defaults.manufacturer.value` to `'Custom (Node-RED)'`.
- [x] 4.3 Change `defaults.model.value` and `defaults.firmwareVersion.value` to `''`.
- [x] 4.4 Move the Device manufacturer/Device model/Device serial/Device firmware `form-row`s to appear directly after the `RM Name`/`Resource ID` rows and before the `Roles` section.
- [x] 4.5 In `oneditprepare`, pre-fill `#node-input-rmName` from `#node-input-name` when `rmName` is empty and `name` is non-empty (on prepare, and on the Connection tab's `Name` field's `input`/`change` event, only while `rmName` remains empty - stop once the user types into `RM Name` directly).
- [x] 4.6 (Found during manual verification, supersedes part of 4.1) "Device manufacturer" overflowed the fixed 120px label column and overlapped the input text. Per user + frontend-design skill guidance: replaced the four individual "Device "-prefixed labels with a full-width "Device" section heading (`<label class="s2-section-label"><i class="fa fa-microchip"></i> Device</label>`, same pattern as the existing `Roles`/`Control Types` headings) above plain "Manufacturer"/"Model"/"Serial"/"Firmware" labels. Updated `specs/s2-resource/spec.md` and `proposal.md` to match.
- [x] 4.7 (Found during manual verification, bugfix to 4.5, superseded by 4.8) `prefillRmName()`'s guard checked `RM Name`'s own value for emptiness, so the first auto-filled character made the field non-empty and froze every further keystroke at that one character. First attempt: an explicit `rmNameManuallyEdited` flag, set on the `RM Name` field's own `input`/`change` event (and initialized `true` when a saved node already has a non-empty `rmName`). Updated `specs/s2-resource/spec.md`'s requirement text and added the missed continuous-typing/direct-edit scenarios.
- [x] 4.8 (Found during manual verification, supersedes 4.7) The 4.7 flag was a permanent one-way latch: reopening a node that already had a saved (or user-typed) `rmName` locked out auto-fill for the rest of that dialog session even after the user cleared `RM Name` back out by hand wanting it to follow `Name` again. Replaced the flag with a `lastAutoFilled` value comparison - `prefillRmName()` now follows `Name` whenever `RM Name` is empty *or* still holds exactly what this function itself last wrote there, which also means a manual clear-back-to-empty correctly resumes following. No `RM Name` input listener needed any more. Updated `specs/s2-resource/spec.md` (requirement text plus a new "User clears a manually-set or loaded RM Name" scenario).

## 5. `s2-resource` dialog - Control Type tab (OMBC power fields)

- [x] 5.1 In `refreshActivePhase()`, read `dbusCfg.measurementType` alongside `dbusCfg.nrOfPhases` and compute `forcedSymmetric` per design.md D2's truth table (in particular: `nrOfPhases === 3 && measurementType === 'L1_L2_L3'` now forces *unchecked*, not checked).
- [x] 5.2 Verify `setActivePhase`/`setSymmetricLock` in `resources/s2-ombc-editor.js` need no signature change (design.md D2 - `refreshActivePhase()` already passes a single resolved `forcedSymmetric` value); adjust only if the corrected truth table exposes a gap.
- [x] 5.3 (User feedback during manual verification, once the field-count fix made the checkbox always forced whenever `Transport: D-Bus` and `nrOfPhases` is 1 or 3) The permanently-disabled, greyed-out "Same value on all phases" checkbox added no information the field count itself doesn't already convey. Changed `setSymmetricLock` in `resources/s2-ombc-editor.js` to hide the whole checkbox row (`.s2-ombc-mode-row`) when `forced !== null`, instead of disabling+greying it - verified this is scoped correctly (`setSymmetricLock` is only ever called from `s2-resource`'s `refreshActivePhase()`; the standalone `s2-ombc-config` node never calls it, and a 2-phase D-Bus device or non-D-Bus transport still leaves `forced === null`, so the checkbox stays visible and interactive there). Removed the now-dead `.s2-ombc-mode-symmetric-locked` CSS rule. Updated `specs/s2-resource/spec.md`'s requirement (renamed "is locked" -> "is hidden") and scenarios accordingly.

## 6. Tests

- [x] 6.1 Add/update editor-level tests (or equivalent existing test coverage for `s2-resource`/`s2-dbus-config` defaults and label text, if such tests exist in `test/`) to assert the new default values (`transport: 'dbus'`, `measurementType: 'L1_L2_L3'`, `manufacturer: 'Custom (Node-RED)'`, `model: ''`, `firmwareVersion: ''`). Updated `test/nodes/s2-dbus-config.test.ts`'s `measurementType` default test, and added `transport`/`manufacturer`/`model`/`firmwareVersion` default-value tests to `test/nodes/s2-resource.test.ts` (these runtime (`index.ts`) fallbacks were also updated to match the editor defaults - see design.md's Risk note on the two staying in sync).
- [x] 6.2 If `resources/s2-ombc-editor.js`'s `setSymmetricLock`/`setActivePhase` (or `refreshActivePhase`'s truth table) has existing unit coverage, extend it for the `nrOfPhases: 3` + `measurementType: 'L1_L2_L3'` case (forced unchecked, 3 visible fields) alongside the existing `3_PHASE_SYMMETRIC` case (forced checked, 1 visible field). No existing test coverage found for this browser-only editor JS (`resources/*.js` isn't under the Jest/ts-jest test suite) - nothing to extend.

## 7. Validation

- [x] 7.1 `npm run build`
- [x] 7.2 `npm test` (421/421 passing, lint clean)
- [x] 7.3 Manually exercise both dialogs in a running Node-RED instance: new `s2-resource` node defaults, adding a new `s2-dbus-config` from inside it (Name pre-fill), Phases/Power Meas. interaction, and the OMBC per-mode field count for `nrOfPhases` 1/2/3 x `measurementType` symmetric/per-phase.
  - [x] Transport default D-Bus, "Built-in - D-Bus (Victron Energy)"/"Virtual Device" labels, tab-panel alignment (3.6) - confirmed live
  - [x] "Device" section heading and Manufacturer/Model/Serial/Firmware defaults (4.6) - confirmed live
  - [x] RM Name pre-fill: fresh node, continuous typing, and reopening an existing node (4.8) - confirmed live
  - [x] OMBC "Same value on all phases" hide-when-forced (5.3) - confirmed live ("looks pretty good right now")
  - [~] `s2-dbus-config`'s Phases-above-Power-Meas order/3-phase-symmetric-restriction/default, the add-new-config Name pre-fill, and the full `nrOfPhases`x`measurementType` OMBC field-count matrix were not individually walked through line-by-line - user closed out this round on the overall "looks pretty good" result and plans a full re-check pass once all feedback batches are in (see below), rather than exhaustive per-item confirmation now
  - Known open issue (out of scope for this change): general dialog width/layout still has other "weird" CSS issues per user, flagged for a dedicated CSS-expert pass later
