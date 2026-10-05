/** Builds publishers from the configuration and reports what is missing. */
import type { AppConfig } from '../config/config';
import { ConfigError } from '../core/errors';
import { FacebookPublisher, InstagramPublisher } from './platforms/meta';
import { defaultLinkedInVersion, LinkedInPublisher } from './platforms/linkedin';
import { TikTokPublisher } from './platforms/tiktok';
import { YouTubePublisher } from './platforms/youtube';
import { TokenStore } from './tokens';
import { PLATFORM_IDS, type PlatformId, type Publisher } from './types';

export interface PlatformStatus {
  id: PlatformId;
  label: string;
  configured: boolean;
  missing: string[];
  notes: string[];
}

const LABELS: Record<PlatformId, string> = { tiktok: 'TikTok', instagram: 'Instagram', facebook: 'Facebook', youtube: 'YouTube', linkedin: 'LinkedIn' };

export const platformStatus = (config: AppConfig): PlatformStatus[] => {
  const e = config.env;
  const req = (vars: Record<string, unknown>) => Object.entries(vars).filter(([, v]) => !v).map(([k]) => k);
  return PLATFORM_IDS.map((id) => {
    let missing: string[] = [];
    const notes: string[] = [];
    switch (id) {
      case 'youtube':
        missing = req({ YOUTUBE_CLIENT_ID: e.YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET: e.YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN: e.YOUTUBE_REFRESH_TOKEN });
        notes.push(`confidentialité : ${e.YOUTUBE_PRIVACY}`);
        break;
      case 'tiktok':
        missing = req({ TIKTOK_CLIENT_KEY: e.TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET: e.TIKTOK_CLIENT_SECRET, 'TIKTOK_REFRESH_TOKEN (ou TIKTOK_ACCESS_TOKEN)': e.TIKTOK_REFRESH_TOKEN || e.TIKTOK_ACCESS_TOKEN });
        notes.push(e.TIKTOK_MODE === 'draft' ? 'mode brouillon (à finaliser dans l’app TikTok)' : `publication directe (${e.TIKTOK_PRIVACY})`);
        break;
      case 'facebook':
        missing = req({ FACEBOOK_PAGE_ID: e.FACEBOOK_PAGE_ID, FACEBOOK_PAGE_ACCESS_TOKEN: e.FACEBOOK_PAGE_ACCESS_TOKEN });
        break;
      case 'instagram':
        missing = req({ INSTAGRAM_USER_ID: e.INSTAGRAM_USER_ID, 'INSTAGRAM_ACCESS_TOKEN (ou FACEBOOK_PAGE_ACCESS_TOKEN)': e.INSTAGRAM_ACCESS_TOKEN || e.FACEBOOK_PAGE_ACCESS_TOKEN });
        break;
      case 'linkedin':
        missing = req({ 'LINKEDIN_ACCESS_TOKEN (ou LINKEDIN_REFRESH_TOKEN)': e.LINKEDIN_ACCESS_TOKEN || e.LINKEDIN_REFRESH_TOKEN, LINKEDIN_AUTHOR_URN: e.LINKEDIN_AUTHOR_URN });
        notes.push(`version API ${e.LINKEDIN_API_VERSION ?? defaultLinkedInVersion()}`);
        break;
    }
    return { id, label: LABELS[id], configured: missing.length === 0, missing, notes };
  });
};

export const createPublisher = (config: AppConfig, id: PlatformId, store: TokenStore = TokenStore.default()): Publisher => {
  const status = platformStatus(config).find((s) => s.id === id)!;
  if (!status.configured) {
    throw new ConfigError(`${status.label} n'est pas configuré (manque : ${status.missing.join(', ')})`, `Lancez "video-agent auth ${id === 'facebook' || id === 'instagram' ? 'meta' : id}" puis complétez .env.`);
  }
  const e = config.env;
  switch (id) {
    case 'youtube':
      return new YouTubePublisher({ clientId: e.YOUTUBE_CLIENT_ID!, clientSecret: e.YOUTUBE_CLIENT_SECRET!, refreshToken: e.YOUTUBE_REFRESH_TOKEN!, privacy: e.YOUTUBE_PRIVACY, categoryId: e.YOUTUBE_CATEGORY_ID, store });
    case 'tiktok':
      return new TikTokPublisher({ clientKey: e.TIKTOK_CLIENT_KEY!, clientSecret: e.TIKTOK_CLIENT_SECRET!, refreshToken: e.TIKTOK_REFRESH_TOKEN, accessToken: e.TIKTOK_ACCESS_TOKEN, mode: e.TIKTOK_MODE, privacy: e.TIKTOK_PRIVACY, store });
    case 'facebook':
      return new FacebookPublisher({ graphVersion: e.META_GRAPH_VERSION, pageId: e.FACEBOOK_PAGE_ID!, pageToken: e.FACEBOOK_PAGE_ACCESS_TOKEN! });
    case 'instagram':
      return new InstagramPublisher({ graphVersion: e.META_GRAPH_VERSION, instagramUserId: e.INSTAGRAM_USER_ID!, instagramToken: (e.INSTAGRAM_ACCESS_TOKEN ?? e.FACEBOOK_PAGE_ACCESS_TOKEN)! });
    case 'linkedin':
      return new LinkedInPublisher({
        accessToken: e.LINKEDIN_ACCESS_TOKEN,
        refreshToken: e.LINKEDIN_REFRESH_TOKEN,
        clientId: e.LINKEDIN_CLIENT_ID,
        clientSecret: e.LINKEDIN_CLIENT_SECRET,
        authorUrn: e.LINKEDIN_AUTHOR_URN!,
        version: e.LINKEDIN_API_VERSION ?? defaultLinkedInVersion(),
        visibility: e.LINKEDIN_VISIBILITY,
        store,
      });
  }
};
