/**
 * Piper: free, offline neural text-to-speech (https://github.com/rhasspy/piper).
 * Natural French and English voices, very fast on CPU. The binary and voices are
 * pre-installed in the Docker image, or downloaded once into PIPER_DATA_DIR.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ProviderError } from '../../core/errors';
import { wavDurationSec } from '../../audio/wav';
import { httpBuffer } from '../http';
import type { VoiceProvider, VoiceRequest, VoiceResult } from './types';

const PIPER_RELEASE = 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2';
const VOICES_BASE = 'https://huggingface.co/rhasspy/piper-voices/resolve/main';

export const piperArchiveName = (platform = process.platform, arch = process.arch): string | undefined => {
  if (platform === 'win32' && arch === 'x64') return 'piper_windows_amd64.zip';
  if (platform === 'darwin') return arch === 'arm64' ? 'piper_macos_aarch64.tar.gz' : 'piper_macos_x64.tar.gz';
  if (platform === 'linux') return arch === 'arm64' ? 'piper_linux_aarch64.tar.gz' : arch === 'arm' ? 'piper_linux_armv7l.tar.gz' : arch === 'x64' ? 'piper_linux_x86_64.tar.gz' : undefined;
  return undefined;
};

/** "fr_FR-siwis-medium" → URL of the .onnx model on the official voices repository. */
export const piperVoiceUrl = (voice: string, base = VOICES_BASE): string => {
  const m = /^([a-z]{2,3})_([A-Z]{2})-([\w]+)-(x_low|low|medium|high)$/.exec(voice);
  if (!m) throw new ProviderError('piper', `invalid voice name "${voice}"`, 'Expected e.g. fr_FR-siwis-medium (see https://rhasspy.github.io/piper-samples/).');
  const [, lang, region, name, quality] = m;
  return `${base}/${lang}/${lang}_${region}/${name}/${quality}/${voice}.onnx`;
};

export interface PiperOptions {
  dataDir: string;
  binary?: string;
  voices: { fr: string; en: string };
  lengthScale: number;
  autoDownload: boolean;
}

const binaryName = process.platform === 'win32' ? 'piper.exe' : 'piper';

const onPath = (): string | undefined => {
  const probe = process.platform === 'win32' ? spawnSync('where', ['piper']) : spawnSync('sh', ['-c', 'command -v piper']);
  const out = probe.status === 0 ? probe.stdout.toString().split(/\r?\n/)[0]?.trim() : undefined;
  return out || undefined;
};

/** Locate an installed Piper binary (configured path, data dir, PATH). */
export const findPiperBinary = (dataDir: string, configured?: string): string | undefined => {
  if (configured) return fs.existsSync(configured) ? configured : undefined;
  const local = path.join(dataDir, 'piper', binaryName);
  if (fs.existsSync(local)) return local;
  return onPath();
};

export class PiperVoiceProvider implements VoiceProvider {
  readonly id = 'piper';
  private installing: Promise<string> | null = null;

  constructor(private readonly o: PiperOptions) {}

  private async binary(signal?: AbortSignal): Promise<string> {
    const found = findPiperBinary(this.o.dataDir, this.o.binary);
    if (found) return found;
    if (!this.o.autoDownload) throw new ProviderError(this.id, 'Piper is not installed', 'Set PIPER_AUTO_DOWNLOAD=true or PIPER_BINARY.');
    this.installing ??= (async () => {
      const archive = piperArchiveName();
      if (!archive) throw new ProviderError(this.id, `no Piper build for ${process.platform}/${process.arch}`);
      fs.mkdirSync(this.o.dataDir, { recursive: true });
      const file = path.join(this.o.dataDir, archive);
      fs.writeFileSync(file, await httpBuffer(`${PIPER_RELEASE}/${archive}`, { provider: this.id, timeoutMs: 300_000, signal }));
      // "tar" also extracts .zip on Windows 10+.
      const res = spawnSync('tar', ['-xf', file, '-C', this.o.dataDir]);
      fs.rmSync(file, { force: true });
      if (res.status !== 0) throw new ProviderError(this.id, `could not extract ${archive}: ${res.stderr?.toString().slice(0, 200)}`);
      const bin = path.join(this.o.dataDir, 'piper', binaryName);
      if (!fs.existsSync(bin)) throw new ProviderError(this.id, 'Piper binary missing after extraction');
      if (process.platform !== 'win32') fs.chmodSync(bin, 0o755);
      return bin;
    })().catch((err) => {
      this.installing = null;
      throw err;
    });
    return this.installing;
  }

  private async voiceModel(language: string, signal?: AbortSignal): Promise<string> {
    const voice = language === 'fr' ? this.o.voices.fr : this.o.voices.en;
    if (voice.endsWith('.onnx')) {
      if (!fs.existsSync(voice)) throw new ProviderError(this.id, `voice model not found: ${voice}`);
      return voice;
    }
    const dir = path.join(this.o.dataDir, 'voices');
    const model = path.join(dir, `${voice}.onnx`);
    if (fs.existsSync(model) && fs.existsSync(`${model}.json`)) return model;
    if (!this.o.autoDownload) throw new ProviderError(this.id, `voice ${voice} is not installed in ${dir}`);
    fs.mkdirSync(dir, { recursive: true });
    const url = piperVoiceUrl(voice);
    fs.writeFileSync(`${model}.json`, await httpBuffer(`${url}.json`, { provider: this.id, timeoutMs: 60_000, signal }));
    fs.writeFileSync(model, await httpBuffer(url, { provider: this.id, timeoutMs: 600_000, signal }));
    return model;
  }

  async synthesize(req: VoiceRequest): Promise<VoiceResult> {
    const [bin, model] = await Promise.all([this.binary(req.signal), this.voiceModel(req.language, req.signal)]);
    const text = req.text.replace(/\*/g, '').replace(/\s+/g, ' ').trim();
    await new Promise<void>((resolve, reject) => {
      const child = spawn(bin, ['--model', model, '--output_file', req.outFile, '--length_scale', String(this.o.lengthScale), '--sentence_silence', '0.15'], {
        stdio: ['pipe', 'ignore', 'pipe'],
        signal: req.signal,
        // The release bundles its own shared libraries next to the binary.
        env: { ...process.env, LD_LIBRARY_PATH: [path.dirname(bin), process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') },
      });
      let stderr = '';
      child.stderr.on('data', (d) => (stderr += d));
      child.on('error', (err) => reject(new ProviderError(this.id, `cannot start Piper: ${err.message}`, undefined, { cause: err })));
      child.on('close', (code) => (code === 0 ? resolve() : reject(new ProviderError(this.id, `Piper exited with ${code}: ${stderr.slice(-300)}`))));
      child.stdin.end(text);
    });
    return { file: req.outFile, durationSec: wavDurationSec(fs.readFileSync(req.outFile)) };
  }
}
