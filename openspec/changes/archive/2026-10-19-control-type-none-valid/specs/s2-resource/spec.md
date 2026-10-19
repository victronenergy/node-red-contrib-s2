## ADDED Requirements

### Requirement: Control type None is valid without a system description
An `s2-resource` whose `systemDescription` is empty, as it is with `Control type: None`, SHALL NOT be marked invalid in the editor because of that. A non-empty `systemDescription` SHALL still be checked as JSON.

#### Scenario: Control type None
- **WHEN** a new `s2-resource` is set to `Control type: None` and the dialog is closed with Done
- **THEN** the node is valid, and deploying shows no "not properly configured" warning for it

#### Scenario: Malformed system description
- **WHEN** the system description holds text that isn't valid JSON
- **THEN** the node is marked invalid with an "Invalid JSON data" message
