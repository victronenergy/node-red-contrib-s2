## ADDED Requirements

### Requirement: Config dialog orders Phases above Power Meas.
`s2-dbus-config`'s edit dialog SHALL present the `Phases` field before the `Power Meas.` field, since `Power Meas.`'s own available options depend on `Phases` (see the "3-phase symmetric" requirement below).

#### Scenario: Dialog layout
- **WHEN** `s2-dbus-config`'s edit dialog is rendered
- **THEN** `Phases` appears above `Power Meas.`

### Requirement: "3-phase symmetric" power measurement requires exactly 3 phases
`s2-dbus-config`'s `Power Meas.` field SHALL offer "3-phase symmetric" (`3_PHASE_SYMMETRIC`) only when `Phases: 3`. For `Phases: 1` or `Phases: 2`, that option SHALL be unavailable, and if `Power Meas.` was previously set to `3_PHASE_SYMMETRIC` and `Phases` changes away from `3`, `Power Meas.` SHALL fall back to another valid option for the new `Phases` value rather than silently keeping an inapplicable selection.

#### Scenario: Phases: 3
- **WHEN** `Phases` is set to `3`
- **THEN** the `Power Meas.` dropdown offers "None", "3-phase symmetric", and "Per phase"

#### Scenario: Phases: 1 or 2
- **WHEN** `Phases` is set to `1` or `2`
- **THEN** the `Power Meas.` dropdown offers only "None" and "Per phase" - "3-phase symmetric" is not selectable

#### Scenario: Changing Phases away from 3 while 3-phase symmetric is selected
- **WHEN** `Power Meas.: 3-phase symmetric` is selected and `Phases` is changed from `3` to `1` or `2`
- **THEN** `Power Meas.` no longer reads "3-phase symmetric"

### Requirement: New config nodes default to per-phase power measurement
`s2-dbus-config`'s `Power Meas.` field SHALL default to "Per phase" (`L1_L2_L3`) for a newly added node, not "3-phase symmetric".

#### Scenario: Newly added node
- **WHEN** a new `s2-dbus-config` node's edit dialog is opened for the first time
- **THEN** `Power Meas.` reads "Per phase"

### Requirement: Config node Name pre-fills from the parent s2-resource node
When an `s2-dbus-config` node is created via the "add new" flow from inside an `s2-resource` node's edit dialog, and the parent `s2-resource` node's own `Name` field is non-empty, `s2-dbus-config`'s `Name` field SHALL pre-fill with that value if the config node's `Name` is otherwise empty. Opening an existing `s2-dbus-config` node, or adding one from any other context (e.g. directly from the palette, or from `s2-dbus`), SHALL NOT be affected.

#### Scenario: Adding a new D-Bus config from within a named s2-resource node
- **WHEN** an `s2-resource` node named "Boiler" has its Connection tab's "Virtual Device" picker used to add a new `s2-dbus-config` node
- **THEN** the new config node's `Name` field pre-fills with "Boiler"

#### Scenario: Adding a new D-Bus config from the standalone s2-dbus node
- **WHEN** a new `s2-dbus-config` node is added from `s2-dbus`'s own edit dialog
- **THEN** its `Name` field is empty, unchanged from today's behavior
