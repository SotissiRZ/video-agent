/** Audio conversion with the ffmpeg shipped by Remotion (or FFMPEG_PATH / the system one). */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);

export const findFfmpeg = (): string => {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const arch = `${process.platform}-${process.arch}`;
  for (const pkg of [`@remotion/compositor-${arch}-gnu`, `@remotion/compositor-${arch}-musl`, `@remotion/compositor-${arch}-msvc`, `@remotion/compositor-${arch}`]) {
    try {
      const bin = path.join(path.dirname(require.resolve(`${pkg}/package.json`)), exe);
      if (fs.existsSync(bin)) return bin;
    } catch {
      /* not installed for this platform */
    }
  }
  return 'ffmpeg';
};

/** Any audio (flac, mp3, ogg...) to 16-bit PCM mono WAV. */
export const toWav = (audio: Buffer, signal?: AbortSignal): Promise<Buffer> => {
  if (audio.subarray(0, 4).toString('latin1') === 'RIFF') return Promise.resolve(audio);
  const bin = findFfmpeg();
  return new Promise((resolve, reject) => {
    const child = spawn(bin, ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-ac', '1', '-ar', '22050', '-c:a', 'pcm_s16le', '-f', 'wav', 'pipe:1'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      signal,
      env: { ...process.env, LD_LIBRARY_PATH: [path.dirname(bin), process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') },
    });
    const out: Buffer[] = [];
    let err = '';
    child.stdout.on('data', (d: Buffer) => out.push(d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(fixWavSizes(Buffer.concat(out))) : reject(new Error(`ffmpeg exited with ${code}: ${err.slice(0, 300)}`))));
    child.stdin.on('error', () => undefined);
    child.stdin.end(audio);
  });
};

/** ffmpeg cannot seek a pipe: it leaves the RIFF/data sizes unset. */
const fixWavSizes = (wav: Buffer): Buffer => {
  if (wav.length < 44) return wav;
  wav.writeUInt32LE(wav.length - 8, 4);
  let offset = 12;
  while (offset + 8 <= wav.length) {
    const id = wav.subarray(offset, offset + 4).toString('latin1');
    if (id === 'data') {
      wav.writeUInt32LE(wav.length - offset - 8, offset + 4);
      break;
    }
    offset += 8 + wav.readUInt32LE(offset + 4);
  }
  return wav;
};
