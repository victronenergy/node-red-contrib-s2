## MODIFIED Requirements

### Requirement: Resource ID is not shown on the RM tab
`s2-resource`'s `resourceId` SHALL NOT be shown as a visible field on the Resource Manager tab. For `Transport: D-Bus` and `Transport: External` it SHALL NOT be shown anywhere in the dialog, consistent with other auto-generated internal identifiers this node doesn't surface (e.g. the D-Bus `DeviceInstance`). It SHALL still be auto-generated once (on first add, if not already set) and persisted unchanged across redeploys.

#### Scenario: RM tab has no visible Resource ID field
- **WHEN** the Resource Manager tab is rendered
- **THEN** no visible field shows or edits `resourceId`

#### Scenario: Resource ID is still generated and stable
- **WHEN** a new `s2-resource` node is added, and later redeployed one or more times
- **THEN** `resourceId` is generated once on the first add and never changes on subsequent redeploys

#### Scenario: Resource ID hidden for D-Bus
- **WHEN** the Connection tab is rendered with `Transport: D-Bus` or `Transport: External`
- **THEN** no visible field shows or edits `resourceId`

## ADDED Requirements

### Requirement: Resource ID is editable for WebSocket transport
With `Transport: WebSocket`, the Connection tab SHALL show the node's `resourceId` in an editable Resource ID field under the CEM picker. Changing the transport SHALL NOT change the node's `resourceId`. Saving the dialog with the field empty SHALL store a newly generated ID.

#### Scenario: Field shown for WebSocket
- **WHEN** the Connection tab is rendered with `Transport: WebSocket`
- **THEN** a Resource ID field under the CEM picker shows the node's current `resourceId` and can be edited

#### Scenario: User sets the ID their CEM expects
- **WHEN** the user enters `my-heatpump-01` and saves
- **THEN** the node's `resourceId` is `my-heatpump-01`, and it is used in `ResourceManagerDetails` and the CEM URL after deploy

#### Scenario: Transport switched away and back
- **WHEN** a node with a user-set `resourceId` is switched to `Transport: D-Bus`, saved, and later switched back to `Transport: WebSocket`
- **THEN** the field shows the same user-set `resourceId`

#### Scenario: Field emptied
- **WHEN** the user clears the field and saves
- **THEN** the node's `resourceId` is a newly generated UUID

### Requirement: Resource ID is validated in the editor
The editor SHALL treat a non-empty `resourceId` as invalid, with a message saying why, when it is not 2-64 characters of `a-z`, `A-Z`, `0-9`, `-`, `_` or `:`, or when another `s2-resource` or `s2-rm-config` node in the editor has the same `resourceId`. When the value is valid but not a UUID, the dialog SHALL show a non-blocking warning that CEMs built on s2python only accept UUIDs.

#### Scenario: Invalid characters
- **WHEN** the Resource ID is set to `my heatpump`
- **THEN** the node is shown as invalid, with a message naming the allowed characters and length

#### Scenario: ID used by another node
- **WHEN** the Resource ID is set to the `resourceId` of another `s2-resource` or `s2-rm-config` node
- **THEN** the node is shown as invalid, with a message saying another S2 node already uses this ID

#### Scenario: Valid non-UUID
- **WHEN** the Resource ID is set to `my-heatpump-01`
- **THEN** the node is valid, and the dialog shows a warning under the field that s2python-based CEMs require a UUID

#### Scenario: UUID
- **WHEN** the Resource ID is a UUID
- **THEN** the node is valid and no warning is shown
