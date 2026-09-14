## 1. Protocol layer: always-on NOT_CONTROLABLE + runtime availability

- [x] 1.1 ~~Add a `SET_AVAILABLE_CONTROL_TYPES` message-type constant~~ - not needed: internal-only commands (`PowerConstraints`, `UpdateStatus`, etc.) are handled as literal string switch cases in `S2ResourceManager.handleInput` with no corresponding `MessageType` constant, since they never go on the wire under that name. `SetAvailableControlTypes` follows the same existing convention (see 1.3).
- [x] 1.2 In `src/lib/s2/resource-manager.ts`, `rmDetails.availableControlTypes` is unioned with `NOT_CONTROLABLE` (via a new `withNotControlable` helper) in the constructor, mutating the array in place (the `rmDetails` field itself stays `readonly` - only its `availableControlTypes` property changes over time).
- [x] 1.3 Added a `SetAvailableControlTypes` branch to `S2ResourceManager.handleInput` (alongside `PowerConstraints`, before the `cemId` check, since it isn't addressed to one CEM): replaces `rmDetails.availableControlTypes` (re-unioning `NOT_CONTROLABLE` in), then iterates `this.sessions.values()` and calls the new `resendResourceManagerDetails` on each.
- [x] 1.4 Added `S2Session.resendResourceManagerDetails(rmDetails)`: updates `_rmDetails` (now mutable) and sends a fresh `ResourceManagerDetails` via the existing `_send` path when `CONNECTED`.
- [x] 1.5 Verified by code review: `resendResourceManagerDetails` only updates `_rmDetails` and conditionally calls `_send` - it never touches `_selectedControlType`, sends `SelectControlType`, or calls `dispose`. Regression test tracked as 4.5.

## 2. `s2-rm` / `s2-rm-config` wiring and UI

- [x] 2.1 Confirmed: `s2-rm/index.ts`'s `node.on('input', ...)` forwards every message straight to `rm.handleInput` with no interception, so `SetAvailableControlTypes` already works unchanged. Updated its doc-comment command list to mention it.
- [x] 2.2 Removed the "Not Ctrl"/`NOT_CONTROLABLE` checkbox from `s2-rm-config`'s control-types markup (`src/nodes/s2-rm-config/index.html`) - removing the `<label>` element also removes it from `oneditsave`'s `:checked` collection, no JS change needed. List is now OMBC/FRBC/DDBC/PPBC/PEBC. Updated the section tooltip and help panel to explain the always-on guarantee.
- [x] 2.3 Updated `s2-rm`'s help text (`src/nodes/s2-rm/index.html`) with the new command, its payload shape, and a worked "10:00-18:00" example (covers 5.2 for `s2-rm` too).

## 3. `s2-resource` wiring and UI

- [x] 3.1 Confirmed: `s2-resource/index.ts`'s input handler sets `hasCommand` whenever `payload.command` is present and forwards straight to `rm.handleInput(msg, done)` regardless of `ombcController`, so `SetAvailableControlTypes` already works unchanged.
- [x] 3.2 Removed the "Not Ctrl"/`NOT_CONTROLABLE` checkbox from `s2-resource`'s own manual control-types markup (`src/nodes/s2-resource/index.html`) - class-based `.s2-resource-ct-checkbox` selectors in the existing JS need no change. `None` mode's manual list is now FRBC/DDBC/PPBC/PEBC. Updated the section tooltip, Resource Manager tab, and Ports help text (incl. a `SetAvailableControlTypes` worked example - covers 5.2 for `s2-resource`).

## 4. Tests

- [x] 4.1 `test/lib/resource-manager.test.ts`: a newly constructed `S2ResourceManager` always includes `NOT_CONTROLABLE` in advertised `available_control_types`, even if the passed-in config list omits it.
- [x] 4.2 `test/lib/resource-manager.test.ts`: `SetAvailableControlTypes` replaces the advertised list (always re-including `NOT_CONTROLABLE`) and resends `ResourceManagerDetails` to a connected session.
- [x] 4.3 `test/lib/resource-manager.test.ts`: command received before any CEM connects is reflected in the next handshake's `ResourceManagerDetails`.
- [x] 4.4 `test/lib/resource-manager.test.ts`: command received with multiple connected CEM sessions resends to each.
- [x] 4.5 `test/lib/resource-manager.test.ts`: removing a CEM's currently-selected control type from the list does not alter session state, force a deselect, or disconnect - only the resend happens.
- [x] 4.6 `test/lib/resource-manager.test.ts`: the resent `ResourceManagerDetails` carries a fresh `message_id` and unchanged `resource_id`/`roles`/`instruction_processing_delay`/`provides_forecast`/`provides_power_measurement_types`.
- [x] 4.7 `test/nodes/s2-rm.test.ts`: updated the existing "reads rmDetails from s2-rm-config node" test's assertion to expect `['OPERATION_MODE_BASED_CONTROL', 'NOT_CONTROLABLE']` (was the one pre-existing test this change's behavior broke - now covers this case).
- [x] 4.8 Not automatable: this repo has no editor-HTML/DOM test harness (no jsdom/cheerio usage anywhere in `test/`, confirmed by search) - verified by inspection instead, that the `NOT_CONTROLABLE`/"Not Ctrl" `<label>` was deleted from `src/nodes/s2-rm-config/index.html`'s control-types markup (see 2.2).
- [x] 4.9 `test/nodes/s2-resource.test.ts` ("NOT_CONTROLABLE always advertised" describe block): `controlType: 'ombc'` config advertises both `OPERATION_MODE_BASED_CONTROL` and `NOT_CONTROLABLE`.
- [x] 4.10 `test/nodes/s2-resource.test.ts`: `controlType: 'none'` with a manual `controlTypes` selection advertises that selection plus `NOT_CONTROLABLE`.
- [x] 4.11 Not automatable, same reason as 4.8 - verified by inspection that the checkbox `<label>` was deleted from `src/nodes/s2-resource/index.html`'s manual control-types markup (see 3.2).
- [x] 4.12 `test/nodes/s2-resource.test.ts`: a `SetAvailableControlTypes` command whose list omits `NOT_CONTROLABLE` still results in it being advertised.

## 5. Documentation

- [ ] 5.1 Update `openspec/specs/s2-rm-protocol/spec.md` and `openspec/specs/s2-resource/spec.md` via archive once this change ships (standard OpenSpec archive step - not a manual edit now).
- [x] 5.2 Done as part of 2.3/3.2: worked "10:00-18:00" example added to both `s2-rm`'s and `s2-resource`'s help text.
- [x] 5.3 Added `CHANGELOG.md` entries under `[Unreleased]`: the new `SetAvailableControlTypes` command (Added) and the always-on `NOT_CONTROLABLE` advertisement (Changed), per design.md's Migration Plan.
