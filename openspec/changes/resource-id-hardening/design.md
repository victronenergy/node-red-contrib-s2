## Decisions

### One start-up check, shared by the three nodes
`resourceIdProblem(value)` in `src/lib/s2/resource-id-registry.ts` returns `null` for a usable ID, or the red status text plus an error message for one that isn't:
- empty: `resource ID missing`;
- an unresolved `${NAME}` or `$(NAME)` (Node-RED leaves the reference in place when the variable is unset): `resource ID variable not set`;
- outside `^[a-zA-Z0-9\-_:]{2,64}$`: `invalid resource ID`.

The value is converted with `String()` first, since a number-typed subflow property arrives as a number. Each node prefixes the message with its type and refuses to start, the same way it refuses a duplicate. That replaces the per-node environment variable checks added in `resource-id-subflows-and-transports`.

### Refuse an empty ID instead of generating one
After substitution, an empty `resourceId` can mean a blank environment variable or a node that was never opened in the editor. The runtime can't tell these apart, because Node-RED replaces the property before the constructor runs. A random ID per start gives the CEM a new resource on every deploy, which is the class of bug this work set out to fix. The editor now fills the ID in every user path (palette, paste, import, `oneditsave`, `s2-rm-config`'s `oneditprepare`), so only flows hand-written, or not opened since before this change, hit the refusal. The error says to open and save the node.

The maintainer asked for this to apply to all three nodes. It replaces the earlier `s2-rm` scenario "Empty resource ID starts normally".

### Release on setup failure with a constructor wrapper
Node-RED's `createNode` (`@node-red/runtime` `flows/util.js`) logs a throwing node constructor and drops the node, so its close handler never runs. Each node's registered constructor becomes:

```ts
function S2XNode (config) {
  RED.nodes.createNode(this, config)
  try { setUpS2XNode.call(this, config) } catch (err) { releaseAllResourceIds(this.id); throw err }
}
```

The existing body moves unchanged into `setUpS2XNode`. `releaseAllResourceIds(ownerNodeId)` drops every claim kind held by that node. This covers any current or future throw after the claim, rather than guarding the known ones (`new URL`, `new WebSocket`) one by one.

### Older `$(NAME)` form
Node-RED's `mapEnvVarProperties` still accepts `$(NAME)` (`EnvVarPropertyRE_old`, `/^\$\((\S+)\)$/`). The editor's `isEnvRef` and the runtime's `unresolvedEnvVar` match both forms.

### Field visibility
The Resource ID section is shown when the transport is WebSocket, when the node is inside a subflow template, or when the current value is an environment variable reference. The last case lets a reference that ended up outside a subflow be fixed in the dialog.

### Flag `s2-rm` nodes sharing an `s2-rm-config`
When an `s2-rm` is pasted, Node-RED keeps its reference to the existing `s2-rm-config` instead of copying it, so the editor watcher never sees a new config. A two-argument `validate` on `s2-rm`'s `rmConfig` property returns a message when another `s2-rm` references the same config node. Both nodes get the red triangle before deploy, which the runtime refusal confirms.

## Risks / Trade-offs

- [Existing nodes with an empty resource ID stop starting] -> Only possible for nodes hand-written, or not opened since before this change. The error says to open the node and press Done (the editor then fills in an ID), and the CHANGELOG says the same.
- [Existing `s2-rm-config` Resource IDs outside the S2 format stop starting] -> `s2-rm-config`'s field has never been validated, so a hand-typed ID with a space was possible. It was already broken over WebSocket (unencoded in the URL); the error names the value.
