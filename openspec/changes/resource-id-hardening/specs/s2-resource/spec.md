## MODIFIED Requirements

### Requirement: Resource ID is unique when a node is added in the editor
When the user adds an `s2-resource` node to the editor (from the palette, by paste, through the Import dialog or from Examples; Node-RED marks such nodes changed), the editor SHALL generate a new `resourceId` if its `resourceId` is empty or equal to that of any other `s2-resource` or `s2-rm-config` node in the editor; otherwise it SHALL keep it. An environment variable reference, `${NAME}` (or Node-RED's older `$(NAME)` form), SHALL be kept. Nodes the editor adds while loading or reloading the deployed flows SHALL be left unchanged.

#### Scenario: Node dropped from the palette
- **WHEN** a new `s2-resource` node is dropped from the palette
- **THEN** it gets a newly generated `resourceId` without its edit dialog being opened

#### Scenario: Node copied and pasted
- **WHEN** an existing `s2-resource` node is copied and pasted while the original is still in the workspace
- **THEN** the pasted node gets a newly generated `resourceId` and the original keeps its own

#### Scenario: Node cut and pasted
- **WHEN** an `s2-resource` node is cut and pasted, so no other node holds its `resourceId`
- **THEN** the pasted node keeps its `resourceId`

#### Scenario: Example imported twice
- **WHEN** the same example flow, which brings its own flow tab, is imported a second time with "Import copy" while the first import is still in the workspace
- **THEN** each `s2-resource` node from the second import gets a newly generated `resourceId`

#### Scenario: Deployed duplicates are not changed on load
- **WHEN** the editor loads deployed flows that already contain two `s2-resource` nodes with the same `resourceId`
- **THEN** neither node's `resourceId` is changed in the editor and no node is marked changed

#### Scenario: Deployed duplicates are not changed on reload
- **WHEN** the editor reloads the deployed flows without a page reload (e.g. after a deploy conflict or a project switch) and they contain two `s2-resource` nodes with the same `resourceId`
- **THEN** neither node's `resourceId` is changed in the editor

#### Scenario: Resource ID held by an s2-rm-config node
- **WHEN** an `s2-resource` node is added whose `resourceId` equals an existing `s2-rm-config` node's `resourceId`
- **THEN** the added node gets a newly generated `resourceId`

#### Scenario: Environment variable copied
- **WHEN** an `s2-resource` node whose `resourceId` is `${S2_RESOURCE_ID}` is copied and pasted
- **THEN** the pasted node keeps `${S2_RESOURCE_ID}`

### Requirement: Resource ID is editable for WebSocket transport and inside subflows
With `Transport: WebSocket`, for any transport when the node is inside a subflow template, or whenever its `resourceId` is an environment variable reference, the Connection tab SHALL show the node's `resourceId` in an editable Resource ID field. Changing the transport SHALL NOT change the node's `resourceId`. Saving the dialog with the field empty SHALL store a newly generated ID.

#### Scenario: Field shown for WebSocket
- **WHEN** the Connection tab is rendered with `Transport: WebSocket`
- **THEN** a Resource ID field under the CEM picker shows the node's current `resourceId` and can be edited

#### Scenario: Field shown inside a subflow
- **WHEN** the Connection tab of an `s2-resource` inside a subflow template is rendered with `Transport: D-Bus`
- **THEN** an editable Resource ID field shows the node's current `resourceId`

#### Scenario: User sets the ID their CEM expects
- **WHEN** the user enters `my-heatpump-01` and saves
- **THEN** the node's `resourceId` is `my-heatpump-01`, and it is used in `ResourceManagerDetails` and the CEM URL after deploy

#### Scenario: Transport switched away and back
- **WHEN** a node with a user-set `resourceId` is switched to `Transport: D-Bus`, saved, and later switched back to `Transport: WebSocket`
- **THEN** the field shows the same user-set `resourceId`

#### Scenario: Field emptied
- **WHEN** the user clears the field and saves
- **THEN** the node's `resourceId` is a newly generated UUID

#### Scenario: Environment variable outside a subflow
- **WHEN** an `s2-resource` with `Transport: D-Bus` whose `resourceId` is `${S2_RESOURCE_ID}` is moved out of a subflow template into a flow
- **THEN** its dialog still shows the Resource ID field, so the reference can be replaced

### Requirement: Resource ID is validated in the editor
The editor SHALL treat a non-empty `resourceId` as invalid, with a message saying why, when it is neither an environment variable reference (`${NAME}` (or Node-RED's older `$(NAME)` form), `NAME` without whitespace) nor 2-64 characters of `a-z`, `A-Z`, `0-9`, `-`, `_` or `:`, or when it is not an environment variable reference and another `s2-resource` or `s2-rm-config` node in the editor has the same `resourceId`. When the value is a valid ID but not a UUID, the dialog SHALL show a non-blocking warning that CEMs built on s2python only accept UUIDs.

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

#### Scenario: Environment variable
- **WHEN** the Resource ID is set to `${S2_RESOURCE_ID}`, also when another node uses the same reference
- **THEN** the node is valid and no warning is shown

#### Scenario: Older environment variable form
- **WHEN** the Resource ID is set to `$(S2_RESOURCE_ID)`
- **THEN** the node is valid and no warning is shown

### Requirement: Resource ID from an environment variable
An `s2-resource` whose `resourceId` is `${NAME}` (or Node-RED's older `$(NAME)` form) SHALL use the value Node-RED substitutes from its environment (subflow instance properties, then flow and global environment) as its resource ID. If the variable is not set, so the reference is still in place when the node starts, the node SHALL log an error naming the variable, show a red `resource ID variable not set` status, and SHALL NOT start, as for a duplicate.

#### Scenario: Subflow instances with their own IDs
- **WHEN** a subflow containing an `s2-resource` with `resourceId` `${S2_RESOURCE_ID}` is placed twice, each instance setting `S2_RESOURCE_ID` to a different UUID
- **THEN** both instances start, each sending its own UUID as `resource_id`

#### Scenario: Variable not set
- **WHEN** a subflow instance doesn't set `S2_RESOURCE_ID`, and no flow or global environment does
- **THEN** that instance logs an error naming `S2_RESOURCE_ID`, shows a red `resource ID variable not set` status, and doesn't start

#### Scenario: Variable set but blank
- **WHEN** a subflow instance sets `S2_RESOURCE_ID` to an empty value
- **THEN** that instance logs an error saying the resource ID is empty, shows a red `resource ID missing` status, and doesn't start

## ADDED Requirements

### Requirement: Resource ID is checked before starting
After Node-RED's environment variable substitution, an `s2-resource` SHALL refuse to start, as for a duplicate, when its `resourceId` is empty (red `resource ID missing`) or is not 2-64 characters of `a-z`, `A-Z`, `0-9`, `-`, `_` or `:` (red `invalid resource ID`), logging an error that says which and how to fix it. A non-string value SHALL be checked and used as its string form.

#### Scenario: Empty resource ID
- **WHEN** an `s2-resource` starts with an empty `resourceId`
- **THEN** it logs an error, shows a red `resource ID missing` status, and registers no D-Bus service and opens no WebSocket connection

#### Scenario: Resolved value outside the S2 ID format
- **WHEN** a subflow instance sets the variable used as resource ID to `boiler 1`
- **THEN** that instance logs an error naming the value, shows a red `invalid resource ID` status, and doesn't start

#### Scenario: Number from an environment variable
- **WHEN** the variable used as resource ID is a number property `42`
- **THEN** the node starts with resource ID `42`

### Requirement: Claims are released when setup fails
If an `s2-resource`'s setup throws after it has claimed its resource ID, it SHALL release its claims before the error reaches Node-RED, since Node-RED never closes a node whose constructor threw.

#### Scenario: Setup fails after claiming
- **WHEN** an `s2-resource`'s setup throws after it claimed its resource ID (e.g. a malformed CEM URL)
- **THEN** its claims are released, so a corrected node with the same resource ID can start without restarting Node-RED
