## MODIFIED Requirements

### Requirement: s2-rm-config resource ID is unique when added in the editor
When the user adds an `s2-rm-config` node to the editor (Node-RED marks such nodes changed), the editor SHALL generate a new `resourceId` if its `resourceId` is empty or equal to the `resourceId` of any other `s2-rm-config` or `s2-resource` node in the editor. Otherwise it SHALL keep the `resourceId`; an environment variable reference, `${NAME}` (or Node-RED's older `$(NAME)` form), SHALL always be kept. Nodes the editor adds while loading or reloading the deployed flows SHALL be left unchanged.

#### Scenario: s2-rm-config imported as a copy
- **WHEN** an import adds an `s2-rm-config` under a new node id whose `resourceId` an existing `s2-rm-config` already holds
- **THEN** the added `s2-rm-config` gets a newly generated `resourceId`

#### Scenario: Deployed flows reloaded
- **WHEN** the editor reloads the deployed flows without a page reload and two `s2-rm-config` nodes share a `resourceId`
- **THEN** neither `resourceId` is changed in the editor

### Requirement: Duplicate resource ID refuses to start
When an `s2-rm` node starts, it SHALL claim the resolved `resourceId` of its `s2-rm-config` as a Resource Manager for the running Node-RED instance, sharing one claim registry with `s2-resource`. If another running `s2-rm` or `s2-resource` node already holds that claim, or the `resourceId` is still an unresolved `${NAME}`, the node SHALL log an error saying why (naming the other node, or the variable) and how to resolve it, show a red `duplicate resource ID` or `resource ID variable not set` status, and SHALL NOT create its Resource Manager. A node SHALL release its claim when it closes, before anything else in its close handling.

#### Scenario: Two s2-rm nodes reference the same s2-rm-config
- **WHEN** two `s2-rm` nodes referencing the same `s2-rm-config` are deployed
- **THEN** the node started second logs an error naming the first node, shows a red `duplicate resource ID` status, and does not handle any input commands

#### Scenario: Example with an s2-rm imported twice
- **WHEN** an example containing an `s2-rm` and its `s2-rm-config` is imported a second time with "Import copy", and Node-RED reuses the existing identical `s2-rm-config` for the copied `s2-rm`
- **THEN** after deploying, one of the two `s2-rm` nodes is refused with a red `duplicate resource ID` status

#### Scenario: s2-rm-config shares its resource ID with an s2-resource
- **WHEN** an `s2-rm` node whose `s2-rm-config` has the same `resourceId` as a running `s2-resource` node is started after it
- **THEN** the `s2-rm` node is refused in the same way

#### Scenario: Empty resource ID
- **WHEN** an `s2-rm-config` has an empty `resourceId`, e.g. from a blank environment variable
- **THEN** the `s2-rm` node logs an error, shows a red `resource ID missing` status, and does not handle any input commands

#### Scenario: Environment variable not set
- **WHEN** an `s2-rm-config`'s `resourceId` is `${S2_RESOURCE_ID}` and that variable is not set for the `s2-rm`'s flow
- **THEN** the `s2-rm` logs an error naming `S2_RESOURCE_ID`, shows a red `resource ID variable not set` status, and does not handle any input commands

### Requirement: s2-websocket refuses a resource ID another transport is using
When an `s2-websocket` node starts, it SHALL claim the `resourceId` of its `s2-rm-config` as a transport, in the same registry; an `s2-rm` claiming that ID as a Resource Manager does not conflict. If another running transport already holds that claim, or the `resourceId` is empty, an unresolved environment variable reference or outside the S2 ID format, the `s2-websocket` SHALL log an error saying why, show the same red status as a refused `s2-rm`, and SHALL NOT connect to the CEM. It SHALL release its claim when it closes, before disconnecting.

#### Scenario: s2-rm and s2-websocket on one config
- **WHEN** one `s2-rm` and one `s2-websocket` reference the same `s2-rm-config`
- **THEN** both start normally

#### Scenario: Two pairs share one s2-rm-config
- **WHEN** two `s2-rm` + `s2-websocket` pairs reference the same `s2-rm-config`
- **THEN** the second `s2-rm` and the second `s2-websocket` are both refused, and only one WebSocket connection to the CEM is opened

#### Scenario: Transport already used by an s2-resource
- **WHEN** an `s2-resource` with `Transport: WebSocket` and `resourceId` X is running and an `s2-websocket` whose `s2-rm-config` has `resourceId` X starts after it
- **THEN** the `s2-websocket` is refused and doesn't connect

## ADDED Requirements

### Requirement: s2-rm and s2-websocket check the resource ID before starting
After Node-RED's environment variable substitution, `s2-rm` and `s2-websocket` SHALL refuse to start when the `resourceId` of their `s2-rm-config` is empty, an unresolved environment variable reference (`${NAME}` (or Node-RED's older `$(NAME)` form)), or not 2-64 characters of `a-z`, `A-Z`, `0-9`, `-`, `_` or `:`, with the same errors and red statuses as `s2-resource`. If a node's setup fails after it has claimed its resource ID, the claim SHALL be released.

#### Scenario: Resource ID with a space
- **WHEN** an `s2-rm-config`'s Resource ID is `my heatpump`
- **THEN** both the `s2-rm` and the `s2-websocket` using it show a red `invalid resource ID` status and don't start

#### Scenario: Malformed CEM URL
- **WHEN** an `s2-rm` or `s2-websocket`'s setup throws after claiming its resource ID because its `s2-cem-config` URL is malformed
- **THEN** the claim is released

### Requirement: s2-rm nodes sharing an s2-rm-config are flagged in the editor
The editor SHALL mark an `s2-rm` node invalid, with a message saying another `s2-rm` uses the same `s2-rm-config`, when another `s2-rm` node references the same `s2-rm-config`, since only one of them can start.

#### Scenario: s2-rm copied and pasted
- **WHEN** an `s2-rm` node is copied and pasted, and the copy references the original's `s2-rm-config`
- **THEN** the pasted `s2-rm` is marked invalid in the editor before deploy, with a message saying another `s2-rm` uses the same `s2-rm-config`; the original is marked as well the next time the editor validates it (e.g. when the flows are reloaded)
