/** Minimal 16-bit PCM WAV encoding/decoding (no native dependency). */

export const encodeWav = (samples: Float32Array | number[], sampleRate: number, channels = 1): Buffer => {
  const n = samples.length;
  const buffer = Buffer.alloc(44 + n * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + n * 2, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * 2, 28);
  buffer.writeUInt16LE(channels * 2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    buffer.writeInt16LE(Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), 44 + i * 2);
  }
  return buffer;
};

/** Wrap raw little-endian 16-bit PCM (e.g. ElevenLabs pcm_22050) into a WAV container. */
export const pcm16ToWav = (pcm: Buffer, sampleRate: number, channels = 1): Buffer => {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
};

/** Duration in seconds of a PCM WAV file (walks the RIFF chunks). */
export const wavDurationSec = (buffer: Buffer): number => {
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('not a WAV file');
  }
  let offset = 12;
  let byteRate = 0;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    let size = buffer.readUInt32LE(offset + 4);
    if (id === 'fmt ') byteRate = buffer.readUInt32LE(offset + 16);
    if (id === 'data') {
      // Streaming encoders sometimes write 0 or 0xFFFFFFFF as data size.
      if (size === 0 || size === 0xffffffff || offset + 8 + size > buffer.length) size = buffer.length - offset - 8;
      if (!byteRate) throw new Error('WAV without fmt chunk');
      return size / byteRate;
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error('WAV without data chunk');
};
