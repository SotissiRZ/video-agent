/**
 * Customer voices: an ElevenLabs instant voice clone of the account owner (one per account) and
 * their pronunciation dictionary, applied to every voice-over they generate.
 */
import { z } from 'zod';
import type { Pronunciation } from '../core/pronunciation';
import type { Db } from './db';
import { HttpError } from './http';

export interface VoiceClone {
  user_id: string;
  provider: string;
  voice_id: string;
  name: string;
  created_at: Date | string;
}

/** ElevenLabs voice management; replaced in tests. */
export interface VoiceCloner {
  create(input: { name: string; audio: Buffer; mimeType: string }): Promise<string>;
  remove(voiceId: string): Promise<void>;
}

const AUDIO_TYPES: Record<string, string> = { 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav', 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac' };
export const audioExtension = (mimeType: string): string | undefined => AUDIO_TYPES[mimeType.split(';')[0]!.trim().toLowerCase()];

export const elevenLabsCloner = (apiKey: string, fetchImpl: typeof fetch = fetch): VoiceCloner => ({
  async create({ name, audio, mimeType }) {
    const form = new FormData();
    form.append('name', name);
    form.append('description', 'Voix clonée par son propriétaire sur SOVID AI');
    form.append('remove_background_noise', 'true');
    form.append('files', new Blob([new Uint8Array(audio)], { type: mimeType.split(';')[0] }), `sample.${audioExtension(mimeType) ?? 'mp3'}`);
    const res = await fetchImpl('https://api.elevenlabs.io/v1/voices/add', { method: 'POST', headers: { 'xi-api-key': apiKey }, body: form, signal: AbortSignal.timeout(120_000) });
    const text = await res.text();
    if (!res.ok) {
      if (/can_not_use_instant_voice_cloning|instant voice cloning|paid|subscription/i.test(text) || res.status === 402) {
        throw new HttpError(503, 'Le clonage de voix n’est pas disponible avec l’abonnement ElevenLabs de la plateforme.', 'voice_clone_unavailable');
      }
      if (/voice_limit|maximum amount of custom voices|voice limit/i.test(text)) throw new HttpError(503, 'La plateforme a atteint son nombre maximal de voix clonées. Réessayez plus tard.', 'voice_clone_limit');
      if (res.status === 400 || res.status === 422) throw new HttpError(400, 'L’enregistrement n’a pas pu être utilisé. Enregistrez au moins une minute de parole claire, sans musique.', 'voice_clone_sample');
      throw new HttpError(502, `ElevenLabs a refusé le clonage (HTTP ${res.status}).`, 'voice_clone_failed');
    }
    const voiceId = (JSON.parse(text) as { voice_id?: string }).voice_id;
    if (!voiceId) throw new HttpError(502, 'ElevenLabs n’a pas renvoyé de voix.', 'voice_clone_failed');
    return voiceId;
  },
  async remove(voiceId) {
    const res = await fetchImpl(`https://api.elevenlabs.io/v1/voices/${encodeURIComponent(voiceId)}`, { method: 'DELETE', headers: { 'xi-api-key': apiKey }, signal: AbortSignal.timeout(30_000) });
    // Already gone on ElevenLabs: nothing left to free.
    if (!res.ok && res.status !== 404) throw new Error(`ElevenLabs voice deletion failed: HTTP ${res.status}`);
  },
});

export const getVoiceClone = (db: Db, userId: string) => db.one<VoiceClone>('SELECT * FROM voice_clones WHERE user_id = $1', [userId]);

export const saveVoiceClone = (db: Db, userId: string, voiceId: string, name: string) =>
  db.one<VoiceClone>(
    `INSERT INTO voice_clones (user_id, provider, voice_id, name) VALUES ($1, 'elevenlabs', $2, $3)
     ON CONFLICT (user_id) DO UPDATE SET voice_id = excluded.voice_id, name = excluded.name, created_at = now() RETURNING *`,
    [userId, voiceId, name],
  );

export const deleteVoiceClone = (db: Db, userId: string) => db.one<VoiceClone>('DELETE FROM voice_clones WHERE user_id = $1 RETURNING *', [userId]);

export const PronunciationSchema = z.object({
  word: z.string().trim().min(1).max(60),
  spoken: z.string().trim().min(1).max(120),
});
export const MAX_PRONUNCIATIONS = 100;

export const listPronunciations = (db: Db, userId: string): Promise<Pronunciation[]> =>
  db.query<Pronunciation>('SELECT word, spoken FROM pronunciations WHERE user_id = $1 ORDER BY lower(word)', [userId]);

/** Replace the whole dictionary (the settings page edits it as a list). */
export const replacePronunciations = async (db: Db, userId: string, entries: Pronunciation[]): Promise<Pronunciation[]> => {
  const unique = new Map(entries.map((entry) => [entry.word.trim().toLowerCase(), { word: entry.word.trim(), spoken: entry.spoken.trim() }]));
  if (unique.size > MAX_PRONUNCIATIONS) throw new HttpError(400, `Au maximum ${MAX_PRONUNCIATIONS} prononciations.`, 'pronunciation_limit');
  await db.tx(async (tx) => {
    await tx.query('DELETE FROM pronunciations WHERE user_id = $1', [userId]);
    for (const entry of unique.values()) await tx.query('INSERT INTO pronunciations (user_id, word, spoken) VALUES ($1, $2, $3)', [userId, entry.word, entry.spoken]);
  });
  return listPronunciations(db, userId);
};

/** Add or update one word (saved from a pronunciation fix on a video). */
export const upsertPronunciation = async (db: Db, userId: string, entry: Pronunciation): Promise<void> => {
  const current = await listPronunciations(db, userId);
  await replacePronunciations(db, userId, [...current.filter((e) => e.word.toLowerCase() !== entry.word.trim().toLowerCase()), entry]);
};
