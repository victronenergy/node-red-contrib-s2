## ADDED Requirements

### Requirement: `NOT_CONTROLABLE` is always advertised and cannot be disabled
Every RM (both `s2-rm`, configured via `s2-rm-config`, and `s2-resource`) SHALL always include `NOT_CONTROLABLE` in `ResourceManagerDetails.available_control_types`, regardless of its configured control types or any `SetAvailableControlTypes` runtime command (see the requirement below). `s2-rm-config`'s manually-editable control-types list SHALL NOT offer a `NOT_CONTROLABLE`/"Not Ctrl" checkbox - unlike the other entries in that list, it is not a configurable option, since a CEM always being able to select "don't control this resource" is a baseline guarantee of any RM in this project.

#### Scenario: Newly deployed s2-rm advertises NOT_CONTROLABLE by default
- **WHEN** a new `s2-rm` node is deployed with `s2-rm-config`'s default control types
- **THEN** `ResourceManagerDetails.available_control_types` includes `NOT_CONTROLABLE`

#### Scenario: s2-rm-config's manual list has no Not Ctrl checkbox
- **WHEN** `s2-rm-config`'s control-types checkbox list is rendered
- **THEN** no checkbox for `NOT_CONTROLABLE` is shown among OMBC/FRBC/DDBC/PPBC/PEBC

#### Scenario: Runtime command omitting NOT_CONTROLABLE still advertises it
- **WHEN** a `SetAvailableControlTypes` command is sent to an RM's input with a list that does not include `NOT_CONTROLABLE`
- **THEN** the RM still advertises `NOT_CONTROLABLE` alongside whatever the command's list specified, and does not drop it

### Requirement: Runtime control-type availability update
The RM SHALL accept a `SetAvailableControlTypes` command containing a replacement `availableControlTypes` list (no `cemId`, since it is not addressed to a specific CEM session). On receiving it, the RM SHALL replace its currently advertised `available_control_types` with that list (always including `NOT_CONTROLABLE`, per the requirement above) and SHALL re-send `ResourceManagerDetails` - with a fresh `message_id` and all of its other mandatory and optional fields (`resource_id`, `roles`, `instruction_processing_delay`, `provides_forecast`, `provides_power_measurement_types`, `name`, `manufacturer`, `model`, `serial_number`, `firmware_version`) unchanged from what the RM would otherwise send - to every currently connected CEM's session, without requiring a node redeploy. If no CEM is currently connected, the updated list SHALL still apply and SHALL be used in `ResourceManagerDetails` the next time a CEM completes the handshake.

#### Scenario: Command received while a CEM is connected
- **WHEN** a `SetAvailableControlTypes` command is received with a new `availableControlTypes` list, and a CEM is currently connected
- **THEN** the RM sends that CEM an updated `ResourceManagerDetails` reflecting the new list, with a fresh `message_id` and its other fields unchanged, without the CEM having reconnected or the node having redeployed

#### Scenario: Command received before any CEM connects
- **WHEN** a `SetAvailableControlTypes` command is received before any CEM has connected
- **THEN** the next CEM to complete the handshake receives a `ResourceManagerDetails` reflecting the updated list

#### Scenario: Multiple connected CEMs
- **WHEN** a `SetAvailableControlTypes` command is received while more than one CEM session is connected
- **THEN** each connected CEM receives its own updated `ResourceManagerDetails` reflecting the new list

### Requirement: No forced deselect when a selected control type becomes unavailable
When a `SetAvailableControlTypes` command removes a control type that a connected CEM currently has active (via a prior `SelectControlType`) from the advertised list, the RM SHALL NOT itself deselect, disconnect, or otherwise alter that session's currently active control type - it SHALL only send the updated `ResourceManagerDetails`. Whether and how the CEM reacts (e.g. by sending its own `SelectControlType` afterward) is left entirely to the CEM.

#### Scenario: Active control type removed from availability
- **WHEN** a CEM currently has `OPERATION_MODE_BASED_CONTROL` selected and a `SetAvailableControlTypes` command removes it from the advertised list
- **THEN** the RM sends the CEM an updated `ResourceManagerDetails` without `OPERATION_MODE_BASED_CONTROL`, and the session's active control type and any in-progress instruction/status flow continue unchanged unless the CEM itself sends a new `SelectControlType`
