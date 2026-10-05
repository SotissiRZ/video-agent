import type { SceneKind } from '../remotion/contract/storyboard';
import type { VideoConcept } from '../core/types';

/** One slot in a template's narrative structure. */
export interface SceneBlueprint {
  /** Narrative role, e.g. "hook", "problem", "benefits", "cta". */
  role: string;
  kind: SceneKind;
  /** Relative share of the total duration. */
  weight: number;
  /** Optional scenes are dropped first when the video is short. */
  optional?: boolean;
  /** Repeatable scenes are duplicated to fill long videos (features, steps...). */
  repeatable?: boolean;
  /** What this scene must achieve — given to the LLM as guidance. */
  purpose: string;
}

/** Inputs for deterministic (offline) copywriting. */
export interface CopyContext {
  lang: 'fr' | 'en';
  brand: string;
  /** Brand, or the topic when there is no brand. Never empty. */
  subject: string;
  audience: string;
  location: string;
  locationPhrase: string;
  topic: string;
}

export interface SceneCopy {
  headline: string;
  subheadline?: string;
  body?: string;
  items?: string[];
  stat?: { value: string; label: string };
  narration: string;
  visualKeywords?: string[];
}

export interface TemplateDefinition {
  id: string;
  name: string;
  description: string;
  /** Normalised (lower-case, no accents) words or phrases that point to this template. */
  keywords: string[];
  /** Words that state the intent of the video ("raconte", "tutoriel"...): they outweigh context words like platform names. */
  strongKeywords?: string[];
  defaultStyle: string;
  /** Format used when the prompt does not specify one. */
  defaultFormat?: string;
  defaultDurationSec: number;
  scenes: SceneBlueprint[];
  /** Extra creative direction for the LLM. */
  guidance: string;
  /** Offline concept. */
  concept(ctx: CopyContext): VideoConcept;
  /** Offline copy for each role; arrays are used for repeated scenes. */
  copy(ctx: CopyContext): Record<string, SceneCopy[]>;
}
