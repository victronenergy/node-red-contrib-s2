## ADDED Requirements

### Requirement: Status shows the connection and the control type
With a built-in control type, `s2-resource`'s node status SHALL show its latest connection status (Resource Manager and transport) and its latest control-type status together, as `<connection> | <control type>`. The colour and shape SHALL come from the connection status, except that a yellow or red control-type status sets the colour. The `idle` status the control type reports before anything has happened SHALL add nothing.

#### Scenario: Mode confirmed while a CEM is connected
- **WHEN** a CEM is connected and the built-in OMBC has confirmed mode `Off`
- **THEN** the status reads `CEM connected (<cem>) - <control types> | Confirmed: Off`, green

#### Scenario: Waiting for a ModeConfirmation
- **WHEN** a CEM is connected and the built-in OMBC is waiting for a `ModeConfirmation`
- **THEN** the status shows the connection followed by `| waiting for ModeConfirmation`, yellow

#### Scenario: CEM disconnects after a confirmed mode
- **WHEN** the CEM disconnects after a mode was confirmed
- **THEN** the status shows the waiting-for-CEM connection status followed by `| Confirmed: Off`

#### Scenario: Nothing to report about the control type
- **WHEN** no mode has been confirmed, defaulted or requested yet
- **THEN** the status shows only the connection status, as before

#### Scenario: Operation mode labelled idle
- **WHEN** an instruction selects an operation mode whose label is `idle`
- **THEN** the status shows the connection followed by `| idle`, like any other mode label
