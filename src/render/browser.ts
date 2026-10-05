/**
 * Headless browser resolution for rendering.
 * Order: explicit setting > Playwright's Chromium headless shell (if installed) > Remotion's own
 * download (performed automatically by Remotion on first render; needs internet access once).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const playwrightRoots = (): string[] => {
  const roots: string[] = [];
  if (process.env.PLAYWRIGHT_BROWSERS_PATH && process.env.PLAYWRIGHT_BROWSERS_PATH !== '0') roots.push(process.env.PLAYWRIGHT_BROWSERS_PATH);
  const home = os.homedir();
  if (process.platform === 'darwin') roots.push(path.join(home, 'Library', 'Caches', 'ms-playwright'));
  else if (process.platform === 'win32') roots.push(path.join(process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local'), 'ms-playwright'));
  else roots.push(path.join(home, '.cache', 'ms-playwright'));
  return roots;
};

const HEADLESS_SHELL_PATHS = [
  ['chrome-linux', 'headless_shell'],
  ['chrome-headless-shell-linux64', 'chrome-headless-shell'],
  ['chrome-mac', 'headless_shell'],
  ['chrome-headless-shell-mac-arm64', 'chrome-headless-shell'],
  ['chrome-headless-shell-mac-x64', 'chrome-headless-shell'],
  ['chrome-win', 'headless_shell.exe'],
  ['chrome-headless-shell-win64', 'chrome-headless-shell.exe'],
];

export const findPlaywrightHeadlessShell = (): string | undefined => {
  for (const root of playwrightRoots()) {
    if (!fs.existsSync(root)) continue;
    const dirs = fs
      .readdirSync(root)
      .filter((d) => d.startsWith('chromium_headless_shell-'))
      .sort()
      .reverse();
    for (const dir of dirs) {
      for (const parts of HEADLESS_SHELL_PATHS) {
        const candidate = path.join(root, dir, ...parts);
        if (fs.existsSync(candidate)) return candidate;
      }
    }
  }
  return undefined;
};

export interface BrowserResolution {
  executable: string | null;
  source: 'config' | 'playwright' | 'remotion';
}

export const resolveBrowser = (configured?: string): BrowserResolution => {
  if (configured) {
    if (!fs.existsSync(configured)) throw new Error(`Browser executable not found: ${configured} (VIDEO_AGENT_BROWSER_EXECUTABLE)`);
    return { executable: configured, source: 'config' };
  }
  const playwright = findPlaywrightHeadlessShell();
  if (playwright) return { executable: playwright, source: 'playwright' };
  return { executable: null, source: 'remotion' };
};
