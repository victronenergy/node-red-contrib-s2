## 1. Reproduce (red)

- [x] 1.1 Script in the scratchpad: `git archive` the branch into an empty directory; (a) `npm pack` without devDependencies, record exit code and whether the tarball has `dist/`; (b) `npm ci` + `npm pack`, check the tarball has `dist/lib/index.js` and every node's `index.js`/`index.html`; (c) `npm install --omit=dev <tarball>` in an empty directory, check whether `node_modules/node-red` exists; (d) extract the tarball from (b) and `npm pack` it without devDependencies, as the Venus recipe does. On main: (a) exits 0 without `dist/`, (b) has no `dist/`, (c) installs Node-RED.

## 2. Fix

- [x] 2.1 `package.json`: add `prepack` (`scripts/prepack.js`: build when `src/` exists, else require `dist/`); remove `peerDependencies`; update `package-lock.json` with `npm install`.
- [x] 2.2 Re-run 1.1 (green): (a) exits non-zero with no tarball, (b) passes, (c) installs no `node-red` or `@node-red/*`, (d) repacks successfully with `dist/`. (A plain `"prepack": "npm run build"` passed (a)-(c) but failed (d) with `tsc: not found`.)

## 3. Docs and validation

- [x] 3.1 CHANGELOG.
- [x] 3.2 `npm test`, `npm run build`, `check-package-files` pass; `openspec validate packaging-for-venus --strict` passes.
