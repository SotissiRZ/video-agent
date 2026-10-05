/** Social publishing: shared types. */

export const PLATFORM_IDS = ['tiktok', 'instagram', 'facebook', 'youtube', 'linkedin'] as const;
export type PlatformId = (typeof PLATFORM_IDS)[number];

export const isPlatformId = (v: string): v is PlatformId => (PLATFORM_IDS as readonly string[]).includes(v);

/** Text published with the video on one platform. */
export interface PostContent {
  /** Used by YouTube (title) and LinkedIn/Facebook (video title). */
  title: string;
  /** Caption / description, hashtags excluded. */
  caption: string;
  hashtags: string[];
}

export type Captions = Partial<Record<PlatformId, PostContent>>;

export interface PlatformConstraints {
  maxCaption: number;
  maxTitle?: number;
  maxHashtags: number;
  minDurationSec: number;
  maxDurationSec: number;
  /** Platform designed for vertical video (a warning is emitted otherwise). */
  vertical: boolean;
  /** Platform API supports scheduled publication. */
  nativeScheduling: boolean;
}

export interface PublishRequest {
  videoFile: string;
  posterFile?: string;
  content: PostContent;
  width: number;
  height: number;
  durationSec: number;
  language: string;
  /** Future publication date (only for platforms with native scheduling). */
  scheduledAt?: Date;
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
}

export interface PublishResult {
  platform: PlatformId;
  status: 'published' | 'scheduled' | 'draft' | 'processing';
  id?: string;
  url?: string;
  message?: string;
}

export interface Publisher {
  readonly id: PlatformId;
  readonly label: string;
  readonly constraints: PlatformConstraints;
  publish(request: PublishRequest): Promise<PublishResult>;
}

/** Final text for a platform: caption followed by hashtags, within the platform limit. */
export const composeText = (content: PostContent, maxChars: number): string => {
  const tags = content.hashtags.map((h) => (h.startsWith('#') ? h : `#${h}`)).join(' ');
  const full = tags ? `${content.caption.trim()}\n\n${tags}` : content.caption.trim();
  if (full.length <= maxChars) return full;
  const room = maxChars - (tags ? tags.length + 2 : 0) - 1;
  if (room > 20) return `${content.caption.trim().slice(0, room).trimEnd()}…${tags ? `\n\n${tags}` : ''}`;
  return full.slice(0, maxChars - 1).trimEnd() + '…';
};
