#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const cli = new URL('../dist/cli.js', import.meta.url);
if (!existsSync(fileURLToPath(cli))) {
  console.error('Video Agent is not built yet. Run "npm run build" in the project folder (or use "npm run dev -- <prompt>").');
  process.exit(1);
}
await import(cli.href);
