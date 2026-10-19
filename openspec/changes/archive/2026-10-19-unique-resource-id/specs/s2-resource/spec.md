## ADDED Requirements

### Requirement: Resource ID is unique when a node is added in the editor
When an `s2-resource` node is added to the editor after the deployed flows have loaded, the editor SHALL generate a new `resourceId` and mark the node changed if its `resourceId` is empty or equal to that of any other `s2-resource` or `s2-rm-config` node in the editor; otherwise it SHALL keep it. Nodes added while the deployed flows load SHALL be left unchanged.

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

#### Scenario: Resource ID held by an s2-rm-config node
- **WHEN** an `s2-resource` node is added whose `resourceId` equals an existing `s2-rm-config` node's `resourceId`
- **THEN** the added node gets a newly generated `resourceId`

### Requirement: Duplicate resource ID refuses to start
When an `s2-resource` node starts, it SHALL claim its resolved `resourceId` for the running Node-RED instance. If another running `s2-resource` or `s2-rm` node already holds that `resourceId`, the node SHALL log an error naming the other node's id, show a red `duplicate resource ID` status, and SHALL NOT create its Resource Manager, transport (no D-Bus service registration, no WebSocket connection) or built-in control type. A node SHALL release its claim when it closes.

#### Scenario: Two deployed nodes share a resource ID
- **WHEN** two `s2-resource` nodes with the same `resourceId` are deployed
- **THEN** the node started second logs an error naming the first node, shows a red `duplicate resource ID` status, and registers no D-Bus service and opens no WebSocket connection, while the first node runs normally

#### Scenario: Redeploying a node keeps its claim
- **WHEN** an `s2-resource` node is redeployed with the same `resourceId`
- **THEN** it starts normally, because the previous instance released its claim on close

#### Scenario: Duplicate removed
- **WHEN** the node holding a `resourceId` is closed (deleted or redeployed with a different `resourceId`) and the refused node is then redeployed
- **THEN** the redeployed node claims the `resourceId` and starts normally
