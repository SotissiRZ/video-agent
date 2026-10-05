/**
 * Meta Graph API: Facebook Page videos/Reels and Instagram Reels.
 * Auth: a long-lived Page access token (see "video-agent auth meta").
 * Permissions: pages_manage_posts, pages_read_engagement, pages_show_list,
 * instagram_basic, instagram_content_publish (Instagram account must be professional and linked to the Page).
 */
import fs from 'node:fs';
import { ProviderError } from '../../core/errors';
import { PLATFORM_CONSTRAINTS } from '../constraints';
import { poll, request, requestJson } from '../http';
import { composeText, type Publisher, type PublishRequest, type PublishResult } from '../types';

export interface MetaOptions {
  graphVersion: string;
  pageId?: string;
  pageToken?: string;
  instagramUserId?: string;
  instagramToken?: string;
}

const graph = (version: string) => `https://graph.facebook.com/${version}`;

const qs = (params: Record<string, string | number | boolean | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) p.set(k, String(v));
  return p.toString();
};

/** Upload the file bytes to a rupload.facebook.com URL (resumable upload protocol). */
const ruploadFile = async (provider: string, url: string, token: string, file: string, signal?: AbortSignal) => {
  const size = fs.statSync(file).size;
  await request(provider, url, {
    method: 'POST',
    headers: { authorization: `OAuth ${token}`, offset: '0', file_size: String(size), 'content-type': 'application/octet-stream' },
    body: fs.readFileSync(file),
    timeoutMs: 30 * 60_000,
    signal,
  });
};

export class FacebookPublisher implements Publisher {
  readonly id = 'facebook' as const;
  readonly label = 'Facebook';
  readonly constraints = PLATFORM_CONSTRAINTS.facebook;
  constructor(private readonly o: MetaOptions & { pageId: string; pageToken: string }) {}

  async publish(req: PublishRequest): Promise<PublishResult> {
    const base = graph(this.o.graphVersion);
    const token = this.o.pageToken;
    const description = composeText(req.content, this.constraints.maxCaption);
    const scheduled = req.scheduledAt && req.scheduledAt.getTime() > Date.now() + 10 * 60_000;
    const asReel = req.height > req.width && req.durationSec >= 3 && req.durationSec <= 90;

    if (asReel) {
      req.onProgress?.('Facebook : création du Reel');
      const start = await requestJson<{ video_id: string; upload_url: string }>(this.id, `${base}/${this.o.pageId}/video_reels?${qs({ upload_phase: 'start', access_token: token })}`, { method: 'POST', signal: req.signal });
      await ruploadFile(this.id, start.upload_url, token, req.videoFile, req.signal);
      await requestJson(this.id, `${base}/${this.o.pageId}/video_reels?${qs({
        upload_phase: 'finish',
        video_id: start.video_id,
        video_state: scheduled ? 'SCHEDULED' : 'PUBLISHED',
        scheduled_publish_time: scheduled ? Math.floor(req.scheduledAt!.getTime() / 1000) : undefined,
        description,
        title: req.content.title,
        access_token: token,
      })}`, { method: 'POST', signal: req.signal });
      return { platform: this.id, status: scheduled ? 'scheduled' : 'published', id: start.video_id, url: `https://www.facebook.com/reel/${start.video_id}` };
    }

    req.onProgress?.('Facebook : envoi de la vidéo');
    const form = new FormData();
    form.set('access_token', token);
    form.set('description', description);
    form.set('title', req.content.title.slice(0, this.constraints.maxTitle));
    if (scheduled) {
      form.set('published', 'false');
      form.set('scheduled_publish_time', String(Math.floor(req.scheduledAt!.getTime() / 1000)));
    }
    form.set('source', await fs.openAsBlob(req.videoFile, { type: 'video/mp4' }), 'video.mp4');
    const res = await requestJson<{ id: string }>(this.id, `https://graph-video.facebook.com/${this.o.graphVersion}/${this.o.pageId}/videos`, { method: 'POST', body: form, timeoutMs: 30 * 60_000, signal: req.signal });
    return { platform: this.id, status: scheduled ? 'scheduled' : 'published', id: res.id, url: `https://www.facebook.com/${this.o.pageId}/videos/${res.id}` };
  }
}

export class InstagramPublisher implements Publisher {
  readonly id = 'instagram' as const;
  readonly label = 'Instagram';
  readonly constraints = PLATFORM_CONSTRAINTS.instagram;
  constructor(private readonly o: MetaOptions & { instagramUserId: string; instagramToken: string }) {}

  async publish(req: PublishRequest): Promise<PublishResult> {
    const base = graph(this.o.graphVersion);
    const token = this.o.instagramToken;
    req.onProgress?.('Instagram : création du conteneur Reel');
    const container = await requestJson<{ id: string; uri: string }>(this.id, `${base}/${this.o.instagramUserId}/media?${qs({
      media_type: 'REELS',
      upload_type: 'resumable',
      caption: composeText(req.content, this.constraints.maxCaption),
      share_to_feed: true,
      access_token: token,
    })}`, { method: 'POST', signal: req.signal });
    if (!container.uri) throw new ProviderError(this.id, 'no upload URI returned for the Reel container');
    req.onProgress?.('Instagram : envoi de la vidéo');
    await ruploadFile(this.id, container.uri, token, req.videoFile, req.signal);

    req.onProgress?.('Instagram : traitement');
    await poll(
      async () => {
        const s = await requestJson<{ status_code: string; status?: string }>(this.id, `${base}/${container.id}?${qs({ fields: 'status_code,status', access_token: token })}`, { signal: req.signal });
        if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') throw new ProviderError(this.id, `processing failed: ${s.status ?? s.status_code}`);
        return s.status_code === 'FINISHED' ? s : undefined;
      },
      { intervalMs: 5000, timeoutMs: 15 * 60_000, signal: req.signal, what: 'Instagram processing', provider: this.id },
    );
    const published = await requestJson<{ id: string }>(this.id, `${base}/${this.o.instagramUserId}/media_publish?${qs({ creation_id: container.id, access_token: token })}`, { method: 'POST', signal: req.signal });
    const info = await requestJson<{ permalink?: string }>(this.id, `${base}/${published.id}?${qs({ fields: 'permalink', access_token: token })}`, { signal: req.signal }).catch(() => ({ permalink: undefined }));
    return { platform: this.id, status: 'published', id: published.id, url: info.permalink };
  }
}
