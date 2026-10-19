## Why

The pre-PR review of the resource ID changes (`unique-resource-id`, `websocket-resource-id`) found gaps:

- **A refused `s2-rm` leaves its transport running.** `s2-websocket` reads the same `s2-rm-config` and connects to `wss://.../<resourceId>` without checking anything, so two `s2-rm` + `s2-websocket` pairs sharing a config still open two CEM connections under one ID, with no RM answering on the second.
- **Subflows work for only one instance.** Every instance of a subflow shares the template's `resourceId`, so after the duplicate refusal only the first instance of a subflow containing an `s2-resource` or `s2-rm` runs, and the user has no way to give each instance its own ID.
- **Editor reloads rewrite deployed duplicates.** The editor watcher treats every node added after the first flow load as a user addition. Reloads without a new `flows:loaded` (project switch, deploy-conflict reload) re-import the deployed flows and replace a duplicate's ID. In the deploy-conflict path Node-RED then clears all change flags, so the editor shows an ID the runtime is not using.
- **A claim can leak.** `releaseResourceId` runs at the end of `close`, after the transport disconnects; a throw there keeps the ID claimed until Node-RED restarts.
- **A refused node is only retried when it is redeployed.** After the holder is deleted with a "Modified nodes" deploy, the refused node stays refused, and the error doesn't say so.

## What Changes

- **Subflow environment variables:** `resourceId` accepts `${NAME}`, which Node-RED itself substitutes from the subflow instance's (or flow's, or global) environment before the node starts. Inside a subflow template the Resource ID field is shown for every transport, so a D-Bus resource in a subflow can use it too. An unresolved `${NAME}` makes the node refuse to start with an error naming the variable. The editor never replaces an `${NAME}` value and skips the duplicate check and UUID warning for it; the runtime duplicate check still applies to the resolved value.
- **Transport claim:** `s2-websocket` claims the resource ID of its `s2-rm-config` as a transport, and so does an `s2-resource` with a built-in WebSocket or D-Bus transport. A second transport for the same ID refuses to connect, with the same error and red status as a refused RM.
- **Editor watcher:** acts only on nodes that arrive marked `changed`, which is how Node-RED adds nodes from the palette, paste and imports. Loads and reloads of the deployed flows don't mark nodes changed, so they are left alone. This replaces the `flowsLoaded` flag.
- **Close handler:** releases the claim first, before anything that could throw.
- **Error text:** says to deploy the refused node again (or do a full deploy) once the other node is gone.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `s2-resource`: environment variables in the resource ID and the field inside subflows; the editor watcher rule; the transport claim; error guidance.
- `s2-rm-protocol`: the same editor rule and environment variables for `s2-rm-config`/`s2-rm`; `s2-websocket` refuses a resource ID another transport is using.

## Impact

- `resources/s2-common.js`: `isEnvRef`; `resourceIdNeedsReplacing` and `validateResourceId` treat `${NAME}` specially; `watchResourceIds` checks `node.changed`.
- `src/nodes/s2-resource/index.html`: field visibility inside subflow templates; help text.
- `src/lib/s2/resource-id-registry.ts`: a claim kind (`rm` or `transport`).
- `src/nodes/s2-resource/index.ts`, `src/nodes/s2-rm/index.ts`, `src/nodes/s2-websocket/index.ts`: unresolved environment variable check, transport claim, release first.
- `s2-dbus` is unchanged: it doesn't read a resource ID, so it can't claim one. A refused `s2-rm` wired to an `s2-dbus` still leaves that D-Bus service registered, and the help text says so.
- README, CHANGELOG.
