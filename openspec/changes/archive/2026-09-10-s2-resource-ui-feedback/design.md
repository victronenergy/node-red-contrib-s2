## Context

See proposal.md - Why/What Changes for motivation and scope. Three implementation areas need decisions beyond a straight label/default edit:

1. Pre-filling a *new* `s2-dbus-config` node's `Name` from the *parent* `s2-resource` node's `Name`, across Node-RED's generic config-node picker (`src/nodes/s2-resource/index.html`, `src/nodes/s2-dbus-config/index.html`).
2. Deriving the OMBC power-field count from two `s2-dbus-config` fields (`nrOfPhases` + `measurementType`) instead of one (`resources/s2-ombc-editor.js`, `s2-resource/index.html`'s `refreshActivePhase()`).
3. Restricting `Power Meas.: 3-phase symmetric` to `Phases: 3` inside `s2-dbus-config`'s own dialog (`src/nodes/s2-dbus-config/index.html`).

Researched Node-RED's config-node picker internals (`node_modules/@node-red/editor-client/public/red/red.js`, `prepareConfigNodeSelect`/`showEditConfigNodeDialog`) to ground decision 1: the "add new" button's click handler calls `showEditConfigNodeDialog(property, type, "_ADD_", prefix, node)`, where `node` is the parent (`s2-resource`) being edited - but that `editContext` is only used internally for `filter` functions, and is never passed to the new config node's own `oneditprepare`. There's no built-in mechanism for a config-node's own edit form to know which parent node opened it, or that parent's in-progress (unsaved) field values.

## Goals / Non-Goals

**Goals:**
- Make the Name pre-fill work for the common case (adding a fresh `s2-dbus-config` from inside `s2-resource`'s Connection tab) without modifying Node-RED core or fighting its config-node picker.
- Keep the OMBC field-count fix a localized correction to existing logic (`setSymmetricLock`) rather than a rewrite of the checkbox+dimming mechanism, since that mechanism already produces the right end-user result (1 vs. 3 visible fields) for every case except "3 phases, per-phase measurement."

**Non-Goals:**
- Pre-filling `s2-dbus-config`'s `Name` when opened any other way (from the palette, from `s2-dbus`, or when editing an existing config node) - out of scope, and explicitly required *not* to change (see spec).
- Changing anything about `s2-cem-config`/the WebSocket path - this batch of feedback only touches D-Bus-related fields and the Resource Manager identity fields.
- Persisting or migrating already-saved node instances - every change here is a `defaults.value` (a client-side editor default), which Node-RED applies only to genuinely new node instances.

## Decisions

### D1: Name pre-fill via a shared "pending name" handoff, consumed once by `s2-dbus-config`'s `oneditprepare`

`s2-resource`'s `oneditprepare` binds an additional `click` handler onto the *existing* "add new" button Node-RED's `prepareConfigNodeSelect` already creates for the `dbusConfig` field (its DOM id is deterministic: `node-input-btn-dbusConfig-add`, from Node-RED's `${prefix}-btn-${property}-add` pattern). jQuery supports multiple handlers per element, so this doesn't replace Node-RED's own handler (which still opens the tray) - it just also runs, reading the parent's *current, possibly-unsaved* `#node-input-name` value and stashing it via a new small helper on the existing shared `window.__s2Common` module (loaded by both node types already), e.g. `__s2Common.setPendingConfigName('s2-dbus-config', name)`.

`s2-dbus-config`'s `oneditprepare` calls a matching `__s2Common.takePendingConfigName('s2-dbus-config')` (a take = read-and-clear) and, only when both that value and its own `name` are non-empty/empty respectively, sets `#node-config-input-name`.

The "take" (not just "read") matters for correctness: the pending value must not leak into a later, unrelated config-node add (e.g., the user cancels the D-Bus config add, then separately adds a CEM config, or adds a second `s2-dbus-config` later while editing a *different* `s2-resource` node with a different name). Scoping the helper by config type is defense in depth for the same reason. `s2-resource`'s own `oneditsave`/`oneditcancel` additionally clear any still-pending value, so an add-button click followed by abandoning the *parent* dialog (not just the child) can't leak either.

**Alternatives considered:**
- *Patch/override `prepareConfigNodeSelect` or `showEditConfigNodeDialog`*: would work but means monkey-patching Node-RED core internals from contrib code - fragile across Node-RED versions, rejected.
- *Give `s2-dbus-config` a `name`-inheriting default function*: Node-RED's `defaults.name.value` is a static value per field definition, not something that can read another node's live state at select-build time - not possible.
- *Read `RED.nodes.node(<s2-resource id>)` from within `s2-dbus-config`'s `oneditprepare`*: the parent id isn't passed through either, and even if it were, a *new* `s2-resource` node's in-progress `Name` edit isn't written back to the node object until the parent's own `oneditsave` runs (typing in the Name field updates the DOM, not the node model) - so this couldn't see an unsaved parent name anyway. The pending-name handoff sidesteps this because it reads the DOM directly, at click time, before anything is saved.

### D2: OMBC field-count logic keys off `nrOfPhases` **and** `measurementType` together, via one corrected truth table in `setSymmetricLock`

`s2-resource/index.html`'s `refreshActivePhase()` already computes `forcedSymmetric` from the referenced `s2-dbus-config`; it's extended to also read `dbusCfg.measurementType` and compute:
- `nrOfPhases === 1` -> `forcedSymmetric = false` (unchanged)
- `nrOfPhases === 3 && measurementType === '3_PHASE_SYMMETRIC'` -> `forcedSymmetric = true` (unchanged case)
- `nrOfPhases === 3 && measurementType === 'L1_L2_L3'` -> `forcedSymmetric = false` (new case - today this was incorrectly forced `true`)
- otherwise (`nrOfPhases === 2`, or `Transport !== 'dbus'`) -> `forcedSymmetric = null` (unchanged)

`setActivePhase`'s single-phase dimming is untouched - it only ever applies to the `nrOfPhases === 1` case, which isn't affected by `measurementType`.

**Alternatives considered:**
- *Replace the checkbox-driven show/hide with a field count computed directly in the DOM (no checkbox at all for D-Bus transport)*: would look identical to the end user once `setSymmetricLock` forces the checkbox anyway (it's already hidden behind a disabled, forced checkbox - see the existing "Same value on all phases" locking requirement), but throws away the existing, already-tested plumbing (`symCheckbox`/`updateSymVisibility`/`getFriendlyModes`) that every mode row relies on for both D-Bus and non-D-Bus transports. Rejected as a larger diff for no user-visible difference.

### D3: `manufacturer` default text is `"Custom (Node-RED)"`

Taking the user's own suggested wording verbatim rather than leaving it open - it's a plain string constant with no other design implication, so there's nothing to gain from deferring it.

### D4: `s2-dbus-config`'s `Power Meas.` option availability is enforced in the editor only (client-side `<option>` show/hide + reset), not validated server-side

The existing `phaseSetting` row (shown only for `nrOfPhases === 1`) already follows this pattern - a `showPhaseSettingRow()`-style function toggling on `nrOfPhases`'s `change` event, run once on `oneditprepare`. The "3-phase symmetric" option gets the same treatment: hidden (`.prop('disabled', ...)` on the `<option>`, keeping it out of keyboard/screen-reader selection without touching the `<select>`'s DOM order) whenever `nrOfPhases !== 3`, and if the current selection becomes the hidden option, reset to `L1_L2_L3` (the new default). No server-side (`index.ts`) validation is added, matching how `phaseSetting`'s own applicability isn't server-validated today either - this is a first batch of editor-only UX feedback, not a data-integrity change.

## Risks / Trade-offs

- [The pending-name handoff is a global (module-level) variable in editor JS, which is inherently a little fragile to timing] -> Mitigated by scoping it per config type, consuming it exactly once (take, not read), and clearing it from both sides' cancel/save paths. Worst case on a bug is a missed or stale pre-fill (an empty or wrong `Name` on the new config node) - never data loss, since `Name` is purely cosmetic and freely editable afterward.
- [Changing `s2-dbus-config`'s `measurementType` default from `3_PHASE_SYMMETRIC` to `L1_L2_L3`, and `s2-resource`'s `transport` default from `websocket` to `dbus`, only affects *new* nodes, but a developer skimming the diff might assume it needs a migration] -> No migration needed (Node-RED applies `defaults.value` only where the saved flow JSON has no value for that field, i.e. genuinely new nodes); call this out explicitly in the PR/commit description.

## Migration Plan

None - every change here is either an editor-only default/label/order change (applies only to newly added nodes; existing saved flows are unaffected) or a corrected editor-only derivation (`setSymmetricLock`'s truth table) with no stored-data shape change. No server-side (`index.ts`) behavior changes, so no redeploy-time migration or version bump beyond the normal release process.
