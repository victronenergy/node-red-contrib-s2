# packaging Specification

## Purpose

Defines what the published npm tarball must contain so that Node-RED's editor can load every node's edit dialog (HTML, icons, and shared resources) after a plain `npm install` - with the build failing loudly instead of silently shipping an incomplete package.

## Requirements

### Requirement: Published package includes shared editor resources
The npm package SHALL include the `resources/` directory at the package root (sibling to `package.json`), since Node-RED's registry serves `resources/<module-name>/<file>` directly from the installed package root, not from `dist/`.

#### Scenario: Editor loads a node's edit dialog after a fresh install
- **WHEN** a user runs `npm install node-red-contrib-s2` and opens the edit dialog for any of `s2-rm-config`, `s2-cem-config`, `s2-websocket`, `s2-rm`, `s2-ombc-config`, `s2-ombc`, `s2-pebc-config`, `s2-pebc`, `s2-dbus-config`, `s2-dbus`, or `s2-resource` in the Node-RED editor
- **THEN** the browser successfully loads `resources/node-red-contrib-s2/s2-common.js` and `resources/node-red-contrib-s2/s2-styles.css` (HTTP 200, not 404), and the edit dialog renders without a JavaScript error

#### Scenario: Packaged tarball contains the resources directory
- **WHEN** `npm pack` is run against this package
- **THEN** the resulting tarball contains `resources/s2-common.js` and `resources/s2-styles.css`

### Requirement: Published package includes every node's compiled HTML and icons
The npm package SHALL include, for every node type declared in `package.json`'s `node-red.nodes` map, the compiled `index.html` file and any icon referenced by that node, at the path Node-RED expects (alongside the compiled node file under `dist/nodes/<node-name>/`).

#### Scenario: Packaged tarball contains each node's edit-dialog HTML
- **WHEN** `npm pack` is run against this package
- **THEN** the tarball contains `dist/nodes/<node-name>/index.html` for each of `s2-rm-config`, `s2-cem-config`, `s2-websocket`, `s2-rm`, `s2-ombc-config`, `s2-ombc`, `s2-pebc-config`, `s2-pebc`, `s2-dbus-config`, `s2-dbus`, and `s2-resource`

### Requirement: Build fails when a required editor asset is missing
The build and/or packaging verification SHALL fail (non-zero exit) if a static asset referenced by a shipped node's `index.html` (a `resources/...` reference, an icon, or the HTML file itself) would not be present in what `npm publish` uploads.

#### Scenario: A node's HTML file is missing from the build output
- **WHEN** the build or packaging check runs and a node listed in `node-red.nodes` has no corresponding `dist/nodes/<node-name>/index.html`
- **THEN** the build/check exits non-zero with a message identifying the missing file, instead of completing silently

#### Scenario: The resources directory is missing or excluded from packaging
- **WHEN** the build or packaging check runs and `resources/` (or a file referenced from it by a node's HTML) is absent, or is not covered by `package.json`'s `files` allowlist
- **THEN** the build/check exits non-zero with a message identifying the missing coverage, instead of completing silently

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
