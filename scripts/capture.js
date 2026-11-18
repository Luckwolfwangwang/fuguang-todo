'use strict';

/**
 * Starts the real Electron app in capture mode, seeds demo data in a throwaway
 * data folder and writes docs/preview-*.png. Run with `npm run capture`.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, '.capture-data');
const electronPath = require('electron');

fs.rmSync(DATA_DIR, { recursive: true, force: true });
fs.mkdirSync(DATA_DIR, { recursive: true });

const env = {
  ...process.env,
  FUGUANG_TODO_CAPTURE: '1',
  FUGUANG_TODO_TEST: '1',
  FUGUANG_TODO_DATA_DIR: DATA_DIR,
};
// The harness may run with ELECTRON_RUN_AS_NODE=1; Electron would then behave
// like plain Node and `require('electron')` would be undefined in the app.
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, ['.', '--capture'], {
  cwd: ROOT,
  env,
  stdio: 'inherit',
  windowsHide: false,
});

child.on('error', (error) => {
  console.error('could not start Electron:', error.message);
  process.exit(1);
});

child.on('exit', (code) => {
  process.exit(code == null ? 0 : code);
});
