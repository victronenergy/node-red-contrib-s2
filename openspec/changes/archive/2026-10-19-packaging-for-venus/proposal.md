## Why

The package is going into the Venus OS image, and two packaging problems showed up when simulating a Venus recipe (`npm-online-install`: `npm pack` of the source, then `npm install --omit=dev --omit=optional`):

- **Packing from source gives an empty package.** The TypeScript build only runs in `prepublishOnly`, so `npm pack` of a git checkout or GitHub tag tarball produces a package without `dist/`. That's no `main` and no node files, and nothing fails.
- **A production install pulls in a second Node-RED.** `peerDependencies: { "node-red": ">=4.1.0" }` is installed by npm 7+ unless peers are omitted (the palette manager passes `--omit=peer`; a plain install and the Venus recipe don't). That's 124 MB of `node_modules`, a full Node-RED, inside the package.

## What Changes

- Add a `prepack` script (`scripts/prepack.js`) that builds when packing a source checkout (`src/` present), so `npm pack` and `npm publish` always pack a fresh `dist/`. Without devDependencies, that fails loudly instead of producing an empty package. When repacking an already-built package (no `src/`, e.g. the extracted registry tarball the Venus recipe runs `npm pack` on), it doesn't build, which would fail without TypeScript, but checks that `dist/` is there. A plain `"prepack": "npm run build"` broke exactly that recipe flow (`tsc: not found`).
- Remove `peerDependencies`. Node-RED's own `node-red.version` field (`>=4.1.0`, unchanged) is what the palette manager uses for compatibility.
- The Venus recipe uses the npm registry tarball (`https://registry.npmjs.org/node-red-contrib-s2/-/node-red-contrib-s2-${PV}.tgz`), which is the same build palette users get. That's recorded here for the recipe; it isn't a change in this repo.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `packaging`: packing always includes a fresh build or fails; a production install doesn't install Node-RED.

## Impact

- `package.json` (`scripts.prepack`, `peerDependencies` removed), `package-lock.json`, `scripts/prepack.js` (new).
- No runtime change. Palette installs are unaffected (the palette manager already omits peers).
- CHANGELOG.
