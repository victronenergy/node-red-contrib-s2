## Why

Two Resource Managers that send the same `resource_id` in `ResourceManagerDetails` look like one resource to a CEM. A user with two `s2-resource` nodes saw GX Opportunity Loads list one load twice and the other not at all, or drop one entirely, with control behaving randomly. Recreating both nodes from scratch fixed it ([community thread](https://community.victronenergy.com/t/opportunity-loads-aircon-cloud-controlled/63386), #12-#17).

The cause is how `resourceId` is generated. `s2-resource` and `s2-rm-config` only generate it in `oneditprepare`, and only when it is empty. A copy-pasted node, or a flow or example imported twice, carries the original's `resourceId` along unchanged. Each `s2-resource` still registers its own D-Bus service (keyed by `node.id`), so on D-Bus the duplicates look like separate devices while S2 reports them as the same resource. Nothing warns about it. The shipped examples make this worse: `boiler-ombc-demo` and `s2-dbus-quickstart` hardcode the same `resourceId`.

The same code path leaves `resourceId` empty for a node that is added but never opened in the editor. The runtime then generates a new random ID on every deploy, which breaks the existing spec's "generated once on first add" promise.

## What Changes

- The editor watches nodes being added (`nodes:add`) once the deployed flows have loaded: palette drop, paste, Import dialog, Examples, "Import copy". It gives an `s2-resource` or `s2-rm-config` a new `resourceId` if the current one is empty or already used by another of those nodes. A cut-and-paste (the original is gone) or a first-time import keeps its ID, so a CEM keeps recognising the resource and its user settings (e.g. Opportunity Loads priority). Deployed flows are never changed on load.
- At runtime, `s2-resource` and `s2-rm` claim their resolved `resourceId` in a process-wide registry. A node whose `resourceId` another running node already holds logs an error naming that node, shows a red `duplicate resource ID` status, and does not start: no Resource Manager, no transport (no D-Bus service, no WebSocket), no control type. The claim is released on close.
- The shipped examples get distinct `resourceId`s.
- **Behaviour change:** a flow that already contains duplicate resource IDs will have one of those nodes refuse to start after upgrading, until its `resourceId` is regenerated (delete and re-add, or copy-paste it again). Today such a flow is already broken on the CEM side, but silently.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `s2-resource`: resource ID uniqueness when nodes are added in the editor, and refusing to start on a runtime duplicate.
- `s2-rm-protocol`: `s2-rm-config` resource ID uniqueness in the editor, and `s2-rm` refusing to start on a runtime duplicate resource ID.

## Impact

- `resources/s2-common.js`: shared editor helpers to generate a UUID, check whether a resource ID needs replacing, and watch nodes being added.
- `src/nodes/s2-resource/index.html`, `src/nodes/s2-rm-config/index.html`: start the watcher; `s2-resource`'s `oneditprepare` uses the shared generator.
- `src/lib/s2/resource-id-registry.ts` (new): process-wide claim/release.
- `src/nodes/s2-resource/index.ts`, `src/nodes/s2-rm/index.ts`: claim before starting, release on close.
- `examples/*.json`: unique `resourceId` per example.
- `README.md`, `CHANGELOG.md`, node help text.
