/** Domain types shared across the agent pipeline. */
import type { OutputFormat } from './formats';
import type { SceneKind } from '../remotion/contract/storyboard';

/** Options a user can force (CLI flags, web form). Anything unset is inferred from the prompt. */
export interface VideoOptions {
  format?: string;
  width?: number;
  height?: number;
  durationSec?: number;
  fps?: number;
  style?: string;
  template?: string;
  language?: string;
  outputFormat?: OutputFormat;
  voice?: boolean;
  music?: boolean;
  subtitles?: boolean;
  /** Generate images with the configured image provider when no asset matches. */
  generateImages?: boolean;
  /** Generate clips with the configured video provider. */
  generateVideo?: boolean;
  /** Search stock photo/video libraries (Pexels, Pixabay, Unsplash). Default true. */
  stock?: boolean;
  /** Which scenes get a photo/clip: all, visual scenes only, none. */
  mediaCoverage?: 'all' | 'visual' | 'none';
  llmProvider?: string;
  /** Stop after the storyboard / project files are written. */
  skipRender?: boolean;
  /** Output directory for this job (default: <output>/<timestamp>-<slug>). */
  outDir?: string;
  /** Use only the deterministic planner (no LLM call). */
  offline?: boolean;
  /** Upper bound for the duration (plan limit), applied after prompt parsing. */
  maxDurationSec?: number;
  /** Small badge shown in a corner of the video (e.g. free plan: "Made with Video Agent"). */
  badge?: string;
  /** Brand kit: name used when the prompt names no brand, colours (#RRGGBB), logo file (absolute path). */
  brandName?: string;
  brandColors?: string[];
  brandLogo?: string;
}

export interface VideoRequest {
  prompt: string;
  options?: VideoOptions;
}

/** Result of the deterministic prompt analysis. */
export interface ParsedPrompt {
  raw: string;
  language: 'fr' | 'en';
  /** Language explicitly asked for in the prompt ("en wolof"), a code of core/languages. */
  locale?: string;
  durationSec?: number;
  format?: { id: string; width: number; height: number };
  fps?: number;
  brand?: string;
  audience?: string;
  location?: string;
  /** Location with its preposition, e.g. "au Burkina Faso", "in Nigeria". */
  locationPhrase?: string;
  /** Main subject, e.g. "Sirago" or "notre nouvelle application de livraison". */
  topic: string;
  styleHints: string[];
  platform?: string;
  wantsVoice?: boolean;
  wantsMusic?: boolean;
  wantsSubtitles?: boolean;
  keywords: string[];
}

/** Fully resolved brief: the parsed prompt merged with options and configuration defaults. */
export interface VideoBrief {
  prompt: string;
  /** Base language: offline copywriting, captions. */
  language: 'fr' | 'en';
  /** Language of the on-screen text, narration and voice (fr, en, ar, wo, sw...). */
  locale: string;
  durationSec: number;
  fps: number;
  width: number;
  height: number;
  formatId: string;
  outputFormat: OutputFormat;
  templateId: string;
  styleId: string;
  brand: string;
  audience: string;
  location: string;
  locationPhrase: string;
  topic: string;
  keywords: string[];
  voice: boolean;
  music: boolean;
  subtitles: boolean;
  /** Corner badge (plan watermark). */
  badge?: string;
  parsed: ParsedPrompt;
}

export interface VideoConcept {
  title: string;
  idea: string;
  angle: string;
  tone: string;
  keyMessage: string;
  callToAction: string;
  tagline: string;
}

export interface PlannedScene {
  role: string;
  kind: SceneKind;
  headline: string;
  subheadline: string;
  body: string;
  items: string[];
  statValue: string;
  statLabel: string;
  narration: string;
  /** Keywords used to find matching assets. */
  visualKeywords: string[];
  /** Prompt for an image/video generation provider. */
  visualPrompt: string;
  /** Relative weight used to split the total duration. */
  weight: number;
}

export interface VideoPlan {
  concept: VideoConcept;
  scenes: PlannedScene[];
  /** Which planner produced the plan ("procedural", "anthropic:claude-...", ...). */
  source: string;
}

export const PIPELINE_STEPS = [
  { id: 'analyze', label: 'Analyse de la demande' },
  { id: 'concept', label: 'Concept de la vidéo' },
  { id: 'script', label: 'Script' },
  { id: 'storyboard', label: 'Storyboard' },
  { id: 'scenes', label: 'Choix des scènes' },
  { id: 'assets', label: 'Sélection des assets' },
  { id: 'animations', label: 'Animations' },
  { id: 'subtitles', label: 'Textes et sous-titres' },
  { id: 'audio', label: 'Voix-off et musique' },
  { id: 'project', label: 'Projet Remotion' },
  { id: 'render', label: 'Rendu' },
  { id: 'output', label: 'Fichier final' },
] as const;

export type StepId = (typeof PIPELINE_STEPS)[number]['id'];

export interface ProgressEvent {
  step: StepId;
  stepIndex: number;
  totalSteps: number;
  status: 'started' | 'progress' | 'completed' | 'skipped' | 'failed';
  message: string;
  /** 0..1 progress within the step (render). */
  progress?: number;
  /** 0..1 overall progress. */
  overall: number;
}

export type ProgressListener = (event: ProgressEvent) => void;
