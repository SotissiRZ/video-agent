import { describe, expect, it } from 'vitest';
import { detectLanguage, extractKeywords, parseDuration, parseFormat, parsePrompt } from '../src/prompt/parser';

const SIRAGO = 'Crée une vidéo verticale de 30 secondes pour promouvoir Sirago auprès des chauffeurs au Burkina Faso.';

describe('prompt parser', () => {
  it('parses the reference brief', () => {
    const p = parsePrompt(SIRAGO);
    expect(p.language).toBe('fr');
    expect(p.durationSec).toBe(30);
    expect(p.format).toEqual({ id: 'vertical', width: 1080, height: 1920 });
    expect(p.brand).toBe('Sirago');
    expect(p.audience).toBe('chauffeurs');
    expect(p.location).toBe('Burkina Faso');
    expect(p.locationPhrase).toBe('au Burkina Faso');
    expect(p.topic).toBe('Sirago');
  });

  it.each([
    ['une vidéo de 45s', 45],
    ['a 20 second clip', 20],
    ['durée 1 min 30', 90],
    ['about 1m30', 90],
    ['2 minutes', 120],
    ['une minute', 60],
    ['trente secondes', 30],
    ['quinze secondes', 15],
    ['12,5 secondes', 13],
  ])('duration in "%s" → %i s', (text, expected) => {
    expect(parseDuration(text)).toBe(expected);
  });

  it('returns undefined when there is no duration', () => {
    expect(parseDuration('une belle vidéo')).toBeUndefined();
  });

  it.each([
    ['format carré', 'square'],
    ['square video', 'square'],
    ['en 16:9', 'landscape'],
    ['vidéo horizontale', 'landscape'],
    ['pour TikTok', 'vertical'],
    ['YouTube Shorts', 'vertical'],
    ['pour YouTube', 'landscape'],
    ['format 4:5', 'portrait'],
  ])('format in "%s" → %s', (text, id) => {
    expect(parseFormat(text).format?.id).toBe(id);
  });

  it('parses explicit resolutions and fps', () => {
    const p = parsePrompt('Create a storytelling video, 1280x720, 60 fps');
    expect(p.format).toMatchObject({ width: 1280, height: 720 });
    expect(p.fps).toBe(60);
  });

  it('detects English briefs and English audiences', () => {
    const p = parsePrompt('Make a 45s TikTok video to launch Zeta Pay for small shop owners in Nigeria, with voice-over');
    expect(p.language).toBe('en');
    expect(p.brand).toBe('Zeta Pay');
    expect(p.audience).toBe('small shop owners');
    expect(p.location).toBe('Nigeria');
    expect(p.platform).toBe('tiktok');
    expect(p.wantsVoice).toBe(true);
  });

  it('reads quoted brand names and negative toggles', () => {
    const p = parsePrompt('Annonce pour l\'ouverture du restaurant « Chez Awa » à Dakar, sans musique, sans sous-titres');
    expect(p.brand).toBe('Chez Awa');
    expect(p.location).toBe('Dakar');
    expect(p.wantsMusic).toBe(false);
    expect(p.wantsSubtitles).toBe(false);
  });

  it('extracts style hints and keywords', () => {
    const p = parsePrompt('Vidéo minimaliste et élégante pour une marque de café');
    expect(p.styleHints).toEqual(expect.arrayContaining(['minimal', 'elegant']));
    expect(extractKeywords('Vidéo pour une marque de café')).toEqual(['marque', 'cafe']);
  });

  it('detects language', () => {
    expect(detectLanguage('Create a video for our new product')).toBe('en');
    expect(detectLanguage('Fais une vidéo pour notre nouveau produit')).toBe('fr');
  });

  it('does not take a place or a person introduced by "de" for a brand', () => {
    expect(parsePrompt("Raconte l'histoire d'une couturière de Bamako").brand).toBeUndefined();
    expect(parsePrompt('Crée une pub pour promouvoir Sirago').brand).toBe('Sirago');
  });

  it('extracts the subject of a story', () => {
    expect(parsePrompt("Raconte en 2 minutes l'histoire d'une couturière de Bamako qui lance sa marque grâce aux réseaux sociaux.").topic).toBe('une couturière de Bamako');
    expect(parsePrompt("Tell the story of a young farmer in Kenya who builds a cooperative").topic).toBe('a young farmer');
  });

  it('falls back to a topic when there is no brand', () => {
    const p = parsePrompt('Tutoriel de 1 min 30 expliquant comment installer notre application mobile, style minimaliste');
    expect(p.brand).toBeUndefined();
    expect(p.topic).toBe('comment installer notre application mobile');
    expect(p.durationSec).toBe(90);
  });
});

describe('topic extraction', () => {
  it('drops chained intent verbs ("pour promouvoir un café" → "un café")', () => {
    expect(parsePrompt('Crée une vidéo verticale de 30 secondes pour promouvoir un café à la plage en ville').topic).toBe('un café à la plage en ville');
    expect(parsePrompt('Fais une vidéo pour présenter notre nouvelle application de livraison').topic).toBe('notre nouvelle application de livraison');
    expect(parsePrompt('Make a video to promote my yoga studio').topic).toBe('my yoga studio');
  });
});

describe('brand detection', () => {
  it('does not take acronyms or generic tech words for a brand', () => {
    const p = parsePrompt('Crée une vidéo verticale de 30 secondes pour présenter notre plateforme SaaS de cybersécurité pour les PME, style tech');
    expect(p.brand).toBeUndefined();
    expect(p.topic).toBe('notre plateforme SaaS de cybersécurité');
    expect(parsePrompt('Make a video about our AI API for developers').brand).toBeUndefined();
    expect(parsePrompt('Crée une vidéo pour promouvoir Sirago auprès des chauffeurs').brand).toBe('Sirago');
  });
});
