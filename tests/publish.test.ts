import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { VideoAgent } from '../src/agent/orchestrator';
import { createLogger } from '../src/core/logger';
import { runOAuthFlow, updateEnvFile } from '../src/publish/auth';
import { formatCredits, proceduralCaptions } from '../src/publish/captions';
import { checkVideoForPlatform } from '../src/publish/constraints';
import { FacebookPublisher, InstagramPublisher } from '../src/publish/platforms/meta';
import { defaultLinkedInVersion, LinkedInPublisher } from '../src/publish/platforms/linkedin';
import { TikTokPublisher, tiktokChunks } from '../src/publish/platforms/tiktok';
import { YouTubePublisher } from '../src/publish/platforms/youtube';
import { createPublisher, platformStatus } from '../src/publish/registry';
import { runDueEntries, ScheduleStore } from '../src/publish/scheduler';
import { ensureCaptions, publishJob } from '../src/publish/service';
import { TokenStore } from '../src/publish/tokens';
import { composeText, type PublishRequest, type Publisher } from '../src/publish/types';
import { json, mockFetch } from './fetch-mock';
import { fakeRenderer, testConfig, tmpDir } from './helpers';

let restore: (() => void) | undefined;
afterEach(() => restore?.());

const makeJob = async () => {
  const config = testConfig();
  const agent = new VideoAgent(config, { renderer: fakeRenderer, logger: createLogger('silent'), voice: null, llm: null, stock: [] });
  const result = await agent.run({ prompt: 'Crée une vidéo verticale de 20 secondes pour promouvoir Sirago auprès des chauffeurs au Burkina Faso.' });
  return { config, result };
};

const videoFile = () => {
  const dir = tmpDir();
  const file = path.join(dir, 'video.mp4');
  fs.writeFileSync(file, Buffer.alloc(2048, 1));
  return file;
};

const request = (over: Partial<PublishRequest> = {}): PublishRequest => ({
  videoFile: videoFile(),
  content: { title: 'Sirago', caption: 'Roulez avec Sirago', hashtags: ['#Sirago', '#BurkinaFaso'] },
  width: 1080,
  height: 1920,
  durationSec: 20,
  language: 'fr',
  ...over,
});

