## MODIFIED Requirements

### Requirement: Advertised control type follows the Control Type tab when built in
When `Control type: OMBC` is selected, `s2-resource`'s Resource Manager tab SHALL NOT offer a separate, manually-editable list of advertised control types for OMBC - the advertised `ResourceManagerDetails.available_control_types` SHALL include `OPERATION_MODE_BASED_CONTROL` automatically. The manually-editable advertised-control-types list SHALL be offered only when `Control type: None`, for whatever control-type node(s) are wired externally, and SHALL NOT include a `NOT_CONTROLABLE` checkbox - per `s2-rm-protocol`'s "`NOT_CONTROLABLE` is always advertised and cannot be disabled" requirement, `NOT_CONTROLABLE` is included automatically in both cases by the shared protocol layer, not by anything specific to this node.

#### Scenario: Control type: OMBC advertises OMBC without manual selection
- **WHEN** `s2-resource` is configured with `Control type: OMBC`
- **THEN** it advertises `OPERATION_MODE_BASED_CONTROL` to the CEM regardless of any other manual control-type selection

#### Scenario: Control type: None still allows advertising other control types
- **WHEN** `s2-resource` is configured with `Control type: None` and the Resource Manager tab's control-types selection includes e.g. `POWER_ENVELOPE_BASED_CONTROL`
- **THEN** it advertises that selection to the CEM, unchanged from today's `s2-rm-config` behavior

#### Scenario: Control type: None manual list has no Not Ctrl checkbox
- **WHEN** the Resource Manager tab's manually-editable control-types list is rendered (`Control type: None`)
- **THEN** no checkbox for `NOT_CONTROLABLE` is shown among FRBC/DDBC/PPBC/PEBC, consistent with `s2-rm-config`'s equivalent list
