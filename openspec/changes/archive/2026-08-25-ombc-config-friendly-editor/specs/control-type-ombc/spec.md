## ADDED Requirements

### Requirement: Default operation modes
`s2-ombc-config`'s friendly editor SHALL pre-populate a "Standby/off" operation mode (zero power on all phases) for a configuration with no existing operation modes, and SHALL prevent it from being removed while in friendly mode.

#### Scenario: New config node has no modes yet
- **WHEN** a `s2-ombc-config` node is opened with no existing `systemDescription`
- **THEN** the friendly editor shows one operation mode representing standby/off (zero power on all phases), and offers no way to delete it

### Requirement: Auto-derived transitions in friendly mode
While in friendly mode, `s2-ombc-config`'s editor SHALL derive a fully-connected transition graph - every configured operation mode able to transition to every other configured operation mode, each with no timers - from the current operation-mode list, without the user authoring any transition directly.

#### Scenario: Two or more operation modes are configured
- **WHEN** the friendly editor's operation-mode list contains N modes and the editor is in friendly mode
- **THEN** the saved `systemDescription`'s transitions include one transition for every ordered pair of distinct modes, each with empty `start_timers` and `blocking_timers`

### Requirement: Friendly/Advanced mode toggle
`s2-ombc-config`'s editor SHALL provide an explicit toggle between friendly mode (the operation-modes list) and Advanced mode (the raw `systemDescription` JSON). Switching to Advanced mode SHALL convert the current friendly state to JSON once. Switching back to friendly mode SHALL re-derive friendly state from the JSON if its shape matches what friendly mode can represent, and SHALL otherwise remain in Advanced mode with a warning rather than discarding content friendly mode cannot express.

#### Scenario: Switching to Advanced mode
- **WHEN** the user switches from friendly mode to Advanced mode
- **THEN** the JSON view is populated with the `systemDescription` equivalent to the current friendly-mode state

#### Scenario: Switching back with a representable shape
- **WHEN** the user switches from Advanced mode back to friendly mode, and the current JSON's operation modes and transitions match what friendly mode produces (a protected standby mode present, and a fully-connected transition graph with no timers)
- **THEN** the friendly editor displays that operation-mode list

#### Scenario: Switching back with a non-representable shape
- **WHEN** the user switches from Advanced mode back to friendly mode, and the current JSON contains anything friendly mode cannot express (e.g. a missing standby mode, a non-fully-connected transition graph, or any timer)
- **THEN** the editor remains in Advanced mode and shows a warning explaining why, instead of silently discarding the customization

### Requirement: Backward compatibility with existing configurations
`s2-ombc-config`'s editor SHALL open an existing, previously-saved raw-JSON `systemDescription` directly into friendly mode when its shape matches what friendly mode can represent, and into Advanced mode otherwise.

#### Scenario: Opening a node saved before this change, in a representable shape
- **WHEN** a `s2-ombc-config` node whose existing `systemDescription` matches friendly mode's shape is opened
- **THEN** its operation modes display in friendly mode

#### Scenario: Opening a node saved before this change, in a non-representable shape
- **WHEN** a `s2-ombc-config` node whose existing `systemDescription` does not match friendly mode's shape (e.g. hand-authored transitions or timers) is opened
- **THEN** the editor opens in Advanced mode showing that JSON unchanged
