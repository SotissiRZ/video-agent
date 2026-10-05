/**
 * LinkedIn Videos API + Posts API (versioned REST API).
 * Auth: OAuth access token with w_member_social (personal profile) or w_organization_social
 * (company page). Author URN: urn:li:person:<id> or urn:li:organization:<id>.
 */
import fs from 'node:fs';
import { ProviderError } from '../../core/errors';
import { PLATFORM_CONSTRAINTS } from '../constraints';
import { formBody, jsonBody, poll, request, requestJson } from '../http';
import { isFresh, type TokenStore } from '../tokens';
import { composeText, type Publisher, type PublishRequest, type PublishResult } from '../types';

const REST = 'https://api.linkedin.com/rest';

/** LinkedIn API versions are YYYYMM and supported ~1 year: default to 2 months ago. */
export const defaultLinkedInVersion = (now = new Date()): string => {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1));
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

export interface LinkedInOptions {
  accessToken?: string;
  refreshToken?: string;
  clientId?: string;
  clientSecret?: string;
  authorUrn: string;
  version: string;
  visibility: 'PUBLIC' | 'CONNECTIONS';
  store: TokenStore;
}

/** LinkedIn escapes reserved characters in "little text" format. */
const escapeCommentary = (text: string) => text.replace(/[\\|{}@[\]()<>#*_~]/g, (c) => `\\${c}`);

export class LinkedInPublisher implements Publisher {
  readonly id = 'linkedin' as const;
  readonly label = 'LinkedIn';
  readonly constraints = PLATFORM_CONSTRAINTS.linkedin;
  constructor(private readonly o: LinkedInOptions) {}

  private async accessToken(signal?: AbortSignal): Promise<string> {
    const cached = this.o.store.get('linkedin');
    if (isFresh(cached)) return cached.accessToken;
    const refreshToken = cached?.refreshToken ?? this.o.refreshToken;
    if (refreshToken && this.o.clientId && this.o.clientSecret) {
      const t = await requestJson<{ access_token: string; expires_in: number; refresh_token?: string }>(this.id, 'https://www.linkedin.com/oauth/v2/accessToken', {
        ...formBody({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: this.o.clientId, client_secret: this.o.clientSecret }),
        signal,
      });
      this.o.store.set('linkedin', { accessToken: t.access_token, refreshToken: t.refresh_token ?? refreshToken, expiresAt: Date.now() + t.expires_in * 1000 });
      return t.access_token;
    }
    if (this.o.accessToken) return this.o.accessToken;
    throw new ProviderError(this.id, 'no LinkedIn token', 'Run "video-agent auth linkedin".');
  }

  private headers(token: string) {
    return { authorization: `Bearer ${token}`, 'linkedin-version': this.o.version, 'x-restli-protocol-version': '2.0.0' };
  }

  async publish(req: PublishRequest): Promise<PublishResult> {
    const token = await this.accessToken(req.signal);
    const size = fs.statSync(req.videoFile).size;
    req.onProgress?.('LinkedIn : initialisation de l’envoi');
    const initBody = { initializeUploadRequest: { owner: this.o.authorUrn, fileSizeBytes: size, uploadCaptions: false, uploadThumbnail: false } };
    const init = await requestJson<{ value: { video: string; uploadToken: string; uploadInstructions: Array<{ uploadUrl: string; firstByte: number; lastByte: number }> } }>(
      this.id,
      `${REST}/videos?action=initializeUpload`,
      { ...jsonBody(initBody), headers: { ...jsonBody(initBody).headers, ...this.headers(token) }, signal: req.signal },
    );

    req.onProgress?.('LinkedIn : envoi de la vidéo');
    const etags: string[] = [];
    const fd = fs.openSync(req.videoFile, 'r');
    try {
      for (const part of init.value.uploadInstructions) {
        const buf = Buffer.alloc(part.lastByte - part.firstByte + 1);
        fs.readSync(fd, buf, 0, buf.length, part.firstByte);
        const res = await request(this.id, part.uploadUrl, { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: buf, timeoutMs: 15 * 60_000, signal: req.signal });
        const etag = res.headers.get('etag');
        if (!etag) throw new ProviderError(this.id, 'missing ETag in upload response');
        etags.push(etag);
      }
    } finally {
      fs.closeSync(fd);
    }
    const finalizeBody = { finalizeUploadRequest: { video: init.value.video, uploadToken: init.value.uploadToken, uploadedPartIds: etags } };
    await request(this.id, `${REST}/videos?action=finalizeUpload`, { ...jsonBody(finalizeBody), headers: { ...jsonBody(finalizeBody).headers, ...this.headers(token) }, signal: req.signal });

    req.onProgress?.('LinkedIn : traitement');
    await poll(
      async () => {
        const v = await requestJson<{ status: string }>(this.id, `${REST}/videos/${encodeURIComponent(init.value.video)}`, { headers: this.headers(token), signal: req.signal });
        if (v.status === 'PROCESSING_FAILED') throw new ProviderError(this.id, 'video processing failed');
        return v.status === 'AVAILABLE' ? v : undefined;
      },
      { intervalMs: 5000, timeoutMs: 10 * 60_000, signal: req.signal, what: 'LinkedIn video processing', provider: this.id },
    );

    const post = {
      author: this.o.authorUrn,
      commentary: escapeCommentary(composeText(req.content, this.constraints.maxCaption)),
      visibility: this.o.visibility,
      distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
      content: { media: { title: req.content.title.slice(0, this.constraints.maxTitle), id: init.value.video } },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    };
    const res = await request(this.id, `${REST}/posts`, { ...jsonBody(post), headers: { ...jsonBody(post).headers, ...this.headers(token) }, signal: req.signal });
    const urn = res.headers.get('x-restli-id') ?? undefined;
    return { platform: this.id, status: 'published', id: urn, url: urn ? `https://www.linkedin.com/feed/update/${urn}` : undefined };
  }
}
