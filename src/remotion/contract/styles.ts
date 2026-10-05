/**
 * Visual styles: palette + typography + motion personality.
 * A style is resolved into a Theme that is embedded in the storyboard. Browser-safe.
 */
import type { Background, Entrance, Theme, TransitionType } from './storyboard';

export const HEADING_FONT = 'Montserrat';
export const BODY_FONT = 'Inter';
const FALLBACK = "'Segoe UI', 'Helvetica Neue', Arial, sans-serif";

export interface StyleDefinition {
  id: string;
  label: string;
  description: string;
  theme: Theme;
  backgrounds: Background['variant'][];
  entrances: Entrance[];
  transitions: TransitionType[];
  /** Default transition length in seconds. */
  transitionSeconds: number;
  subtitleStyle: 'boxed' | 'outline' | 'karaoke';
}

const theme = (id: string, partial: Omit<Theme, 'id' | 'headingFont' | 'bodyFont'> & Partial<Theme>): Theme => ({
  id,
  headingFont: `'${HEADING_FONT}', ${FALLBACK}`,
  bodyFont: `'${BODY_FONT}', ${FALLBACK}`,
  ...partial,
});

export const STYLES: Record<string, StyleDefinition> = {
  modern: {
    id: 'modern',
    label: 'Modern',
    description: 'Deep blue gradients, bold type and smooth motion. A safe default for most videos.',
    theme: theme('modern', {
      palette: {
        background: '#0B1026',
        backgroundAlt: '#1B2559',
        surface: 'rgba(255,255,255,0.08)',
        primary: '#4F7CFF',
        secondary: '#22D3EE',
        accent: '#FFC53D',
        text: '#FFFFFF',
        mutedText: 'rgba(255,255,255,0.72)',
        onPrimary: '#FFFFFF',
      },
      headingWeight: 800,
      radius: 28,
      motion: 'normal',
      uppercaseHeadlines: false,
    }),
    backgrounds: ['gradient', 'shapes', 'spotlight'],
    entrances: ['rise', 'blur', 'pop'],
    transitions: ['fade', 'slide', 'wipe'],
    transitionSeconds: 0.5,
    subtitleStyle: 'boxed',
  },
  vibrant: {
    id: 'vibrant',
    label: 'Vibrant',
    description: 'Saturated warm colours, punchy pops and fast cuts. Great for social media and ads.',
    theme: theme('vibrant', {
      palette: {
        background: '#FF4D2E',
        backgroundAlt: '#FF9F1C',
        surface: 'rgba(0,0,0,0.18)',
        primary: '#1A1A2E',
        secondary: '#FFD23F',
        accent: '#FFE066',
        text: '#FFFFFF',
        mutedText: 'rgba(255,255,255,0.85)',
        onPrimary: '#FFFFFF',
      },
      headingWeight: 900,
      radius: 20,
      motion: 'energetic',
      uppercaseHeadlines: true,
    }),
    backgrounds: ['shapes', 'gradient', 'waves'],
    entrances: ['pop', 'slide', 'rise'],
    transitions: ['slide', 'wipe', 'flip'],
    transitionSeconds: 0.35,
    subtitleStyle: 'karaoke',
  },
  minimal: {
    id: 'minimal',
    label: 'Minimal',
    description: 'Light background, generous whitespace, calm motion.',
    theme: theme('minimal', {
      palette: {
        background: '#F7F7F5',
        backgroundAlt: '#ECECE8',
        surface: '#FFFFFF',
        primary: '#111111',
        secondary: '#6B7280',
        accent: '#E11D48',
        text: '#111111',
        mutedText: '#4B5563',
        onPrimary: '#FFFFFF',
      },
      headingWeight: 700,
      radius: 12,
      motion: 'calm',
      uppercaseHeadlines: false,
    }),
    backgrounds: ['grid', 'gradient'],
    entrances: ['rise', 'typewriter', 'blur'],
    transitions: ['fade'],
    transitionSeconds: 0.6,
    subtitleStyle: 'outline',
  },
  corporate: {
    id: 'corporate',
    label: 'Corporate',
    description: 'Navy and teal, structured layouts, professional and reassuring.',
    theme: theme('corporate', {
      palette: {
        background: '#0F2741',
        backgroundAlt: '#163A5F',
        surface: 'rgba(255,255,255,0.07)',
        primary: '#14B8A6',
        secondary: '#60A5FA',
        accent: '#F59E0B',
        text: '#FFFFFF',
        mutedText: 'rgba(255,255,255,0.75)',
        onPrimary: '#06201C',
      },
      headingWeight: 700,
      radius: 14,
      motion: 'calm',
      uppercaseHeadlines: false,
    }),
    backgrounds: ['grid', 'gradient', 'spotlight'],
    entrances: ['rise', 'slide'],
    transitions: ['fade', 'slide'],
    transitionSeconds: 0.5,
    subtitleStyle: 'boxed',
  },
  elegant: {
    id: 'elegant',
    label: 'Elegant',
    description: 'Dark, gold accents, slow reveals. For premium brands and storytelling.',
    theme: theme('elegant', {
      palette: {
        background: '#0A0A0A',
        backgroundAlt: '#1C1917',
        surface: 'rgba(255,255,255,0.06)',
        primary: '#D4AF37',
        secondary: '#A8A29E',
        accent: '#F5E6B8',
        text: '#FAFAF9',
        mutedText: 'rgba(250,250,249,0.7)',
        onPrimary: '#0A0A0A',
      },
      headingWeight: 600,
      radius: 4,
      motion: 'calm',
      uppercaseHeadlines: true,
    }),
    backgrounds: ['spotlight', 'gradient'],
    entrances: ['blur', 'rise'],
    transitions: ['fade'],
    transitionSeconds: 0.8,
    subtitleStyle: 'outline',
  },
  playful: {
    id: 'playful',
    label: 'Playful',
    description: 'Candy colours, bouncy springs and rounded shapes.',
    theme: theme('playful', {
      palette: {
        background: '#7C3AED',
        backgroundAlt: '#EC4899',
        surface: 'rgba(255,255,255,0.16)',
        primary: '#FDE047',
        secondary: '#34D399',
        accent: '#FDE047',
        text: '#FFFFFF',
        mutedText: 'rgba(255,255,255,0.88)',
        onPrimary: '#3B0764',
      },
      headingWeight: 900,
      radius: 40,
      motion: 'energetic',
      uppercaseHeadlines: false,
    }),
    backgrounds: ['shapes', 'waves'],
    entrances: ['pop', 'rise'],
    transitions: ['slide', 'flip', 'wipe'],
    transitionSeconds: 0.4,
    subtitleStyle: 'karaoke',
  },
  tech: {
    id: 'tech',
    label: 'Tech',
    description: 'Near-black with neon green/cyan, grids and crisp motion. For apps and software.',
    theme: theme('tech', {
      palette: {
        background: '#05070D',
        backgroundAlt: '#0B1A24',
        surface: 'rgba(34,211,238,0.08)',
        primary: '#22D3EE',
        secondary: '#A3E635',
        accent: '#A3E635',
        text: '#E6F6FF',
        mutedText: 'rgba(230,246,255,0.7)',
        onPrimary: '#03131A',
      },
      headingWeight: 800,
      radius: 16,
      motion: 'normal',
      uppercaseHeadlines: false,
    }),
    backgrounds: ['grid', 'spotlight', 'gradient'],
    entrances: ['typewriter', 'slide', 'rise'],
    transitions: ['wipe', 'slide', 'fade'],
    transitionSeconds: 0.45,
    subtitleStyle: 'boxed',
  },
  warm: {
    id: 'warm',
    label: 'Warm',
    description: 'Earthy terracotta and sand tones, friendly and human.',
    theme: theme('warm', {
      palette: {
        background: '#7C2D12',
        backgroundAlt: '#C2410C',
        surface: 'rgba(255,247,237,0.12)',
        primary: '#FDBA74',
        secondary: '#FDE68A',
        accent: '#FDE68A',
        text: '#FFF7ED',
        mutedText: 'rgba(255,247,237,0.8)',
        onPrimary: '#431407',
      },
      headingWeight: 800,
      radius: 22,
      motion: 'normal',
      uppercaseHeadlines: false,
    }),
    backgrounds: ['waves', 'gradient', 'shapes'],
    entrances: ['rise', 'pop'],
    transitions: ['fade', 'slide'],
    transitionSeconds: 0.5,
    subtitleStyle: 'boxed',
  },
};

export const STYLE_IDS = Object.keys(STYLES);
export const DEFAULT_STYLE_ID = 'modern';

export const getStyle = (id: string | undefined): StyleDefinition => STYLES[id ?? ''] ?? STYLES[DEFAULT_STYLE_ID]!;
