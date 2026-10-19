## Why

A second pre-PR review of the resource ID work (`unique-resource-id`, `websocket-resource-id`, `resource-id-subflows-and-transports`) found more gaps:

- **A blank variable gives a random ID per deploy.** Node-RED substitutes `${NAME}` whenever the variable is defined, including when it's blank, so the node sees an empty ID and falls back to a random one on every start. The CEM then sees a new resource after each deploy. `s2-websocket` on the same config connects with no ID at all.
- **Claims leak when setup throws.** Node-RED never closes a node whose constructor threw. `s2-rm` (`new URL()` on a malformed CEM URL), `s2-websocket` and `s2-resource` (`new WebSocket()` on a malformed URL) can throw after claiming, so the ID stays held until Node-RED restarts.
- **No way to edit a reference outside a subflow.** A D-Bus `s2-resource` copied out of a subflow keeps `${NAME}`, but outside subflows its Resource ID field is hidden.
- **Resolved values aren't checked.** The editor can't check what `${NAME}` resolves to, and the runtime didn't either. `boiler 1`, or a number, went straight to the CEM and into the WebSocket URL.
- **The older `$(NAME)` form isn't recognised.** Node-RED still substitutes it, but the editor marked it invalid and the runtime didn't detect it when unset.
- **A copied `s2-rm` shares its config without warning.** Node-RED reuses the existing `s2-rm-config` when an `s2-rm` is pasted, so the copy is only refused at deploy, with no hint in the editor.

## What Changes

- **Start-up check:** `s2-resource`, `s2-rm` and `s2-websocket` check the resource ID after Node-RED's substitution and refuse to start when it is empty (`resource ID missing`), still an unresolved reference (`resource ID variable not set`), or outside the S2 ID format (`invalid resource ID`). A non-string value is used as its string form.
- **Behaviour change:** an empty ID is no longer replaced with a random one at runtime, for all three nodes. The editor always fills it in now (palette, paste, import, and on save).
- **Release on failure:** each node's constructor releases its claims if its setup throws.
- **Older form:** `$(NAME)` is treated as an environment variable reference everywhere `${NAME}` is.
- **Field visibility:** `s2-resource` also shows its Resource ID field whenever the value is an environment variable reference.
- **Shared configs:** the editor marks an `s2-rm` invalid when another `s2-rm` uses the same `s2-rm-config`.
- **Wording:** the CHANGELOG and help say plainly that a copied `s2-rm` keeps its `s2-rm-config`, so it needs its own.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `s2-resource`: the start-up check, release on setup failure, `$(NAME)`, and Resource ID field visibility.
- `s2-rm-protocol`: the same check and release for `s2-rm` and `s2-websocket`; an empty ID is refused; shared `s2-rm-config` is flagged in the editor.

## Impact

- `src/lib/s2/resource-id-registry.ts`: `resourceIdProblem`, `releaseAllResourceIds`; `unresolvedEnvVar` also matches `$(NAME)`.
- `src/nodes/s2-resource/index.ts`, `src/nodes/s2-rm/index.ts`, `src/nodes/s2-websocket/index.ts`: use the shared check; release-on-throw wrapper.
- `resources/s2-common.js`: `isEnvRef` also matches `$(NAME)`; `rmConfigSharedBy` for the `s2-rm` validate.
- `src/nodes/s2-resource/index.html`: field visibility. `src/nodes/s2-rm/index.html`: `validate` on `rmConfig`.
- Tests whose fixtures relied on an empty resource ID being generated at runtime.
- README, CHANGELOG, help texts.
