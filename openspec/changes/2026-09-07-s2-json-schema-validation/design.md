## Context

See proposal.md - Why. This change was opened to track review feedback from `2026-09-04-ombc-mode-minimum-duration` (PR #36, philipptrenz): validate S2 payloads against the formal JSON schemas from [flexiblepower/s2-json](https://github.com/flexiblepower/s2-json) instead of relying on structural checks scattered across each config editor and the message path having no schema backing at all.

The complication driving most of this document: `s2-json`'s schemas are written against S2 v1.0.0. This repo's `s2-rm`/`s2-ombc`/`s2-pebc` nodes implement S2 `0.0.2-beta` (`src/lib/s2/messages.ts`, `supported_protocol_versions: ['0.0.2-beta']`), matching what Venus OS actually ships (`s2-python` v0.8.1). The two protocol versions are not confirmed to be structurally compatible - S2 changed meaningfully between beta and 1.0 - so `s2-json`'s schemas cannot be assumed to apply as-is.

## Goals / Non-Goals

**Goals:**
- Establish what schema-version gap exists between `s2-json` (v1.0.0) and the deployed protocol (`0.0.2-beta`), and pick one of the resolution options below before committing to an implementation.
- Once resolved, validate both config-save-time payloads (Advanced-mode `systemDescription`) and message-path payloads (`s2-rm` send/receive) against a schema that actually matches `0.0.2-beta`.

**Non-Goals:**
- Migrating this repo's nodes to S2 v1.0.0 - that's a separate, much larger change (protocol version support is decided by what Venus OS ships, not by this repo alone) and not implied by wanting schema validation.
- Replacing the existing structural checks in `s2-ombc-config`/`s2-pebc-config` (`isFriendlyRepresentable` and friends) - those check friendly/Advanced round-trip shape, a different concern from S2-spec conformance, and stay as-is regardless of this change.

## Decisions

**No implementation decision yet - this section records the options, not a choice.**
Resolving the `0.0.2-beta` vs. v1.0.0 gap needs research (diffing the two S2 spec versions field-by-field, or asking upstream) that has not happened yet. Candidate resolutions, to be evaluated in a follow-up revision of this change:
1. **Hand-adapt/fork a `0.0.2-beta`-shaped schema** from `s2-json`'s v1.0.0 schema, tracked and reviewed manually as the source of truth for validation here. Risk: schema drift if `s2-json` fixes bugs upstream that don't get pulled into the fork.
2. **Request or wait for `s2-json` to publish a `0.0.2-beta` (or general "beta") schema set**, if one exists or the upstream project would accept a contribution. Cleanest long-term, but not in this repo's control and may never happen.
3. **Validate only the subset of structure that is unambiguously stable across both versions** (e.g. top-level message envelope shape, `message_type` values), leaving control-type-specific payload shapes (`OMBC.SystemDescription`, `PEBC.SystemDescription`, etc.) unvalidated until option 1 or 2 lands. Lower value but zero risk of false rejections from a mismatched schema.

Whichever option is chosen becomes a **Decision** in a revision of this document, at which point the `specs/s2-message-validation/spec.md` delta and `tasks.md` can be filled in with concrete, implementable requirements.

**Validator library, if/when implementation proceeds:** `ajv` is the de facto standard JSON Schema validator for Node.js and is already a natural fit given `src/lib/s2` is plain TypeScript with no existing schema-validation dependency - noted here as the likely choice, not a commitment, since it doesn't affect the blocking question above.

## Risks / Trade-offs

- [Validating against a schema that doesn't actually match the deployed `0.0.2-beta` protocol] -> Would produce false-positive rejections of legitimately valid `0.0.2-beta` payloads, worse than the status quo of no validation. This is why the version-gap decision above is a hard blocker on any implementation, not just a nice-to-have to resolve later.
- [Cost of maintaining a hand-adapted/forked schema (option 1) as the S2 spec or `s2-json` evolves] -> Accepted as a maintenance cost only if options 2 and 3 turn out to be infeasible; to be weighed explicitly once the version-gap research is done.

## Open Questions

- Does `s2-json`'s v1.0.0 schema differ from S2 `0.0.2-beta` in ways that affect the payloads this repo actually sends/receives (OMBC/PEBC system descriptions, instructions, status), or only in areas this repo doesn't touch? Answering this determines whether options 1-3 above are even meaningfully different in effort.
- Is there an existing `0.0.2-beta`-era S2 JSON schema anywhere (an older `s2-json` tag/branch, the S2 spec repo itself, or another RM/CEM implementation) that could be used directly instead of adapting the v1.0.0 one?
