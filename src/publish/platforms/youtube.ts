/**
 * YouTube Data API v3 — resumable upload (videos and Shorts).
 * Auth: OAuth 2.0 refresh token (scope youtube.upload), see "video-agent auth youtube".
 * Note: projects that have not passed Google's API audit can only upload private videos.
 */
import fs from 'node:fs';
import { ProviderError } from '../../core/errors';
import { PLATFORM_CONSTRAINTS } from '../constraints';
import { formBody, jsonBody, request, requestJson } from '../http';
import { isFresh, type TokenStore } from '../tokens';
import { composeText, type Publisher, type PublishRequest, type PublishResult } from '../types';

export interface YouTubeOptions {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  privacy: 'public' | 'unlisted' | 'private';
  categoryId: string;
  store: TokenStore;
}

export const refreshGoogleToken = async (o: { clientId: string; clientSecret: string; refreshToken: string }, signal?: AbortSignal) =>
  requestJson<{ access_token: string; expires_in: number }>('youtube', 'https://oauth2.googleapis.com/token', {
    ...formBody({ client_id: o.clientId, client_secret: o.clientSecret, refresh_token: o.refreshToken, grant_type: 'refresh_token' }),
    signal,
  });

export class YouTubePublisher implements Publisher {
  readonly id = 'youtube' as const;
  readonly label = 'YouTube';
  readonly constraints = PLATFORM_CONSTRAINTS.youtube;
  constructor(private readonly o: YouTubeOptions) {}

  private async accessToken(signal?: AbortSignal): Promise<string> {
    const cached = this.o.store.get('youtube');
    if (isFresh(cached)) return cached.accessToken;
    const t = await refreshGoogleToken(this.o, signal);
    this.o.store.set('youtube', { accessToken: t.access_token, expiresAt: Date.now() + t.expires_in * 1000 });
    return t.access_token;
  }

  async publish(req: PublishRequest): Promise<PublishResult> {
    const token = await this.accessToken(req.signal);
    const size = fs.statSync(req.videoFile).size;
    const tags = req.content.hashtags.map((h) => h.replace(/^#/, '')).slice(0, 15);
    const scheduled = req.scheduledAt && req.scheduledAt.getTime() > Date.now() + 60_000;
    const metadata = {
      snippet: {
        title: req.content.title.slice(0, this.constraints.maxTitle),
        description: composeText(req.content, this.constraints.maxCaption),
        tags,
        categoryId: this.o.categoryId,
        defaultLanguage: req.language,
        defaultAudioLanguage: req.language,
      },
      status: {
        // A scheduled video must be private until its publishAt date.
        privacyStatus: scheduled ? 'private' : this.o.privacy,
        ...(scheduled ? { publishAt: req.scheduledAt!.toISOString() } : {}),
        selfDeclaredMadeForKids: false,
        embeddable: true,
        // YouTube's disclosure for realistic altered or synthetic content: every video here is AI-made.
        containsSyntheticMedia: true,
      },
    };
    req.onProgress?.('YouTube : initialisation de l’envoi');
    const init = await request(this.id, 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
      ...jsonBody(metadata),
      headers: {
        ...jsonBody(metadata).headers,
        authorization: `Bearer ${token}`,
        'x-upload-content-length': String(size),
        'x-upload-content-type': 'video/mp4',
      },
      signal: req.signal,
    });
    const uploadUrl = init.headers.get('location');
    if (!uploadUrl) throw new ProviderError(this.id, 'no upload URL returned');
    req.onProgress?.('YouTube : envoi de la vidéo');
    const video = await requestJson<{ id: string; status?: { uploadStatus?: string } }>(this.id, uploadUrl, {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'video/mp4', 'content-length': String(size) },
      body: fs.readFileSync(req.videoFile),
      timeoutMs: 30 * 60_000,
      signal: req.signal,
    });
    if (req.posterFile && fs.existsSync(req.posterFile)) {
      // Custom thumbnails need a verified channel: best effort.
      await request(this.id, `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${video.id}`, {
        headers: { authorization: `Bearer ${token}`, 'content-type': 'image/jpeg' },
        body: fs.readFileSync(req.posterFile),
        signal: req.signal,
      }).catch(() => undefined);
    }
    const isShort = req.height > req.width && req.durationSec <= 180;
    return {
      platform: this.id,
      status: scheduled ? 'scheduled' : 'published',
      id: video.id,
      url: isShort ? `https://youtube.com/shorts/${video.id}` : `https://www.youtube.com/watch?v=${video.id}`,
      message: scheduled ? `programmée le ${req.scheduledAt!.toISOString()}` : `confidentialité : ${metadata.status.privacyStatus}`,
    };
  }
}
