## 1. Friendly-mode data model and conversions

- [ ] 1.1 Add `minDurationMinutes`/`minDurationSeconds` (or equivalent) to the friendly-mode operation-mode row model
- [ ] 1.2 Update `friendlyStateToSystemDescription`/`buildTransitions`: derive a deterministic timer id per mode with a configured minimum duration (see design.md), append it to `timers`, and wire it into `start_timers` (transitions into that mode) / `blocking_timers` (transitions out of that mode) for the fully-connected graph
- [ ] 1.3 Update `isFriendlyRepresentable` to accept the derived timer shape: each timer belongs to exactly one mode, wired into exactly its inbound/outbound transitions per the rule, and no other timer/transition customization exists
- [ ] 1.4 Update `systemDescriptionToFriendlyState` to recover each mode's minimum-duration minutes/seconds from the timer wired to it, when the shape check passes

## 2. Editor UI

- [ ] 2.1 Add a "Minimum time in this mode" minutes + seconds input pair to each operation-mode row in the editable list (`addModeItem`), reading/writing via `getFriendlyModes`/`oneditsave`
- [ ] 2.2 Update the System Description tooltip and the `s2-ombc-config` help panel to describe the new field and its S2 `timers`/`start_timers`/`blocking_timers` mapping

## 3. Backward compatibility

- [ ] 3.1 Confirm existing configs with no timers still open into Friendly mode unchanged (no regression to the existing shape check)
- [ ] 3.2 Confirm an existing Advanced-mode config using the derived timer pattern opens into Friendly mode with the correct minutes/seconds populated per mode

## 4. Documentation

- [ ] 4.1 Update `README.md` if warranted

## 5. Verification

- [ ] 5.1 Manual verification in a real Node-RED editor: configure a minimum duration on a mode, confirm the generated `systemDescription` (via Advanced mode) has the expected timer/start_timers/blocking_timers; leave a mode's duration unset and confirm no timer is generated for it; round-trip Friendly -> Advanced -> Friendly with a configured duration; confirm a hand-authored Advanced timer with a non-whole-second duration correctly falls through to Advanced mode with a warning
- [ ] 5.2 `npm run lint`
- [ ] 5.3 `npm run build`
- [ ] 5.4 `npm test` (no new Jest coverage expected - this is editor-only browser JS with no test infrastructure in this repo, matching the prior friendly-editor change)
