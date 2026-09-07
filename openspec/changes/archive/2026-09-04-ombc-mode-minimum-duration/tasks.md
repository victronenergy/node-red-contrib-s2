## 1. Friendly-mode data model and conversions

- [x] 1.1 Add `minDurationMinutes`/`minDurationSeconds` (or equivalent) to the friendly-mode operation-mode row model
- [x] 1.2 Update `friendlyStateToSystemDescription`/`buildTransitions`: derive a deterministic, UUID4-shaped timer id per mode with a configured minimum duration (a `generateUuid()` sibling seeded from the mode's own id - see design.md; a plain custom-format string is not valid, `s2-python` rejects non-UUID4 id fields), append it to `timers`, and wire it into `start_timers` (transitions into that mode) / `blocking_timers` (transitions out of that mode) for the fully-connected graph
- [x] 1.3 Update `isFriendlyRepresentable` to accept the derived timer shape: each timer belongs to exactly one mode, wired into exactly its inbound/outbound transitions per the rule, and no other timer/transition customization exists
- [x] 1.4 Update `systemDescriptionToFriendlyState` to recover each mode's minimum-duration minutes/seconds from the timer wired to it, when the shape check passes

## 2. Editor UI

- [x] 2.1 Add a "Minimum time in this mode" minutes + seconds input pair to each operation-mode row in the editable list (`addModeItem`), reading/writing via `getFriendlyModes`/`oneditsave`
- [x] 2.2 Update the System Description tooltip and the `s2-ombc-config` help panel to describe the new field and its S2 `timers`/`start_timers`/`blocking_timers` mapping

## 3. Backward compatibility

- [x] 3.1 Confirm existing configs with no timers still open into Friendly mode unchanged (no regression to the existing shape check)
- [x] 3.2 Confirm an existing Advanced-mode config using the derived timer pattern opens into Friendly mode with the correct minutes/seconds populated per mode

## 4. Documentation

- [x] 4.1 Update `README.md` if warranted - not warranted: its `s2-ombc-config` row already describes "operation modes, transitions, timers" generically and doesn't enumerate friendly-mode specifics, so no change needed

## 5. Verification

- [x] 5.1 Manual verification in a real Node-RED editor: configure a minimum duration on a mode, confirm the generated `systemDescription` (via Advanced mode) has the expected timer/start_timers/blocking_timers; leave a mode's duration unset and confirm no timer is generated for it; round-trip Friendly -> Advanced -> Friendly with a configured duration; confirm a hand-authored Advanced timer with a non-whole-second duration correctly falls through to Advanced mode with a warning - confirmed by the user in a real Node-RED editor; also covered by an isolated Node.js run of the extracted conversion functions against equivalent cases
- [x] 5.2 `npm run lint`
- [x] 5.3 `npm run build`
- [x] 5.4 `npm test` (confirm nothing else regresses - no new Jest coverage expected: `npm test` only runs `test/**/*.test.ts` against the TypeScript runtime code, and this change is confined to `index.html`'s browser JS, which has no automated test harness in this repo, matching the prior friendly-editor change) - 310/310 tests pass, no regressions
