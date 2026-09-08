## Context

Node-RED resolves a module's `resources/` folder relative to the **installed package root** (`module.dir` in `@node-red/registry/lib/localfilesystem.js`), never relative to `dist/`. This repo already keeps `resources/` at the package root (`resources/s2-common.js`, `resources/s2-styles.css`), which is the right location — the bug is purely that `package.json`'s `files` allowlist (`["dist/", "README.md", "LICENSE", "CHANGELOG.md"]`) never includes it, so `npm pack`/`npm publish` strips the directory. See proposal.md - Why.

Separately, `copy-html` is one long chained shell command in `package.json` (`mkdir -p ... && cp ... && cp ... && cp ...`), hand-maintained per node/icon. It has no failure signal if a `cp` source is missing (a typo'd path just no-ops silently under some shells, or the whole chain aborts with a cryptic error), and every new node requires manually extending the chain in four places (mkdir, html copy, icon mkdir, icon copy) — easy to forget one, which is effectively what happened here.

## Goals / Non-Goals

**Goals:**
- Make the shipped npm tarball actually contain `resources/` and every node's `index.html`/icons.
- Replace the hand-extended shell one-liner with something that fails loudly (non-zero exit, clear message) when a source file is missing, so a future new node can't silently ship broken.
- Add an automated check (run in `npm test`, so CI catches it) that verifies packaging completeness without requiring a real `npm publish`.

**Non-Goals:**
- No change to where `resources/` lives (package root is correct and required by Node-RED — not moving it under `dist/`).
- No change to node runtime behavior, node registration, or the `node-red.nodes` map.
- Not building a general-purpose asset bundler — the node count is small (4) and static.

## Decisions

**1. Fix the actual bug with `package.json.files`, not `copy-html`.**
Add `"resources/"` to the `files` array. This is the minimal, correct fix per the design constraint above (resources must live at package root). `copy-html` copying resources into `dist/resources` would *not* fix the bug — Node-RED wouldn't look there — so that approach is explicitly rejected.

**2. Replace the `copy-html` one-liner with a small Node script (`scripts/copy-html.js`).**
Alternatives considered:
- *Keep shell one-liner, just add the missing `cp`*: fixes today's instance but leaves the same footgun for the next node — rejected, doesn't address why this happened.
- *Switch to a generic file-copy npm package (e.g. `cpy-cli`, `copyfiles`)*: adds a dependency for something a ~20-line script does, and doesn't get us the "fail if a node's HTML is missing" check for free — rejected.
- *Node script driven by `package.json`'s own `node-red.nodes` map* (chosen): iterates the node names already declared in `node-red.nodes`, copies each `src/nodes/<name>/index.html` → `dist/nodes/<name>/`, copies icons, and throws (non-zero exit) if a source file doesn't exist. Cross-platform (no reliance on Unix `cp`/`mkdir -p`), and adding a node to `node-red.nodes` is now the only place a maintainer needs to touch — the script picks it up automatically.

**3. Add a packaging-completeness check, run as part of `npm test`.**
A small script/test (`test/packaging.test.ts` or `scripts/check-package-files.js`, wired into the existing `test` script) that:
- Runs (or assumes) a build, then greps each shipped node's `dist/nodes/<name>/index.html` for `resources/...` and `src=/href=` references.
- Confirms every referenced path resolves under a directory covered by `package.json`'s `files` allowlist (using `npm pack --dry-run --json` to get the real file list npm would publish, rather than reimplementing glob-matching against `files`).
- Fails with a clear message naming the missing file if anything doesn't resolve.

Using `npm pack --dry-run --json` (built into npm, no new dependency) is preferred over hand-parsing the `files` glob patterns, since npm's own inclusion logic is the actual source of truth.

## Risks / Trade-offs

- [Risk] The packaging check running `npm pack --dry-run` in CI is slightly slower than a pure unit test → Mitigation: it's a single subprocess call, negligible in this small package; run it once as part of the existing `test` script rather than per-test.
- [Risk] `scripts/copy-html.js` duplicates node names already listed in `package.json.node-red.nodes` → Mitigation: that's intentional (decision 2) — reading them from `package.json` instead of hardcoding is exactly what removes the manual-sync footgun.
- [Trade-off] This does not add an integration test that actually launches Node-RED and loads the editor (closer to the real bug symptom) — that would need a heavier test harness (headless browser + real Node-RED instance). The packaging-completeness check catches the same class of bug at much lower cost; a full editor-load test is out of scope for this fix.
