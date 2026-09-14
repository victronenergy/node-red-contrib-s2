# Vendored from flexiblepower/s2-json

Source: https://github.com/flexiblepower/s2-json
Tag: `v0.0.2-beta` (matches this repo's own `supported_protocol_versions` in `../messages.ts`)
Commit: `b831b6f1f19f824f32269ecd6ac6a6e250e7af80`
Vendored: 2026-09-14
License: Apache-2.0 (see `LICENSE` in this directory)

Only the `messages/` and `schemas/` subdirectories are vendored - the AsyncAPI and OpenAPI
definitions in the upstream repo aren't needed here.

Do not hand-edit these files. If upstream fixes something (e.g. the `maxItems: 5` discrepancy
on `ResourceManagerDetails.available_control_types` flagged in
`openspec/specs/s2-message-validation/spec.md`), re-vendor by re-cloning the relevant tag rather
than patching individual files, so this stays a clean, diffable copy of a real upstream commit.
