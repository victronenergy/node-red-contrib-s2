## Context

See `unique-resource-id` and `websocket-resource-id` (archived 2026-10-19) for the claim registry, the editor watcher and the WebSocket Resource ID field this change builds on.

## Decisions

### Environment variables: let Node-RED substitute them
Node-RED replaces a node property whose whole value is `${NAME}` (`/^\${(\S+)}$/`) with the value from the node's environment before calling the node constructor (`@node-red/runtime` `flows/util.js` `mapEnvVarProperties`, the same in 4.1.0 and 5.0.x). For a node inside a subflow that environment is the subflow instance's properties, then the parent flow's, then global and process environment. So `config.resourceId` already holds the instance's own value at runtime and no extra resolution code is needed. Subflow instance nodes have distinct runtime ids (`<instanceId>-<nodeId>`), so per-instance values give per-instance claims, D-Bus service names and CEM resources.

When the variable is unset, Node-RED leaves the literal `${NAME}` in place. Sending that as `resource_id` would go unnoticed: the schema's unanchored pattern accepts it. The node therefore refuses to start when its `resourceId` still matches `^\${\S+}$`, naming the variable.

The maintainer chose to show the field inside subflow templates for every transport, so D-Bus users (GX Opportunity Loads) can use it. Outside subflows, D-Bus and External still hide it. A node is in a subflow template when `RED.nodes.subflow(node.z)` exists.

The editor can't know the per-instance values, so for `${NAME}` it skips the duplicate check and the non-UUID warning and never replaces it on add. The runtime checks the resolved values.

### Transport claim alongside the RM claim
The duplicate refusal only stopped the RM. The transports that carry a resource ID to a CEM are `s2-websocket` (from its `s2-rm-config`, in the URL) and `s2-resource`'s built-in transports. The registry gets a claim kind, `'rm' | 'transport'`, keyed separately, so the legitimate pair of one `s2-rm` and one `s2-websocket` on the same config can both claim, while a second transport for the same ID is refused. `s2-resource` with a built-in WebSocket or D-Bus transport claims both kinds; with External it claims only `rm`, and the external transport node claims `transport` itself.

`s2-dbus` doesn't read a resource ID (it registers by node id and relays whatever its `s2-rm` sends), so it can't claim. A refused `s2-rm` wired to an `s2-dbus` leaves a D-Bus service that never completes a handshake. Making `s2-dbus` depend on `s2-rm-config` is out of scope; it is documented.

### Editor watcher: `node.changed` instead of `flowsLoaded`
Node-RED marks nodes `changed` when the user adds them: `RED.view` `createNode` sets `nn.changed = true` (palette), and `RED.view.importNodes` imports with `markChanged: true` (paste, Import dialog, Examples, "Import copy"). Both happen before `nodes:add` is emitted. Loading and reloading the deployed flows (`RED.nodes.import` from `loadFlows`, the deploy-conflict reload, a project switch) use `markChanged: false`. Same in 4.1.0 and 5.0.x.

Acting only on `changed` nodes covers every user addition and no load or reload, with no timing assumptions and no state. It replaces the `flowsLoaded` flag and its late-registration special case. An undo that re-adds a deleted node keeps whatever `changed` value the node had; since the other copy already has its own ID by then, nothing is replaced.

**Alternative considered:** resetting `flowsLoaded` on `workspace:clear` and restoring it with `setTimeout(0)`. That fails for the project-switch path, where the re-import happens asynchronously after the timeout.

### Release first
Both close handlers call `releaseResourceId` first, before `rm.close()` and the transport disconnects, so a throw in those can't keep the ID claimed.

### Retry guidance instead of automatic retry
A refused node could subscribe to releases and start itself later, but that means constructing the RM and transport outside Node-RED's normal node lifecycle. Instead, the error says to deploy the refused node again (any change to it, or a full deploy) once the other node is gone.