describe('captions', () => {
  it('builds platform-specific captions and hashtags', async () => {
    const { result } = await makeJob();
    const c = proceduralCaptions({ brief: result.brief, concept: result.concept, durationSec: 20, credits: [{ sceneId: 'a', provider: 'pexels', author: 'Awa', url: 'u' }], includeCredits: true });
    expect(c.youtube!.title).toMatch(/#Shorts$/);
    expect(c.youtube!.hashtags).toContain('#Shorts');
    expect(c.tiktok!.hashtags).toEqual(expect.arrayContaining(['#Sirago', '#BurkinaFaso', '#fyp']));
    expect(c.linkedin!.caption).toContain('Awa (pexels)');
    expect(c.tiktok!.caption).not.toContain('Awa');
    expect(c.instagram!.hashtags.length).toBeLessThanOrEqual(8);
    expect(formatCredits([], 'fr')).toBe('');
  });

  it('composes text within limits', () => {
    expect(composeText({ title: '', caption: 'Bonjour', hashtags: ['a', '#b'] }, 100)).toBe('Bonjour\n\n#a #b');
    const long = composeText({ title: '', caption: 'x'.repeat(500), hashtags: ['#tag'] }, 100);
    expect(long.length).toBeLessThanOrEqual(100);
    expect(long.endsWith('#tag')).toBe(true);
  });

  it('saves captions.json and keeps user edits', async () => {
    const { config, result } = await makeJob();
    const { loadJob } = await import('../src/publish/service');
    const job = loadJob(result.jobDir);
    const first = await ensureCaptions(config, job, ['tiktok'], { llm: null });
    const file = path.join(result.jobDir, 'captions.json');
    const edited = { ...first, tiktok: { ...first.tiktok!, caption: 'Mon texte' } };
    fs.writeFileSync(file, JSON.stringify(edited));
    const again = await ensureCaptions(config, job, ['tiktok', 'linkedin'], { llm: null });
    expect(again.tiktok!.caption).toBe('Mon texte');
    expect(again.linkedin).toBeDefined();
  });
});

describe('platform rules', () => {
  it('validates videos per platform', () => {
    const v = { width: 1920, height: 1080, durationSec: 30, sizeBytes: 1e6, container: 'mp4' };
    expect(checkVideoForPlatform('tiktok', v).warnings[0]).toMatch(/vertical/);
    expect(checkVideoForPlatform('youtube', v)).toEqual({ errors: [], warnings: [] });
    expect(checkVideoForPlatform('instagram', { ...v, container: 'gif' }).errors[0]).toMatch(/MP4/);
    expect(checkVideoForPlatform('linkedin', { ...v, durationSec: 2 }).errors[0]).toMatch(/shorter/);
  });

  it('chunks TikTok uploads', () => {
    expect(tiktokChunks(1000)).toEqual({ chunkSize: 1000, count: 1 });
    expect(tiktokChunks(100 * 1024 * 1024)).toEqual({ chunkSize: 10 * 1024 * 1024, count: 10 });
  });

  it('computes a recent LinkedIn API version', () => {
    expect(defaultLinkedInVersion(new Date(Date.UTC(2026, 9, 5)))).toBe('202608');
    expect(defaultLinkedInVersion(new Date(Date.UTC(2026, 0, 15)))).toBe('202511');
  });

  it('reports missing credentials per platform', () => {
    const none = platformStatus(testConfig());
    expect(none.every((p) => !p.configured)).toBe(true);
    const fb = platformStatus(testConfig({ FACEBOOK_PAGE_ID: '1', FACEBOOK_PAGE_ACCESS_TOKEN: 't' }));
    expect(fb.find((p) => p.id === 'facebook')!.configured).toBe(true);
    expect(fb.find((p) => p.id === 'instagram')!.missing).toEqual(['INSTAGRAM_USER_ID']);
    expect(() => createPublisher(testConfig(), 'youtube')).toThrow(/YOUTUBE_CLIENT_ID/);
  });
});

describe('publishers (HTTP protocol)', () => {
  const store = () => new TokenStore(path.join(tmpDir(), 'tokens.json'));

  it('YouTube: refresh token → resumable upload', async () => {
    const m = mockFetch([
      ['POST', /oauth2\.googleapis\.com\/token/, () => json({ access_token: 'ya29', expires_in: 3600 })],
      ['POST', /upload\/youtube\/v3\/videos/, () => new Response('', { status: 200, headers: { location: 'https://upload.test/session' } })],
      ['PUT', /upload\.test\/session/, () => json({ id: 'vid123' })],
    ]);
    restore = m.restore;
    const yt = new YouTubePublisher({ clientId: 'c', clientSecret: 's', refreshToken: 'r', privacy: 'public', categoryId: '22', store: store() });
    const at = new Date(Date.now() + 3600_000);
    const res = await yt.publish(request({ scheduledAt: at }));
    expect(res).toMatchObject({ status: 'scheduled', url: 'https://youtube.com/shorts/vid123' });
    const meta = JSON.parse(m.calls[1]!.body as string);
    expect(meta.status).toMatchObject({ privacyStatus: 'private', publishAt: at.toISOString() });
    expect(meta.snippet.tags).toEqual(['Sirago', 'BurkinaFaso']);
    expect(m.calls[1]!.headers.authorization).toBe('Bearer ya29');
    expect(m.calls[2]!.headers['content-type']).toBe('video/mp4');
  });

  it('TikTok draft mode: refresh (rotating token) → inbox init → upload → status', async () => {
    const m = mockFetch([
      ['POST', /oauth\/token/, () => json({ access_token: 'act', refresh_token: 'new-refresh', expires_in: 86400, refresh_expires_in: 1, open_id: 'o' })],
      ['POST', /inbox\/video\/init/, () => json({ data: { publish_id: 'p1', upload_url: 'https://upload.tiktok.test/1' }, error: { code: 'ok', message: '' } })],
      ['PUT', /upload\.tiktok\.test/, () => new Response('', { status: 201 })],
      ['POST', /status\/fetch/, () => json({ data: { status: 'SEND_TO_USER_INBOX' }, error: { code: 'ok', message: '' } })],
    ]);
    restore = m.restore;
    const tokens = store();
    const tt = new TikTokPublisher({ clientKey: 'k', clientSecret: 's', refreshToken: 'old', mode: 'draft', privacy: 'PUBLIC_TO_EVERYONE', store: tokens });
    const res = await tt.publish(request());
    expect(res.status).toBe('draft');
    expect(tokens.get('tiktok')!.refreshToken).toBe('new-refresh');
    expect(m.calls[2]!.headers['content-range']).toBe('bytes 0-2047/2048');
  });

  it('TikTok direct mode falls back to an allowed privacy level', async () => {
    const m = mockFetch([
      ['POST', /creator_info/, () => json({ data: { privacy_level_options: ['SELF_ONLY'] }, error: { code: 'ok', message: '' } })],
      ['POST', /video\/init/, () => json({ data: { publish_id: 'p2', upload_url: 'https://upload.tiktok.test/2' }, error: { code: 'ok', message: '' } })],
      ['PUT', /upload\.tiktok\.test/, () => new Response('', { status: 201 })],
      ['POST', /status\/fetch/, () => json({ data: { status: 'PUBLISH_COMPLETE', publicaly_available_post_id: [777] }, error: { code: 'ok', message: '' } })],
    ]);
    restore = m.restore;
    const tt = new TikTokPublisher({ clientKey: 'k', clientSecret: 's', accessToken: 'tok', mode: 'direct', privacy: 'PUBLIC_TO_EVERYONE', store: store() });
    const res = await tt.publish(request());
    expect(res).toMatchObject({ status: 'published', url: 'https://www.tiktok.com/video/777' });
    expect(JSON.parse(m.calls[1]!.body as string).post_info.privacy_level).toBe('SELF_ONLY');
    expect(res.message).toMatch(/SELF_ONLY/);
  });

  it('Facebook: vertical short → Reels flow', async () => {
    const m = mockFetch([
      ['POST', /video_reels\?.*upload_phase=start/, () => json({ video_id: 'r1', upload_url: 'https://rupload.facebook.com/video-upload/v23.0/r1' })],
      ['POST', /rupload\.facebook\.com/, () => json({ success: true })],
      ['POST', /video_reels\?.*upload_phase=finish/, () => json({ success: true })],
    ]);
    restore = m.restore;
    const fb = new FacebookPublisher({ graphVersion: 'v23.0', pageId: 'PAGE', pageToken: 'PT' });
    const res = await fb.publish(request());
    expect(res).toMatchObject({ status: 'published', url: 'https://www.facebook.com/reel/r1' });
    expect(m.calls[1]!.headers).toMatchObject({ authorization: 'OAuth PT', offset: '0', file_size: '2048' });
    expect(m.calls[2]!.url).toContain('video_state=PUBLISHED');
  });

  it('Facebook: landscape → /videos multipart with native scheduling', async () => {
    const m = mockFetch([['POST', /graph-video\.facebook\.com\/v23\.0\/PAGE\/videos/, () => json({ id: 'v9' })]]);
    restore = m.restore;
    const fb = new FacebookPublisher({ graphVersion: 'v23.0', pageId: 'PAGE', pageToken: 'PT' });
    const res = await fb.publish(request({ width: 1920, height: 1080, scheduledAt: new Date(Date.now() + 86400_000) }));
    expect(res.status).toBe('scheduled');
    const form = m.calls[0]!.body as FormData;
    expect(form.get('published')).toBe('false');
    expect(form.get('source')).toBeInstanceOf(Blob);
  });

  it('Instagram: resumable Reel container → upload → wait → publish', async () => {
    let polls = 0;
    const m = mockFetch([
      ['POST', /\/IG\/media\?/, () => json({ id: 'c1', uri: 'https://rupload.facebook.com/ig-api-upload/v23.0/c1' })],
      ['POST', /rupload\.facebook\.com\/ig-api-upload/, () => json({ success: true })],
      ['GET', /\/c1\?fields=status_code/, () => json({ status_code: ++polls > 1 ? 'FINISHED' : 'IN_PROGRESS' })],
      ['POST', /media_publish/, () => json({ id: 'm1' })],
      ['GET', /\/m1\?fields=permalink/, () => json({ permalink: 'https://instagram.com/reel/m1' })],
    ]);
    restore = m.restore;
    const ig = new InstagramPublisher({ graphVersion: 'v23.0', instagramUserId: 'IG', instagramToken: 'T' });
    const { vi } = await import('vitest');
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const promise = ig.publish(request());
    await vi.runAllTimersAsync();
    const res = await promise;
    vi.useRealTimers();
    expect(res).toMatchObject({ status: 'published', url: 'https://instagram.com/reel/m1' });
    expect(m.calls[0]!.url).toContain('media_type=REELS');
    expect(m.calls[0]!.url).toContain('upload_type=resumable');
  });

  it('LinkedIn: initialize → upload parts (ETags) → finalize → wait → post', async () => {
    const m = mockFetch([
      ['POST', /videos\?action=initializeUpload/, () => json({ value: { video: 'urn:li:video:1', uploadToken: 'tok', uploadInstructions: [{ uploadUrl: 'https://up.test/1', firstByte: 0, lastByte: 1023 }, { uploadUrl: 'https://up.test/2', firstByte: 1024, lastByte: 2047 }] } })],
      ['PUT', /up\.test\/1/, () => new Response('', { headers: { etag: 'e1' } })],
      ['PUT', /up\.test\/2/, () => new Response('', { headers: { etag: 'e2' } })],
      ['POST', /videos\?action=finalizeUpload/, () => new Response('')],
      ['GET', /rest\/videos\/urn/, () => json({ status: 'AVAILABLE' })],
      ['POST', /rest\/posts/, () => new Response('', { status: 201, headers: { 'x-restli-id': 'urn:li:share:9' } })],
    ]);
    restore = m.restore;
    const li = new LinkedInPublisher({ accessToken: 'at', authorUrn: 'urn:li:person:abc', version: '202608', visibility: 'PUBLIC', store: store() });
    const res = await li.publish(request());
    expect(res).toMatchObject({ status: 'published', url: 'https://www.linkedin.com/feed/update/urn:li:share:9' });
    expect(JSON.parse(m.calls[3]!.body as string).finalizeUploadRequest.uploadedPartIds).toEqual(['e1', 'e2']);
    expect(m.calls[0]!.headers['linkedin-version']).toBe('202608');
    const post = JSON.parse(m.calls[5]!.body as string);
    expect(post.commentary).toContain('\\#Sirago');
    expect(post.content.media.id).toBe('urn:li:video:1');
  });
});

describe('publication service & scheduler', () => {
  const fakePublisher = (id: Publisher['id'], fail = false): Publisher => ({
    id,
    label: id,
    constraints: { maxCaption: 2200, maxHashtags: 30, minDurationSec: 1, maxDurationSec: 600, vertical: true, nativeScheduling: id === 'youtube' },
    publish: async (req) => {
      if (fail) throw new Error('quota');
      return { platform: id, status: req.scheduledAt ? 'scheduled' : 'published', url: `https://${id}.test/1` };
    },
  });

  it('publishes, reports failures, records history; dry-run sends nothing', async () => {
    const { config, result } = await makeJob();
    const store = new ScheduleStore(path.join(tmpDir(), 'schedule.json'));
    const dry = await publishJob(config, result.jobDir, { platforms: ['tiktok'], dryRun: true, publisherFactory: () => { throw new Error('should not be called'); }, scheduleStore: store });
    expect(dry.outcomes[0]).toMatchObject({ ok: true, status: 'dry-run' });
    expect(fs.existsSync(path.join(result.jobDir, 'publish.json'))).toBe(false);

    const run = await publishJob(config, result.jobDir, { platforms: ['tiktok', 'linkedin'], publisherFactory: (id) => fakePublisher(id, id === 'linkedin'), scheduleStore: store });
    expect(run.outcomes.map((o) => [o.platform, o.ok, o.status])).toEqual([['tiktok', true, 'published'], ['linkedin', false, 'failed']]);
    expect(run.outcomes[1]!.message).toMatch(/quota/);
    expect(JSON.parse(fs.readFileSync(path.join(result.jobDir, 'publish.json'), 'utf8'))).toHaveLength(1);
  });

  it('schedules natively when possible, locally otherwise, and the scheduler publishes due entries', async () => {
    const { config, result } = await makeJob();
    const store = new ScheduleStore(path.join(tmpDir(), 'schedule.json'));
    const at = new Date(Date.now() + 3600_000);
    const run = await publishJob(config, result.jobDir, { platforms: ['youtube', 'instagram'], at, publisherFactory: (id) => fakePublisher(id), scheduleStore: store });
    expect(run.outcomes.find((o) => o.platform === 'youtube')!.status).toBe('scheduled');
    expect(run.outcomes.find((o) => o.platform === 'instagram')!.status).toBe('scheduled-local');
    expect(store.list()).toMatchObject([{ platforms: ['instagram'], status: 'pending' }]);

    expect(await runDueEntries(store, async () => [], undefined, new Date())).toBe(0);
    const published: string[][] = [];
    const processed = await runDueEntries(store, async (_dir, platforms) => (published.push(platforms), platforms.map((platform) => ({ platform, ok: true }))), undefined, new Date(at.getTime() + 1000));
    expect(processed).toBe(1);
    expect(published).toEqual([['instagram']]);
    expect(store.list()[0]!.status).toBe('done');
    const second = store.add({ jobDir: 'x', platforms: ['tiktok'], at: at.toISOString() });
    expect(store.cancel(second.id)).toBe(true);
    expect(store.cancel(second.id)).toBe(false);
  });

  it('rejects formats a platform cannot take', async () => {
    const { config, result } = await makeJob();
    fs.renameSync(path.join(result.jobDir, 'video.mp4'), path.join(result.jobDir, 'video.gif'));
    const job = JSON.parse(fs.readFileSync(path.join(result.jobDir, 'job.json'), 'utf8'));
    fs.writeFileSync(path.join(result.jobDir, 'job.json'), JSON.stringify({ ...job, videoFile: 'video.gif' }));
    const run = await publishJob(config, result.jobDir, { platforms: ['instagram'], publisherFactory: (id) => fakePublisher(id) });
    expect(run.outcomes[0]).toMatchObject({ ok: false, status: 'failed' });
  });
});

describe('auth helpers', () => {
  it('runs the OAuth flow through a local callback server', async () => {
    let authorizeUrl = '';
    const code = runOAuthFlow({
      redirectUri: 'http://127.0.0.1:18765/callback',
      authorizeUrl: (redirect, state) => `https://auth.test/?redirect_uri=${encodeURIComponent(redirect)}&state=${state}`,
      prompt: (url) => {
        authorizeUrl = url;
        const state = new URL(url).searchParams.get('state');
        void fetch(`http://127.0.0.1:18765/callback?code=abc&state=${state}`);
      },
    });
    await expect(code).resolves.toBe('abc');
    expect(authorizeUrl).toContain('redirect_uri=http');
  });

  it('rejects a wrong state in manual mode', async () => {
    await expect(
      runOAuthFlow({ redirectUri: 'https://example.com/cb', authorizeUrl: () => 'https://auth.test', prompt: () => undefined, readRedirect: async () => 'https://example.com/cb?code=x&state=forged' }),
    ).rejects.toThrow(/state/);
  });

  it('updates .env without touching other lines', () => {
    const file = path.join(tmpDir(), '.env');
    fs.writeFileSync(file, '# comment\nOPENAI_API_KEY=sk\nYOUTUBE_REFRESH_TOKEN=old\n');
    updateEnvFile(file, { YOUTUBE_REFRESH_TOKEN: 'new', LINKEDIN_AUTHOR_URN: 'urn:li:person:1' });
    expect(fs.readFileSync(file, 'utf8')).toBe('# comment\nOPENAI_API_KEY=sk\nYOUTUBE_REFRESH_TOKEN=new\nLINKEDIN_AUTHOR_URN=urn:li:person:1\n');
  });
});
