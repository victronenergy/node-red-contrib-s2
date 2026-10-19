## 1. Runtime claim registry

- [x] 1.1 Write `test/lib/resource-id-registry.test.ts`: claim succeeds when free; claim by a different owner fails and returns the holder; claim again by the same owner succeeds; release frees it; release by a non-owner leaves the claim in place.
- [x] 1.2 Implement `src/lib/s2/resource-id-registry.ts` (`claimResourceId`, `releaseResourceId`).

## 2. s2-resource refuses a duplicate

- [x] 2.1 Tests in `test/nodes/s2-resource.test.ts`: a second node with the same `resourceId` reports an error naming the first, shows the red `duplicate resource ID` status, constructs no D-Bus or WebSocket transport, and sends nothing on input; after the first node closes, a new node with that `resourceId` starts.
- [x] 2.2 Claim in `src/nodes/s2-resource/index.ts` right after resolving `rmDetails`, before anything else starts; release in `close`.

## 3. s2-rm refuses a duplicate

- [x] 3.1 Tests in `test/nodes/s2-rm.test.ts`: two `s2-rm` nodes sharing an `s2-rm-config` (second is refused and handles no input); an `s2-rm` sharing its ID with a running `s2-resource`; an empty `resourceId` starts normally; release on close.
- [x] 3.2 Claim in `src/nodes/s2-rm/index.ts` after resolving `rmDetails`; release in `close`.

## 4. Editor: regenerate on add

- [x] 4.1 Write `test/resources/s2-common.test.ts`, loading `resources/s2-common.js` with a fake `window` and `RED`: `generateUuid` returns a v4 UUID; `resourceIdNeedsReplacing` is true for an empty ID, true when another `s2-resource` or `s2-rm-config` holds it, false when only the node itself holds it, and false for unrelated node types with a `resourceId` property.
- [x] 4.2 Add `generateUuid` and `resourceIdNeedsReplacing` to `resources/s2-common.js`.
- [x] 4.3 Tests for `watchResourceIds`: replaces duplicates of `s2-resource` and `s2-rm-config` added after `flows:loaded` and marks them changed; fills an empty ID; keeps a unique ID; leaves the initial load alone; active straight away when tabs already exist; one listener when called twice.
- [x] 4.4 Implement `watchResourceIds`; call it from the `s2-resource` and `s2-rm-config` editors; use `generateUuid` in `s2-resource`'s `oneditprepare` fallback.
- [x] 4.5 Verify in a real editor with Playwright: palette drop, copy-paste, cut-paste, importing an example twice ("Import copy", own tab) for `s2-resource` and `s2-rm-config`, and an editor reload with deployed duplicates. (Found: `onadd` misses imports onto a new tab, which led to 4.3/4.4; Node-RED reuses an identical `s2-rm-config` on "Import copy", which the runtime check covers.)

## 5. Examples and docs

- [x] 5.1 Give every example a distinct `resourceId` (`boiler-ombc-demo` and `s2-dbus-quickstart` share one today).
- [x] 5.2 Mention the duplicate check in the `s2-resource` and `s2-rm` help text, the README, and the CHANGELOG (Unreleased: Fixed, plus the behaviour change for flows that already contain duplicates).

## 6. Validation

- [x] 6.1 `npm test` (lint + unit) and `npm run build` pass.
- [x] 6.2 `openspec validate unique-resource-id --strict` passes.
