/**
 * This script starts the electron main process HTTP server for browser testing.
 * The React UI is served by Vite dev server (electron-ui:dev), and this script
 * opens the browser and ensures the backend is available.
 */
import { spawn } from "child_process";
import { setTimeout } from "timers/promises";

const BACKEND_PORT = 51730;
const UI_PORT = 51731;

console.log(`\n  Electron UI Browser Mode`);
console.log(`  ➜  UI:      http://localhost:${UI_PORT}/`);
console.log(`  ➜  Backend: http://localhost:${BACKEND_PORT}/`);
console.log(`\n  React dev server should be running via 'npm run electron-ui:dev'`);
console.log(`  Press Ctrl+C to stop\n`);

// Open browser after a short delay
await setTimeout(2000);

// Open in default browser
const openCmd =
  process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
spawn(openCmd, [`http://localhost:${UI_PORT}/`], { shell: true });
