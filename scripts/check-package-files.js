#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));

function getPublishedFiles() {
  const output = execFileSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: root,
    encoding: 'utf8',
  });
  const [result] = JSON.parse(output);
  return new Set(result.files.map((f) => f.path));
}

function resourceRefsInHtml(htmlContent) {
  const refs = [];
  const re = /(?:src|href)\s*=\s*"resources\/([^"]+)"/g;
  let match;
  while ((match = re.exec(htmlContent)) !== null) {
    // The URL is resources/<module-name>/<file>; Node-RED serves it from
    // the package's resources/<file> (module-name segment is stripped).
    const afterModule = match[1].split('/').slice(1).join('/');
    refs.push(`resources/${afterModule}`);
  }
  return refs;
}

const publishedFiles = getPublishedFiles();
const errors = [];

for (const [typeName, nodeMainPath] of Object.entries(pkg['node-red'].nodes || {})) {
  const nodeName = path.basename(path.dirname(nodeMainPath));
  const distHtmlRelPath = path.posix.join('dist', 'nodes', nodeName, 'index.html');

  if (!publishedFiles.has(distHtmlRelPath)) {
    errors.push(`node "${typeName}": ${distHtmlRelPath} is not in the published package (run "npm run build" first?)`);
    continue;
  }

  const htmlContent = fs.readFileSync(path.join(root, distHtmlRelPath), 'utf8');
  for (const resourceRef of resourceRefsInHtml(htmlContent)) {
    if (!publishedFiles.has(resourceRef)) {
      errors.push(`node "${typeName}": ${distHtmlRelPath} references "${resourceRef}", which is not in the published package`);
    }
  }
}

if (errors.length > 0) {
  console.error('check-package-files: the published npm package is missing required editor assets:\n');
  for (const error of errors) {
    console.error(`  - ${error}`);
  }
  console.error('\nAdd the missing path(s) to the "files" array in package.json.');
  process.exit(1);
}

console.log('check-package-files: all node HTML files and referenced resources are covered by "files" in package.json');
