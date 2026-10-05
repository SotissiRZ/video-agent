/** Storyboard validation: schema, timing coherence, content per scene kind, assets. */
import fs from 'node:fs';
import path from 'node:path';
import { StoryboardSchema, type Storyboard } from '../remotion/contract/storyboard';
import { computeTotalDuration, transitionLength } from '../remotion/contract/timeline';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  storyboard?: Storyboard;
}

export interface ValidateOptions {
  /** When given, local media/audio paths are checked for existence. */
  publicDir?: string;
  /** H.264 / H.265 require even dimensions. */
  requireEvenDimensions?: boolean;
}

const isRemote = (src: string) => /^(https?:|data:)/i.test(src);

export const validateStoryboard = (input: unknown, options: ValidateOptions = {}): ValidationResult => {
  const parsed = StoryboardSchema.safeParse(input);
  if (!parsed.success) {
    return { valid: false, errors: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`), warnings: [] };
  }
  const sb = parsed.data;
  const errors: string[] = [];
  const warnings: string[] = [];
  const { fps, width, height } = sb.format;

  const total = computeTotalDuration(sb.scenes);
  if (sb.format.durationInFrames !== total) {
    errors.push(`format.durationInFrames is ${sb.format.durationInFrames} but scenes add up to ${total} frames`);
  }
  if (options.requireEvenDimensions !== false && (width % 2 || height % 2)) {
    errors.push(`dimensions ${width}x${height} must be even for H.264`);
  }

  const ids = new Set<string>();
  sb.scenes.forEach((scene, i) => {
    const where = `scene ${i + 1} (${scene.id})`;
    if (ids.has(scene.id)) errors.push(`${where}: duplicate id`);
    ids.add(scene.id);
    if (scene.durationInFrames < fps) warnings.push(`${where}: shorter than 1 second`);
    if (!scene.headline.trim() && scene.kind !== 'image') errors.push(`${where}: empty headline`);
    if ((scene.kind === 'bullets' || scene.kind === 'steps') && scene.items.length === 0) errors.push(`${where}: ${scene.kind} scene without items`);
    if (scene.kind === 'stat' && !scene.stat?.value) errors.push(`${where}: stat scene without value`);
    if (scene.items.length > 5) warnings.push(`${where}: only the first 5 items are displayed`);
    if (scene.headline.replace(/\*/g, '').length > 90) warnings.push(`${where}: headline is long (${scene.headline.length} chars)`);
    const t = scene.transitionOut;
    if (i < sb.scenes.length - 1 && t.type !== 'none' && transitionLength(sb.scenes, i) < t.durationInFrames) {
      warnings.push(`${where}: transition shortened to fit the scene`);
    }
    if (scene.voiceover && scene.voiceover.durationInFrames > scene.durationInFrames) {
      errors.push(`${where}: voice-over (${scene.voiceover.durationInFrames}f) longer than the scene (${scene.durationInFrames}f)`);
    }
  });

  let previousEnd = 0;
  sb.subtitles.cues.forEach((cue, i) => {
    if (cue.endFrame <= cue.startFrame) errors.push(`subtitle ${i + 1}: ends before it starts`);
    if (cue.startFrame < previousEnd) errors.push(`subtitle ${i + 1}: overlaps the previous cue`);
    if (cue.endFrame > sb.format.durationInFrames) errors.push(`subtitle ${i + 1}: ends after the video`);
    previousEnd = cue.endFrame;
  });

  if (options.publicDir) {
    const files = [
      ...sb.scenes.flatMap((s) => [s.media?.src, s.voiceover?.src]),
      sb.audio.music?.src,
      sb.brand.logo,
    ].filter((s): s is string => Boolean(s) && !isRemote(s!));
    for (const file of files) {
      if (!fs.existsSync(path.join(options.publicDir, file))) errors.push(`missing asset: ${file}`);
    }
  }

  return { valid: errors.length === 0, errors, warnings, storyboard: sb };
};
