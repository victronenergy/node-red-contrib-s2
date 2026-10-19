## Context

A CEM identifies a Resource Manager by `ResourceManagerDetails.resource_id`. Both `s2-resource` (its own `resourceId` property) and `s2-rm` (through `s2-rm-config.resourceId`) take it from config, falling back to a fresh `generateId()` at runtime when it is empty. The editor generates it in `oneditprepare` only when it is empty, so anything that copies node JSON (copy-paste, import, examples) copies the ID too.

## Goals / Non-Goals

**Goals:**
- A copy-pasted or re-imported `s2-resource` gets its own `resourceId` without any user action.
- A moved (cut-and-paste) or first-time-imported node keeps its `resourceId`, so the CEM's per-resource state and settings survive.
- Two running nodes with the same `resourceId` never both talk to a CEM.

**Non-Goals:**
- Detecting duplicates across separate Node-RED instances or devices. Each is a separate process; the ID is a UUID, so a collision across instances only happens when someone copies flow JSON between them, which is out of scope.
- Changing the D-Bus service name or settings path (still keyed by `node.id`).
- Exposing `resourceId` on the RM tab (still hidden, per the existing requirement).

## Decisions

### Replace on `nodes:add`, only when needed, only after the flows have loaded
The editor emits `nodes:add` (`RED.nodes.add`) for every node it gains: a palette drop, a paste, any import (Import dialog, Examples, "Import copy"), undo, and also each node of the initial flow load. At that point the new node is already in `RED.nodes`, and so is the original of a copy-paste or of a repeated import. A cut-and-paste has already removed the original. `flows:loaded` is emitted once, at the end of the initial load. All of this is the same in 4.1.0 (the minimum `node-red.version`) and 5.0.x.

`watchResourceIds(RED)` in `resources/s2-common.js` listens for `nodes:add` and, once flows have loaded, gives an `s2-resource` or `s2-rm-config` a new ID (and marks it changed) when its `resourceId` is empty or another of those nodes holds the same value. It never replaces a unique ID: the CEM may already know that resource, and changing it would lose the user's per-resource settings there (for Opportunity Loads, its priority and enable state). Nodes from the initial load are left alone, so the editor never changes a deployed node behind the user's back; the runtime check reports deployed duplicates instead. Both node editors call it; a flag on `window.__s2Common` keeps it to one listener. If the script loads after the flows (palette install while the editor is open), flow tabs already exist, so it starts active.

The functions take `RED` as a parameter so Jest can run the shipped script against a fake editor.

**Alternatives considered:**
- A node definition's `onadd`: the first version of this change. Playwright showed it is only called for nodes that land on the active tab (`RED.view.importNodes` filters its moving set by `n.z == RED.workspaces.active()`). Every shipped example, and any exported flow, brings its own tab, so a second "Import copy" kept the duplicate ID.
- Always regenerate on import: breaks cut-and-paste and moving a node between tabs, both of which go through import. That silently changes the resource's identity.
- `validate` on the `resourceId` property (red triangle): flags the problem but leaves the user to fix a hidden field.
- Derive `resource_id` from `node.id`: `node.id` changes on every paste, which would be correct for copies, but it also changes on cut-and-paste. It would also change the ID of every existing deployed resource on upgrade.

### Process-wide claim registry at runtime
`src/lib/s2/resource-id-registry.ts` keeps a module-level `Map<resourceId, ownerNodeId>`. Node-RED gives every node file its own `RED` object (`@node-red/registry` `createNodeApi`), so state shared between `s2-rm` and `s2-resource` cannot be keyed on `RED`. The compiled module is shared through Node's require cache, so a single module-level map is shared by both node types.

On deploy, Node-RED waits for all affected nodes to stop (`flows.stop(...).then(start)`) before starting new ones. A node being redeployed releases its claim in `close` before its replacement claims. Claiming again with the same owner node id succeeds, so a node recreated in place is never refused by its own stale claim. A node stopped but not closed cannot happen in Node-RED.

On conflict, the later-constructed node is refused (start order follows flow order, so the result is deterministic for a given flow). The error names the node that holds the claim, so the user can find both.

### Refuse to start rather than warn
The maintainer chose refusal. Two RMs with one identity silently corrupt the CEM's view, and the loads Opportunity Loads controls are real appliances. A red status plus a single error is easy to find; a warning that keeps both running leaves the broken behaviour in place. The refused node creates no `S2ResourceManager`, no transport and no control type, registers no input handler, and has nothing to release on close.

## Risks / Trade-offs

- [Existing flows with duplicates lose one node after upgrade] -> Documented as a behaviour change in the CHANGELOG, with the fix: copy and paste the refused node (the copy gets a new ID in the editor) and delete the original. The runtime error says the same.
- [A node added before this change and never opened keeps an empty `resourceId`] -> Runtime still falls back to `generateId()` per deploy, as today, and `oneditprepare` still fills it in on the next edit. Unchanged behaviour, not made worse.
- [Flows reloaded mid-session (e.g. after a remote deploy merge) go through `nodes:add` without a new `flows:loaded`] -> A duplicate arriving that way is replaced in the editor and deployed on the next deploy. That only affects a node the runtime is already refusing.
- [Two `s2-rm` nodes sharing one `s2-rm-config`] -> Now refused. No shipped example does this on its own, and two sessions under one identity is the same corruption the change prevents. Importing the same `s2-rm` example twice ends up here too: Node-RED's "Import copy" reuses an identical existing config node rather than copying it, so there is no second config for the editor to give a new ID. The runtime refusal and its error (give the node its own `s2-rm-config`) cover it.
