import type { ProgressEvent } from '../core/types';

const ICONS: Record<ProgressEvent['status'], string> = { started: '…', progress: '…', completed: '✔', skipped: '–', failed: '✖' };

/** Terminal progress reporter (stderr). Rewrites the current line on TTYs. */
export const createProgressPrinter = (stream: NodeJS.WriteStream = process.stderr) => {
  const tty = Boolean(stream.isTTY);
  let lastLineWasProgress = false;
  return (e: ProgressEvent) => {
    const head = `[${String(e.stepIndex + 1).padStart(2)}/${e.totalSteps}] ${String(Math.round(e.overall * 100)).padStart(3)}%`;
    const line = `${head} ${ICONS[e.status]} ${e.message}`;
    if (e.status === 'progress') {
      if (!tty) return;
      stream.write(`\r\x1b[2K${line}`);
      lastLineWasProgress = true;
      return;
    }
    if (e.status === 'started') {
      if (tty) {
        stream.write(`\r\x1b[2K${line}`);
        lastLineWasProgress = true;
      }
      return;
    }
    stream.write(`${tty && lastLineWasProgress ? '\r\x1b[2K' : ''}${line}\n`);
    lastLineWasProgress = false;
  };
};
