## ADDED Requirements

### Requirement: Packing always includes a fresh build or fails
When packing a source checkout (one that contains `src/`), `npm pack` and `npm publish` SHALL build the package first, so the packed `dist/` matches the source; when the build cannot run (e.g. devDependencies not installed), packing SHALL fail with a non-zero exit instead of producing a package without `dist/`. When packing an already-built package (no `src/`, e.g. the extracted npm registry tarball a Venus recipe repacks), packing SHALL NOT build, and SHALL fail if `dist/` is missing.

#### Scenario: Packing a source checkout with devDependencies
- **WHEN** `npm pack` is run in a clean checkout of the repository after `npm ci`
- **THEN** the tarball contains `dist/lib/index.js` (the package's `main`) and `dist/nodes/<node-name>/index.js` and `index.html` for every node in `node-red.nodes`

#### Scenario: Packing a source checkout without devDependencies
- **WHEN** `npm pack` is run in a source checkout (e.g. an extracted GitHub tag tarball) where devDependencies are not installed
- **THEN** `npm pack` exits non-zero and writes no tarball

#### Scenario: Repacking the published tarball
- **WHEN** the npm registry tarball is extracted and `npm pack` is run on it without devDependencies, as the Venus recipe does
- **THEN** it packs successfully without building, and the result still contains `dist/`

### Requirement: A production install does not install Node-RED
Installing the package for production SHALL NOT install Node-RED itself. The package SHALL declare its Node-RED requirement only through `node-red.version`, not as a dependency, peer dependency or optional dependency.

#### Scenario: Plain production install
- **WHEN** the packed tarball is installed with `npm install --omit=dev` in an empty directory, without `--omit=peer`
- **THEN** no `node-red` or `@node-red/*` package is installed
