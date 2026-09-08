## Why

The published npm package omits the `resources/` directory (`s2-common.js`, `s2-styles.css`), which every node's edit dialog loads via `<script src="resources/node-red-contrib-s2/s2-common.js">`. Node-RED serves that directory straight from the installed package root (`node_modules/node-red-contrib-s2/resources/`), but `package.json`'s `files` allowlist never includes it, so `npm pack`/`npm publish` strips it out. Installed users get a 404 for `s2-common.js` on every node's edit dialog, which throws before the rest of the dialog script runs, breaking the editor for all four node types.

## What Changes

- Add `resources/` to the `files` allowlist in `package.json` so it ships with the published package at the package root (where Node-RED's registry looks for it — not under `dist/`).
- Make the `copy-html` build step less error-prone: replace the single long chained `mkdir -p && cp && cp ...` command (which grows by hand for every new node/icon and fails silently if a step is mistyped or a node is added without updating it) with a small script that copies each node's `index.html` and icons in a loop, and fails loudly if a expected source file is missing.
- Add a packaging check (script and/or test) that fails CI if a file required by the shipped nodes (resources referenced from any node's `index.html`, or a node's own `index.html`/icon) is not covered by `package.json`'s `files` allowlist — so this class of bug can't silently regress.

## Capabilities

### New Capabilities
- `packaging`: The published npm package must contain every static asset (compiled node files, per-node HTML/icons, and shared `resources/`) that the Node-RED editor needs to load each node's edit dialog, and the build must fail rather than silently omit assets.

### Modified Capabilities
(none — no existing specs yet)

## Impact

- `package.json` (`files` field, `copy-html` script)
- Build tooling (`copy-html` script, currently inline in `package.json`)
- New: a packaging-verification script/test (e.g. `test/packaging.test.ts` or a `scripts/check-package-files.js` run in `npm test`/CI)
- No runtime source code changes; no breaking changes to node behavior.
