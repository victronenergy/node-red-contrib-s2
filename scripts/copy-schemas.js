#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')

// Only the generated, self-contained validators file (plus its tiny vendored runtime helpers)
// ships to dist/ - the raw vendored JSON schemas under src/lib/s2/s2-json-schema/ are a
// build-time source for scripts/generate-schema-validators.js, not something the runtime needs
// (its content is already inlined into the generated file). Keeping the raw schemas, and the full
// `ajv`/`ajv-formats` packages, out of dist/ matters on the disk-constrained device this package
// ships to - see src/lib/s2/schema-validation.ts's own header comment.
const files = [
  ['lib/s2/schema-validators.generated.js', 'lib/s2/schema-validators.generated.js']
]

for (const [src, dest] of files) {
  const srcPath = path.join(root, 'src', src)
  const destPath = path.join(root, 'dist', dest)
  if (!fs.existsSync(srcPath)) {
    throw new Error(`copy-schemas: missing ${path.relative(root, srcPath)} - run "npm run generate-schema-validators" first`)
  }
  fs.mkdirSync(path.dirname(destPath), { recursive: true })
  fs.copyFileSync(srcPath, destPath)
}

const runtimeSrcDir = path.join(root, 'src', 'lib', 's2', 'ajv-runtime')
const runtimeDestDir = path.join(root, 'dist', 'lib', 's2', 'ajv-runtime')
let runtimeFileCount = 0
if (fs.existsSync(runtimeSrcDir)) {
  fs.mkdirSync(runtimeDestDir, { recursive: true })
  for (const name of fs.readdirSync(runtimeSrcDir)) {
    fs.copyFileSync(path.join(runtimeSrcDir, name), path.join(runtimeDestDir, name))
    runtimeFileCount++
  }
}

console.log(`copy-schemas: copied ${files.length} file(s) and ${runtimeFileCount} vendored runtime helper(s) into dist/`)
