## Context

`s2-rm`'s handshake/session/routing logic lives entirely inside its `registerType(RED)` callback (`src/nodes/s2-rm/index.ts`) - there's no way to construct that behavior except as a Node-RED node instance. `s2-ombc-config`'s friendly operation-mode editor is likewise a self-contained block of client-side jQuery inside `src/nodes/s2-ombc-config/index.html`. `s2-resource` needs both, embedded, without duplicating either. See `proposal.md` for why.

## Goals / Non-Goals

**Goals:**
- One extraction of `s2-rm`'s session logic that both `s2-rm` and `s2-resource` construct directly, with no behavior difference between them.
- One copy of the OMBC friendly-editor widget, loaded by both `s2-ombc-config` and `s2-resource`.
- `s2-resource`'s port layout stays deterministic and matches `s2-rm`'s exactly in the `External`/`None` configuration (see `s2-resource` spec's port-contract requirement).

**Non-Goals:**
- Redesigning `s2-rm`'s protocol behavior - this only changes where the code that implements it lives.
- A generic "N independent toggles each contributing ports" mechanism for future control types - this change only needs to solve it for two settings (Transport, Control type).

## Decisions

**Extract session logic into a plain class, not a shared mixin or base node type.** `s2-rm`'s `registerType` callback becomes a thin Node-RED wrapper around a new `S2ResourceManager` class (in `src/lib/s2/`, alongside the existing `session.ts`/`messages.ts`) that takes plain callbacks for "send to transport" and "emit to CEM-output" instead of calling `node.send()` directly. `s2-rm` and `s2-resource` each construct one and wire its callbacks to their own ports. Rejected: making `s2-resource` internally instantiate a hidden `s2-rm` Node-RED node - Node-RED nodes aren't designed to be constructed outside `registerType`, and it would leave a phantom node with no visible wires or status in the editor.

**Shared CEM connection stays a separate config node; RM identity does not.** `s2-resource`'s Connection tab picks an existing `s2-cem-config` node (same dropdown-plus-edit-pencil pattern every config-node reference in this codebase uses), because one CEM connection legitimately serves multiple resources. RM identity (`resourceId`, `roles`, ...) is folded directly into `s2-resource`'s own config instead of a separate `s2-rm-config` reference, because - checked against `s2-rm-config`'s actual fields - a resource ID and its roles are inherently 1:1 with one resource and were never actually shared in practice; the separate config node existed only because `s2-rm` needed one to be constructible as a node.

**Shared OMBC editor widget via a common client-side script, not duplication.** The friendly-editor functions (`addModeItem`, `defaultStandbyMode`, the friendly/advanced conversion, etc.) move into a script loaded once and referenced by both `s2-ombc-config/index.html` and `s2-resource/index.html` - Node-RED loads every enabled node's `.html` into one editor page, so functions defined by one node's script tag are callable from another's as long as load order is respected (`s2-resource` depends on the shared script, not the other way around, avoiding an order dependency). Rejected: duplicating the widget into `s2-resource` - the exact drift risk the "Abnormal only" and future OMBC editor changes are meant to avoid.

**Port layout: fixed slots per built-in, not a single dynamic count.** `s2-resource` always exposes the same four *slots* - transport-in, transport-out, CEM-in, CEM-out - matching `s2-rm`'s two-input/two-output shape. `Transport: WebSocket` wires the transport slots to the built-in connection instead of external ports; `Control type: OMBC` wires the CEM slots to the built-in control type instead of external ports. Only a slot whose corresponding setting is `External`/`None` is exposed as an actual Node-RED input/output. This keeps the port *count* a simple function of two independent booleans (0, 2, or 4 external ports) rather than needing an ordering scheme across more than two toggles - deliberately narrower than a general N-toggle mechanism (see Non-Goals). `oneditsave` recomputes `node.inputs`/`node.outputs` from both selects together, the same mechanism `victron-virtual` already uses for its single S2 toggle.

## Risks / Trade-offs

- [Extracting `s2-rm`'s logic could subtly change its behavior] → The `s2-rm-protocol` spec's existing requirements and `test/nodes/s2-rm.test.ts` are the regression check; the extraction itself is required to keep `s2-rm`'s test suite passing unchanged.
- [Shared client-side script load order] → `s2-resource`'s script tag calls the shared widget functions only from inside `oneditprepare`/`oneditsave`, which run long after all node scripts have loaded, so exact `<script>` tag order between the two `.html` files doesn't matter in practice; still worth an explicit smoke test (deploy both nodes in one flow) rather than relying on that alone.
- [Two-toggle port recomputation done wrong could silently disconnect existing wires on redeploy] → Only recompute when the resolved slot exposure actually changes from the node's last-deployed state, matching Node-RED's own guidance for dynamic-port nodes.

## Open Questions

- Whether the extracted `S2ResourceManager` class also becomes the natural home for the not-yet-designed runtime `NOT_CONTROLABLE` toggle (proposal's "Out of scope" list) - deferred to that future change, doesn't affect this one's shape.
