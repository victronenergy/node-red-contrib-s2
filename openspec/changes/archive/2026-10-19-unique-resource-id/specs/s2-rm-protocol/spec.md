## ADDED Requirements

### Requirement: s2-rm-config resource ID is unique when added in the editor
When an `s2-rm-config` node is added to the editor after the editor has finished loading the deployed flows, the editor SHALL generate a new `resourceId` and mark the node changed if its `resourceId` is empty or equal to the `resourceId` of any other `s2-rm-config` or `s2-resource` node in the editor. Otherwise it SHALL keep the `resourceId`. Nodes added while the editor loads the deployed flows SHALL be left unchanged.

#### Scenario: s2-rm-config imported as a copy
- **WHEN** an import adds an `s2-rm-config` under a new node id whose `resourceId` an existing `s2-rm-config` already holds
- **THEN** the added `s2-rm-config` gets a newly generated `resourceId`

### Requirement: Duplicate resource ID refuses to start
When an `s2-rm` node starts, it SHALL claim the resolved `resourceId` of its `s2-rm-config` for the running Node-RED instance, sharing one claim registry with `s2-resource`. If another running `s2-rm` or `s2-resource` node already holds that `resourceId`, the node SHALL log an error naming the other node's id, show a red `duplicate resource ID` status, and SHALL NOT create its Resource Manager. A node SHALL release its claim when it closes.

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
- **WHEN** an `s2-rm-config` has an empty `resourceId`
- **THEN** the `s2-rm` node claims the `resourceId` it generates at start-up, which no other node holds, and starts normally
