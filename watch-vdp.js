#!/usr/bin/env node
// watch-vdp.js — Watches inventory.json and auto-regenerates VDP pages on change
// Usage: node watch-vdp.js

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const inventoryFile = path.join(__dirname, 'inventory.json');
const generatorFile = path.join(__dirname, 'generate-vdp.js');

function runGenerator() {
  try {
    console.log('\n[watch-vdp] inventory.json changed — regenerating VDP pages...');
    execSync(`"${process.execPath}" "${generatorFile}"`, { stdio: 'inherit' });
    console.log('[watch-vdp] Done. Watching for changes...\n');
  } catch (e) {
    console.error('[watch-vdp] Error running generate-vdp.js:', e.message);
  }
}

console.log('[watch-vdp] Watching inventory.json for changes...');
console.log('[watch-vdp] Press Ctrl+C to stop.\n');

let debounceTimer = null;
fs.watch(inventoryFile, () => {
  // Debounce: wait 300ms after last change before running
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(runGenerator, 300);
});
