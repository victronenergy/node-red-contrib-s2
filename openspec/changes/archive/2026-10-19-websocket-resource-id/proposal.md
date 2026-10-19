## Why

A WebSocket CEM addresses a Resource Manager by its resource ID: `s2-cem-config` puts it in the connection URL (`wss://.../{resourceId}`), and some CEMs only accept resources registered on their side first, with an ID the user has to enter there or that the CEM issues. `s2-resource` keeps `resourceId` hidden, so for such a CEM the user can neither read the generated ID nor set the one the CEM expects, short of editing flow JSON. `s2-rm-config` already shows an editable Resource ID; `s2-resource` is the recommended node and should cover this too.

A D-Bus CEM (GX Opportunity Loads) never surfaces the ID, so there it stays hidden, as today.

## What Changes

- `s2-resource`'s Connection tab shows an editable **Resource ID** field in the WebSocket section, directly under the CEM picker, only when `Transport: WebSocket`. It shows the generated ID, which the user can copy or replace.
- The field accepts the S2 `ID` format: 2-64 characters of `a-z`, `A-Z`, `0-9`, `-`, `_` or `:`. Anything else, or an ID another `s2-resource`/`s2-rm-config` in the editor already uses, makes the node invalid with a specific message (red triangle, Node-RED's deploy warning).
- A valid ID that isn't a UUID shows a non-blocking warning under the field: CEMs built on s2python (which types `resource_id` as a UUID) reject it.
- Saving with the field emptied generates a new ID instead of leaving it empty.
- The ID is not shown for `Transport: D-Bus` or `External`, unchanged. Switching transport keeps whatever ID the node has.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `s2-resource`: the Resource ID is user-visible and editable for `Transport: WebSocket` only, with validation.

## Impact

- `src/nodes/s2-resource/index.html`: field in the WebSocket section, `validate` on `resourceId`, live non-UUID warning, `oneditsave` fallback, help text.
- `resources/s2-common.js`: `validateResourceId` (format and duplicate check) and `isUuid`, shared and unit-tested.
- `resources/s2-styles.css`: a scoped warning style for the non-UUID hint.
- No runtime change: the runtime already uses the configured `resourceId` as-is, and the duplicate check from `unique-resource-id` applies to it.
- README, CHANGELOG.
