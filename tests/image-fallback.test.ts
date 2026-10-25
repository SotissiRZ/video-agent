import { describe, expect, it } from 'vitest';
import { FallbackImageProvider } from '../src/providers/image/registry';

describe('image services in auto mode', () => {
  it('moves to the next service when one fails, and skips it afterwards', async () => {
    const calls: string[] = [];
    const broken = { id: 'cloudflare', generate: async () => { calls.push('cloudflare'); throw new Error('HTTP 404 invalid account'); } };
    const working = { id: 'huggingface', generate: async ({ outFileBase }: { outFileBase: string }) => { calls.push('huggingface'); return { file: `${outFileBase}.png` }; } };
    const chain = new FallbackImageProvider([broken, working]);
    expect(chain.id).toBe('cloudflare');
    const request = { prompt: 'p', width: 1080, height: 1920, outFileBase: '/tmp/x' };
    expect(await chain.generate(request)).toEqual({ file: '/tmp/x.png' });
    expect(chain.id).toBe('huggingface');
    await chain.generate(request);
    expect(calls).toEqual(['cloudflare', 'huggingface', 'huggingface']);
    const dead = new FallbackImageProvider([broken, { ...broken, id: 'other' }]);
    await expect(dead.generate(request)).rejects.toThrow(/HTTP 404/);
  });
});
