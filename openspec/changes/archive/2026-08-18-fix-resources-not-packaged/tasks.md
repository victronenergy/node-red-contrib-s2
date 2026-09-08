## 1. Ship resources/ in the published package

- [x] 1.1 Add `"resources/"` to the `files` array in `package.json`
- [x] 1.2 Verify with `npm pack --dry-run` that `resources/s2-common.js` and `resources/s2-styles.css` appear in the file list

## 2. Replace the fragile copy-html shell one-liner

- [x] 2.1 Add `scripts/copy-html.js`: reads node names from `package.json`'s `node-red.nodes`, copies each `src/nodes/<name>/index.html` to `dist/nodes/<name>/index.html`, and copies the icon(s) referenced by each node's HTML/existing icons setup, creating destination directories as needed
- [x] 2.2 Make `scripts/copy-html.js` throw / exit non-zero with a clear message if any expected source file (HTML or icon) is missing
- [x] 2.3 Update the `copy-html` script in `package.json` to run `node scripts/copy-html.js` instead of the inline `mkdir -p && cp ...` chain
- [x] 2.4 Run `npm run build` and confirm `dist/nodes/<name>/index.html` and `dist/nodes/<name>/icons/*` still exist for all four node types

## 3. Add a packaging-completeness check

- [x] 3.1 Add a check (e.g. `scripts/check-package-files.js`, or a Jest test under `test/`) that runs `npm pack --dry-run --json` to get the real published file list
- [x] 3.2 For each node in `node-red.nodes`, assert `dist/nodes/<name>/index.html` is in the published file list
- [x] 3.3 Parse each shipped node's `index.html` for `resources/...` references (script `src` / link `href`) and assert the referenced file is in the published file list
- [x] 3.4 Wire the check into the `test` script (or `prepublishOnly`, alongside `build`) so it runs in CI and blocks a broken publish
- [x] 3.5 Confirm the check fails (revert step 1.1 locally, run the check, expect non-zero exit) then restore the fix and confirm it passes

## 4. Verify the fix end to end

- [x] 4.1 Run `npm pack` and inspect the resulting tarball (`tar -tzf`) to confirm `resources/s2-common.js`, `resources/s2-styles.css`, and every node's `index.html` are present
- [x] 4.2 Run `npm test` and confirm it passes with the new packaging check included
