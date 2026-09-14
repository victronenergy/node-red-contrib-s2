## MODIFIED Requirements

### Requirement: Instruction resolution into actionable output
On receiving an OMBC instruction, `s2-ombc` SHALL resolve the referenced operation mode against its configuration and emit it on its instruction output with a routable topic and the resolved mode detail, including the requested power in both S2's own commodity-quantity shape and the `values` convenience shape.

#### Scenario: OMBC instruction selects a configured mode
- **WHEN** an OMBC instruction referencing a configured operation mode arrives at `s2-ombc`
- **THEN** the node emits a message with `msg.topic` set to `'ModeInstruction'` and `msg.payload` containing the resolved mode's `id`, `index`, `label`, and `factor`, plus `commodityPower` (an array of `{commodity_quantity, value}` pairs, one per phase, computed from the mode's power ranges and the instructed factor)

#### Scenario: Requested power also expressed in the values convenience shape
- **WHEN** an OMBC instruction resolves to a configured mode, as in the prior scenario
- **THEN** the emitted message's `msg.payload` also includes a `values` field: a plain number when the mode's power ranges are 3-phase-symmetric, or a 3-element `[L1, L2, L3]` array when they are per-phase - the same shape `PowerMeasurement` input already accepts on `s2-dbus`/`s2-resource`, so a flow can feed `msg.payload.values` directly into a `PowerMeasurement` input without conversion

