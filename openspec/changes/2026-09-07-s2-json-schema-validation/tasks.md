## 1. Research: resolve the schema-version gap

- [ ] 1.1 Diff S2 `0.0.2-beta` against S2 v1.0.0 for the message/payload shapes this repo actually sends or receives (session/handshake messages, `OMBC.SystemDescription`/`OMBC.Instruction`/`OMBC.Status`, `PEBC.SystemDescription`/`PEBC.Instruction`/`PEBC.Status`, generic status/system-description commands) - identify which fields, if any, changed shape, were added, or were removed
- [ ] 1.2 Check whether an S2 `0.0.2-beta`-era JSON schema already exists anywhere (an older `s2-json` tag/branch, the S2 spec repository itself, another open-source RM/CEM implementation) before assuming one needs to be built
- [ ] 1.3 Based on 1.1 and 1.2, choose one of the three resolution options in design.md's Decisions section (adapt/fork a `0.0.2-beta` schema, obtain/wait for an upstream `0.0.2-beta` schema, or validate only the version-stable subset) and update design.md's Decisions section with the chosen approach and rationale
- [ ] 1.4 Revisit `specs/s2-message-validation/spec.md` once 1.3 is decided: confirm its requirements still hold, or tighten/adjust them (e.g. narrow "the applicable schema" to the concrete chosen source) before implementation tasks are written

## 2. Implementation (blocked on section 1)

- [ ] 2.1 Add the chosen schema source to the repo (vendored file(s), or a new dependency) and a validator (`ajv`, pending confirmation in design.md)
- [ ] 2.2 Wire config-save-time validation into `s2-ombc-config`/`s2-pebc-config`'s Advanced-mode save path, with an actionable inline error on failure
- [ ] 2.3 Wire message-path validation into `s2-rm`'s session layer (`src/lib/s2/session.ts`) for both outgoing and incoming messages, with a diagnostic log on failure
- [ ] 2.4 Add Jest coverage for the validation logic in `src/lib/s2` (valid payload passes, invalid payload is rejected with a useful error)

## 3. Verification

- [ ] 3.1 Manual verification: save a valid and an invalid Advanced-mode `systemDescription` in each of `s2-ombc-config`/`s2-pebc-config`; confirm existing valid configs from before this change still open/save without new validation errors
- [ ] 3.2 `npm run lint`
- [ ] 3.3 `npm run build`
- [ ] 3.4 `npm test`
