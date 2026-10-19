## Why

An `s2-resource` with `Control type: None` is always marked invalid in the editor ("Invalid JSON data: Unexpected end of JSON input"), so every deploy warns that the workspace contains nodes that are not properly configured (#69). Control type None has no OMBC system description, so `systemDescription` stays empty. Its input is a `json` typedInput. For a property with no validator of its own, Node-RED's editor asks that typedInput to validate the value (`validateNodeProperty`, the same in 4.1.0 and 5.0.x), and `JSON.parse('')` fails.

## What Changes

- Mark `systemDescription` as `required: false` in `s2-resource`'s defaults. For an optional property, Node-RED treats an empty value as valid before it consults the typedInput. A non-empty value is still checked as JSON.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `s2-resource`: an empty system description is valid.

## Impact

- `src/nodes/s2-resource/index.html`: one default property attribute.
- No runtime change: the runtime already treats an empty `systemDescription` as no operation modes.
- CHANGELOG.
