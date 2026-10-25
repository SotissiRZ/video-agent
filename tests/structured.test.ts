import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parsePrompt } from '../src/prompt/parser';
import { alignNarration, parseStructuredPrompt, plannedFromStructured, splitNarration, visualKeywordsFor } from '../src/prompt/structured';
import { applyBrandColors, luminance, parseHexColors } from '../src/storyboard/brand-colors';
import { getStyle } from '../src/remotion/contract/styles';

const text = fs.readFileSync(path.join(__dirname, 'fixtures', 'structured-prompt.txt'), 'utf8');

describe('production notes after the script', () => {
  it('never shows or reads aloud the notes written after the final texts', () => {
    const prompt = fs.readFileSync(path.resolve('tests/fixtures/zsr-script-with-notes.txt'), 'utf8');
    const script = parseStructuredPrompt(prompt)!;
    expect(script.finalTexts).toEqual(['ZSR-TechNum', 'Votre idée. Notre technologie.', 'Contactez-nous pour votre projet.']);
    expect(script.voiceover).toMatch(/^Vous avez une idée/);
    expect(script.voiceover).not.toMatch(/impression de confiance|IMPORTANT|faux logo/);
    const planned = plannedFromStructured(script, { brand: 'ZSR-TechNum', totalSec: 60, language: 'fr' });
    const everything = JSON.stringify(planned);
    expect(everything).not.toMatch(/impression de confiance|Le rendu doit|IMPORTANT|faux logo|texte déformé/);
    // A six-item list keeps all its items.
    expect(planned.find((p) => p.items.includes('PDF'))!.items).toEqual(['Logo', 'Affiche', 'Bannière', 'Flyer', 'PDF', 'PPTX']);
  });

  it('keeps an unquoted voice-over written on several lines', () => {
    const script = parseStructuredPrompt(['SCÈNE 1 — A (0–5 s)', 'Texte : « Bonjour »', 'SCÈNE 2 — B (5–10 s)', 'Texte : « Merci »', 'Voix off :', 'Bienvenue chez nous.', 'Nous livrons partout à Dakar.'].join('\n'))!;
    expect(script.voiceover).toBe('Bienvenue chez nous. Nous livrons partout à Dakar.');
  });
});

describe('detailed scripts (SCÈNE 1 — … (0–5 s))', () => {
  it('reads scenes, timings, on-screen texts, voice-over and final texts', () => {
    const s = parseStructuredPrompt(text)!;
    expect(s.scenes).toHaveLength(7);
    expect(s.scenes[1]).toMatchObject({ title: 'DÉVELOPPEMENT WEB', startSec: 5, endSec: 12, texts: ['Sites web & applications', 'Des solutions modernes adaptées à vos besoins.'] });
    expect(s.scenes[1]!.description).toMatch(/site web moderne/);
    expect(s.totalSec).toBe(60);
    expect(s.minSec).toBe(45);
    expect(s.voiceover).toMatch(/^Vous avez une idée/);
    expect(s.finalTexts).toEqual(['ZSR-TechNum', 'Votre idée. Notre technologie.', 'Contactez-nous pour votre projet.']);
    expect(parseStructuredPrompt('Une vidéo pour mon café')).toBeUndefined();
  });

  it('keeps the user texts and matches the voice-over to the scene it talks about', () => {
    const s = parseStructuredPrompt(text)!;
    const planned = plannedFromStructured(s, { brand: 'ZSR-TechNum', totalSec: 60, language: 'fr' });
    expect(planned.map((p) => p.kind)).toEqual(['title', 'text', 'bullets', 'text', 'bullets', 'image', 'cta']);
    expect(planned[2]!.items).toEqual(['Machine Learning', 'Computer Vision', 'Data Science']);
    expect(planned[1]!.narration).toMatch(/Développement web/);
    expect(planned[2]!.narration).toMatch(/intelligence artificielle/);
    expect(planned[3]!.narration).toMatch(/automatisation/);
    expect(planned[4]!.narration).toMatch(/contenus professionnels/);
    expect(planned[6]).toMatchObject({ headline: 'Votre idée. Notre *technologie.*', subheadline: 'Contactez-nous' });
    expect(planned[6]!.narration).toMatch(/Contactez-nous/);
    expect(planned[1]!.visualKeywords).toEqual(expect.arrayContaining(['web designer laptop', 'smartphone app interface', 'analytics dashboard laptop']));
    // "Apparition du logo ZSR-TechNum" / "retour au logo ZSR-TechNum": the brand logo, not a stock search.
    expect(planned[0]!.visualKeywords).not.toContain('graphic designer laptop');
    // The closing montage reuses the visuals of the other scenes.
    expect(planned[6]!.visualKeywords[0]).toBe(planned[1]!.visualKeywords[0]);
    expect(planned.map((p) => p.weight)).toEqual([5, 7, 8, 8, 8, 8, 16]);
  });

  it('splits enumerations and keeps the text order when aligning', () => {
    expect(splitNarration('A, b, c, d et e : fin.')).toEqual(['A,', 'b,', 'c,', 'd', 'et e :', 'fin.']);
    expect(splitNarration('Un, deux et trois.')).toEqual(['Un, deux et trois.']);
    const scenes = [{ title: 'Intro', texts: [] }, { title: 'Paiement mobile', texts: [] }, { title: 'Sécurité', texts: [] }];
    // "sécurité" in the first sentence must not pull the whole text to the last scene.
    const out = alignNarration(['Bonjour, en toute sécurité.', 'Le paiement mobile.', 'La sécurité avant tout.'], scenes, [3, 3, 3]);
    expect(out).toEqual(['Bonjour, en toute sécurité.', 'Le paiement mobile.', 'La sécurité avant tout.']);
    expect(visualKeywordsFor('formulaires, bases de données et notifications')).toEqual(['online form laptop', 'server room data center', 'data charts screen', 'smartphone notification']);
  });

  it('uses the style named after "Style visuel :" and the brand colours', () => {
    expect(parsePrompt(text).styleHints[0]).toBe('tech');
    expect(parsePrompt(text).brand).toBe('ZSR-TechNum');
    const colors = parseHexColors('Couleurs : #0b1c8c, #3CC8C8 et #fff');
    expect(colors).toEqual(['#0B1C8C', '#3CC8C8', '#FFFFFF']);
    const theme = applyBrandColors(getStyle('tech').theme, colors);
    expect(theme.palette.background).toBe('#0B1C8C');
    expect(theme.palette.primary).toBe('#FFFFFF');
    expect(theme.palette.accent).toBe('#3CC8C8');
    expect(luminance(theme.palette.background)).toBeLessThan(0.08);
  });
});
