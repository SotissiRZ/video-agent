/**
 * Storyboard contract shared by the agent (Node) and the Remotion compositions (browser).
 *
 * This file MUST stay browser-safe: no Node.js imports. It is the single source of
 * truth for what a rendered video looks like; everything the agent decides ends up here.
 */
import { z } from 'zod';

export const SCENE_KINDS = ['title', 'text', 'bullets', 'stat', 'image', 'quote', 'steps', 'cta'] as const;
export const SceneKindSchema = z.enum(SCENE_KINDS);
export type SceneKind = z.infer<typeof SceneKindSchema>;

export const TRANSITION_TYPES = ['none', 'fade', 'slide', 'wipe', 'flip'] as const;
export const TransitionTypeSchema = z.enum(TRANSITION_TYPES);
export type TransitionType = z.infer<typeof TransitionTypeSchema>;

export const ENTRANCES = ['rise', 'pop', 'slide', 'blur', 'typewriter'] as const;
export const EntranceSchema = z.enum(ENTRANCES);
export type Entrance = z.infer<typeof EntranceSchema>;

export const DirectionSchema = z.enum(['from-left', 'from-right', 'from-top', 'from-bottom']);

export const TransitionSchema = z.object({
  type: TransitionTypeSchema.default('fade'),
  durationInFrames: z.number().int().min(0).default(15),
  direction: DirectionSchema.default('from-right'),
});
export type Transition = z.infer<typeof TransitionSchema>;

export const MediaSchema = z.object({
  type: z.enum(['image', 'video']),
  /** Path relative to the job public dir (resolved with staticFile) or an absolute http(s) URL. */
  src: z.string().min(1),
  fit: z.enum(['cover', 'contain']).default('cover'),
  /** Where the asset comes from, for traceability: asset library, AI provider, ... */
  origin: z.string().default('asset'),
  /** Known clip length (videos only). When set, the clip loops to fill the scene. */
  durationInFrames: z.number().int().positive().optional(),
  /** Attribution for stock media (photographer / videographer and source page). */
  credit: z.object({ author: z.string(), source: z.string(), url: z.string().optional() }).optional(),
});
export type Media = z.infer<typeof MediaSchema>;

export const BackgroundSchema = z.object({
  variant: z.enum(['gradient', 'shapes', 'grid', 'waves', 'spotlight', 'media']).default('gradient'),
  /** Optional palette override for this scene. */
  from: z.string().optional(),
  to: z.string().optional(),
});
export type Background = z.infer<typeof BackgroundSchema>;

export const AnimationSchema = z.object({
  entrance: EntranceSchema.default('rise'),
  /** Delay between successive elements (words, bullets) in frames. */
  stagger: z.number().int().min(0).default(4),
  /** Slow zoom applied to backgrounds / media (Ken Burns). 0 = none. */
  kenBurns: z.number().min(0).max(0.5).default(0.06),
});
export type Animation = z.infer<typeof AnimationSchema>;

export const AudioClipSchema = z.object({
  src: z.string().min(1),
  durationInFrames: z.number().int().positive(),
  volume: z.number().min(0).max(1).default(1),
});
export type AudioClip = z.infer<typeof AudioClipSchema>;

export const SceneSchema = z.object({
  id: z.string().min(1),
  kind: SceneKindSchema,
  /** Narrative role from the template blueprint (hook, problem, solution, cta, ...). */
  role: z.string().min(1),
  durationInFrames: z.number().int().positive(),
  headline: z.string().default(''),
  subheadline: z.string().default(''),
  body: z.string().default(''),
  items: z.array(z.string()).default([]),
  stat: z.object({ value: z.string(), label: z.string() }).optional(),
  /** Text spoken by the voice-over (and used for subtitles). */
  narration: z.string().default(''),
  media: MediaSchema.optional(),
  /** Further shots shown after `media`, sharing the scene time (cross-fades). */
  shots: z.array(MediaSchema).max(4).optional(),
  background: BackgroundSchema.default({}),
  layout: z.enum(['center', 'left']).default('center'),
  animation: AnimationSchema.default({}),
  /** Transition played between this scene and the next one (ignored on the last scene). */
  transitionOut: TransitionSchema.default({}),
  voiceover: AudioClipSchema.optional(),
});
export type Scene = z.infer<typeof SceneSchema>;
export type SceneInput = z.input<typeof SceneSchema>;

export const PaletteSchema = z.object({
  background: z.string(),
  backgroundAlt: z.string(),
  surface: z.string(),
  primary: z.string(),
  secondary: z.string(),
  accent: z.string(),
  text: z.string(),
  mutedText: z.string(),
  onPrimary: z.string(),
});
export type Palette = z.infer<typeof PaletteSchema>;

export const ThemeSchema = z.object({
  id: z.string(),
  palette: PaletteSchema,
  headingFont: z.string(),
  bodyFont: z.string(),
  headingWeight: z.number().int().min(100).max(900).default(800),
  radius: z.number().min(0).default(24),
  motion: z.enum(['calm', 'normal', 'energetic']).default('normal'),
  uppercaseHeadlines: z.boolean().default(false),
});
export type Theme = z.infer<typeof ThemeSchema>;

export const SubtitleCueSchema = z.object({
  startFrame: z.number().int().min(0),
  endFrame: z.number().int().positive(),
  text: z.string().min(1),
});
export type SubtitleCue = z.infer<typeof SubtitleCueSchema>;

export const SubtitlesSchema = z.object({
  enabled: z.boolean().default(true),
  style: z.enum(['boxed', 'outline', 'karaoke']).default('boxed'),
  cues: z.array(SubtitleCueSchema).default([]),
});
export type Subtitles = z.infer<typeof SubtitlesSchema>;

export const StoryboardSchema = z.object({
  version: z.literal(1).default(1),
  meta: z.object({
    title: z.string().min(1),
    language: z.string().default('fr'),
    template: z.string(),
    style: z.string(),
    prompt: z.string().default(''),
    generator: z.string().default('video-agent'),
  }),
  format: z.object({
    width: z.number().int().min(16).max(7680),
    height: z.number().int().min(16).max(7680),
    fps: z.number().int().min(1).max(120),
    /** Total duration after transition overlaps. Must equal computeTotalDuration(scenes). */
    durationInFrames: z.number().int().positive(),
  }),
  theme: ThemeSchema,
  brand: z
    .object({
      name: z.string().default(''),
      tagline: z.string().default(''),
      logo: z.string().optional(),
      showWatermark: z.boolean().default(true),
      /** Small badge in the top-right corner (plan watermark, e.g. "Made with Video Agent"). */
      badge: z.string().max(60).optional(),
    })
    .default({}),
  scenes: z.array(SceneSchema).min(1),
  subtitles: SubtitlesSchema.default({}),
  audio: z
    .object({
      music: z
        .object({
          src: z.string().min(1),
          volume: z.number().min(0).max(1).default(0.35),
          /** Volume while the voice-over speaks. */
          duckedVolume: z.number().min(0).max(1).default(0.12),
        })
        .optional(),
    })
    .default({}),
});
export type Storyboard = z.infer<typeof StoryboardSchema>;
export type StoryboardInput = z.input<typeof StoryboardSchema>;

/** Props given to the Remotion composition. */
export const CompositionPropsSchema = z.object({ storyboard: StoryboardSchema });
export type CompositionProps = z.infer<typeof CompositionPropsSchema>;

export const COMPOSITION_ID = 'VideoAgent';
