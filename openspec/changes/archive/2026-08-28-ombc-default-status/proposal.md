## Why

Confirming an OMBC status today requires both a `cemId` (only known after a CEM has connected and selected OMBC) and the exact `confirmedOperationModeId` (a config-authored UUID). That makes it impossible to inject a sensible default status at flow-deploy time, and there's no signal telling the flow when an initial status actually needs to be supplied.

## What Changes

- `cemId` becomes optional on a confirm message. When omitted, `s2-ombc` resolves it to the one CEM currently tracked with OMBC selected; zero such CEMs is treated as the pre-connection default case below, more than one is an error asking the caller to specify `cemId` explicitly.
- A confirm message may identify the operation mode by `confirmedOperationModeId`, `confirmedOperationModeIndex` (0-based index into the configured operation modes), or `confirmedOperationModeLabel` (matching a mode's `diagnostic_label`). Exactly one of the three must be present; more than one is an error. All three are resolved and validated against the configured operation modes - including `confirmedOperationModeId`, which today is sent to the CEM unchecked; an id matching no configured mode, an out-of-range index, or a label matching zero or more than one mode is rejected with an error.
- A confirm resolved with no CEM (per the first bullet) is stored as a single default, separate from the per-CEM persisted status. When a CEM later selects OMBC and has no persisted status of its own, the default seeds it (same `UpdateStatus` dispatch as an existing persisted status).
- After `s2-ombc` sends the `SystemDescription` for a newly OMBC-selecting CEM, if that CEM has neither a persisted status nor a default available, `s2-ombc` emits a `StatusRequest` notification on its instruction output so the downstream flow knows it must supply one (by sending a confirm message back into `s2-ombc`).
- No change to the wire format sent to the CEM (`OMBC.Status` is unaffected) - this only changes how `s2-ombc` accepts and resolves the *inputs* to that message.
- Verified separately, no change needed: OMBC instructions resolved on the instruction output already carry the operation mode's `id`, `index`, and `label` (`msg.ombc.operationMode`) per the existing "Instruction resolution into actionable output" requirement.

## Capabilities

### Modified Capabilities
- `control-type-ombc`: confirm-message resolution gains optional `cemId`, three ways to identify the operation mode, a pre-connection default status, and a `StatusRequest` notification when no status is available for a newly OMBC-selecting CEM.

## Impact

- `src/nodes/s2-ombc/index.ts` (`handleConfirm`, `handleSelectControlType`)
- `test/nodes/s2-ombc.test.ts`
- `cemId` continues to work exactly as today when supplied. `confirmedOperationModeId` gains validation it didn't have before: a confirm carrying an id that doesn't match any configured operation mode is now rejected, where today it would be sent to the CEM unchecked - a deliberate, narrow behavior change to close a protocol-correctness gap, not a compatibility concern for any caller already sending valid ids.
