/**
 * Real rendering test: bundles the Remotion compositions and renders a short video.
 * Needs a headless browser (auto-detected, or VIDEO_AGENT_BROWSER_EXECUTABLE, or Remotion's download).
 * Run with: npm run test:render
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { StoryboardSchema } from '../src/remotion/contract/storyboard';
import { getStyle } from '../src/remotion/contract/styles';
import { computeTotalDuration } from '../src/remotion/contract/timeline';
import { renderStoryboard } from '../src/render/renderer';
import { tmpDir } from './helpers';

describe('Remotion rendering', () => {
  it('renders an MP4 and a poster from a storyboard', async () => {
    const scenes = StoryboardSchema.shape.scenes.parse([
      { id: 'a', kind: 'title', role: 'hook', durationInFrames: 20, headline: 'Bonjour *Remotion*', subheadline: 'Test', transitionOut: { type: 'fade', durationInFrames: 6 } },
      { id: 'b', kind: 'bullets', role: 'benefits', durationInFrames: 20, headline: 'Liste', items: ['Un', 'Deux'] },
      { id: 'c', kind: 'cta', role: 'cta', durationInFrames: 20, headline: 'Fin', subheadline: 'Go', transitionOut: { type: 'none' } },
    ]);
    const storyboard = StoryboardSchema.parse({
      meta: { title: 'render test', template: 'advertisement', style: 'modern' },
      format: { width: 320, height: 180, fps: 20, durationInFrames: computeTotalDuration(scenes) },
      theme: getStyle('modern').theme,
      brand: { name: 'Test' },
      scenes,
      subtitles: { cues: [{ startFrame: 0, endFrame: 20, text: 'Sous-titre' }] },
    });
    const dir = tmpDir('video-agent-render-');
    fs.mkdirSync(path.join(dir, 'public'));
    const result = await renderStoryboard({
      storyboard,
      publicDir: path.join(dir, 'public'),
      outputFile: path.join(dir, 'video.mp4'),
      posterFile: path.join(dir, 'poster.jpg'),
      outputFormat: 'mp4',
      browserExecutable: process.env.VIDEO_AGENT_BROWSER_EXECUTABLE,
    });
    expect(result.durationSec).toBeCloseTo(computeTotalDuration(scenes) / 20, 5);
    const video = fs.readFileSync(result.file);
    expect(video.length).toBeGreaterThan(1000);
    expect(video.toString('ascii', 4, 8)).toBe('ftyp');
    expect(fs.statSync(result.posterFile!).size).toBeGreaterThan(1000);
  }, 300_000);
});
