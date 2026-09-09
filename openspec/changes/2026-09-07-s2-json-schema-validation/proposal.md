## Why

S2 config editors (`s2-ombc-config`, `s2-pebc-config`) and the `s2-rm` message path currently accept malformed `systemDescription`/message JSON with no structural validation of their own: a typo or hand-authored mistake either fails silently, or only surfaces as a rejection/disconnect on the CEM side, far from where it was introduced. The [flexiblepower/s2-json](https://github.com/flexiblepower/s2-json) project publishes formal JSON schemas for the S2 protocol that could catch this earlier, with a clear error message, both when a config is saved and when a message is sent or received. This was raised as review feedback on `2026-09-04-ombc-mode-minimum-duration` (PR #36) and deferred there as out of scope for that proposal - this change exists so the idea isn't lost.

## What Changes

- Add JSON-schema-based validation of S2 payloads (Advanced-mode `systemDescription` on config save, and outgoing/incoming messages on the `s2-rm` session path), surfacing a clear validation error at the point of authoring/sending rather than only as a downstream CEM-side rejection.
- **Blocking prerequisite, not yet resolved:** `s2-json`'s schemas target S2 v1.0.0. Venus OS currently ships `s2-python` v0.8.1 against S2 protocol version `0.0.2-beta` (see `src/lib/s2/messages.ts`'s `supported_protocol_versions`), which this repo's `s2-rm`/`s2-ombc`/`s2-pebc` nodes are built against. `s2-json`'s v1.0.0 schemas cannot be applied as-is to `0.0.2-beta` payloads (field/shape differences between the two protocol versions are not yet catalogued). This proposal captures the intent and researches that gap; it does **not** commit to an implementation approach until the gap is resolved (candidates include: hand-adapting/forking a `0.0.2-beta`-shaped schema, waiting for/requesting an `s2-json` release covering `0.0.2-beta`, or validating only the subset of structure that is unambiguously stable across both versions).
- No implementation in this change - proposal and research only, per the user's request.

## Capabilities

### New Capabilities
- `s2-message-validation`: JSON-schema-based validation of S2 config and message payloads, applied at config-save time and on the `s2-rm` message path, against schemas matching the deployed S2 protocol version.

### Modified Capabilities
(none yet - `control-type-ombc`, `control-type-pebc`, and `s2-rm-protocol` will each need a delta once the schema-version gap above is resolved and an implementation approach is chosen; deferred to a follow-up revision of this change or a design decision within it)

## Impact

- `src/nodes/s2-ombc-config/index.html`, `src/nodes/s2-pebc-config/index.html` (Advanced-mode save-time validation)
- `src/lib/s2/session.ts`, `src/lib/s2/messages.ts` (message-path validation, S2 protocol version handling)
- Likely new dependency: a JSON Schema validator (e.g. `ajv`) plus either a vendored/adapted schema set or a new dependency on `s2-json` once its schema-version coverage is confirmed
- No breaking changes intended: validation should reject payloads that are already invalid per the S2 spec, not payloads that work today
