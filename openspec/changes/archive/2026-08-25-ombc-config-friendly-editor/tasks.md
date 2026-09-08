## 1. Friendly-mode data model and conversions

- [x] 1.1 Define the friendly-mode operation-mode row model in editor JS: id, diagnostic label, abnormal-condition-only flag, symmetric toggle, watt value(s)
- [x] 1.2 Implement friendly state → `systemDescription`: seed/keep the Standby/off mode, auto-derive the fully-connected transition graph (empty `start_timers`/`blocking_timers`) over the current mode set, empty `timers`
- [x] 1.3 Implement the "friendly-representable" shape check against an arbitrary `systemDescription` (power-range shape per mode, exact fully-connected transition set, empty timers) per design.md
- [x] 1.4 Implement `systemDescription` → friendly state, used only when the shape check passes

## 2. Editor UI

- [x] 2.1 Add a Friendly/Advanced (JSON) mode toggle to `s2-ombc-config`'s edit dialog
- [x] 2.2 Build the operation-modes editable list: label, abnormal-condition-only checkbox, "same value on all phases" toggle, watt input(s); Standby/off pre-seeded and not removable from the list's own controls
- [x] 2.3 Wire the Advanced tab to the existing raw-JSON `typedInput`; switching to Advanced converts current friendly state to JSON once (task 1.2)
- [x] 2.4 Switching from Advanced back to Friendly: re-derive friendly state when the shape check passes (task 1.4); otherwise stay in Advanced mode and show a warning explaining why

## 3. Backward compatibility

- [x] 3.1 On `oneditprepare`, open directly into Friendly mode if the existing `systemDescription` matches the friendly shape, otherwise open into Advanced mode showing it unchanged
- [x] 3.2 Replace the default scaffold for a brand-new node (currently one `3_PHASE_SYMMETRIC` mode) with a seeded Standby/off mode, opening in Friendly mode

## 4. Documentation

- [x] 4.1 Update `s2-ombc-config`'s help text/tooltip to describe Friendly vs Advanced mode
- [x] 4.2 Update `README.md` if warranted

## 5. Verification

- [x] 5.1 Manual verification in a real Node-RED editor: new-node friendly defaults; add/remove/reorder modes; symmetric toggle; switch to Advanced and back for both a representable and a non-representable case; open each of the three real example configs found during research and confirm correct Friendly/Advanced placement (confirmed working by the user after two rounds of CSS/layout fixes - a CSS specificity bug where `.s2-form .form-row label` beat class-only overrides, causing the abnormal-condition/tooltip-icon overlap issues)
- [x] 5.2 `npm run lint`
- [x] 5.3 `npm run build`
- [x] 5.4 `npm test` (confirm nothing else regresses - no new Jest coverage expected, since this is editor-only browser JS with no test infrastructure in this repo)