### Requirement: Operation mode identified by id, index, or label
A confirm message SHALL identify the operation mode via `id` (or legacy `confirmedOperationModeId`), `index` (or legacy `confirmedOperationModeIndex`, a 0-based index into the configured operation modes), or `label` (or legacy `confirmedOperationModeLabel`, matching a configured mode's `diagnostic_label`), resolved in that priority order when more than one is present: `id` wins over `index`, which wins over `label`. `s2-ombc` SHALL resolve whichever field wins to the mode's canonical id before building or persisting status, and SHALL validate it against the CEM's configured operation modes: an `id` SHALL match a configured mode's id, an `index` SHALL be within range, and a `label` SHALL match exactly one configured mode's `diagnostic_label`. A confirm message giving none of `id`/`index`/`label` (in either field-naming style) SHALL be rejected with an error, as SHALL one whose winning identifier does not resolve to exactly one configured mode. A confirm message MAY also include a `factor` (or legacy `operationModeFactor`); when present and numeric it SHALL be used as the operation mode factor, and SHALL default to `1` otherwise. Any other field present in the confirm payload SHALL be ignored. This lets a flow pass an entire `ModeInstruction` payload (see "Instruction resolution into actionable output") straight back in as a confirmation.

#### Scenario: Mode identified by index
- **WHEN** a confirm message supplies `index` referencing a configured operation mode, and no `id`
- **THEN** the resulting status's `activeOperationModeId` is that mode's id

#### Scenario: Mode identified by label
- **WHEN** a confirm message supplies `label` matching a configured mode's `diagnostic_label`, and neither `id` nor `index`
- **THEN** the resulting status's `activeOperationModeId` is that mode's id

#### Scenario: No mode identifier supplied
- **WHEN** a confirm message supplies none of `id`/`confirmedOperationModeId`, `index`/`confirmedOperationModeIndex`, or `label`/`confirmedOperationModeLabel`
- **THEN** `s2-ombc` rejects the message with an error

#### Scenario: Unknown id
- **WHEN** a confirm message supplies `id` that does not match any configured operation mode's id
- **THEN** `s2-ombc` rejects the message with an error

#### Scenario: Label matches no configured mode
- **WHEN** a confirm message supplies `label` that does not match any configured mode's `diagnostic_label`, and no `id` or `index`
- **THEN** `s2-ombc` rejects the message with an error

#### Scenario: Label matches more than one configured mode
- **WHEN** a confirm message supplies `label` that matches more than one configured mode's `diagnostic_label`, and no `id` or `index`
- **THEN** `s2-ombc` rejects the message with an error

#### Scenario: id takes priority when multiple identifiers are present
- **WHEN** a confirm message supplies `id`, `index`, and `label` together, and `id` matches a configured mode
- **THEN** the resulting status's `activeOperationModeId` is the mode matched by `id`, regardless of what `index` or `label` refer to

#### Scenario: A whole ModeInstruction payload confirms its own mode
- **WHEN** a confirm message's payload is exactly a previously-emitted `ModeInstruction` payload (`{ id, index, label, factor, commodityPower, values }`)
- **THEN** it resolves to the mode named by `id`, using that payload's `factor` as the operation mode factor, and the extra `commodityPower`/`values` fields are ignored

#### Scenario: Confirm message omits factor
- **WHEN** a confirm message identifies a valid mode and includes neither `factor` nor `operationModeFactor`
- **THEN** the resulting status's operation mode factor is `1`

## ADDED Requirements

### Requirement: Optional power modulation per mode in friendly mode
`s2-ombc-config`'s friendly editor SHALL offer each operation mode an optional "power modulation" toggle. When off (the default), the mode keeps today's single-value behavior: one power value (symmetric, or per-phase) that becomes a `power_ranges` entry whose `start_of_range` and `end_of_range` are equal. When on, the mode instead takes two power values - "from" (associated with an instructed factor of 0) and "to" (associated with a factor of 1) - per phase grouping (symmetric, or per-phase), which become a `power_ranges` entry with differing `start_of_range`/`end_of_range`. Toggling between off and on SHALL NOT be blocked by, or force a switch to, Advanced mode.

#### Scenario: Mode with modulation off
- **WHEN** an operation mode's power modulation toggle is off and a single power value (or per-phase values) is entered
- **THEN** the saved `systemDescription`'s corresponding `power_ranges` entry (or entries) has `start_of_range` equal to `end_of_range`, matching today's fixed-power behavior

#### Scenario: Mode with modulation on
- **WHEN** an operation mode's power modulation toggle is on and "from"/"to" values are entered (symmetric, or per-phase)
- **THEN** the saved `systemDescription`'s corresponding `power_ranges` entry (or entries) has `start_of_range` set to the "from" value and `end_of_range` set to the "to" value

#### Scenario: Opening a saved config with a genuine power range
- **WHEN** a `s2-ombc-config` node whose saved `systemDescription` has an operation mode with `start_of_range` different from `end_of_range` (symmetric, or consistently across all three phases) is opened
- **THEN** the friendly editor opens directly (not Advanced mode), showing that mode with power modulation on and its "from"/"to" fields populated from `start_of_range`/`end_of_range`

#### Scenario: Modes with inconsistent per-phase ranges still require Advanced mode
- **WHEN** a `s2-ombc-config` node whose saved `systemDescription` has an operation mode with a `power_ranges` shape friendly mode still can't represent (e.g. only some phases modulating, or a range on an unsupported commodity quantity) is opened
- **THEN** the editor opens in Advanced mode, as it did before this change

### Requirement: s2-resource never silently discards a non-representable OMBC configuration
`s2-resource`'s OMBC tab SHALL provide the same Friendly/Advanced mode toggle `s2-ombc-config` provides. When the node's saved `systemDescription` is not representable by the friendly editor, opening the node SHALL show that configuration as editable raw JSON in Advanced mode, exactly as `s2-ombc-config` does - never falling back to a default mode list that discards the saved configuration. Saving the node while in Advanced mode SHALL persist the JSON as edited, without passing it through the friendly editor's state first; saving while in Friendly mode SHALL persist the friendly editor's state, as today.

#### Scenario: Opening a node with a non-representable configuration
- **WHEN** a `s2-resource` node whose saved `systemDescription` is not representable by the friendly editor is opened
- **THEN** its OMBC tab shows that configuration as raw JSON in Advanced mode, unchanged from what was saved

#### Scenario: Saving a non-representable configuration unchanged
- **WHEN** a `s2-resource` node opened per the prior scenario is saved without switching to Friendly mode
- **THEN** the node's `systemDescription` after saving is unchanged (byte-identical JSON, modulo formatting), not replaced by a default operation mode

#### Scenario: Opening a representable configuration is unaffected
- **WHEN** a `s2-resource` node whose saved `systemDescription` is representable by the friendly editor is opened
- **THEN** its OMBC tab opens in Friendly mode showing that configuration, exactly as before this change

#### Scenario: Switching between modes matches s2-ombc-config's behavior
- **WHEN** a `s2-resource` node's OMBC tab is switched between Friendly and Advanced mode
- **THEN** it converts and validates the same way `s2-ombc-config`'s own Friendly/Advanced toggle does (see "Friendly/Advanced mode toggle"), including refusing to switch back to Friendly mode from a JSON edit that Friendly mode can't represent
