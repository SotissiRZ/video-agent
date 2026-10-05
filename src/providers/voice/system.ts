/**
 * Offline voice using the operating system's speech engine:
 * macOS `say`, Linux `espeak-ng`/`espeak`, Windows System.Speech (PowerShell).
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { ProviderError } from '../../core/errors';
import { wavDurationSec } from '../../audio/wav';
import type { VoiceProvider, VoiceRequest, VoiceResult } from './types';

const hasCommand = (cmd: string): boolean => {
  const probe = process.platform === 'win32' ? spawnSync('where', [cmd]) : spawnSync('sh', ['-c', `command -v ${cmd}`]);
  return probe.status === 0;
};

const run = (cmd: string, args: string[], input?: string, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['pipe', 'ignore', 'pipe'], signal });
    let stderr = '';
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited with ${code}: ${stderr.slice(0, 300)}`))));
    child.stdin.end(input ?? '');
  });

export type SystemEngine = 'say' | 'espeak-ng' | 'espeak' | 'sapi';

export const detectSystemEngine = (): SystemEngine | undefined => {
  if (process.platform === 'darwin' && hasCommand('say')) return 'say';
  if (process.platform === 'win32' && hasCommand('powershell')) return 'sapi';
  if (hasCommand('espeak-ng')) return 'espeak-ng';
  if (hasCommand('espeak')) return 'espeak';
  return undefined;
};

export class SystemVoiceProvider implements VoiceProvider {
  readonly id = 'system';
  constructor(
    private readonly engine: SystemEngine,
    private readonly voice?: string,
  ) {}

  async synthesize(req: VoiceRequest): Promise<VoiceResult> {
    const text = req.text.replace(/\*/g, '');
    try {
      switch (this.engine) {
        case 'say':
          await run('say', [...(this.voice ? ['-v', this.voice] : []), '-o', req.outFile, '--data-format=LEI16@22050', text], undefined, req.signal);
          break;
        case 'espeak-ng':
        case 'espeak':
          await run(this.engine, ['-v', this.voice ?? req.language, '-s', '160', '-w', req.outFile, text], undefined, req.signal);
          break;
        case 'sapi': {
          const script =
            "Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; " +
            (this.voice ? `$s.SelectVoice('${this.voice.replace(/'/g, "''")}'); ` : '') +
            `$s.SetOutputToWaveFile('${req.outFile.replace(/'/g, "''")}'); $s.Speak([Console]::In.ReadToEnd()); $s.Dispose()`;
          await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], text, req.signal);
          break;
        }
      }
    } catch (err) {
      throw new ProviderError(this.id, `speech synthesis failed: ${(err as Error).message}`, 'Install espeak-ng (Linux) or choose another voice provider.', { cause: err });
    }
    return { file: req.outFile, durationSec: wavDurationSec(fs.readFileSync(req.outFile)) };
  }
}
