## ADDED Requirements

### Requirement: No abnormal-condition-only toggle
`s2-ombc-config`'s friendly editor SHALL NOT offer a per-mode "abnormal condition only" toggle: the friendly editor's auto-derived transitions are always fully connected, so a mode reachable only under abnormal conditions can never actually be represented. A previously-saved mode with `abnormal_condition_only: true` SHALL be treated as `false` when opened in friendly mode.

#### Scenario: Friendly editor renders a mode
- **WHEN** the friendly editor renders an operation-mode row, built in or user-added
- **THEN** no "abnormal condition only" control is shown for that row

#### Scenario: Opening a config saved before this change
- **WHEN** a `s2-ombc-config` node whose saved `systemDescription` has a mode with `abnormal_condition_only: true` is opened in friendly mode
- **THEN** the mode displays and saves with `abnormal_condition_only: false`
