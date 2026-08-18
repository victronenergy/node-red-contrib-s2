#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));

function requireFile(filePath, description) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`copy-html: missing ${description}: ${path.relative(root, filePath)}`);
  }
  return filePath;
}

function copyFile(src, dest, description) {
  requireFile(src, description);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

const nodeEntries = Object.entries(pkg['node-red'].nodes || {});
if (nodeEntries.length === 0) {
  throw new Error('copy-html: package.json has no node-red.nodes entries');
}

for (const [typeName, nodeMainPath] of nodeEntries) {
  const nodeName = path.basename(path.dirname(nodeMainPath));

  const srcHtml = path.join(root, 'src', 'nodes', nodeName, 'index.html');
  const destHtml = path.join(root, 'dist', 'nodes', nodeName, 'index.html');
  copyFile(srcHtml, destHtml, `HTML file for node "${typeName}"`);

  const htmlContent = fs.readFileSync(srcHtml, 'utf8');
  const iconMatch = htmlContent.match(/icon:\s*'([^']+)'/);
  if (iconMatch) {
    const iconName = iconMatch[1];
    const srcIcon = path.join(root, 'icons', iconName);
    const destIcon = path.join(root, 'dist', 'nodes', nodeName, 'icons', iconName);
    copyFile(srcIcon, destIcon, `icon "${iconName}" for node "${typeName}"`);
  }
}

console.log(`copy-html: copied HTML/icons for ${nodeEntries.length} node(s)`);
