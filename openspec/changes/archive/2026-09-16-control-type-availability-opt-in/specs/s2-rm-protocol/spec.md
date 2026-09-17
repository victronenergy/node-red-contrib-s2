## MODIFIED Requirements

### Requirement: `NOT_CONTROLABLE` is opt-out, checked by default
Every RM (both `s2-rm`, configured via `s2-rm-config`, and `s2-resource`) SHALL include `NOT_CONTROLABLE` in `ResourceManagerDetails.available_control_types` only when it is present in the RM's currently configured or currently advertised control types - it is no longer forced. `s2-rm-config`'s and `s2-resource`'s manually-editable control-types lists SHALL offer a `NOT_CONTROLABLE`/"Not Controllable" checkbox, checked by default for newly created nodes, so a CEM can still choose not to control the resource unless a flow author explicitly unchecks it. When checked, the deploy-time configured control-types list SHALL place `NOT_CONTROLABLE` first, ahead of any other configured control type, regardless of the checkbox's own position in either editor's list.

#### Scenario: Newly deployed s2-rm advertises NOT_CONTROLABLE by default
- **WHEN** a new `s2-rm` node is deployed with `s2-rm-config`'s default control types
- **THEN** `ResourceManagerDetails.available_control_types` includes `NOT_CONTROLABLE`, because the "Not Controllable" checkbox defaults to checked

#### Scenario: NOT_CONTROLABLE explicitly unchecked at config time
- **WHEN** `s2-rm-config`'s "Not Controllable" checkbox is unchecked and the node is deployed
- **THEN** `ResourceManagerDetails.available_control_types` does not include `NOT_CONTROLABLE`

#### Scenario: s2-rm-config's manual list offers a Not Controllable checkbox
- **WHEN** `s2-rm-config`'s control-types checkbox list is rendered
- **THEN** a checkbox for `NOT_CONTROLABLE` is shown alongside OMBC/FRBC/DDBC/PPBC/PEBC

#### Scenario: NOT_CONTROLABLE sorts first in the configured list when checked
- **WHEN** `s2-rm-config`'s or `s2-resource`'s "Not Controllable" checkbox is checked alongside one or more other control types, and the node is deployed
- **THEN** `NOT_CONTROLABLE` appears first in the resulting configured control-types list (and therefore first in `ResourceManagerDetails.available_control_types` and its `NC` status-bar abbreviation), regardless of the checkbox's own position among the others

#### Scenario: Runtime list omitting NOT_CONTROLABLE no longer advertises it
- **WHEN** a `SetAvailableControlTypes` command is sent to an RM's input with an `availableControlTypes` list that does not include `NOT_CONTROLABLE`
- **THEN** the RM advertises exactly the list the command specified, without `NOT_CONTROLABLE`

### Requirement: Runtime control-type availability update
The RM SHALL accept a `SetAvailableControlTypes` command specifying a replacement for its advertised control types in one of two mutually exclusive forms (no `cemId` in either form, since it is not addressed to a specific CEM session):

- **List form**: an `availableControlTypes` array. The RM SHALL replace its currently advertised `available_control_types` with exactly that list (no types added or removed beyond what the caller specified).
- **Toggle form**: an `isControllable` boolean. `isControllable: false` SHALL replace the advertised list with exactly `[NOT_CONTROLABLE]`. `isControllable: true` SHALL replace the advertised list with the RM's deploy-time configured control types (the list derived from `s2-rm-config`'s or `s2-resource`'s control-types configuration, including whether its `NOT_CONTROLABLE` checkbox was checked), discarding any list currently in effect from a prior `SetAvailableControlTypes` command.

A command payload that specifies both `availableControlTypes` and `isControllable`, or neither, SHALL be rejected without changing the advertised list.

In either form, once the new list is determined, the RM SHALL re-send `ResourceManagerDetails` - with a fresh `message_id` and all of its other mandatory and optional fields (`resource_id`, `roles`, `instruction_processing_delay`, `provides_forecast`, `provides_power_measurement_types`, `name`, `manufacturer`, `model`, `serial_number`, `firmware_version`) unchanged from what the RM would otherwise send - to every currently connected CEM's session, without requiring a node redeploy. If no CEM is currently connected, the updated list SHALL still apply and SHALL be used in `ResourceManagerDetails` the next time a CEM completes the handshake.

#### Scenario: Command received while a CEM is connected
- **WHEN** a `SetAvailableControlTypes` command with the list form is received with a new `availableControlTypes` list, and a CEM is currently connected
- **THEN** the RM sends that CEM an updated `ResourceManagerDetails` reflecting the new list, with a fresh `message_id` and its other fields unchanged, without the CEM having reconnected or the node having redeployed

#### Scenario: Command received before any CEM connects
- **WHEN** a `SetAvailableControlTypes` command is received before any CEM has connected
- **THEN** the next CEM to complete the handshake receives a `ResourceManagerDetails` reflecting the updated list

#### Scenario: Multiple connected CEMs
- **WHEN** a `SetAvailableControlTypes` command is received while more than one CEM session is connected
- **THEN** each connected CEM receives its own updated `ResourceManagerDetails` reflecting the new list

#### Scenario: isControllable false advertises only NOT_CONTROLABLE
- **WHEN** a `SetAvailableControlTypes` command `{ isControllable: false }` is received
- **THEN** the RM's advertised `available_control_types` becomes exactly `['NOT_CONTROLABLE']`, regardless of what was previously advertised or configured

#### Scenario: isControllable true restores the deploy-time configured list
- **WHEN** an RM configured with `['OPERATION_MODE_BASED_CONTROL', 'NOT_CONTROLABLE']` has previously received `{ isControllable: false }`, and then receives `{ isControllable: true }`
- **THEN** the RM's advertised `available_control_types` becomes exactly `['OPERATION_MODE_BASED_CONTROL', 'NOT_CONTROLABLE']` again

#### Scenario: Command specifying both forms is rejected
- **WHEN** a `SetAvailableControlTypes` command is received with both `availableControlTypes` and `isControllable` set
- **THEN** the RM rejects the command with an error and does not change its currently advertised list

#### Scenario: Command specifying neither form is rejected
- **WHEN** a `SetAvailableControlTypes` command is received with neither `availableControlTypes` nor `isControllable` set
- **THEN** the RM rejects the command with an error and does not change its currently advertised list
