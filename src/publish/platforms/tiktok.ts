/**
 * TikTok Content Posting API.
 * - mode "draft": the video lands in the creator's TikTok inbox to be finished in the app
 *   (scope video.upload, works for unaudited apps).
 * - mode "direct": published directly (scope video.publish). Until the app passes TikTok's
 *   audit, direct posts are forced to private (SELF_ONLY).
 */
import fs from 'node:fs';
import { ProviderError } from '../../core/errors';
import { PLATFORM_CONSTRAINTS } from '../constraints';
import { formBody, jsonBody, poll, request, requestJson } from '../http';
import { isFresh, type TokenStore } from '../tokens';
import { composeText, type Publisher, type PublishRequest, type PublishResult } from '../types';

const API = 'https://open.tiktokapis.com/v2';
const MAX_SINGLE_CHUNK = 64 * 1024 * 1024;
const CHUNK = 10 * 1024 * 1024;

export interface TikTokOptions {
  clientKey: string;
  clientSecret: string;
  refreshToken?: string;
  accessToken?: string;
  mode: 'draft' | 'direct';
  privacy: string;
  store: TokenStore;
}

interface TikTokEnvelope<T> {
  data: T;
  error: { code: string; message: string };
}

export const refreshTikTokToken = async (o: { clientKey: string; clientSecret: string; refreshToken: string }, signal?: AbortSignal) =>
  requestJson<{ access_token: string; refresh_token: string; expires_in: number; refresh_expires_in: number; open_id: string }>('tiktok', `${API}/oauth/token/`, {
    ...formBody({ client_key: o.clientKey, client_secret: o.clientSecret, grant_type: 'refresh_token', refresh_token: o.refreshToken }),
    signal,
  });

/** Chunking rules: one chunk up to 64 MB, otherwise 10 MB chunks with the remainder in the last one. */
export const tiktokChunks = (size: number): { chunkSize: number; count: number } => {
  if (size <= MAX_SINGLE_CHUNK) return { chunkSize: size, count: 1 };
  return { chunkSize: CHUNK, count: Math.floor(size / CHUNK) };
};

export class TikTokPublisher implements Publisher {
  readonly id = 'tiktok' as const;
  readonly label = 'TikTok';
  readonly constraints = PLATFORM_CONSTRAINTS.tiktok;
  constructor(private readonly o: TikTokOptions) {}

  private async accessToken(signal?: AbortSignal): Promise<string> {
    const cached = this.o.store.get('tiktok');
    if (isFresh(cached)) return cached.accessToken;
    const refreshToken = cached?.refreshToken ?? this.o.refreshToken;
    if (!refreshToken) {
      if (this.o.accessToken) return this.o.accessToken;
      throw new ProviderError(this.id, 'no TikTok token', 'Run "video-agent auth tiktok".');
    }
    const t = await refreshTikTokToken({ clientKey: this.o.clientKey, clientSecret: this.o.clientSecret, refreshToken }, signal);
    // TikTok rotates refresh tokens: keep the new one.
    this.o.store.set('tiktok', { accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt: Date.now() + t.expires_in * 1000 });
    return t.access_token;
  }

  private async api<T>(path: string, token: string, body: unknown, signal?: AbortSignal): Promise<T> {
    const res = await requestJson<TikTokEnvelope<T>>(this.id, `${API}${path}`, {
      ...jsonBody(body),
      headers: { ...jsonBody(body).headers, authorization: `Bearer ${token}` },
      signal,
    });
    if (res.error && res.error.code !== 'ok') throw new ProviderError(this.id, `${res.error.code}: ${res.error.message}`);
    return res.data;
  }

  async publish(req: PublishRequest): Promise<PublishResult> {
    const token = await this.accessToken(req.signal);
    const size = fs.statSync(req.videoFile).size;
    const { chunkSize, count } = tiktokChunks(size);
    const source_info = { source: 'FILE_UPLOAD', video_size: size, chunk_size: chunkSize, total_chunk_count: count };

    let init: { publish_id: string; upload_url: string };
    let note = '';
    if (this.o.mode === 'direct') {
      const creator = await this.api<{ privacy_level_options: string[]; creator_username?: string }>('/post/publish/creator_info/query/', token, {}, req.signal);
      let privacy = this.o.privacy;
      if (!creator.privacy_level_options.includes(privacy)) {
        note = `confidentialité ${privacy} non autorisée, ${creator.privacy_level_options[0]} utilisée`;
        privacy = creator.privacy_level_options[0] ?? 'SELF_ONLY';
      }
      init = await this.api('/post/publish/video/init/', token, {
        post_info: { title: composeText(req.content, this.constraints.maxCaption), privacy_level: privacy, disable_duet: false, disable_comment: false, disable_stitch: false, video_cover_timestamp_ms: 1000 },
        source_info,
      }, req.signal);
    } else {
      init = await this.api('/post/publish/inbox/video/init/', token, { source_info }, req.signal);
    }

    req.onProgress?.('TikTok : envoi de la vidéo');
    const fd = fs.openSync(req.videoFile, 'r');
    try {
      for (let i = 0; i < count; i++) {
        const start = i * chunkSize;
        const end = i === count - 1 ? size - 1 : start + chunkSize - 1;
        const buf = Buffer.alloc(end - start + 1);
        fs.readSync(fd, buf, 0, buf.length, start);
        await request(this.id, init.upload_url, {
          method: 'PUT',
          headers: { 'content-type': 'video/mp4', 'content-length': String(buf.length), 'content-range': `bytes ${start}-${end}/${size}` },
          body: buf,
          timeoutMs: 15 * 60_000,
          signal: req.signal,
        });
      }
    } finally {
      fs.closeSync(fd);
    }

    req.onProgress?.('TikTok : traitement');
    const final = await poll(
      async () => {
        const s = await this.api<{ status: string; fail_reason?: string; publicaly_available_post_id?: Array<string | number> }>('/post/publish/status/fetch/', token, { publish_id: init.publish_id }, req.signal);
        if (s.status === 'FAILED') throw new ProviderError(this.id, `publication failed: ${s.fail_reason ?? 'unknown'}`);
        return ['PUBLISH_COMPLETE', 'SEND_TO_USER_INBOX'].includes(s.status) ? s : undefined;
      },
      { intervalMs: 5000, timeoutMs: 10 * 60_000, signal: req.signal, what: 'TikTok processing', provider: this.id },
    );
    const postId = final.publicaly_available_post_id?.[0];
    if (final.status === 'SEND_TO_USER_INBOX') {
      return { platform: this.id, status: 'draft', id: init.publish_id, message: 'brouillon envoyé dans la boîte de réception TikTok : ouvrez l’app pour publier' };
    }
    return { platform: this.id, status: 'published', id: String(postId ?? init.publish_id), url: postId ? `https://www.tiktok.com/video/${postId}` : undefined, message: note || undefined };
  }
}
