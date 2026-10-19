#!/usr/bin/env node
'use strict';

// npm runs prepack both when this repository is packed and when an already packaged copy is
// packed again - a Venus recipe runs `npm pack` on the extracted registry tarball, without
// devDependencies, so building there would fail (tsc: not found). Only a source checkout has
// src/; a packaged copy ships the built dist/ instead.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));

if (fs.existsSync(path.join(root, 'src'))) {
  try {
    // Build output to stderr: `npm pack --json` (used by check-package-files) owns stdout.
    execFileSync('npm', ['run', 'build'], { cwd: root, stdio: ['ignore', 2, 2] });
  } catch (err) {
    console.error('prepack: build failed - refusing to pack a package without a fresh dist/ (are devDependencies installed?)');
    process.exit(1);
  }
} else if (!fs.existsSync(path.join(root, pkg.main))) {
  console.error(`prepack: no src/ to build from and ${pkg.main} is missing - refusing to pack a package without dist/`);
  process.exit(1);
}
