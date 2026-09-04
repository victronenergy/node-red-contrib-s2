## ADDED Requirements

`s2-ombc-config`'s friendly editor SHALL offer each operation mode an optional minimum-duration input, entered as minutes and seconds, defaulting to unset (no timer - equivalent to today's behavior). A configured value SHALL apply only to that mode: once the timer wired to that mode (per "Auto-derived transitions in friendly mode") has been started by the CEM, the CEM SHALL NOT issue an instruction to transition away from that mode until the configured duration has elapsed.
#### Scenario: Mode has no minimum duration configured
- **WHEN** an operation mode's minimum-duration minutes and seconds fields are both left unset or zero
- **THEN** no timer is generated for that mode and no transition into or out of it references any timer

#### Scenario: Mode has a minimum duration configured
- **WHEN** an operation mode's minimum-duration fields are set to M minutes and S seconds (M and/or S > 0)
- **THEN** the saved `systemDescription` includes exactly one timer for that mode with `duration` of (M x 60 + S) x 1000 milliseconds, wired per the "Auto-derived transitions in friendly mode" requirement

## MODIFIED Requirements

### Requirement: Auto-derived transitions in friendly mode
While in friendly mode, `s2-ombc-config`'s editor SHALL derive a fully-connected transition graph - every configured operation mode able to transition to every other configured operation mode - from the current operation-mode list, without the user authoring any transition directly. For any mode with a configured minimum-duration timer, every transition into that mode SHALL include that timer's id in `start_timers`, and every transition out of that mode SHALL include that timer's id in `blocking_timers`. Transitions where neither endpoint has a configured minimum duration SHALL have empty `start_timers` and `blocking_timers`, as before.

#### Scenario: Two or more operation modes are configured
- **WHEN** the friendly editor's operation-mode list contains N modes, none with a minimum duration configured, and the editor is in friendly mode
- **THEN** the saved `systemDescription`'s transitions include one transition for every ordered pair of distinct modes, each with empty `start_timers` and `blocking_timers`, and `timers` is empty

#### Scenario: A mode has a configured minimum duration
- **WHEN** the friendly editor is in friendly mode and one mode has a minimum-duration value configured
- **THEN** the saved `systemDescription`'s `timers` includes one timer for that mode with `duration` equal to the configured minutes/seconds converted to milliseconds, every transition whose `to` is that mode includes the timer's id in `start_timers`, and every transition whose `from` is that mode includes the timer's id in `blocking_timers`

### Requirement: Friendly/Advanced mode toggle
`s2-ombc-config`'s editor SHALL provide an explicit toggle between friendly mode (the operation-modes list) and Advanced mode (the raw `systemDescription` JSON). Switching to Advanced mode SHALL convert the current friendly state to JSON once. Switching back to friendly mode SHALL re-derive friendly state from the JSON if its shape matches what friendly mode can represent, and SHALL otherwise remain in Advanced mode with a warning rather than discarding content friendly mode cannot express.

#### Scenario: Switching to Advanced mode
- **WHEN** the user switches from friendly mode to Advanced mode
- **THEN** the JSON view is populated with the `systemDescription` equivalent to the current friendly-mode state

#### Scenario: Switching back with a representable shape
- **WHEN** the user switches from Advanced mode back to friendly mode, and the current JSON's operation modes and transitions match what friendly mode produces (a protected standby mode present, a fully-connected transition graph, and any timers present matching exactly one per-mode minimum-duration timer each, wired per the auto-derived-transitions rule)
- **THEN** the friendly editor displays that operation-mode list, with each mode's minimum-duration minutes/seconds fields populated from the duration of the timer wired to it, if any

#### Scenario: Switching back with a non-representable shape
- **WHEN** the user switches from Advanced mode back to friendly mode, and the current JSON contains anything friendly mode cannot express (e.g. a missing standby mode, a non-fully-connected transition graph, a blocked transition, or a timer not wired exactly per the per-mode minimum-duration pattern)
- **THEN** the editor remains in Advanced mode and shows a warning explaining why, instead of silently discarding the customization

### Requirement: Backward compatibility with existing configurations
`s2-ombc-config`'s editor SHALL open an existing, previously-saved raw-JSON `systemDescription` directly into friendly mode when its shape matches what friendly mode can represent, and into Advanced mode otherwise.

#### Scenario: Opening a node saved before this change, in a representable shape
- **WHEN** a `s2-ombc-config` node whose existing `systemDescription` matches friendly mode's shape is opened
- **THEN** its operation modes display in friendly mode

#### Scenario: Opening a node saved before this change, in a non-representable shape
- **WHEN** a `s2-ombc-config` node whose existing `systemDescription` does not match friendly mode's shape (e.g. hand-authored transitions, a blocked transition, or a timer not wired exactly per the per-mode minimum-duration pattern) is opened
- **THEN** the editor opens in Advanced mode showing that JSON unchanged
